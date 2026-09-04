#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { safeAcceptanceStage, terminalJobError } from "./e01-runner-result.mjs";

const BASE = "http://127.0.0.1:4373", MAX_UNITS = 6_945;
assert.equal(process.env.OPENREEL_E01_CP288_EXECUTE, "true");
assert.equal(process.env.OPENREEL_E01_MAX_SUBMISSIONS, "1");
assert.equal(process.env.OPENREEL_E01_MAX_UNITS, String(MAX_UNITS));
assert.equal(process.env.OPENREEL_ARK_MAX_RETRIES, "0");
assert.equal(process.env.OPENREEL_VOLCENGINE_ROUTE_PREFERENCE, "direct");
assert.equal(process.env.OPENREEL_VOLCENGINE_DIRECT_BASE_URL, "https://ark.cn-beijing.volces.com/api/plan/v3");

let cookie, csrf, application, submissions = 0, acceptanceStage = "initialization";
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
async function request(path, { expected = 200, ...options } = {}) {
  const response = await fetch(`${BASE}${path}`, options), type = response.headers.get("content-type") || "";
  const value = type.includes("json") ? await response.json() : await response.arrayBuffer();
  if (response.status !== expected) throw Object.assign(new Error("request failed"), { code: value?.error?.code || "HTTP_ERROR", status: response.status, upstreamStatus: value?.error?.details?.upstreamStatus ?? null });
  return { response, value };
}
const headers = () => ({ "content-type": "application/json", cookie, "x-csrf-token": csrf });
try {
  acceptanceStage = "authentication";
  const email = `cp288-video-${marker}@openreel.invalid`, password = randomBytes(24).toString("base64url");
  await request("/api/v1/auth/register", { method: "POST", expected: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); csrf = login.value.csrfToken;
  acceptanceStage = "allowance";
  application = (await request("/api/v1/key-applications", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ reason: "cp288 authorized direct single-video acceptance", requestedLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000 }) })).value;
  await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ plan: "cp288-direct-single-video", hardLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000, periodEndsAt: new Date(Date.now() + 30 * 60_000).toISOString(), reviewedBy: "cp287-owner-gate", reviewNote: "one 5s 480p silent seedance-2-fast direct call; CNY 30 ceiling; zero retry" }) });
  acceptanceStage = "project_setup";
  const project = (await request("/api/v1/projects", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "cp288 isolated direct real-video acceptance" }) })).value;
  const session = (await request(`/api/v1/projects/${project.id}/sessions`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "single-call" }) })).value;
  const node = (await request(`/api/v1/sessions/${session.id}/nodes`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ type: "video", title: "Real Seedance clip", content: "", position: { x: 80, y: 80 } }) })).value;
  acceptanceStage = "submission"; submissions += 1;
  let job = (await request(`/api/v1/sessions/${session.id}/ark-jobs`, { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ nodeId: node.id, model: "seedance-2-fast", capability: "video", prompt: "A small orange robot walks beside a white rover across a red desert at golden hour, slow stable camera, consistent robot and rover markings", parameters: { aspect: "16:9", resolution: "480p", duration: 5, audio: false, watermark: false }, idempotencyKey: `cp288-${marker}` }) })).value;
  acceptanceStage = "polling";
  for (let poll = 0; job.state === "running" && poll < 120; poll += 1) { await new Promise(resolve => setTimeout(resolve, 5_000)); job = (await request(`/api/v1/jobs/${job.id}/ark-poll`, { method: "POST", expected: 201, headers: headers(), body: "{}" })).value; }
  acceptanceStage = "terminal";
  if (job.state !== "succeeded") {
    const usage = (await request("/api/v1/billing/usage", { headers: headers() })).value;
    throw terminalJobError(job, usage);
  }
  acceptanceStage = "project_snapshot";
  const snapshot = (await request(`/api/v1/projects/${project.id}`, { headers: headers() })).value;
  acceptanceStage = "asset_metadata";
  const assets = (await request(`/api/v1/projects/${project.id}/assets`, { headers: headers() })).value, asset = assets.find(value => value.id === job.assetId);
  assert.equal(asset.mimeType, "video/mp4"); assert.ok(asset.byteLength > 0);
  acceptanceStage = "asset_download";
  const download = await request(`/api/v1/projects/${project.id}/assets/${asset.id}/content`, { headers: { cookie } });
  assert.equal(download.response.headers.get("content-type"), "video/mp4"); assert.equal(download.value.byteLength, asset.byteLength);
  acceptanceStage = "billing";
  const usage = (await request("/api/v1/billing/usage", { headers: headers() })).value;
  assert.equal(usage.reconciliation.consistent, true); assert.equal(usage.subscription.reservedMicros, 0); assert.ok(usage.subscription.spentMicros <= MAX_UNITS);
  acceptanceStage = "timeline";
  const clips = snapshot.timeline.tracks.filter(value => value.kind === "video").flatMap(value => value.clips);
  assert.equal(clips.length, 1); assert.equal(clips[0].assetId, asset.id);
  process.stdout.write(JSON.stringify({ status: "succeeded", submissions, route: "direct_plan_v3", model: "seedance-2-fast", mimeType: asset.mimeType, bytes: asset.byteLength, downloadedBytes: download.value.byteLength, assetCount: assets.length, videoClipCount: clips.length, spentUnits: usage.subscription.spentMicros, reservedUnits: usage.subscription.reservedMicros, reconciliation: usage.reconciliation.consistent }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ status: "stopped", submissions, code: error.code || "ASSERTION_FAILED", acceptanceStage: safeAcceptanceStage(acceptanceStage), terminalState: error.terminalState ?? null, httpStatus: error.status ?? null, upstreamStatus: error.upstreamStatus ?? null, spentUnits: error.spentUnits ?? null, reservedUnits: error.reservedUnits ?? null, reconciliation: error.reconciliation ?? null }) + "\n"); process.exitCode = 1;
} finally {
  if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ reviewNote: "cp288 direct single-call run ended" }) }).catch(() => {});
}
