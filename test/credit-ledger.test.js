import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCreditLedgerStore, normalizeCreditLot, planCreditConsumption, reconcileCreditLots } from "../src/credit-ledger.js";

const lot = (overrides = {}) => ({ id: "lot-general", accountId: "acct-1", kind: "general", model: null, grantedPoints: 1000, remainingPoints: 800, grantedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-09-01T00:00:00.000Z", sourceQuoteId: "quote-1", ...overrides });

test("B-01 credit consumption is expiry ordered, model scoped and non-executable", () => {
  const plan = planCreditConsumption([
    lot({ id: "later", expiresAt: "2026-10-01T00:00:00.000Z", remainingPoints: 500 }),
    lot({ id: "specific", kind: "model_specific", model: "qwen-video", remainingPoints: 300, expiresAt: "2026-08-20T00:00:00.000Z" }),
    lot({ id: "other", kind: "model_specific", model: "other-model", remainingPoints: 900, expiresAt: "2026-08-19T00:00:00.000Z" })
  ], { accountId: "acct-1", model: "qwen-video", points: 600, at: "2026-08-17T00:00:00.000Z" });
  assert.deepEqual(plan.debits, [{ lotId: "specific", points: 300 }, { lotId: "later", points: 300 }]);
  assert.equal(plan.executable, false); assert.equal(plan.paymentConnected, false); assert.equal(plan.requiresHumanGate, true);
  assert.throws(() => { plan.debits.push({}); }, TypeError);
});

test("B-01 credit lots exclude expired and incompatible balances and fail closed on insufficiency", () => {
  assert.throws(() => planCreditConsumption([
    lot({ id: "expired", remainingPoints: 700, expiresAt: "2026-08-16T00:00:00.000Z" }),
    lot({ id: "wrong-model", kind: "model_specific", model: "other", remainingPoints: 500 })
  ], { accountId: "acct-1", model: "qwen-video", points: 1, at: "2026-08-17T00:00:00.000Z" }), error => error.code === "INSUFFICIENT_CREDITS" && error.availablePoints === 0);
  assert.throws(() => planCreditConsumption([lot(), lot({ id: "foreign", accountId: "acct-2" })], { accountId: "acct-1", model: "qwen-video", points: 1, at: "2026-08-17T00:00:00.000Z" }), error => error.code === "ACCOUNT_SCOPE_MISMATCH");
});

test("B-01 credit reconciliation separates consumed, expired and spendable points", () => {
  const result = reconcileCreditLots([lot(), lot({ id: "expired", grantedPoints: 400, remainingPoints: 250, expiresAt: "2026-08-16T00:00:00.000Z" })], { accountId: "acct-1", at: "2026-08-17T00:00:00.000Z" });
  assert.deepEqual(result, { schema: "openreel-credit-lot-reconciliation/v1", accountId: "acct-1", at: "2026-08-17T00:00:00.000Z", lotCount: 2, grantedPoints: 1400, consumedPoints: 350, remainingPoints: 1050, expiredPoints: 250, spendablePoints: 800, consistent: true, paymentConnected: false });
});

test("B-01 credit lot contracts reject field, time, scope and arithmetic drift", () => {
  assert.throws(() => normalizeCreditLot(lot({ extra: true })), /fields are invalid/);
  assert.throws(() => normalizeCreditLot(lot({ remainingPoints: 1001 })), /exceed grant/);
  assert.throws(() => normalizeCreditLot(lot({ expiresAt: "2026-07-01T00:00:00.000Z" })), /expiry must follow/);
  assert.throws(() => normalizeCreditLot(lot({ kind: "general", model: "qwen" })), /cannot bind/);
  assert.throws(() => planCreditConsumption([lot(), lot()], { accountId: "acct-1", model: "qwen", points: 1, at: "2026-08-17T00:00:00.000Z" }), /duplicate ids/);
});

test("B-01 durable credit debit applies atomically and survives restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-credit-")), "ledger.json");
  const store = createCreditLedgerStore(file); store.initialize([lot()]);
  const plan = planCreditConsumption([lot()], { accountId: "acct-1", model: "qwen-video", points: 300, at: "2026-08-17T00:00:00.000Z" });
  const result = store.apply(plan, { operationId: "usage-1", expectedRevision: 0 });
  assert.equal(result.revision, 1); assert.equal(result.lots[0].remainingPoints, 500); assert.equal(result.paymentConnected, false);
  const restarted = createCreditLedgerStore(file); assert.equal(restarted.read().lots[0].remainingPoints, 500); assert.equal(restarted.read().operationCount, 1);
  const replay = restarted.apply(plan, { operationId: "usage-1", expectedRevision: 0 });
  assert.equal(replay.revision, 1); assert.equal(replay.replayed, true); assert.equal(restarted.read().revision, 1);
});

test("B-01 durable credit debit fails closed on concurrency, drift and corruption", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-credit-")), "ledger.json"), store = createCreditLedgerStore(file); store.initialize([lot()]);
  const plan = planCreditConsumption([lot()], { accountId: "acct-1", model: "qwen-video", points: 100, at: "2026-08-17T00:00:00.000Z" });
  store.apply(plan, { operationId: "usage-1", expectedRevision: 0 });
  assert.throws(() => store.apply(plan, { operationId: "usage-2", expectedRevision: 0 }), error => error.code === "CONCURRENT_UPDATE");
  const changed = { ...plan, points: 101 };
  assert.throws(() => store.apply(changed, { operationId: "usage-1", expectedRevision: 1 }), error => error.code === "IDEMPOTENCY_CONFLICT");
  writeFileSync(file, readFileSync(file, "utf8").replace('"revision":1', '"revision":-1'));
  assert.throws(() => store.read(), error => error.code === "CREDIT_LEDGER_CORRUPT");
});

test("B-01 ledger excludes a second process while an exclusive lock is held", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-credit-")), "ledger.json"), store = createCreditLedgerStore(file); store.initialize([lot()]);
  const plan = planCreditConsumption([lot()], { accountId: "acct-1", model: "qwen-video", points: 100, at: "2026-08-17T00:00:00.000Z" });
  mkdirSync(`${file}.lock`, { mode: 0o700 });
  writeFileSync(`${file}.lock/owner.json`, '{"schema":"openreel-credit-ledger-lock/v1","pid":999999}\n', { mode: 0o600 });
  assert.throws(() => store.apply(plan, { operationId: "usage-locked", expectedRevision: 0 }), error => error.code === "CREDIT_LEDGER_LOCKED");
  assert.equal(store.read().revision, 0); assert.equal(store.read().lots[0].remainingPoints, 800);
  rmSync(`${file}.lock`, { recursive: true });
  assert.equal(store.apply(plan, { operationId: "usage-after-lock", expectedRevision: 0 }).revision, 1);
});

test("B-01 abandoned crash lock fails closed without mutating durable state", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-credit-")), "ledger.json"), store = createCreditLedgerStore(file); store.initialize([lot()]);
  const before = readFileSync(file, "utf8");
  mkdirSync(`${file}.lock`, { mode: 0o700 });
  writeFileSync(`${file}.lock/owner.json`, '{"schema":"openreel-credit-ledger-lock/v1","pid":999998}\n', { mode: 0o600 });
  const plan = planCreditConsumption([lot()], { accountId: "acct-1", model: "qwen-video", points: 100, at: "2026-08-17T00:00:00.000Z" });
  assert.throws(() => store.apply(plan, { operationId: "usage-after-crash", expectedRevision: 0 }), error => error.code === "CREDIT_LEDGER_LOCKED");
  assert.equal(readFileSync(file, "utf8"), before);
});

test("B-01 abandoned lock recovery is bound to an inspected owner fingerprint", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-credit-")), "ledger.json"), store = createCreditLedgerStore(file); store.initialize([lot()]);
  const lock = `${file}.lock`;
  mkdirSync(lock, { mode: 0o700 });
  writeFileSync(`${lock}/owner.json`, `${JSON.stringify({ schema: "openreel-credit-ledger-lock/v2", pid: 999997, ledger: file, createdAt: "2026-08-17T01:00:00.000Z", nonce: "crash-owner-1" })}\n`, { mode: 0o600 });
  const inspection = store.inspectLock();
  assert.equal(inspection.locked, true); assert.equal(inspection.owner.pid, 999997); assert.match(inspection.fingerprint, /^[a-f0-9]{64}$/);
  assert.throws(() => store.recoverLock({ expectedFingerprint: "0".repeat(64) }), error => error.code === "CREDIT_LEDGER_LOCK_CHANGED");
  assert.equal(store.inspectLock().fingerprint, inspection.fingerprint);
  assert.deepEqual(store.recoverLock({ expectedFingerprint: inspection.fingerprint }), { recovered: true, fingerprint: inspection.fingerprint, paymentConnected: false });
  assert.deepEqual(store.inspectLock(), { locked: false, recoverable: false, paymentConnected: false });
});

test("B-01 lock inspection and recovery reject malformed or changed ownership", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-credit-")), "ledger.json"), store = createCreditLedgerStore(file); store.initialize([lot()]);
  const lock = `${file}.lock`; mkdirSync(lock, { mode: 0o700 });
  writeFileSync(`${lock}/owner.json`, '{"schema":"openreel-credit-ledger-lock/v1","pid":999996}\n', { mode: 0o600 });
  assert.throws(() => store.inspectLock(), error => error.code === "CREDIT_LEDGER_LOCK_INVALID");
  rmSync(lock, { recursive: true }); mkdirSync(lock, { mode: 0o700 });
  writeFileSync(`${lock}/owner.json`, `${JSON.stringify({ schema: "openreel-credit-ledger-lock/v2", pid: 999995, ledger: file, createdAt: "2026-08-17T01:00:00.000Z", nonce: "owner-before" })}\n`, { mode: 0o600 });
  const fingerprint = store.inspectLock().fingerprint;
  writeFileSync(`${lock}/owner.json`, `${JSON.stringify({ schema: "openreel-credit-ledger-lock/v2", pid: 999994, ledger: file, createdAt: "2026-08-17T01:00:01.000Z", nonce: "owner-after" })}\n`);
  assert.throws(() => store.recoverLock({ expectedFingerprint: fingerprint }), error => error.code === "CREDIT_LEDGER_LOCK_CHANGED");
  assert.equal(store.inspectLock().owner.pid, 999994);
});

test("B-01 recovery claim keeps the canonical lock fail-closed across a recovery crash", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-credit-")), "ledger.json"), store = createCreditLedgerStore(file); store.initialize([lot()]);
  const lock = `${file}.lock`; mkdirSync(lock, { mode: 0o700 });
  writeFileSync(`${lock}/owner.json`, `${JSON.stringify({ schema: "openreel-credit-ledger-lock/v2", pid: 999993, ledger: file, createdAt: "2026-08-17T01:00:00.000Z", nonce: "abandoned-owner" })}\n`, { mode: 0o600 });
  const fingerprint = store.inspectLock().fingerprint;
  writeFileSync(`${lock}/recovery-claim.json`, `${JSON.stringify({ schema: "openreel-credit-ledger-recovery-claim/v1", ownerFingerprint: fingerprint, pid: 999992, nonce: "crashed-recoverer" })}\n`, { mode: 0o600 });
  assert.throws(() => store.recoverLock({ expectedFingerprint: fingerprint }), error => error.code === "CREDIT_LEDGER_RECOVERY_CLAIMED");
  const plan = planCreditConsumption([lot()], { accountId: "acct-1", model: "qwen-video", points: 100, at: "2026-08-17T00:00:00.000Z" });
  assert.throws(() => store.apply(plan, { operationId: "usage-during-recovery", expectedRevision: 0 }), error => error.code === "CREDIT_LEDGER_LOCKED");
  assert.equal(store.read().revision, 0);
});
