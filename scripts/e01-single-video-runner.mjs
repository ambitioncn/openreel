#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const AUTHORIZATION_ID = "openreel-e01-seedance2-cp80";
export const MAX_UNITS = 138_889;
export const MAX_SUBMISSIONS = 1;

export function validateAuthorization(env = process.env) {
  assert.equal(env.OPENREEL_E01_SINGLE_VIDEO_EXECUTE, "true", "execution switch must be true");
  assert.equal(env.OPENREEL_E01_AUTHORIZATION_ID, AUTHORIZATION_ID, "authorization id mismatch");
  assert.equal(env.OPENREEL_E01_MAX_SUBMISSIONS, String(MAX_SUBMISSIONS), "submission ceiling must be one");
  assert.equal(env.OPENREEL_E01_MAX_UNITS, String(MAX_UNITS), "budget ceiling mismatch");
  assert.equal(env.OPENREEL_ARK_MAX_RETRIES, "0", "automatic provider retries must be disabled");
  return true;
}

export function validateLedger(usage) {
  assert.equal(usage.reconciliation?.consistent, true, "ledger reconciliation mismatch");
  assert.equal(usage.subscription?.currency, "USD", "ledger currency mismatch");
  assert.equal(usage.subscription?.unitScale, 10_000, "ledger scale mismatch");
  assert.equal(usage.subscription?.hardLimitMicros, MAX_UNITS, "ledger hard limit mismatch");
  assert.equal(usage.subscription?.reservedMicros, 0, "open reservation remains");
  assert.ok(usage.subscription?.spentMicros <= MAX_UNITS, "budget exceeded");
  assert.equal(usage.usage?.length, 1, "exactly one terminal usage entry is required");
  assert.equal(usage.usage[0]?.model, "seedance-2", "unexpected billed model");
  return true;
}

async function run() {
  validateAuthorization();
  const base = process.env.OPENREEL_E01_BASE || "http://127.0.0.1:4273";
  assert.equal(base, "http://127.0.0.1:4273", "runner is restricted to approved loopback staging");
  assert.ok(process.env.OPENREEL_ADMIN_KEY, "server-side admin reference is required");
  const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const email = `e01-video-${marker}@openreel.invalid`, password = randomBytes(24).toString("base64url");
  let cookie, csrf, application, issued, providerSubmissions = 0;
  async function request(path, { expected = 200, ...options } = {}) {
    const response = await fetch(`${base}${path}`, options), type = response.headers.get("content-type") || "";
    const value = type.includes("json") ? await response.json() : null;
    if (response.status !== expected) throw Object.assign(new Error(value?.error?.message || `HTTP ${response.status}`), { code: value?.error?.code || "HTTP_ERROR", status: response.status, upstreamStatus: value?.error?.details?.upstreamStatus ?? null });
    return { response, value };
  }
  const userHeaders = () => ({ "content-type": "application/json", cookie, "x-csrf-token": csrf });
  try {
    await request("/api/v1/auth/register", { method: "POST", expected: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); csrf = login.value.csrfToken;
    application = (await request("/api/v1/key-applications", { method: "POST", expected: 201, headers: userHeaders(), body: JSON.stringify({ reason: "Authorized cp80 single silent Seedance 2 staging call", requestedLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000 }) })).value;
    await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ plan: "e01-single-video", hardLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000, periodEndsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), reviewedBy: "cp80-owner-gate", reviewNote: "one 4s 480p silent seedance-2 submission / USD 13.8889 hard ceiling / zero retry" }) });
    issued = (await request("/api/v1/api-keys", { method: "POST", expected: 201, headers: userHeaders(), body: JSON.stringify({ name: "e01-single-video-ephemeral" }) })).value;
    assert.equal(providerSubmissions, 0);
    providerSubmissions += 1;
    let job = (await request("/api/v1/inference/jobs", { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-api-key": issued.key }, body: JSON.stringify({ model: "seedance-2", capability: "video", input: { prompt: "A young astronaut in an orange suit walks beside a white rover across a red desert at golden hour, slow stable camera, consistent suit patches and rover markings", ratio: "16:9", resolution: "480p", duration: 4, generate_audio: false, watermark: false }, idempotencyKey: `e01-single-video-${marker}` }) })).value;
    for (let poll = 0; job.status === "running" && poll < 120; poll += 1) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      job = (await request(`/api/v1/inference/jobs/${job.id}`, { headers: { "x-openreel-api-key": issued.key } })).value;
    }
    assert.equal(job.status, "succeeded", "single video did not succeed before terminal timeout");
    const usage = (await request("/api/v1/billing/usage", { headers: userHeaders() })).value;
    validateLedger(usage);
    process.stdout.write(`${JSON.stringify({ status: "terminal", providerSubmissions, jobStatus: job.status, resultShape: job.result && typeof job.result === "object" ? Object.keys(job.result).sort() : typeof job.result, spentUnits: usage.subscription.spentMicros, reservedUnits: usage.subscription.reservedMicros, reconciliation: usage.reconciliation.consistent })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "stopped", providerSubmissions, code: error.code || "ASSERTION_FAILED", httpStatus: error.status ?? null, upstreamStatus: error.upstreamStatus ?? null })}\n`);
    process.exitCode = 1;
  } finally {
    if (issued?.id && cookie) await request(`/api/v1/api-keys/${issued.id}`, { method: "DELETE", headers: userHeaders() }).catch(() => {});
    if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ reviewNote: "cp80 single-video run ended; ephemeral access stopped" }) }).catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
