#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const AUTHORIZATION_ID = "openreel-e01-phase-one-cp54";
export const MAX_UNITS = 30_558;
export const CALLS = Object.freeze([
  ...Array.from({ length: 4 }, (_, index) => Object.freeze({ caseId: `image-continuity-${index + 1}`, model: "seedream-5-lite", capability: "image", maximumReservedUnits: 2_778 })),
  ...Array.from({ length: 2 }, (_, index) => Object.freeze({ caseId: `video-sequence-${index + 1}`, model: "seedance-2-fast", capability: "video", maximumReservedUnits: 6_945 })),
  Object.freeze({ caseId: "vision-image-1", model: "embedding-vision", capability: "vision", maximumReservedUnits: 2_778, source: "image" }),
  Object.freeze({ caseId: "vision-video-1", model: "embedding-vision", capability: "vision", maximumReservedUnits: 2_778, source: "video" })
]);

export function validateAuthorization(env = process.env) {
  assert.equal(env.OPENREEL_E01_EXECUTE, "true", "execution switch must be true");
  assert.equal(env.OPENREEL_E01_AUTHORIZATION_ID, AUTHORIZATION_ID, "authorization id mismatch");
  assert.equal(env.OPENREEL_E01_MAX_SUBMISSIONS, "8", "submission ceiling must be 8");
  assert.equal(env.OPENREEL_E01_MAX_UNITS, String(MAX_UNITS), "budget ceiling mismatch");
  assert.equal(env.OPENREEL_ARK_MAX_RETRIES, "0", "automatic provider retries must be disabled");
  assert.equal(CALLS.length, 8);
  assert.equal(CALLS.reduce((sum, item) => sum + item.maximumReservedUnits, 0), MAX_UNITS);
  return true;
}

export function validateLedger(usage, completed, expectedModels) {
  assert.equal(usage.reconciliation?.consistent, true, "ledger reconciliation mismatch");
  assert.equal(usage.subscription?.currency, "USD", "ledger currency mismatch");
  assert.equal(usage.subscription?.unitScale, 10_000, "ledger scale mismatch");
  assert.equal(usage.subscription?.hardLimitMicros, MAX_UNITS, "ledger hard limit mismatch");
  assert.equal(usage.subscription?.reservedMicros, 0, "open reservation remains");
  assert.ok(usage.subscription?.spentMicros <= MAX_UNITS, "aggregate budget exceeded");
  assert.equal(usage.usage?.length, completed, "terminal ledger count mismatch");
  assert.deepEqual(usage.usage.map(item => item.model), expectedModels, "ledger model sequence mismatch");
  return true;
}

function promptFor(call) {
  if (call.capability === "image") return { prompt: `Cinematic storyboard frame ${call.caseId.at(-1)}: the same young astronaut in an orange suit beside the same white rover on a red desert, consistent face, suit patches, rover markings and golden-hour lighting, wide 16:9 composition`, size: "2560x1440", watermark: false, response_format: "url" };
  if (call.capability === "video") return { prompt: `The same young astronaut in an orange suit walks beside the same white rover across a red desert at golden hour, locked character identity and rover markings, slow stable camera, continuity sequence ${call.caseId.at(-1)}`, ratio: "16:9", resolution: "480p", duration: 5, generate_audio: false, watermark: false };
  throw new Error("vision input must be derived from a successful generated result");
}

function transientUrl(job) {
  const value = job?.result?.url;
  assert.ok(typeof value === "string" && value.startsWith("https://"), "terminal result has no safe HTTPS URL");
  return value;
}

async function run() {
  validateAuthorization();
  const base = process.env.OPENREEL_E01_BASE || "http://127.0.0.1:4273", adminKey = process.env.OPENREEL_ADMIN_KEY;
  assert.equal(base, "http://127.0.0.1:4273", "runner is restricted to the approved loopback staging target");
  assert.ok(adminKey, "server-side admin reference is required");
  const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14), password = randomBytes(24).toString("base64url");
  const email = `e01-${marker}@openreel.invalid`;
  let cookie, csrf, application, issued;
  const completed = [], models = [], transient = { image: null, video: null };
  async function request(path, { expected = 200, ...options } = {}) {
    const response = await fetch(`${base}${path}`, options), type = response.headers.get("content-type") || "", value = type.includes("json") ? await response.json() : null;
    if (response.status !== expected) throw Object.assign(new Error(value?.error?.message || `HTTP ${response.status}`), { code: value?.error?.code || "HTTP_ERROR", status: response.status, upstreamStatus: value?.error?.details?.upstreamStatus ?? null });
    return { response, value };
  }
  const userHeaders = () => ({ "content-type": "application/json", cookie, "x-csrf-token": csrf });
  try {
    await request("/api/v1/auth/register", { method: "POST", expected: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); csrf = login.value.csrfToken;
    application = (await request("/api/v1/key-applications", { method: "POST", expected: 201, headers: userHeaders(), body: JSON.stringify({ reason: "Authorized E-01 phase-one isolated staging matrix", requestedLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000 }) })).value;
    await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": adminKey }, body: JSON.stringify({ plan: "e01-phase-one", hardLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000, periodEndsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), reviewedBy: "cp54-human-gate", reviewNote: "8 submissions / USD 3.0558 / zero retry / isolated staging" }) });
    issued = (await request("/api/v1/api-keys", { method: "POST", expected: 201, headers: userHeaders(), body: JSON.stringify({ name: "e01-phase-one-ephemeral" }) })).value;
    for (const call of CALLS) {
      assert.ok(completed.length < 8, "submission ceiling reached");
      const input = call.capability === "vision" ? { input: [{ type: `${call.source}_url`, [`${call.source}_url`]: transient[call.source] }] } : promptFor(call);
      assert.ok(call.capability !== "vision" || transient[call.source], `missing successful ${call.source} result`);
      let job = (await request("/api/v1/inference/jobs", { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-api-key": issued.key }, body: JSON.stringify({ model: call.model, capability: call.capability, input, idempotencyKey: `e01-${marker}-${call.caseId}` }) })).value;
      for (let poll = 0; job.status === "running" && poll < 120; poll += 1) { await new Promise(resolve => setTimeout(resolve, 5_000)); job = (await request(`/api/v1/inference/jobs/${job.id}`, { headers: { "x-openreel-api-key": issued.key } })).value; }
      assert.equal(job.status, "succeeded", `${call.caseId} did not succeed`);
      if (call.capability === "image" && !transient.image) transient.image = transientUrl(job);
      if (call.capability === "video" && !transient.video) transient.video = transientUrl(job);
      completed.push({ caseId: call.caseId, model: call.model, status: job.status, resultShape: job.result && typeof job.result === "object" ? Object.keys(job.result).sort() : typeof job.result }); models.push(call.model);
      const usage = (await request("/api/v1/billing/usage", { headers: userHeaders() })).value;
      validateLedger(usage, completed.length, models);
      process.stdout.write(`${JSON.stringify({ phase: "case_complete", completed: completed.length, total: 8, ...completed.at(-1), spentUnits: usage.subscription.spentMicros })}\n`);
    }
    const usage = (await request("/api/v1/billing/usage", { headers: userHeaders() })).value;
    process.stdout.write(`${JSON.stringify({ status: "passed", authorizationId: AUTHORIZATION_ID, submissions: completed.length, maximumSubmissions: 8, maximumUnits: MAX_UNITS, spentUnits: usage.subscription.spentMicros, retries: 0, reconciliation: usage.reconciliation.consistent, results: completed })}\n`);
  } finally {
    transient.image = transient.video = null;
    if (issued?.id && cookie) await request(`/api/v1/api-keys/${issued.id}`, { method: "DELETE", headers: userHeaders() }).catch(() => {});
    if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": adminKey }, body: JSON.stringify({ reviewNote: "E-01 phase-one runner ended; ephemeral access stopped" }) }).catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(error => { process.stderr.write(`${JSON.stringify({ status: "stopped", code: error.code || "ASSERTION_FAILED", message: error.message, upstreamStatus: error.upstreamStatus ?? null })}\n`); process.exitCode = 1; });
