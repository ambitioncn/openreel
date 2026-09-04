import test from "node:test";
import assert from "node:assert/strict";
import { AUTHORIZATION_ID, CALLS, MAX_UNITS, validateAuthorization, validateLedger } from "../scripts/e01-phase-one-runner.mjs";

test("E-01 runner freezes the authorized eight-submission matrix and ceiling", () => {
  assert.equal(CALLS.length, 8);
  assert.deepEqual(Object.fromEntries(["embedding-vision", "seedream-5-lite", "seedance-2-fast"].map(model => [model, CALLS.filter(item => item.model === model).length])), { "embedding-vision": 2, "seedream-5-lite": 4, "seedance-2-fast": 2 });
  assert.equal(CALLS.reduce((sum, item) => sum + item.maximumReservedUnits, 0), MAX_UNITS);
  assert.equal(validateAuthorization({ OPENREEL_E01_EXECUTE: "true", OPENREEL_E01_AUTHORIZATION_ID: AUTHORIZATION_ID, OPENREEL_E01_MAX_SUBMISSIONS: "8", OPENREEL_E01_MAX_UNITS: "30558", OPENREEL_ARK_MAX_RETRIES: "0" }), true);
  for (const mutation of [env => { env.OPENREEL_E01_EXECUTE = "false"; }, env => { env.OPENREEL_E01_MAX_SUBMISSIONS = "9"; }, env => { env.OPENREEL_E01_MAX_UNITS = "30559"; }, env => { env.OPENREEL_ARK_MAX_RETRIES = "1"; }]) { const env = { OPENREEL_E01_EXECUTE: "true", OPENREEL_E01_AUTHORIZATION_ID: AUTHORIZATION_ID, OPENREEL_E01_MAX_SUBMISSIONS: "8", OPENREEL_E01_MAX_UNITS: "30558", OPENREEL_ARK_MAX_RETRIES: "0" }; mutation(env); assert.throws(() => validateAuthorization(env)); }
});

test("E-01 runner stops on ledger drift, open reservations, sequence mismatch, or budget breach", () => {
  const usage = { reconciliation: { consistent: true }, subscription: { currency: "USD", unitScale: 10_000, hardLimitMicros: MAX_UNITS, reservedMicros: 0, spentMicros: 100 }, usage: [{ model: "seedream-5-lite" }] };
  assert.equal(validateLedger(usage, 1, ["seedream-5-lite"]), true);
  for (const mutation of [value => { value.reconciliation.consistent = false; }, value => { value.subscription.reservedMicros = 1; }, value => { value.subscription.spentMicros = MAX_UNITS + 1; }, value => { value.usage[0].model = "seedance-2-fast"; }]) { const value = structuredClone(usage); mutation(value); assert.throws(() => validateLedger(value, 1, ["seedream-5-lite"])); }
});
