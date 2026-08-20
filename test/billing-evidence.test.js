import assert from "node:assert/strict";
import test from "node:test";
import { validateBillingEvidenceSnapshot } from "../src/billing-evidence.js";
import { createPlatform } from "../src/platform.js";

function fixture() {
  const platform = createPlatform();
  platform.register({ email: "evidence@example.test", password: "local-pass-123" });
  const token = platform.login({ email: "evidence@example.test", password: "local-pass-123" }).token;
  const accountId = platform.authenticate(token).id;
  platform.grantSubscription(accountId, { hardLimitMicros: 1000, periodEndsAt: "2099-01-01T00:00:00.000Z" });
  const reservation = platform.reserveUsageForAccount(accountId, { model: "image", maxCostMicros: 600, idempotencyKey: "evidence-1" });
  const usage = platform.settleUsageForAccount(accountId, reservation.id, { inputTokens: 600000, outputTokens: 0, inputMicrosPerMillion: 1000, outputMicrosPerMillion: 0 });
  platform.refundUsage(accountId, usage.id, { amountMicros: 200, idempotencyKey: "refund-1", reason: "quality adjustment" });
  platform.reserveUsageForAccount(accountId, { model: "video", maxCostMicros: 300, idempotencyKey: "evidence-2" });
  return platform.usageStatus(token);
}

test("B-01 billing evidence verifies account scope, arithmetic and disconnected payment boundary", () => {
  const result = validateBillingEvidenceSnapshot(fixture());
  assert.deepEqual(result.counts, { keys: 0, reservations: 2, usage: 1, refunds: 1 });
  assert.deepEqual(result.totals, { reservedMicros: 300, settledMicros: 600, refundedMicros: 200, spentMicros: 400 });
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.paymentConnected, false);
});

test("B-01 billing evidence fails closed on account escape and arithmetic drift", () => {
  const escaped = fixture(); escaped.reservations[0].accountId = "other-account";
  assert.throws(() => validateBillingEvidenceSnapshot(escaped), /escaped account scope/);
  const drifted = fixture(); drifted.subscription.spentMicros++;
  assert.throws(() => validateBillingEvidenceSnapshot(drifted), /spent total drifted/);
  const refund = fixture(); refund.refunds[0].amountMicros = 601;
  assert.throws(() => validateBillingEvidenceSnapshot(refund), /refunds exceed settled usage/);
});

test("B-01 billing evidence rejects reconciliation, payment and secret-bearing claims", () => {
  const mismatch = fixture(); mismatch.reconciliation.consistent = false; mismatch.reconciliation.mismatches = [{}];
  assert.throws(() => validateBillingEvidenceSnapshot(mismatch), /not consistent/);
  const payment = fixture(); payment.paymentIntegration.connected = true;
  assert.throws(() => validateBillingEvidenceSnapshot(payment), /must not claim a connected payment integration/);
  const secret = fixture(); secret.keys.push({ id: "forbidden-key", accountId: secret.subscription.accountId, key: "forbidden" });
  assert.throws(() => validateBillingEvidenceSnapshot(secret), /secret-bearing fields/);
});

test("B-01 billing evidence rejects duplicate and broken ledger references", () => {
  const duplicate = fixture(); duplicate.refunds.push({ ...duplicate.refunds[0] });
  assert.throws(() => validateBillingEvidenceSnapshot(duplicate), /refunds contains duplicate id/);
  const unknownUsage = fixture(); unknownUsage.refunds[0].usageId = "missing-usage";
  assert.throws(() => validateBillingEvidenceSnapshot(unknownUsage), /references unknown usage/);
  const wrongReservation = fixture();
  wrongReservation.refunds[0].reservationId = wrongReservation.reservations[1].id;
  assert.throws(() => validateBillingEvidenceSnapshot(wrongReservation), /reservation does not match usage/);
});

test("B-01 billing evidence rejects currency, unit scale and aggregate precision drift", () => {
  const currency = fixture(); currency.usage[0].currency = "EUR";
  assert.throws(() => validateBillingEvidenceSnapshot(currency), /usage currency drifted/);
  const scale = fixture(); scale.refunds[0].unitScale = 100;
  assert.throws(() => validateBillingEvidenceSnapshot(scale), /refunds unit scale drifted/);
  const overflow = fixture();
  overflow.reservations[0].status = "reserved";
  overflow.reservations[0].maxCostMicros = Number.MAX_SAFE_INTEGER;
  overflow.reservations.push({ ...overflow.reservations[0], id: "second-reservation", maxCostMicros: 1 });
  assert.throws(() => validateBillingEvidenceSnapshot(overflow), /total exceeds safe integer precision/);
});
