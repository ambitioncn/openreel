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

test("CO-01 invite revoke and membership lifecycle enforce role and tenant boundaries across restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-collaboration-")), "platform.json"); let platform = createPlatform({ file });
  const owner = account(platform, "owner@example.test"), admin = account(platform, "admin@example.test"), editor = account(platform, "editor@example.test"), outsider = account(platform, "outsider@example.test");
  const team = platform.createTeam(owner, { name: "Studio" }), other = platform.createTeam(outsider, { name: "Other" });
  platform.acceptInvite(admin, platform.invite(owner, team.id, { email: "admin@example.test", role: "admin" }).id);
  platform.acceptInvite(editor, platform.invite(admin, team.id, { email: "editor@example.test", role: "editor" }).id);
  const ownerId = platform.authenticate(owner).id, editorId = platform.authenticate(editor).id;
  const revoked = platform.revokeInvite(admin, team.id, platform.invite(owner, team.id, { email: "revoked@example.test" }).id);
  assert.equal(revoked.status, "revoked");
  const revokedAccount = account(platform, "revoked@example.test");
  assert.throws(() => platform.acceptInvite(revokedAccount, revoked.id), e => e.code === "FORBIDDEN");
  assert.throws(() => platform.updateMember(admin, team.id, ownerId, { role: "viewer" }), e => e.code === "FORBIDDEN");
  assert.throws(() => platform.updateMember(owner, team.id, ownerId, { role: "viewer" }), e => e.code === "CONFLICT");
  assert.throws(() => platform.removeMember(outsider, team.id, editorId), e => e.code === "FORBIDDEN");
  assert.throws(() => platform.revokeInvite(owner, team.id, platform.invite(outsider, other.id, { email: "cross@example.test" }).id), e => e.code === "FORBIDDEN");
  platform.updateMember(owner, team.id, editorId, { role: "viewer" });
  platform.removeMember(admin, team.id, editorId);
  platform = createPlatform({ file });
  assert.throws(() => platform.budgetStatus(editor, team.id), e => e.code === "FORBIDDEN");
  assert.equal(platform.budgetStatus(owner, team.id).tenantId, team.tenantId);
});

test("CO-01 presence expires and optimistic collaboration rejects stale or unauthorized writes", () => {
  let clock = Date.parse("2026-08-07T00:00:00.000Z");
  const file = join(mkdtempSync(join(tmpdir(), "openreel-presence-")), "platform.json"); let platform = createPlatform({ file, now: () => new Date(clock).toISOString() });
  const owner = account(platform, "presence-owner@example.test"), editor = account(platform, "presence-editor@example.test"), viewer = account(platform, "presence-viewer@example.test"), outsider = account(platform, "presence-outsider@example.test");
  const team = platform.createTeam(owner, { name: "Presence" });
  for (const [token, email, role] of [[editor, "presence-editor@example.test", "editor"], [viewer, "presence-viewer@example.test", "viewer"]]) platform.acceptInvite(token, platform.invite(owner, team.id, { email, role }).id);
  assert.equal(platform.updatePresence(owner, team.id, { documentId: "canvas", cursor: { x: 2, y: 3 } }).length, 1);
  assert.equal(platform.updatePresence(editor, team.id, { documentId: "canvas" }).length, 2);
  assert.throws(() => platform.listPresence(outsider, team.id, "canvas"), e => e.code === "FORBIDDEN");
  const first = platform.updateCollaborativeDocument(owner, team.id, "canvas", { version: 0, content: { title: "owner edit" } });
  assert.equal(first.version, 1);
  assert.throws(() => platform.updateCollaborativeDocument(editor, team.id, "canvas", { version: 0, content: { title: "stale edit" } }), e => e.code === "VERSION_CONFLICT" && e.details.expectedVersion === 1);
  assert.deepEqual(platform.collaborativeDocument(editor, team.id, "canvas").content, { title: "owner edit" });
  assert.throws(() => platform.updateCollaborativeDocument(viewer, team.id, "canvas", { version: 1, content: {} }), e => e.code === "FORBIDDEN");
  clock += 30_001; assert.equal(platform.listPresence(owner, team.id, "canvas").length, 0);
  platform = createPlatform({ file, now: () => new Date(clock).toISOString() });
  const nextOwner = platform.login({ email: "presence-owner@example.test", password: "local-pass-123" }).token;
  assert.equal(platform.listPresence(nextOwner, team.id, "canvas").length, 0);
  assert.equal(platform.collaborativeDocument(nextOwner, team.id, "canvas").version, 1);
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
  platform.grantSubscription(accountId, { plan: "bounded-test", hardLimitMicros: 1000, periodEndsAt: "2099-01-01T00:00:00.000Z" });
  const issued = platform.createApiKey(token, { name: "production" });
  assert.match(issued.key, /^or_live_/); assert.equal(platform.listApiKeys(token)[0].key, undefined);
  assert.equal(JSON.stringify(JSON.parse(readFileSync(file, "utf8"))).includes(issued.key), false);
  const first = platform.reserveUsage(issued.key, { model: "doubao-seed-1.8", maxCostMicros: 600, idempotencyKey: "request-1" });
  assert.equal(platform.reserveUsage(issued.key, { model: "doubao-seed-1.8", maxCostMicros: 600, idempotencyKey: "request-1" }).id, first.id);
  const reservedStatus = platform.usageStatus(token);
  assert.equal(reservedStatus.reservations[0].status, "reserved");
  assert.equal(reservedStatus.reservations[0].maxCostMicros, 600);
  assert.equal(reservedStatus.paymentIntegration.connected, false);
  assert.throws(() => platform.reserveUsage(issued.key, { model: "seedance", maxCostMicros: 500, idempotencyKey: "too-large" }), e => e.code === "BUDGET_EXHAUSTED");
  const usage = platform.settleUsage(issued.key, first.id, { inputTokens: 250000, outputTokens: 250000, inputMicrosPerMillion: 1000, outputMicrosPerMillion: 1400 });
  assert.equal(usage.costMicros, 600);
  const second = platform.reserveUsage(issued.key, { model: "seedream", maxCostMicros: 400, idempotencyKey: "request-2" });
  platform.settleUsage(issued.key, second.id, { inputTokens: 400000, outputTokens: 0, inputMicrosPerMillion: 1000, outputMicrosPerMillion: 0 });
  assert.equal(platform.listApiKeys(token)[0].status, "suspended");
  assert.throws(() => platform.authenticateApiKey(issued.key), e => e.code === "INVALID_API_KEY");
  platform = createPlatform({ file }); token = platform.login({ email: "paid@example.test", password: "local-pass-123" }).token;
  const status = platform.usageStatus(token);
  assert.equal(status.subscription.spentMicros, 1000);
  assert.deepEqual(status.reservations.map(item => item.status), ["settled", "settled"]);
});

test("billing usage status isolates account reservations", () => {
  const platform = createPlatform(), a = account(platform, "billing-a@example.test"), b = account(platform, "billing-b@example.test");
  for (const token of [a, b]) platform.grantSubscription(platform.authenticate(token).id, { hardLimitMicros: 1000, periodEndsAt: "2099-01-01T00:00:00.000Z" });
  platform.reserveUsageForAccount(platform.authenticate(a).id, { model: "image", maxCostMicros: 100, idempotencyKey: "a-1" });
  platform.reserveUsageForAccount(platform.authenticate(b).id, { model: "video", maxCostMicros: 200, idempotencyKey: "b-1" });
  assert.deepEqual(platform.usageStatus(a).reservations.map(item => item.model), ["image"]);
  assert.deepEqual(platform.usageStatus(b).reservations.map(item => item.model), ["video"]);
});

test("usage refunds are bounded, idempotent, durable and reconciliation detects drift", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-refund-")), "platform.json");
  let platform = createPlatform({ file }), token = account(platform, "refund@example.test"), accountId = platform.authenticate(token).id;
  platform.grantSubscription(accountId, { hardLimitMicros: 1000, periodEndsAt: "2099-01-01T00:00:00.000Z" });
  const reservation = platform.reserveUsageForAccount(accountId, { model: "image", maxCostMicros: 600, idempotencyKey: "refund-reservation" });
  const usage = platform.settleUsageForAccount(accountId, reservation.id, { inputTokens: 600000, outputTokens: 0, inputMicrosPerMillion: 1000, outputMicrosPerMillion: 0 });
  const first = platform.refundUsage(accountId, usage.id, { amountMicros: 200, idempotencyKey: "refund-1", reason: "provider quality failure" });
  assert.equal(platform.refundUsage(accountId, usage.id, { amountMicros: 200, idempotencyKey: "refund-1", reason: "provider quality failure" }).id, first.id);
  assert.throws(() => platform.refundUsage(accountId, usage.id, { amountMicros: 201, idempotencyKey: "refund-1", reason: "changed replay" }), e => e.code === "IDEMPOTENCY_CONFLICT");
  assert.throws(() => platform.refundUsage(accountId, usage.id, { amountMicros: 401, idempotencyKey: "refund-too-large", reason: "invalid" }), e => e.code === "REFUND_EXCEEDS_USAGE");
  assert.equal(platform.reconcileUsage(accountId).consistent, true);
  platform = createPlatform({ file }); token = platform.login({ email: "refund@example.test", password: "local-pass-123" }).token;
  assert.equal(platform.usageStatus(token).subscription.spentMicros, 400);
  assert.equal(platform.usageStatus(token).refunds[0].status, "partially_refunded");
  const persisted = JSON.parse(readFileSync(file, "utf8")); persisted.subscriptions[0].spentMicros = 399; writeFileSync(file, JSON.stringify(persisted));
  platform = createPlatform({ file });
  const reconciliation = platform.reconcileUsage(accountId);
  assert.equal(reconciliation.consistent, false); assert.equal(reconciliation.mismatches[0].calculated.spentMicros, 400);
});

test("stopped key access can fail its open reservations without retaining a secret", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-stopped-reservation-")), "platform.json"), platform = createPlatform({ file }), token = account(platform, "stopped-reservation@example.test"), application = platform.submitKeyApplication(token, { reason: "bounded test", requestedLimitUnits: 600 });
  platform.approveKeyApplication(application.id, { hardLimitUnits: 600, periodEndsAt: "2099-01-01T00:00:00.000Z" });
  const key = platform.createApiKey(token, { name: "ephemeral" }), reservation = platform.reserveUsage(key.key, { model: "video", maxCostMicros: 600, idempotencyKey: "stopped-reservation" });
  assert.throws(() => platform.failStoppedAccessReservations(application.id), error => error.code === "CONFLICT");
  platform.revokeApiKey(token, key.id); platform.stopKeyAccess(application.id, { reviewNote: "test ended" });
  const entries = platform.failStoppedAccessReservations(application.id); assert.equal(entries.length, 1); assert.equal(entries[0].reservationId, reservation.id); assert.equal(entries[0].status, "failed");
  const state = JSON.parse(readFileSync(file, "utf8")), subscription = state.subscriptions.find(item => item.id === reservation.subscriptionId); assert.equal(subscription.reservedMicros, 0); assert.equal(subscription.spentMicros, 0); assert.equal(state.usageReservations.find(item => item.id === reservation.id).status, "failed");
  assert.deepEqual(platform.failStoppedAccessReservations(application.id), []);
});

test("refunds reject failed usage and cross-account access", () => {
  const platform = createPlatform(), a = account(platform, "refund-a@example.test"), b = account(platform, "refund-b@example.test"), accountA = platform.authenticate(a).id, accountB = platform.authenticate(b).id;
  for (const accountId of [accountA, accountB]) platform.grantSubscription(accountId, { hardLimitMicros: 1000, periodEndsAt: "2099-01-01T00:00:00.000Z" });
  const reservation = platform.reserveUsageForAccount(accountA, { model: "video", maxCostMicros: 300, idempotencyKey: "failed-reservation" });
  const failed = platform.settleUsageForAccount(accountA, reservation.id, { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0, failed: true });
  assert.throws(() => platform.refundUsage(accountA, failed.id, { amountMicros: 1, idempotencyKey: "refund-failed", reason: "invalid" }), e => e.code === "CONFLICT");
  assert.throws(() => platform.refundUsage(accountB, failed.id, { amountMicros: 1, idempotencyKey: "refund-other", reason: "invalid" }), e => e.code === "FORBIDDEN");
  assert.deepEqual(platform.usageStatus(b).refunds, []);
});

test("administrators can reject applications and stop approved key access", () => {
  const platform = createPlatform(), approvedToken = account(platform, "approved@example.test"), rejectedToken = account(platform, "rejected@example.test");
  const rejected = platform.submitKeyApplication(rejectedToken, { reason: "Evaluation", requestedLimitMicros: 500 });
  assert.equal(platform.rejectKeyApplication(rejected.id, { reviewNote: "More information required" }).status, "rejected");
  assert.match(platform.createApiKey(rejectedToken).key, /^or_live_/);
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
  assert.equal(legacy.currency, "CNY"); assert.equal(legacy.unitScale, 1_000_000); assert.equal(legacy.status, "stopped"); assert.equal(state.schemaVersion, 7);
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
