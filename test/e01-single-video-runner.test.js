import test from "node:test";
import assert from "node:assert/strict";
import { AUTHORIZATION_ID, MAX_UNITS, validateAuthorization, validateLedger } from "../scripts/e01-single-video-runner.mjs";

test("single-video authorization is exact and fail-closed", () => {
  assert.equal(AUTHORIZATION_ID, "openreel-e01-seedance2-cp80");
  assert.equal(validateAuthorization({ OPENREEL_E01_SINGLE_VIDEO_EXECUTE: "true", OPENREEL_E01_AUTHORIZATION_ID: AUTHORIZATION_ID, OPENREEL_E01_MAX_SUBMISSIONS: "1", OPENREEL_E01_MAX_UNITS: String(MAX_UNITS), OPENREEL_ARK_MAX_RETRIES: "0" }), true);
  for (const changed of [{ OPENREEL_E01_MAX_SUBMISSIONS: "2" }, { OPENREEL_E01_MAX_UNITS: "138890" }, { OPENREEL_ARK_MAX_RETRIES: "1" }]) assert.throws(() => validateAuthorization({ OPENREEL_E01_SINGLE_VIDEO_EXECUTE: "true", OPENREEL_E01_AUTHORIZATION_ID: AUTHORIZATION_ID, OPENREEL_E01_MAX_SUBMISSIONS: "1", OPENREEL_E01_MAX_UNITS: String(MAX_UNITS), OPENREEL_ARK_MAX_RETRIES: "0", ...changed }));
});

test("single-video ledger requires one settled Seedance entry", () => {
  const usage = { reconciliation: { consistent: true }, subscription: { currency: "USD", unitScale: 10_000, hardLimitMicros: MAX_UNITS, reservedMicros: 0, spentMicros: 100 }, usage: [{ model: "seedance-2" }] };
  assert.equal(validateLedger(usage), true);
  assert.throws(() => validateLedger({ ...usage, usage: [] }));
  assert.throws(() => validateLedger({ ...usage, subscription: { ...usage.subscription, reservedMicros: 1 } }));
});
