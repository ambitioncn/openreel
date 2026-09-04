#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:4373", MAX_UNITS = 5_556;
for (const [key, value] of Object.entries({ OPENREEL_M01_VISION_EXECUTE: "true", OPENREEL_M01_VISION_AUTHORIZATION: "corrected-v2-once", OPENREEL_M01_MAX_SUBMISSIONS: "2", OPENREEL_M01_MAX_UNITS: String(MAX_UNITS), OPENREEL_ARK_MAX_RETRIES: "0" })) assert.equal(process.env[key], value);
assert.ok(process.env.OPENREEL_ADMIN_KEY);
const fixtures = [
  { caseId: "m01-vision-corrected-image-1", mode: "image-to-text", type: "image_url", mime: "image/png", path: process.env.OPENREEL_M01_IMAGE_FIXTURE },
  { caseId: "m01-vision-corrected-video-1", mode: "video-to-text", type: "video_url", mime: "video/mp4", path: process.env.OPENREEL_M01_VIDEO_FIXTURE }
];
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14), email = `m01-vision-${marker}@openreel.invalid`, password = randomBytes(24).toString("base64url");
let cookie, csrf, application, issued, submissions = 0, stage = "initialization";
async function request(path, { expected = 200, ...options } = {}) { const response = await fetch(`${BASE}${path}`, options), type = response.headers.get("content-type") || "", value = type.includes("json") ? await response.json() : null; if (response.status !== expected) throw Object.assign(new Error("request failed"), { code: value?.error?.code || "HTTP_ERROR", status: response.status, upstreamStatus: value?.error?.details?.upstreamStatus ?? null }); return { response, value }; }
const headers = () => ({ "content-type": "application/json", cookie, "x-csrf-token": csrf });
try {
  for (const fixture of fixtures) { const bytes = readFileSync(fixture.path); assert.ok(bytes.length > 0 && bytes.length <= 500_000); fixture.data = `data:${fixture.mime};base64,${bytes.toString("base64")}`; }
  stage = "authentication"; await request("/api/v1/auth/register", { method: "POST", expected: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); csrf = login.value.csrfToken;
  stage = "allowance"; application = (await request("/api/v1/key-applications", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ reason: "M-01 owner-authorized bounded vision validation", requestedLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000 }) })).value;
  await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ plan: "m01-vision-corrected-v2-once", hardLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000, periodEndsAt: new Date(Date.now() + 30 * 60_000).toISOString(), reviewedBy: "owner-corrected-v2-gate", reviewNote: "corrected embedding-vision image then video; two submissions maximum; CNY 4 ceiling; zero retry" }) });
  issued = (await request("/api/v1/api-keys", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "m01-vision-ephemeral" }) })).value;
  const results = [];
  for (const fixture of fixtures) {
    stage = fixture.caseId; submissions += 1;
    const job = (await request("/api/v1/inference/jobs", { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-api-key": issued.key }, body: JSON.stringify({ model: "embedding-vision", capability: "vision", input: { input: [{ type: fixture.type, [fixture.type]: { url: fixture.data } }] }, idempotencyKey: `${fixture.caseId}-${marker}` }) })).value;
    if (job.status !== "succeeded") throw Object.assign(new Error("provider terminal failure"), { code: "PROVIDER_TERMINAL_FAILURE", terminalState: job.status });
    results.push({ caseId: fixture.caseId, mode: fixture.mode, status: job.status, resultShape: Object.keys(job.result || {}).sort() });
    const usage = (await request("/api/v1/billing/usage", { headers: headers() })).value; assert.equal(usage.reconciliation.consistent, true); assert.equal(usage.subscription.reservedMicros, 0); assert.ok(usage.subscription.spentMicros <= MAX_UNITS);
  }
  const usage = (await request("/api/v1/billing/usage", { headers: headers() })).value;
  process.stdout.write(JSON.stringify({ status: "passed", submissions, retries: 0, model: "embedding-vision", results, spentUnits: usage.subscription.spentMicros, reservedUnits: usage.subscription.reservedMicros, reconciliation: usage.reconciliation.consistent }) + "\n");
} catch (error) { process.stdout.write(JSON.stringify({ status: "stopped", submissions, retries: 0, stage, code: error.code || "ASSERTION_FAILED", terminalState: error.terminalState ?? null, httpStatus: error.status ?? null, upstreamStatus: error.upstreamStatus ?? null }) + "\n"); process.exitCode = 1; }
finally { if (issued?.id && cookie) await request(`/api/v1/api-keys/${issued.id}`, { method: "DELETE", headers: headers() }).catch(() => {}); if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ reviewNote: "M-01 vision run ended" }) }).catch(() => {}); }
