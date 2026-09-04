#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:4373", MAX_UNITS = 13_890, MAX_SUBMISSIONS = 2;
for (const [key, value] of Object.entries({ OPENREEL_E01_CP320_EXECUTE: "true", OPENREEL_E01_MAX_SUBMISSIONS: String(MAX_SUBMISSIONS), OPENREEL_E01_MAX_UNITS: String(MAX_UNITS), OPENREEL_ARK_MAX_RETRIES: "0", OPENREEL_VOLCENGINE_ROUTE_PREFERENCE: "direct", OPENREEL_VOLCENGINE_DIRECT_BASE_URL: "https://ark.cn-beijing.volces.com/api/plan/v3" })) assert.equal(process.env[key], value);
let cookie, csrf, application, submissions = 0, stage = "initialization";
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14), email = `cp320-continuity-${marker}@openreel.invalid`, password = randomBytes(24).toString("base64url");
async function request(path, { expected = 200, ...options } = {}) { const response = await fetch(`${BASE}${path}`, options), type = response.headers.get("content-type") || ""; const value = type.includes("json") ? await response.json() : await response.arrayBuffer(); if (response.status !== expected) throw Object.assign(new Error("request failed"), { code: value?.error?.code || "HTTP_ERROR", status: response.status, upstreamStatus: value?.error?.details?.upstreamStatus ?? null }); return { response, value }; }
const headers = () => ({ "content-type": "application/json", cookie, "x-csrf-token": csrf });
const shots = [
  "Shot 1 of a continuous scene: a small orange robot with one white circular chest light and a blue stripe walks beside a compact white rover marked R7 across a red desert at golden hour, wide side view, slow stable camera, no cuts",
  "Shot 2 continuing immediately from the same scene: the identical small orange robot with one white circular chest light and blue stripe stops beside the identical compact white rover marked R7 and points toward distant mountains, medium front three-quarter view, same red desert and golden-hour lighting, slow stable camera, no cuts"
];
try {
  stage = "authentication"; await request("/api/v1/auth/register", { method: "POST", expected: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); csrf = login.value.csrfToken;
  stage = "allowance"; application = (await request("/api/v1/key-applications", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ reason: "cp320 two-shot continuity acceptance", requestedLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000 }) })).value;
  await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ plan: "cp320-two-shot-continuity", hardLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000, periodEndsAt: new Date(Date.now() + 30 * 60_000).toISOString(), reviewedBy: "cp319-owner-gate", reviewNote: "two 5s 480p silent seedance-2-fast calls; CNY 60 aggregate ceiling; one submission per shot; zero retry" }) });
  stage = "project_setup"; const project = (await request("/api/v1/projects", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "cp320 isolated two-shot continuity" }) })).value;
  const session = (await request(`/api/v1/projects/${project.id}/sessions`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "two-shot-continuity" }) })).value;
  const assets = [];
  for (let index = 0; index < shots.length; index += 1) {
    stage = `shot_${index + 1}_setup`; const node = (await request(`/api/v1/sessions/${session.id}/nodes`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ type: "video", title: `Continuity shot ${index + 1}`, content: "", position: { x: 80 + index * 360, y: 80 } }) })).value;
    stage = `shot_${index + 1}_submission`; submissions += 1;
    let job = (await request(`/api/v1/sessions/${session.id}/ark-jobs`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ nodeId: node.id, model: "seedance-2-fast", capability: "video", prompt: shots[index], parameters: { aspect: "16:9", resolution: "480p", duration: 5, audio: false, watermark: false }, idempotencyKey: `cp320-shot-${index + 1}-${marker}` }) })).value;
    stage = `shot_${index + 1}_polling`; for (let poll = 0; job.state === "running" && poll < 120; poll += 1) { await new Promise(resolve => setTimeout(resolve, 5_000)); job = (await request(`/api/v1/jobs/${job.id}/ark-poll`, { method: "POST", expected: 201, headers: headers(), body: "{}" })).value; }
    if (job.state !== "succeeded") throw Object.assign(new Error("provider terminal failure"), { code: "PROVIDER_TERMINAL_FAILURE", terminalState: job.state });
    const projectAssets = (await request(`/api/v1/projects/${project.id}/assets`, { headers: headers() })).value, asset = projectAssets.find(value => value.id === job.assetId); assert.equal(asset.mimeType, "video/mp4");
    const download = await request(`/api/v1/projects/${project.id}/assets/${asset.id}/content`, { headers: { cookie } }); assert.equal(download.value.byteLength, asset.byteLength); writeFileSync(`${process.env.OPENREEL_E01_RETAINED_MEDIA_PREFIX}-${index + 1}.mp4`, Buffer.from(download.value), { mode: 0o600 }); assets.push({ id: asset.id, bytes: asset.byteLength });
  }
  stage = "acceptance"; const snapshot = (await request(`/api/v1/projects/${project.id}`, { headers: headers() })).value, usage = (await request("/api/v1/billing/usage", { headers: headers() })).value;
  const clips = snapshot.timeline.tracks.filter(value => value.kind === "video").flatMap(value => value.clips); assert.equal(clips.length, 2); assert.equal(usage.reconciliation.consistent, true); assert.equal(usage.subscription.reservedMicros, 0); assert.ok(usage.subscription.spentMicros <= MAX_UNITS); assert.equal(submissions, 2);
  writeFileSync(process.env.OPENREEL_E01_BROWSER_PACKET, JSON.stringify({ email, password, projectId: project.id, assetIds: assets.map(value => value.id) }), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ status: "api_stages_succeeded", submissions, route: "direct_plan_v3", model: "seedance-2-fast", assets, videoClipCount: clips.length, spentUnits: usage.subscription.spentMicros, reservedUnits: usage.subscription.reservedMicros, reconciliation: usage.reconciliation.consistent }) + "\n");
} catch (error) { process.stdout.write(JSON.stringify({ status: "stopped", submissions, code: error.code || "ASSERTION_FAILED", acceptanceStage: stage, terminalState: error.terminalState ?? null, httpStatus: error.status ?? null, upstreamStatus: error.upstreamStatus ?? null }) + "\n"); process.exitCode = 1; }
finally { if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ reviewNote: "cp320 two-shot run ended" }) }).catch(() => {}); }
