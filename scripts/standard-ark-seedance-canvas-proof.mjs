#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { persistTerminalPacket, terminalPacket } from "./async-provider-terminal-packet.mjs";

const RETRIES = 0;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function safeError(error) {
  const code = typeof error?.code === "string" && SAFE_CODE.test(error.code) && error.code !== "ERR_ASSERTION" ? error.code : "PROOF_ASSERTION_FAILED";
  return Object.assign(new Error("Seedance proof did not complete"), { code });
}

export async function runStandardArkSeedanceCanvasProof({ fetchImpl = globalThis.fetch, env = process.env, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const base = env.OPENREEL_STANDARD_ARK_PROOF_BASE || "http://127.0.0.1:4373";
  const evidencePath = env.OPENREEL_STANDARD_ARK_TERMINAL_PACKET;
  const outputPath = env.OPENREEL_STANDARD_ARK_RETAINED_MEDIA;
  const model = env.OPENREEL_STANDARD_ARK_MODEL || "seedance-2";
  const endpointId = env.OPENREEL_STANDARD_ARK_ENDPOINT_ID;
  const maximumUnits = Number(env.OPENREEL_STANDARD_ARK_MAX_UNITS);
  if (env.OPENREEL_STANDARD_ARK_PAID_PROOF_CONFIRM !== "SUBMIT_ONE_STANDARD_ARK_PAID_PROOF") return { status: "not_submitted", submissions: 0, retries: RETRIES };
  if (!evidencePath || !endpointId || !Number.isSafeInteger(maximumUnits) || maximumUnits < 1) throw new Error("proof configuration is incomplete");

  let cookie, csrf, application, project, job, usage, artifact, submissions = 0, stage = "authentication";
  const record = async (error = null) => persistTerminalPacket(evidencePath, terminalPacket({ stage, submissions, retries: RETRIES, job, usage, artifact, error, model, endpointId, route: "standard_api_v3" }));
  const request = async (path, { expected = 200, ...options } = {}) => {
    const response = await fetchImpl(`${base}${path}`, options), type = response.headers.get("content-type") || "";
    const value = type.includes("json") ? await response.json() : await response.arrayBuffer();
    if (response.status !== expected) throw Object.assign(new Error("OpenReel request failed"), { code: value?.error?.code || "HTTP_ERROR" });
    return { response, value };
  };
  const headers = () => ({ "content-type": "application/json", cookie, "x-csrf-token": csrf });

  try {
    const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14), email = `seedance-proof-${marker}@openreel.invalid`, password = randomBytes(24).toString("base64url");
    await request("/api/v1/auth/register", { method: "POST", expected: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); csrf = login.value.csrfToken;
    stage = "allowance";
    application = (await request("/api/v1/key-applications", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ reason: "One bounded standard Ark Seedance proof", requestedLimitUnits: maximumUnits, currency: "USD", unitScale: 10_000 }) })).value;
    await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ plan: "standard-ark-seedance-proof", hardLimitUnits: maximumUnits, currency: "USD", unitScale: 10_000, periodEndsAt: new Date(Date.now() + 30 * 60_000).toISOString(), reviewedBy: "explicit-owner-gate", reviewNote: "one 5s 480p silent private Seedance call; zero retries" }) });
    stage = "project_setup";
    project = (await request("/api/v1/projects", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "Standard Ark Seedance isolated proof" }) })).value;
    const session = (await request(`/api/v1/projects/${project.id}/sessions`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "single-call" }) })).value;
    const node = (await request(`/api/v1/sessions/${session.id}/nodes`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ type: "video", title: "Seedance proof clip", content: "", position: { x: 80, y: 80 } }) })).value;
    stage = "submission"; submissions += 1;
    job = (await request(`/api/v1/sessions/${session.id}/ark-jobs`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ nodeId: node.id, model, capability: "video", prompt: "A small orange robot walks beside a white rover across a red desert at golden hour, slow stable camera", parameters: { aspect: "16:9", resolution: "480p", duration: 5, audio: false, watermark: false }, idempotencyKey: `seedance-proof-${marker}` }) })).value;
    await record();
    stage = "polling";
    for (let poll = 0; job.state === "running" && poll < 120; poll += 1) { await wait(5_000); job = (await request(`/api/v1/jobs/${job.id}/ark-poll`, { method: "POST", expected: 201, headers: headers(), body: "{}" })).value; await record(); }
    usage = (await request("/api/v1/billing/usage", { headers: headers() })).value;
    stage = "terminal"; await record();
    if (job.state !== "succeeded") throw Object.assign(new Error("provider task did not succeed"), { code: job.error?.code || "ARK_TASK_FAILED" });
    const snapshot = (await request(`/api/v1/projects/${project.id}`, { headers: headers() })).value;
    const assets = (await request(`/api/v1/projects/${project.id}/assets`, { headers: headers() })).value;
    artifact = assets.find(value => value.id === job.assetId);
    stage = "asset_metadata"; await record();
    assert.equal(artifact?.mimeType, "video/mp4"); assert.ok(artifact.byteLength > 0);
    const download = await request(`/api/v1/projects/${project.id}/assets/${artifact.id}/content`, { headers: { cookie } });
    const bytes = Buffer.from(download.value); assert.equal(bytes.length, artifact.byteLength);
    artifact = { ...artifact, sha256: createHash("sha256").update(bytes).digest("hex") };
    if (outputPath) await writeFile(outputPath, bytes, { mode: 0o600 });
    stage = "billing"; await record();
    assert.equal(usage.reconciliation.consistent, true); assert.equal(usage.subscription.reservedMicros, 0); assert.ok(usage.subscription.spentMicros <= maximumUnits);
    const clips = snapshot.timeline.tracks.filter(value => value.kind === "video").flatMap(value => value.clips);
    stage = "timeline"; await record(); assert.equal(clips.length, 1); assert.equal(clips[0].assetId, artifact.id);
    stage = "succeeded"; await record();
    return { status: "succeeded", submissions, retries: RETRIES, model, endpointId, byteLength: artifact.byteLength, sha256: artifact.sha256, spentUnits: usage.subscription.spentMicros };
  } catch (cause) {
    const error = safeError(cause);
    if (project && cookie) {
      try { const snapshot = (await request(`/api/v1/projects/${project.id}`, { headers: headers() })).value; job = snapshot.nodes.flatMap(node => node.runs || []).find(value => value.id === job?.id) || job; } catch {}
      try { usage = (await request("/api/v1/billing/usage", { headers: headers() })).value; } catch {}
    }
    await record(error);
    return { status: "failed", submissions, retries: RETRIES, code: error.code, stage };
  } finally {
    if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ reviewNote: "standard Ark Seedance proof ended" }) }).catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runStandardArkSeedanceCanvasProof().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "failed") process.exitCode = 1;
  }, () => { process.stdout.write('{"status":"failed","submissions":0,"retries":0,"code":"PROOF_HARNESS_FAILED"}\n'); process.exitCode = 1; });
}
