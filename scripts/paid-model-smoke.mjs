#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = process.env.OPENREEL_PAID_SMOKE_BASE || "http://127.0.0.1:4173";
const adminKey = process.env.OPENREEL_ADMIN_KEY;
if (!adminKey) throw new Error("OPENREEL_ADMIN_KEY is required");
assert.equal(process.env.OPENREEL_PAID_SMOKE_CALL_LIMIT, "1", "call limit must be exactly 1");
assert.equal(process.env.OPENREEL_PAID_SMOKE_BUDGET_CNY, "2", "approved budget must be exactly CNY 2");

async function request(path, { expected = 200, ...options } = {}) {
  const response = await fetch(`${base}${path}`, options), value = await response.json();
  if (response.status !== expected) throw Object.assign(new Error(value.error?.message || `HTTP ${response.status}`), { code: value.error?.code || "HTTP_ERROR", status: response.status, upstreamStatus: value.error?.details?.upstreamStatus ?? null });
  return { response, value };
}

const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14), password = randomBytes(24).toString("base64url");
const email = `paid-smoke-${marker}@openreel.invalid`;
let application, issued, userHeaders;
const results = [];

try {
  await request("/api/v1/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }), expected: 201 });
  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  userHeaders = { "content-type": "application/json", cookie, "x-csrf-token": login.value.csrfToken };
  application = (await request("/api/v1/key-applications", { method: "POST", headers: userHeaders, body: JSON.stringify({ reason: "Bounded Embedding Vision production verification", requestedLimitMicros: 2_000_000 }), expected: 201 })).value;
  await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", headers: { "content-type": "application/json", "x-openreel-admin-key": adminKey }, body: JSON.stringify({ plan: "verification", hardLimitMicros: 2_000_000, periodEndsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reviewNote: "CNY 2 / one-call human gate" }), expected: 201 });
  issued = (await request("/api/v1/api-keys", { method: "POST", headers: userHeaders, body: JSON.stringify({ name: "bounded-production-smoke" }), expected: 201 })).value;

  const calls = [
    ["embedding-vision", "vision", { input: [{ type: "text", text: "test" }] }]
  ];
  assert.equal(calls.length, 1);
  for (const [model, capability, input] of calls) {
    try {
      let job = (await request("/api/v1/inference/jobs", { method: "POST", headers: { "content-type": "application/json", "x-openreel-api-key": issued.key }, body: JSON.stringify({ model, capability, input, idempotencyKey: `paid-smoke-${marker}-${model}` }), expected: 201 })).value;
      for (let polls = 0; job.status === "running" && polls < 120; polls += 1) { await new Promise(resolve => setTimeout(resolve, 5000)); job = (await request(`/api/v1/inference/jobs/${job.id}`, { headers: { "x-openreel-api-key": issued.key } })).value; }
      results.push({ model, status: job.status, providerTask: Boolean(job.providerTaskId), resultShape: job.result && typeof job.result === "object" ? Object.keys(job.result).sort() : typeof job.result });
    } catch (error) {
      results.push({ model, status: "failed", error: error.code || "UNKNOWN", httpStatus: error.status || null, upstreamStatus: error.upstreamStatus ?? null });
    }
  }
  const usage = (await request("/api/v1/billing/usage", { headers: userHeaders })).value;
  console.log(JSON.stringify({ status: results.every(x => x.status === "succeeded") ? "passed" : "partial", approvedBudgetCny: 2, attemptedCalls: results.length, results, ledgerEntries: usage.usage.length, internalSpentMicros: usage.subscription.spentMicros }));
} finally {
  if (issued?.id && userHeaders) await request(`/api/v1/api-keys/${issued.id}`, { method: "DELETE", headers: userHeaders }).catch(() => {});
  if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", headers: { "content-type": "application/json", "x-openreel-admin-key": adminKey }, body: JSON.stringify({ reviewNote: "Bounded production verification ended" }), expected: 201 }).catch(() => {});
}
