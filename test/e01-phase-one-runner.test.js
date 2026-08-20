import test from "node:test";
import assert from "node:assert/strict";
import { AUTHORIZATION_ID, CALLS, PHASE_MAX_UNITS as MAX_UNITS, validateAuthorization, validateLedger } from "./fixtures/e01-release-safety.mjs";

test("E-01 runner freezes the authorized eight-submission matrix and ceiling", () => {
  assert.equal(CALLS.length, 8);
  assert.deepEqual(Object.fromEntries(["embedding-vision", "seedream-5-lite", "seedance-2-fast"].map(model => [model, CALLS.filter(item => item.model === model).length])), { "embedding-vision": 2, "seedream-5-lite": 4, "seedance-2-fast": 2 });
  assert.equal(CALLS.reduce((sum, item) => sum + item.maximumReservedUnits, 0), MAX_UNITS);
  const options = { submissions: 8, maximumUnits: MAX_UNITS };
  assert.equal(validateAuthorization({ EXECUTE: "test-only", AUTHORIZATION_ID, MAX_SUBMISSIONS: "8", MAX_UNITS: "30558", MAX_RETRIES: "0" }, options), true);
  for (const mutation of [env => { env.EXECUTE = "false"; }, env => { env.MAX_SUBMISSIONS = "9"; }, env => { env.MAX_UNITS = "30559"; }, env => { env.MAX_RETRIES = "1"; }]) { const env = { EXECUTE: "test-only", AUTHORIZATION_ID, MAX_SUBMISSIONS: "8", MAX_UNITS: "30558", MAX_RETRIES: "0" }; mutation(env); assert.throws(() => validateAuthorization(env, options)); }
});

test("E-01 runner stops on ledger drift, open reservations, sequence mismatch, or budget breach", () => {
  const usage = { reconciliation: { consistent: true }, subscription: { currency: "USD", unitScale: 10_000, hardLimitMicros: MAX_UNITS, reservedMicros: 0, spentMicros: 100 }, usage: [{ model: "seedream-5-lite" }] };
  const options = { maximumUnits: MAX_UNITS, completed: 1, expectedModels: ["seedream-5-lite"] };
  assert.equal(validateLedger(usage, options), true);
  for (const mutation of [value => { value.reconciliation.consistent = false; }, value => { value.subscription.reservedMicros = 1; }, value => { value.subscription.spentMicros = MAX_UNITS + 1; }, value => { value.usage[0].model = "seedance-2-fast"; }]) { const value = structuredClone(usage); mutation(value); assert.throws(() => validateLedger(value, options)); }
});
