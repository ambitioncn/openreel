import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCreditProduct, quoteCreditProduct } from "../src/credit-products.js";

const fixture = (overrides = {}) => ({
  id: "seedance-25-launch",
  kind: "model_specific",
  model: "seedance-2.5",
  minimumTier: "premium",
  basePoints: 7_500,
  bonusBasisPoints: 7_000,
  priceMicros: 499_000_000,
  currency: "CNY",
  unitScale: 1_000_000,
  validForDays: 730,
  purchaseLimit: null,
  ...overrides
});

test("B-01 credit products represent evidenced model scope, membership, bonus and expiry without payment authority", () => {
  const quote = quoteCreditProduct(fixture(), { membershipTier: "premium" });
  assert.deepEqual(quote, {
    schema: "openreel-credit-product-quote/v1",
    productId: "seedance-25-launch",
    kind: "model_specific",
    model: "seedance-2.5",
    basePoints: 7_500,
    bonusPoints: 5_250,
    totalPoints: 12_750,
    validForDays: 730,
    priceMicros: 499_000_000,
    currency: "CNY",
    unitScale: 1_000_000,
    executable: false,
    paymentConnected: false,
    requiresHumanGate: true
  });
  assert.equal(Object.isFrozen(quote), true);
});

test("B-01 credit products enforce membership and periodic purchase limits", () => {
  assert.throws(() => quoteCreditProduct(fixture(), { membershipTier: "starter" }), error => error.code === "MEMBERSHIP_REQUIRED");
  const limited = fixture({ purchaseLimit: { count: 1, period: "week" } });
  assert.equal(quoteCreditProduct(limited, { membershipTier: "supreme", priorPurchasesInPeriod: 0 }).totalPoints, 12_750);
  assert.throws(() => quoteCreditProduct(limited, { membershipTier: "supreme", priorPurchasesInPeriod: 1 }), error => error.code === "PURCHASE_LIMIT_REACHED");
});

test("B-01 credit product contracts reject scope, money, field and authority drift", () => {
  assert.throws(() => normalizeCreditProduct(fixture({ kind: "general", model: "seedance-2.5" })), /cannot bind a model/);
  assert.throws(() => normalizeCreditProduct(fixture({ kind: "model_specific", model: null })), /model is invalid/);
  assert.throws(() => normalizeCreditProduct(fixture({ currency: "USD" })), /money metadata/);
  assert.throws(() => normalizeCreditProduct(fixture({ bonusBasisPoints: -1 })), /bonusBasisPoints/);
  assert.throws(() => normalizeCreditProduct({ ...fixture(), executable: true }), /fields are invalid/);
  const accessor = fixture(); Object.defineProperty(accessor, "priceMicros", { enumerable: true, get: () => 1 });
  assert.throws(() => normalizeCreditProduct(accessor), /enumerable data property/);
});
