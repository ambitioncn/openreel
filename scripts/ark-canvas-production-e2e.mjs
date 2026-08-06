#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = process.env.OPENREEL_E2E_BASE || "https://openreel.io";
const adminKey = process.env.OPENREEL_ADMIN_KEY;
assert.ok(adminKey, "OPENREEL_ADMIN_KEY is required");
assert.equal(process.env.OPENREEL_E2E_MAX_CALLS, "2");
assert.equal(process.env.OPENREEL_E2E_BUDGET_CNY, "5");
assert.equal(process.env.OPENREEL_ARK_MAX_RETRIES, "0");
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14), password = randomBytes(24).toString("base64url");
const email = `ark-canvas-e2e-${marker}@openreel.invalid`, attackerEmail = `ark-canvas-attacker-${marker}@openreel.invalid`;
let application, issued, auth;

async function request(path, { expected = 200, ...options } = {}) { const response = await fetch(`${base}${path}`, options), type = response.headers.get("content-type") || "", value = type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()); if (response.status !== expected) throw new Error(`${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(value)}`); return { response, value }; }
async function registerLogin(address) { await request("/api/v1/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: address, password }), expected: 201 }); const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: address, password }) }); return { cookie: login.response.headers.getSetCookie().map(x => x.split(";", 1)[0]).join("; "), csrf: login.value.csrfToken, account: login.value.account }; }
const userRequest = (owner, path, method = "GET", body, headers = {}, expected = method === "POST" ? 201 : 200) => request(path, { method, expected, headers: { cookie: owner.cookie, ...(method === "GET" ? {} : { "x-csrf-token": owner.csrf }), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

try {
  auth = await registerLogin(email); const attacker = await registerLogin(attackerEmail); console.log(JSON.stringify({ phase: "registered", email }));
  application = (await userRequest(auth, "/api/v1/key-applications", "POST", { reason: "Restricted Ark canvas production E2E", requestedLimitMicros: 5_000_000 })).value;
  await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": adminKey }, body: JSON.stringify({ plan: "e2e", hardLimitMicros: 5_000_000, periodEndsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reviewNote: "CNY 5 / max 2 calls / zero retry gate" }) });
  issued = (await userRequest(auth, "/api/v1/api-keys", "POST", { name: "ark-canvas-e2e" })).value;
  const project = (await userRequest(auth, "/api/v1/projects", "POST", { name: `Ark Canvas E2E ${marker}` })).value, session = (await userRequest(auth, `/api/v1/projects/${project.id}/sessions`, "POST", { name: "Main" })).value, node = (await userRequest(auth, `/api/v1/sessions/${session.id}/nodes`, "POST", { type: "video" })).value;
  const idempotencyKey = `ark-canvas-${marker}`;
  let job = (await userRequest(auth, `/api/v1/sessions/${session.id}/ark-jobs`, "POST", { nodeId: node.id, prompt: "A calm ocean sunrise, static camera, production acceptance fixture", model: "seedance-2-fast", capability: "video", idempotencyKey, parameters: { aspect: "16:9", resolution: "480p", duration: 5, audio: false } }, { "x-openreel-api-key": issued.key })).value;
  console.log(JSON.stringify({ phase: "submitted", canvasJobId: job.id, arkJobId: job.arkJobId }));
  for (let poll = 0; job.state === "running" && poll < 120; poll++) { await new Promise(resolve => setTimeout(resolve, 5000)); job = (await userRequest(auth, `/api/v1/jobs/${job.id}/ark-poll`, "POST", {}, { "x-openreel-api-key": issued.key })).value; if (poll % 6 === 0) console.log(JSON.stringify({ phase: "poll", poll: poll + 1, state: job.state })); }
  assert.equal(job.state, "succeeded"); assert.ok(job.assetId);
  const snapshot = (await userRequest(auth, `/api/v1/projects/${project.id}`)).value, asset = snapshot.assets.find(x => x.id === job.assetId); assert.ok(asset); assert.equal(asset.metadata.arkJobId, job.arkJobId); assert.ok(snapshot.timeline.tracks.some(t => t.clips.some(c => c.assetId === asset.id)));
  const preview = await request(asset.downloadUrl, { headers: { cookie: auth.cookie } }); assert.equal(preview.response.status, 200); assert.ok(preview.value.length > 1000);
  const manifest = (await userRequest(auth, `/api/v1/projects/${project.id}/exports/manifest`)).value; assert.ok(manifest.assets.some(x => x.id === asset.id));
  for (const path of [`/api/v1/projects/${project.id}`, `/api/v1/jobs/${job.id}/progress`, asset.downloadUrl]) { const denied = await fetch(`${base}${path}`, { headers: { cookie: attacker.cookie } }); assert.ok([403, 404].includes(denied.status), `${path} leaked with ${denied.status}`); }
  const usage = (await userRequest(auth, "/api/v1/billing/usage")).value; assert.equal(usage.usage.filter(x => x.model === "seedance-2-fast").length, 1); assert.ok(usage.subscription.spentMicros <= 5_000_000); assert.equal(usage.subscription.reservedMicros, 0);
  console.log(JSON.stringify({ status: "passed", email, projectId: project.id, canvasJobId: job.id, arkJobId: job.arkJobId, assetId: asset.id, previewBytes: preview.value.length, timelineClip: true, exportIncludesAsset: true, idorRejected: 3, model: "seedance-2-fast", ledgerEntries: usage.usage.length, spentMicros: usage.subscription.spentMicros, attemptedPaidCalls: 1, maxPaidCalls: 2, budgetCny: 5, retries: 0 }));
} finally {
  if (issued?.id && auth) await userRequest(auth, `/api/v1/api-keys/${issued.id}`, "DELETE", undefined, {}, 200).catch(() => {});
  if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": adminKey }, body: JSON.stringify({ reviewNote: "Restricted Ark canvas E2E ended; key revoked" }) }).catch(() => {});
}
