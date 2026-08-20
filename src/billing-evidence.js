import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const exactKeys = (value, expected, label) => {
  assert.equal(value && typeof value, "object", `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields are invalid`);
};
const amount = (value, label) => {
  assert.ok(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`);
  return value;
};
const addAmount = (total, value, label) => {
  const next = total + amount(value, label);
  assert.ok(Number.isSafeInteger(next), `${label} total exceeds safe integer precision`);
  return next;
};
const requireUniqueIds = (entries, label) => {
  const ids = new Set();
  for (const entry of entries) {
    assert.ok(typeof entry?.id === "string" && entry.id, `billing snapshot ${label} id is required`);
    assert.ok(!ids.has(entry.id), `billing snapshot ${label} contains duplicate id ${entry.id}`);
    ids.add(entry.id);
  }
  return ids;
};
const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);

export function validateBillingEvidenceSnapshot(snapshot) {
  exactKeys(snapshot, ["subscription", "keys", "reservations", "usage", "refunds", "reconciliation", "paymentIntegration"], "billing snapshot");
  for (const field of ["keys", "reservations", "usage", "refunds"]) assert.ok(Array.isArray(snapshot[field]), `billing snapshot ${field} must be an array`);
  const accountId = snapshot.subscription?.accountId;
  assert.ok(typeof accountId === "string" && accountId, "billing snapshot accountId is required");
  assert.ok(typeof snapshot.subscription.id === "string" && snapshot.subscription.id, "billing snapshot subscription id is required");
  const subscriptionId = snapshot.subscription.id;
  const ids = Object.fromEntries(Object.entries({ keys: snapshot.keys, reservations: snapshot.reservations, usage: snapshot.usage, refunds: snapshot.refunds })
    .map(([field, entries]) => [field, requireUniqueIds(entries, field)]));
  for (const [field, entries] of Object.entries({ keys: snapshot.keys, reservations: snapshot.reservations, usage: snapshot.usage, refunds: snapshot.refunds })) {
    for (const entry of entries) {
      assert.equal(entry.accountId, accountId, `billing snapshot ${field} escaped account scope`);
      if (field !== "keys") assert.equal(entry.subscriptionId, subscriptionId, `billing snapshot ${field} escaped subscription scope`);
      if ("currency" in entry) assert.equal(entry.currency, snapshot.subscription.currency, `billing snapshot ${field} currency drifted`);
      if ("unitScale" in entry) assert.equal(entry.unitScale, snapshot.subscription.unitScale, `billing snapshot ${field} unit scale drifted`);
    }
  }
  for (const item of snapshot.usage) assert.ok(ids.reservations.has(item.reservationId), "billing snapshot usage references an unknown reservation");
  for (const item of snapshot.refunds) {
    assert.ok(ids.usage.has(item.usageId), "billing snapshot refund references unknown usage");
    assert.ok(ids.reservations.has(item.reservationId), "billing snapshot refund references an unknown reservation");
    assert.equal(snapshot.usage.find(usage => usage.id === item.usageId).reservationId, item.reservationId, "billing snapshot refund reservation does not match usage");
  }
  const reservedMicros = snapshot.reservations.filter(item => item.status === "reserved").reduce((sum, item) => addAmount(sum, item.maxCostMicros, "reservation maxCostMicros"), 0);
  const settledMicros = snapshot.usage.filter(item => item.status === "settled").reduce((sum, item) => addAmount(sum, item.costMicros, "usage costMicros"), 0);
  const refundedMicros = snapshot.refunds.reduce((sum, item) => addAmount(sum, item.amountMicros, "refund amountMicros"), 0);
  assert.ok(refundedMicros <= settledMicros, "billing snapshot refunds exceed settled usage");
  const spentMicros = settledMicros - refundedMicros;
  assert.equal(amount(snapshot.subscription.reservedMicros, "subscription reservedMicros"), reservedMicros, "billing snapshot reserved total drifted");
  assert.equal(amount(snapshot.subscription.spentMicros, "subscription spentMicros"), spentMicros, "billing snapshot spent total drifted");
  exactKeys(snapshot.reconciliation, ["accountId", "consistent", "mismatches"], "billing reconciliation");
  assert.equal(snapshot.reconciliation.accountId, accountId, "billing reconciliation escaped account scope");
  assert.equal(snapshot.reconciliation.consistent, true, "billing reconciliation is not consistent");
  assert.deepEqual(snapshot.reconciliation.mismatches, [], "billing reconciliation contains mismatches");
  exactKeys(snapshot.paymentIntegration, ["connected", "boundary"], "payment integration boundary");
  assert.equal(snapshot.paymentIntegration.connected, false, "billing evidence must not claim a connected payment integration");
  assert.ok(typeof snapshot.paymentIntegration.boundary === "string" && snapshot.paymentIntegration.boundary.trim(), "payment integration boundary is required");
  const serialized = canonical(snapshot);
  assert.doesNotMatch(serialized, /"(?:secretHash|passwordHash|token|key)":/i, "billing snapshot contains secret-bearing fields");
  return Object.freeze({
    status: "verified",
    accountId,
    counts: Object.freeze({ keys: snapshot.keys.length, reservations: snapshot.reservations.length, usage: snapshot.usage.length, refunds: snapshot.refunds.length }),
    totals: Object.freeze({ reservedMicros, settledMicros, refundedMicros, spentMicros }),
    paymentConnected: false,
    fingerprint: createHash("sha256").update(serialized).digest("hex")
  });
}
