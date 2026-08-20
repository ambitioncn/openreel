import test from "node:test";
import assert from "node:assert/strict";
import { AUTHORIZATION_ID, SINGLE_MAX_UNITS as MAX_UNITS, validateAuthorization, validateLedger } from "./fixtures/e01-release-safety.mjs";

test("single-video authorization is exact and fail-closed", () => {
  assert.equal(AUTHORIZATION_ID, "test-only-non-authority");
  const options = { submissions: 1, maximumUnits: MAX_UNITS };
  assert.equal(validateAuthorization({ EXECUTE: "test-only", AUTHORIZATION_ID, MAX_SUBMISSIONS: "1", MAX_UNITS: String(MAX_UNITS), MAX_RETRIES: "0" }, options), true);
  for (const changed of [{ MAX_SUBMISSIONS: "2" }, { MAX_UNITS: "138890" }, { MAX_RETRIES: "1" }]) assert.throws(() => validateAuthorization({ EXECUTE: "test-only", AUTHORIZATION_ID, MAX_SUBMISSIONS: "1", MAX_UNITS: String(MAX_UNITS), MAX_RETRIES: "0", ...changed }, options));
});

test("single-video ledger requires one settled Seedance entry", () => {
  const usage = { reconciliation: { consistent: true }, subscription: { currency: "USD", unitScale: 10_000, hardLimitMicros: MAX_UNITS, reservedMicros: 0, spentMicros: 100 }, usage: [{ model: "seedance-2" }] };
  const options = { maximumUnits: MAX_UNITS, completed: 1, expectedModels: ["seedance-2"] };
  assert.equal(validateLedger(usage, options), true);
  assert.throws(() => validateLedger({ ...usage, usage: [] }, options));
  assert.throws(() => validateLedger({ ...usage, subscription: { ...usage.subscription, reservedMicros: 1 } }, options));
});
