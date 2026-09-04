#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const BASE = "http://127.0.0.1:4373", MAX_UNITS = 6_945;
assert.equal(process.env.OPENREEL_E01_CP281_EXECUTE, "true");
assert.equal(process.env.OPENREEL_E01_MAX_SUBMISSIONS, "1");
assert.equal(process.env.OPENREEL_E01_MAX_UNITS, String(MAX_UNITS));
assert.equal(process.env.OPENREEL_ARK_MAX_RETRIES, "0");
assert.ok(process.env.OPENREEL_ADMIN_KEY);

let cookie, csrf, application, submissions = 0;
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
async function request(path, { expected = 200, ...options } = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const type = response.headers.get("content-type") || "";
  const value = type.includes("json") ? await response.json() : await response.arrayBuffer();
  if (response.status !== expected) throw Object.assign(new Error(value?.error?.message || `HTTP ${response.status}`), { code: value?.error?.code || "HTTP_ERROR", status: response.status, upstreamStatus: value?.error?.details?.upstreamStatus ?? null });
  return { response, value };
}
const headers = () => ({ "content-type": "application/json", cookie, "x-csrf-token": csrf });
try {
  const email = `cp281-video-${marker}@openreel.invalid`, password = randomBytes(24).toString("base64url");
  await request("/api/v1/auth/register", { method: "POST", expected: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  cookie = login.response.headers.getSetCookie().map(x => x.split(";", 1)[0]).join("; "); csrf = login.value.csrfToken;
  application = (await request("/api/v1/key-applications", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ reason: "cp281 authorized single real-video canvas acceptance", requestedLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000 }) })).value;
  await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ plan: "cp281-single-video", hardLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000, periodEndsAt: new Date(Date.now() + 30 * 60_000).toISOString(), reviewedBy: "cp280-owner-gate", reviewNote: "one 5s 480p silent seedance-2-fast call; CNY 5 ceiling; zero retry" }) });
  const project = (await request("/api/v1/projects", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "cp281 isolated real-video acceptance" }) })).value;
  const session = (await request(`/api/v1/projects/${project.id}/sessions`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "single-call" }) })).value;
  const node = (await request(`/api/v1/sessions/${session.id}/nodes`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ type: "video", title: "Real Seedance clip", content: "", position: { x: 80, y: 80 } }) })).value;
  submissions += 1;
  let job = (await request(`/api/v1/sessions/${session.id}/ark-jobs`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ nodeId: node.id, model: "seedance-2-fast", capability: "video", prompt: "A small orange robot walks beside a white rover across a red desert at golden hour, slow stable camera, consistent robot and rover markings", parameters: { aspect: "16:9", resolution: "480p", duration: 5, audio: false, watermark: false }, idempotencyKey: `cp281-${marker}` }) })).value;
  for (let poll = 0; job.state === "running" && poll < 120; poll += 1) { await new Promise(r => setTimeout(r, 5_000)); job = (await request(`/api/v1/jobs/${job.id}/ark-poll`, { method: "POST", expected: 201, headers: headers(), body: "{}" })).value; }
  assert.equal(job.state, "succeeded");
  const snapshot = (await request(`/api/v1/projects/${project.id}`, { headers: headers() })).value;
  const assets = (await request(`/api/v1/projects/${project.id}/assets`, { headers: headers() })).value;
  const asset = assets.find(x => x.id === job.assetId);
  assert.equal(asset.mimeType, "video/mp4"); assert.ok(asset.size > 0);
  const download = await request(`/api/v1/projects/${project.id}/assets/${asset.id}/content`, { headers: { cookie } });
  assert.equal(download.response.headers.get("content-type"), "video/mp4"); assert.equal(download.value.byteLength, asset.size);
  const usage = (await request("/api/v1/billing/usage", { headers: headers() })).value;
  assert.equal(usage.reconciliation.consistent, true); assert.equal(usage.subscription.reservedMicros, 0); assert.ok(usage.subscription.spentMicros <= MAX_UNITS);
  const videoClips = snapshot.timeline.tracks.filter(x => x.kind === "video").flatMap(x => x.clips);
  assert.equal(videoClips.length, 1); assert.equal(videoClips[0].assetId, asset.id);
  process.stdout.write(JSON.stringify({ status: "succeeded", submissions, model: "seedance-2-fast", mimeType: asset.mimeType, bytes: asset.size, downloadedBytes: download.value.byteLength, assetCount: assets.length, videoClipCount: videoClips.length, spentUnits: usage.subscription.spentMicros, reservedUnits: usage.subscription.reservedMicros, reconciliation: usage.reconciliation.consistent }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ status: "stopped", submissions, code: error.code || "ASSERTION_FAILED", httpStatus: error.status ?? null, upstreamStatus: error.upstreamStatus ?? null }) + "\n"); process.exitCode = 1;
} finally {
  if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ reviewNote: "cp281 single-call run ended" }) }).catch(() => {});
}
