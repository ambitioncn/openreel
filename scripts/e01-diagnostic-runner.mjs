#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = process.env.OPENREEL_E01_BASE || "http://127.0.0.1:4273";
assert.equal(base, "http://127.0.0.1:4273");
assert.equal(process.env.OPENREEL_E01_DIAGNOSTIC_EXECUTE, "true");
assert.equal(process.env.OPENREEL_E01_MAX_SUBMISSIONS, "1");
assert.equal(process.env.OPENREEL_E01_MAX_UNITS, "2778");
assert.equal(process.env.OPENREEL_ARK_MAX_RETRIES, "0");
assert.ok(process.env.OPENREEL_ADMIN_KEY);

const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const email = `e01-diagnostic-${marker}@openreel.invalid`, password = randomBytes(24).toString("base64url");
let cookie, csrf, application, issued, submissionStarted = false;
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
  application = (await request("/api/v1/key-applications", { method: "POST", expected: 201, headers: userHeaders(), body: JSON.stringify({ reason: "Authorized E-01 corrected-size diagnostic", requestedLimitUnits: 2778, currency: "USD", unitScale: 10_000 }) })).value;
  await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ plan: "e01-diagnostic", hardLimitUnits: 2778, currency: "USD", unitScale: 10_000, periodEndsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), reviewedBy: "cp57-human-gate", reviewNote: "one submission / USD 0.2778 / zero retry" }) });
  issued = (await request("/api/v1/api-keys", { method: "POST", expected: 201, headers: userHeaders(), body: JSON.stringify({ name: "e01-diagnostic-ephemeral" }) })).value;
  submissionStarted = true;
  const job = (await request("/api/v1/inference/jobs", { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-api-key": issued.key }, body: JSON.stringify({ model: "seedream-5-lite", capability: "image", input: { prompt: "Cinematic storyboard frame: a young astronaut in an orange suit beside a white rover on a red desert at golden hour, wide 16:9 composition", size: "2560x1440", watermark: false, response_format: "url" }, idempotencyKey: `e01-diagnostic-${marker}` }) })).value;
  const usage = (await request("/api/v1/billing/usage", { headers: userHeaders() })).value;
  process.stdout.write(`${JSON.stringify({ status: "terminal", providerSubmissions: 1, jobStatus: job.status, resultShape: job.result && typeof job.result === "object" ? Object.keys(job.result).sort() : typeof job.result, spentUnits: usage.subscription.spentMicros, reservedUnits: usage.subscription.reservedMicros, reconciliation: usage.reconciliation.consistent })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ status: "stopped", providerSubmissions: submissionStarted ? 1 : 0, code: error.code || "ASSERTION_FAILED", httpStatus: error.status ?? null, upstreamStatus: error.upstreamStatus ?? null })}\n`);
  process.exitCode = 1;
} finally {
  if (issued?.id && cookie) await request(`/api/v1/api-keys/${issued.id}`, { method: "DELETE", headers: userHeaders() }).catch(() => {});
  if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ reviewNote: "E-01 diagnostic ended; ephemeral access stopped" }) }).catch(() => {});
}
