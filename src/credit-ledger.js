import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, fsyncSync } from "node:fs";
import { dirname } from "node:path";

const ownRecord = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} must not contain accessors`);
  }
};
const exactKeys = (value, keys, label) => {
  const actual = Object.keys(value).sort(), expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} fields are invalid`);
};
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw new TypeError(`${label} is invalid`);
  return value;
};
const points = (value, label, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${label} is invalid`);
  return value;
};
const instant = (value, label) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) throw new TypeError(`${label} is invalid`);
  return value;
};

export function normalizeCreditLot(input) {
  ownRecord(input, "credit lot");
  exactKeys(input, ["id", "accountId", "kind", "model", "grantedPoints", "remainingPoints", "grantedAt", "expiresAt", "sourceQuoteId"], "credit lot");
  const kind = input.kind;
  if (!new Set(["general", "model_specific"]).has(kind)) throw new TypeError("credit lot kind is invalid");
  const model = kind === "model_specific" ? text(input.model, "credit lot model") : null;
  if (kind === "general" && input.model !== null) throw new TypeError("general credit lots cannot bind a model");
  const grantedAt = instant(input.grantedAt, "credit lot grantedAt"), expiresAt = instant(input.expiresAt, "credit lot expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(grantedAt)) throw new TypeError("credit lot expiry must follow grant time");
  const grantedPoints = points(input.grantedPoints, "credit lot grantedPoints", 1), remainingPoints = points(input.remainingPoints, "credit lot remainingPoints");
  if (remainingPoints > grantedPoints) throw new TypeError("credit lot remaining points exceed grant");
  return Object.freeze({ id: text(input.id, "credit lot id"), accountId: text(input.accountId, "credit lot accountId"), kind, model, grantedPoints, remainingPoints, grantedAt, expiresAt, sourceQuoteId: text(input.sourceQuoteId, "credit lot sourceQuoteId") });
}

export function planCreditConsumption(lotsInput, { accountId, model, points: requested, at }) {
  if (!Array.isArray(lotsInput)) throw new TypeError("credit lots must be an array");
  const owner = text(accountId, "accountId"), targetModel = text(model, "model"), amount = points(requested, "points", 1), now = instant(at, "at");
  const lots = lotsInput.map(normalizeCreditLot);
  assert.equal(new Set(lots.map(lot => lot.id)).size, lots.length, "credit lots contain duplicate ids");
  if (lots.some(lot => lot.accountId !== owner)) throw Object.assign(new Error("credit lots escaped account scope"), { code: "ACCOUNT_SCOPE_MISMATCH" });
  const eligible = lots.filter(lot => lot.remainingPoints > 0 && Date.parse(lot.expiresAt) > Date.parse(now) && (lot.kind === "general" || lot.model === targetModel)).sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || Date.parse(a.grantedAt) - Date.parse(b.grantedAt) || a.id.localeCompare(b.id));
  const available = eligible.reduce((sum, lot) => {
    const total = sum + lot.remainingPoints;
    if (!Number.isSafeInteger(total)) throw new TypeError("eligible credit total exceeds safe integer precision");
    return total;
  }, 0);
  if (available < amount) throw Object.assign(new Error("insufficient eligible credits"), { code: "INSUFFICIENT_CREDITS", availablePoints: available });
  let remaining = amount;
  const debits = [];
  for (const lot of eligible) {
    if (!remaining) break;
    const debitPoints = Math.min(remaining, lot.remainingPoints);
    debits.push(Object.freeze({ lotId: lot.id, points: debitPoints }));
    remaining -= debitPoints;
  }
  return Object.freeze({ schema: "openreel-credit-consumption-plan/v1", accountId: owner, model: targetModel, points: amount, at: now, debits: Object.freeze(debits), executable: false, paymentConnected: false, requiresHumanGate: true });
}

export function reconcileCreditLots(lotsInput, { accountId, at }) {
  if (!Array.isArray(lotsInput)) throw new TypeError("credit lots must be an array");
  const owner = text(accountId, "accountId"), now = instant(at, "at"), lots = lotsInput.map(normalizeCreditLot);
  assert.equal(new Set(lots.map(lot => lot.id)).size, lots.length, "credit lots contain duplicate ids");
  if (lots.some(lot => lot.accountId !== owner)) throw Object.assign(new Error("credit lots escaped account scope"), { code: "ACCOUNT_SCOPE_MISMATCH" });
  const add = (values, label) => values.reduce((sum, value) => { const total = sum + value; if (!Number.isSafeInteger(total)) throw new TypeError(`${label} exceeds safe integer precision`); return total; }, 0);
  const grantedPoints = add(lots.map(lot => lot.grantedPoints), "granted total");
  const remainingPoints = add(lots.map(lot => lot.remainingPoints), "remaining total");
  const expiredPoints = add(lots.filter(lot => Date.parse(lot.expiresAt) <= Date.parse(now)).map(lot => lot.remainingPoints), "expired total");
  return Object.freeze({ schema: "openreel-credit-lot-reconciliation/v1", accountId: owner, at: now, lotCount: lots.length, grantedPoints, consumedPoints: grantedPoints - remainingPoints, remainingPoints, expiredPoints, spendablePoints: remainingPoints - expiredPoints, consistent: true, paymentConnected: false });
}

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = value => structuredClone(value);
const freezeResult = value => Object.freeze({ ...value, lots: Object.freeze(value.lots.map(lot => Object.freeze(lot))), debits: Object.freeze(value.debits.map(debit => Object.freeze(debit))) });

export function createCreditLedgerStore(file) {
  if (typeof file !== "string" || !file) throw new TypeError("credit ledger file is invalid");
  const empty = () => ({ schema: "openreel-credit-ledger-store/v1", revision: 0, lots: [], operations: [] });
  const validate = state => {
    ownRecord(state, "credit ledger state");
    exactKeys(state, ["schema", "revision", "lots", "operations"], "credit ledger state");
    if (state.schema !== "openreel-credit-ledger-store/v1" || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.lots) || !Array.isArray(state.operations)) throw Object.assign(new Error("credit ledger state is corrupt"), { code: "CREDIT_LEDGER_CORRUPT" });
    const lots = state.lots.map(normalizeCreditLot);
    if (new Set(lots.map(lot => lot.id)).size !== lots.length) throw Object.assign(new Error("credit ledger state has duplicate lots"), { code: "CREDIT_LEDGER_CORRUPT" });
    for (const operation of state.operations) {
      ownRecord(operation, "credit operation");
      exactKeys(operation, ["operationId", "fingerprint", "result"], "credit operation");
      text(operation.operationId, "credit operation id"); text(operation.fingerprint, "credit operation fingerprint"); ownRecord(operation.result, "credit operation result");
    }
    return { ...state, lots: lots.map(clone), operations: clone(state.operations) };
  };
  const read = () => {
    if (!existsSync(file)) return empty();
    let parsed; try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { throw Object.assign(new Error("credit ledger state is unreadable"), { code: "CREDIT_LEDGER_CORRUPT" }); }
    return validate(parsed);
  };
  const write = state => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o750 });
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(state)}\n`, { flag: "wx", mode: 0o640 });
      const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, file);
      const dirFd = openSync(dirname(file), "r"); try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } finally { rmSync(temp, { force: true }); }
  };
  const lockDirectory = `${file}.lock`;
  const lockOwnerFile = directory => `${directory}/owner.json`;
  const readLockOwner = directory => {
    let bytes;
    try { bytes = readFileSync(lockOwnerFile(directory)); } catch { throw Object.assign(new Error("credit ledger lock owner is unreadable"), { code: "CREDIT_LEDGER_LOCK_INVALID" }); }
    let owner;
    try { owner = JSON.parse(bytes.toString("utf8")); } catch { throw Object.assign(new Error("credit ledger lock owner is invalid"), { code: "CREDIT_LEDGER_LOCK_INVALID" }); }
    try {
      ownRecord(owner, "credit ledger lock owner");
      exactKeys(owner, ["schema", "pid", "ledger", "createdAt", "nonce"], "credit ledger lock owner");
      if (owner.schema !== "openreel-credit-ledger-lock/v2" || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.ledger !== file) throw new TypeError("credit ledger lock owner fields are invalid");
      instant(owner.createdAt, "credit ledger lock owner createdAt"); text(owner.nonce, "credit ledger lock owner nonce");
    } catch { throw Object.assign(new Error("credit ledger lock owner is invalid"), { code: "CREDIT_LEDGER_LOCK_INVALID" }); }
    return { owner: Object.freeze(owner), fingerprint: createHash("sha256").update(bytes).digest("hex") };
  };
  const withExclusiveLock = operation => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o750 });
    try {
      mkdirSync(lockDirectory, { mode: 0o700 });
    } catch (error) {
      if (error?.code === "EEXIST") throw Object.assign(new Error("credit ledger is locked by another process"), { code: "CREDIT_LEDGER_LOCKED" });
      throw error;
    }
    try {
      writeFileSync(lockOwnerFile(lockDirectory), `${JSON.stringify({ schema: "openreel-credit-ledger-lock/v2", pid: process.pid, ledger: file, createdAt: new Date().toISOString(), nonce: crypto.randomUUID() })}\n`, { flag: "wx", mode: 0o600 });
      return operation();
    } finally {
      rmSync(lockDirectory, { recursive: true, force: true });
    }
  };
  return {
    inspectLock() {
      if (!existsSync(lockDirectory)) return Object.freeze({ locked: false, recoverable: false, paymentConnected: false });
      const { owner, fingerprint } = readLockOwner(lockDirectory);
      return Object.freeze({ locked: true, recoverable: true, owner, fingerprint, paymentConnected: false });
    },
    recoverLock({ expectedFingerprint }) {
      const expected = text(expectedFingerprint, "expectedFingerprint");
      if (!/^[a-f0-9]{64}$/.test(expected)) throw new TypeError("expectedFingerprint is invalid");
      const inspected = readLockOwner(lockDirectory);
      if (inspected.fingerprint !== expected) throw Object.assign(new Error("credit ledger lock changed after inspection"), { code: "CREDIT_LEDGER_LOCK_CHANGED" });
      const claimFile = `${lockDirectory}/recovery-claim.json`;
      const claim = `${JSON.stringify({ schema: "openreel-credit-ledger-recovery-claim/v1", ownerFingerprint: expected, pid: process.pid, nonce: crypto.randomUUID() })}\n`;
      try { writeFileSync(claimFile, claim, { flag: "wx", mode: 0o600 }); } catch (error) {
        if (error?.code === "EEXIST") throw Object.assign(new Error("credit ledger lock recovery is already claimed"), { code: "CREDIT_LEDGER_RECOVERY_CLAIMED" });
        if (error?.code === "ENOENT") throw Object.assign(new Error("credit ledger lock changed after inspection"), { code: "CREDIT_LEDGER_LOCK_CHANGED" });
        throw error;
      }
      try {
        const claimed = readLockOwner(lockDirectory);
        if (claimed.fingerprint !== expected) throw Object.assign(new Error("credit ledger lock changed during recovery"), { code: "CREDIT_LEDGER_LOCK_CHANGED" });
        rmSync(lockDirectory, { recursive: true });
        const dirFd = openSync(dirname(file), "r"); try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
        return Object.freeze({ recovered: true, fingerprint: expected, paymentConnected: false });
      } catch (error) {
        try { if (readFileSync(claimFile, "utf8") === claim) rmSync(claimFile); } catch {}
        throw error;
      }
    },
    initialize(lotsInput) {
      if (!Array.isArray(lotsInput)) throw new TypeError("credit lots must be an array");
      const lots = lotsInput.map(normalizeCreditLot); assert.equal(new Set(lots.map(lot => lot.id)).size, lots.length, "credit lots contain duplicate ids");
      return withExclusiveLock(() => {
        if (existsSync(file)) throw Object.assign(new Error("credit ledger already exists"), { code: "CREDIT_LEDGER_EXISTS" });
        const state = { ...empty(), lots: lots.map(clone) }; write(state); return Object.freeze({ revision: 0, lotCount: lots.length, paymentConnected: false });
      });
    },
    read() { const state = read(); return Object.freeze({ schema: state.schema, revision: state.revision, lots: Object.freeze(state.lots.map(lot => Object.freeze(clone(lot)))), operationCount: state.operations.length, paymentConnected: false }); },
    apply(plan, { operationId, expectedRevision }) {
      ownRecord(plan, "credit consumption plan");
      exactKeys(plan, ["schema", "accountId", "model", "points", "at", "debits", "executable", "paymentConnected", "requiresHumanGate"], "credit consumption plan");
      if (plan.schema !== "openreel-credit-consumption-plan/v1" || plan.executable !== false || plan.paymentConnected !== false || plan.requiresHumanGate !== true || !Array.isArray(plan.debits)) throw new TypeError("credit consumption plan boundary is invalid");
      const id = text(operationId, "operationId"), revision = points(expectedRevision, "expectedRevision"), fingerprint = digest(plan);
      return withExclusiveLock(() => {
        const state = read(), prior = state.operations.find(operation => operation.operationId === id);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw Object.assign(new Error("credit operation idempotency conflict"), { code: "IDEMPOTENCY_CONFLICT" });
          return freezeResult({ ...clone(prior.result), replayed: true });
        }
        if (state.revision !== revision) throw Object.assign(new Error("credit ledger changed during operation"), { code: "CONCURRENT_UPDATE", expectedRevision: revision, currentRevision: state.revision });
        const lots = state.lots.map(normalizeCreditLot);
        const byId = new Map(lots.map(lot => [lot.id, { ...lot }])); let applied = 0;
        for (const debit of plan.debits) {
          ownRecord(debit, "credit debit"); exactKeys(debit, ["lotId", "points"], "credit debit");
          const lotId = text(debit.lotId, "credit debit lotId"), amount = points(debit.points, "credit debit points", 1), lot = byId.get(lotId);
          if (!lot || lot.accountId !== plan.accountId || lot.remainingPoints < amount) throw Object.assign(new Error("credit debit no longer applies"), { code: "STALE_CREDIT_PLAN" });
          lot.remainingPoints -= amount; applied += amount;
        }
        if (applied !== plan.points) throw Object.assign(new Error("credit debit total does not match plan"), { code: "STALE_CREDIT_PLAN" });
        const result = { schema: "openreel-credit-consumption-result/v1", operationId: id, accountId: plan.accountId, model: plan.model, points: plan.points, at: plan.at, revision: state.revision + 1, lots: [...byId.values()].map(clone), debits: clone(plan.debits), replayed: false, paymentConnected: false };
        const next = { ...state, revision: result.revision, lots: result.lots, operations: [...state.operations, { operationId: id, fingerprint, result }] };
        write(next); return freezeResult(clone(result));
      });
    }
  };
}
