import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentStore } from "../src/core.js";
import { createPlatform } from "../src/platform.js";

const workflow = { schema: "openreel-workflow/v1", template: "story-to-reel", version: 1, nodes: [{ id: "script", type: "script" }, { id: "frame", type: "image" }, { id: "clip", type: "video" }] };
function account(platform, email = "owner@example.test") { platform.register({ email, password: "local-pass-123" }); return platform.login({ email, password: "local-pass-123" }).token; }

test("P1.2 schema constraints reject incompatible mode, aspect, duration, audio and references", () => {
  const store = createPersistentStore(join(mkdtempSync(join(tmpdir(), "openreel-params-")), "state.json")), project = store.createProject({ name: "Parameters" }), session = store.createSession(project.id, { name: "Main" }), node = store.createNode(session.id, { type: "video" });
  assert.deepEqual(store.listModels().find(x => x.kind === "video").schema.durations, [.5]);
  for (const input of [{ aspect: "1:1" }, { resolution: "4k" }, { duration: 9 }, { audio: false }, { mode: "image-to-video" }]) assert.throws(() => store.createJob(session.id, { nodeId: node.id, prompt: "x", ...input }), e => e.code === "INCOMPATIBLE_PARAMETERS");
  const refs = Array.from({ length: 3 }, (_, i) => store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: `${i}.png`, bytes: Buffer.from("x") }));
  assert.throws(() => store.createJob(session.id, { nodeId: node.id, prompt: "x", referenceAssetIds: refs.map(x => x.id) }), e => e.code === "INCOMPATIBLE_PARAMETERS");
});

test("P1.3 history/library versions and cross-project copy provenance survive restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-library-")), "state.json"); let store = createPersistentStore(file), source = store.createProject({ name: "Source" }), session = store.createSession(source.id, { name: "Main" }), node = store.createNode(session.id, { type: "image" });
  for (const prompt of ["red hero", "blue hero"]) { const job = store.createJob(session.id, { nodeId: node.id, prompt }); store.tickJob(job.id); store.tickJob(job.id); }
  const target = store.createProject({ name: "Target" }), first = store.listAssets(source.id, { role: "result" })[0], copied = store.copyAsset(source.id, first.id, target.id);
  assert.equal(store.listHistory(source.id, { search: "blue", state: "succeeded" }).length, 1); assert.equal(store.snapshot(source.id).nodes[0].resultVersions.length, 2); assert.equal(copied.metadata.provenance.sourceAssetId, first.id);
  store = createPersistentStore(file); assert.equal(store.listAssets(target.id)[0].metadata.provenance.operation, "copy"); assert.equal(store.assetContent(source.id, first.id).bytes.equals(store.assetContent(target.id, copied.id).bytes), true);
});

test("P1.5 import is versioned, validated, reproducible and local-only", () => {
  const platform = createPlatform(), token = account(platform), team = platform.createTeam(token, { name: "Studio" });
  const first = platform.importWorkflow(token, team.id, workflow), replay = platform.importWorkflow(token, team.id, workflow);
  assert.equal(first.id, replay.id); assert.equal(first.digest, replay.digest); assert.equal(first.provenance.source, "local-import");
  assert.throws(() => platform.importWorkflow(token, team.id, { ...workflow, schema: "unknown" }), e => e.code === "INVALID_WORKFLOW");
});

test("P2.1 quote/reserve/settle is durable, idempotent and enforces atomic hard ceiling", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-budget-")), "platform.json"); let platform = createPlatform({ file }), token = account(platform), team = platform.createTeam(token, { name: "Budget" });
  assert.equal(platform.quote(token, team.id, { kind: "video", units: 2 }).amount, 80);
  const reservation = platform.reserve(token, team.id, { kind: "video", units: 2, idempotencyKey: "r1" }); assert.equal(platform.reserve(token, team.id, { kind: "video", units: 2, idempotencyKey: "r1" }).id, reservation.id);
  const settled = platform.settle(token, team.id, reservation.id, { actualAmount: 70 }); assert.equal(settled.amount, 70); assert.equal(platform.settle(token, team.id, reservation.id, { actualAmount: 70 }).id, settled.id);
  const attempts = await Promise.allSettled(Array.from({ length: 3 }, (_, i) => Promise.resolve().then(() => platform.reserve(token, team.id, { kind: "video", units: 100, idempotencyKey: `large-${i}` })))); assert.equal(attempts.filter(x => x.status === "fulfilled").length, 2); assert.equal(attempts.find(x => x.status === "rejected").reason.code, "INSUFFICIENT_BUDGET");
  platform = createPlatform({ file }); token = platform.login({ email: "owner@example.test", password: "local-pass-123" }).token; assert.equal(platform.budgetStatus(token, team.id).balance, 9930); assert.equal(platform.budgetStatus(token, team.id).reserved, 8000);
});

test("P2.2 password sessions, invites, membership roles and conflicts form a real local boundary", () => {
  const platform = createPlatform(), owner = account(platform), team = platform.createTeam(owner, { name: "Team" });
  platform.register({ email: "viewer@example.test", password: "viewer-pass-123" }); const viewer = platform.login({ email: "viewer@example.test", password: "viewer-pass-123" }).token, invite = platform.invite(owner, team.id, { email: "viewer@example.test", role: "viewer" });
  assert.throws(() => platform.invite(owner, team.id, { email: "viewer@example.test", role: "viewer" }), e => e.code === "CONFLICT"); platform.acceptInvite(viewer, invite.id);
  assert.throws(() => platform.reserve(viewer, team.id, { kind: "image" }), e => e.code === "FORBIDDEN"); assert.throws(() => platform.authenticate("bad"), e => e.code === "UNAUTHENTICATED"); assert.equal(platform.securityBoundary().productionReady, false);
});

test("production sessions are hashed at rest, expire, rotate, and revoke", () => {
  let clock = Date.parse("2026-08-04T00:00:00.000Z");
  const file = join(mkdtempSync(join(tmpdir(), "openreel-session-")), "platform.json");
  const platform = createPlatform({ file, now: () => new Date(clock).toISOString(), sessionTtlMs: 1000 });
  platform.register({ email: "session@example.test", password: "session-pass-123" });
  const first = platform.login({ email: "session@example.test", password: "session-pass-123" });
  const persisted = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(JSON.stringify(persisted).includes(first.token), false);
  assert.equal(platform.authenticate(first.token).email, "session@example.test");
  const rotated = platform.rotateSession(first.token);
  assert.throws(() => platform.authenticate(first.token), e => e.code === "UNAUTHENTICATED");
  platform.logout(rotated.token);
  assert.throws(() => platform.authenticate(rotated.token), e => e.code === "UNAUTHENTICATED");
  const expiring = platform.login({ email: "session@example.test", password: "session-pass-123" });
  clock += 1001;
  assert.throws(() => platform.authenticate(expiring.token), e => e.code === "UNAUTHENTICATED");
});

test("paid API keys are one-time secrets, meter tokens, enforce reservations and suspend at the hard limit", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-api-key-")), "platform.json");
  let platform = createPlatform({ file }), token = account(platform, "paid@example.test"), accountId = platform.authenticate(token).id;
  assert.throws(() => platform.createApiKey(token), e => e.code === "PAYMENT_REQUIRED");
  const application = platform.submitKeyApplication(token, { reason: "Production rendering", requestedLimitMicros: 1000 });
  assert.equal(application.accountId, accountId); assert.equal(application.status, "pending");
  assert.throws(() => platform.submitKeyApplication(token, { reason: "Duplicate", requestedLimitMicros: 1000 }), e => e.code === "CONFLICT");
  platform.approveKeyApplication(application.id, { plan: "manual", hardLimitMicros: 1000, periodEndsAt: "2099-01-01T00:00:00.000Z", reviewNote: "Approved" });
  const issued = platform.createApiKey(token, { name: "production" });
  assert.match(issued.key, /^or_live_/); assert.equal(platform.listApiKeys(token)[0].key, undefined);
  assert.equal(JSON.stringify(JSON.parse(readFileSync(file, "utf8"))).includes(issued.key), false);
  const first = platform.reserveUsage(issued.key, { model: "doubao-seed-1.8", maxCostMicros: 600, idempotencyKey: "request-1" });
  assert.equal(platform.reserveUsage(issued.key, { model: "doubao-seed-1.8", maxCostMicros: 600, idempotencyKey: "request-1" }).id, first.id);
  assert.throws(() => platform.reserveUsage(issued.key, { model: "seedance", maxCostMicros: 500, idempotencyKey: "too-large" }), e => e.code === "BUDGET_EXHAUSTED");
  const usage = platform.settleUsage(issued.key, first.id, { inputTokens: 250000, outputTokens: 250000, inputMicrosPerMillion: 1000, outputMicrosPerMillion: 1400 });
  assert.equal(usage.costMicros, 600);
  const second = platform.reserveUsage(issued.key, { model: "seedream", maxCostMicros: 400, idempotencyKey: "request-2" });
  platform.settleUsage(issued.key, second.id, { inputTokens: 400000, outputTokens: 0, inputMicrosPerMillion: 1000, outputMicrosPerMillion: 0 });
  assert.equal(platform.listApiKeys(token)[0].status, "suspended");
  assert.throws(() => platform.authenticateApiKey(issued.key), e => e.code === "INVALID_API_KEY");
  platform = createPlatform({ file }); token = platform.login({ email: "paid@example.test", password: "local-pass-123" }).token;
  assert.equal(platform.usageStatus(token).subscription.spentMicros, 1000);
});

test("administrators can reject applications and stop approved key access", () => {
  const platform = createPlatform(), approvedToken = account(platform, "approved@example.test"), rejectedToken = account(platform, "rejected@example.test");
  const rejected = platform.submitKeyApplication(rejectedToken, { reason: "Evaluation", requestedLimitMicros: 500 });
  assert.equal(platform.rejectKeyApplication(rejected.id, { reviewNote: "More information required" }).status, "rejected");
  assert.throws(() => platform.createApiKey(rejectedToken), e => e.code === "PAYMENT_REQUIRED");
  const approved = platform.submitKeyApplication(approvedToken, { reason: "Video API", requestedLimitMicros: 800 });
  platform.approveKeyApplication(approved.id, { hardLimitMicros: 800, periodEndsAt: "2099-01-01T00:00:00.000Z" });
  const issued = platform.createApiKey(approvedToken);
  const stopped = platform.stopKeyAccess(approved.id, { reviewNote: "Manual account stop" });
  assert.equal(stopped.application.status, "stopped"); assert.equal(stopped.keys[0].status, "suspended");
  assert.throws(() => platform.authenticateApiKey(issued.key), e => e.code === "INVALID_API_KEY");
});

test("schema 4 CNY history stays labeled and cannot be mixed with new USD pricing", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-currency-")), "platform.json"), accountId = "legacy-account", subscriptionId = "legacy-subscription";
  writeFileSync(file, JSON.stringify({ schemaVersion: 4, accounts: [{ id: accountId, email: "legacy@example.test", passwordHash: "x", salt: "x", createdAt: "2026-01-01T00:00:00.000Z" }], sessions: [], teams: [], invites: [], wallets: [], ledger: [], workflows: [], automations: [], objects: [], subscriptions: [{ id: subscriptionId, accountId, plan: "legacy", status: "active", hardLimitMicros: 1_000_000, spentMicros: 0, reservedMicros: 0, periodStartedAt: "2026-01-01T00:00:00.000Z", periodEndsAt: "2099-01-01T00:00:00.000Z" }], keyApplications: [], apiKeys: [], usageReservations: [], usageLedger: [] }));
  const platform = createPlatform({ file }), migrated = platform.grantSubscription(accountId, { hardLimitUnits: 10_000, currency: "USD", unitScale: 10_000, periodEndsAt: "2099-01-01T00:00:00.000Z" });
  assert.equal(migrated.currency, "USD"); assert.equal(migrated.unitScale, 10_000); assert.equal(migrated.hardLimitMicros, 10_000);
  const state = JSON.parse(readFileSync(file, "utf8")), legacy = state.subscriptions.find(item => item.id === subscriptionId);
  assert.equal(legacy.currency, "CNY"); assert.equal(legacy.unitScale, 1_000_000); assert.equal(legacy.status, "stopped"); assert.equal(state.schemaVersion, 5);
});

test("P1.4 automation preserves intent, exposes plan/status/failure/cost and replays idempotently", () => {
  const platform = createPlatform(), token = account(platform), team = platform.createTeam(token, { name: "Automation" }), imported = platform.importWorkflow(token, team.id, workflow), plan = platform.planAutomation(token, team.id, { intent: "Keep the red hero consistent", workflowId: imported.id });
  const run = platform.runAutomation(token, team.id, plan, "run-1"), replay = platform.runAutomation(token, team.id, plan, "run-1"); assert.equal(run.id, replay.id); assert.equal(run.intent, plan.intent); assert.equal(run.status, "succeeded"); assert.equal(run.cost, 30);
  const failed = platform.runAutomation(token, team.id, { ...plan, nodes: [{ id: "bad", type: "image", fail: true }] }, "run-fail"); assert.equal(failed.status, "failed"); assert.equal(failed.failure.code, "NODE_FAILED"); assert.equal(failed.cost, 0);
});

test("P2.3 adapters isolate tenant data and deny cross-tenant workflows and ledger access", () => {
  const platform = createPlatform(), a = account(platform, "a@example.test"), b = account(platform, "b@example.test"), teamA = platform.createTeam(a, { name: "A" }), teamB = platform.createTeam(b, { name: "B" });
  platform.objects.put(teamA.tenantId, "asset", { secret: "A" }); platform.objects.put(teamB.tenantId, "asset", { secret: "B" }); assert.equal(platform.objects.get(teamA.tenantId, "asset").secret, "A");
  const imported = platform.importWorkflow(a, teamA.id, workflow); assert.throws(() => platform.planAutomation(b, teamB.id, { intent: "steal", workflowId: imported.id }), e => e.code === "FORBIDDEN");
  const reservation = platform.reserve(a, teamA.id, { kind: "image" }); assert.throws(() => platform.settle(b, teamB.id, reservation.id), e => e.code === "FORBIDDEN"); assert.equal(platform.database.query(teamB.tenantId, "ledger").length, 0);
});
