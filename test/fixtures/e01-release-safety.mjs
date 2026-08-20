import assert from "node:assert/strict";

export const AUTHORIZATION_ID = "test-only-non-authority";
export const PHASE_MAX_UNITS = 30_558;
export const SINGLE_MAX_UNITS = 138_889;
export const CALLS = Object.freeze([
  ...Array.from({ length: 4 }, (_, index) => Object.freeze({ caseId: `image-${index + 1}`, model: "seedream-5-lite", maximumReservedUnits: 2_778 })),
  ...Array.from({ length: 2 }, (_, index) => Object.freeze({ caseId: `video-${index + 1}`, model: "seedance-2-fast", maximumReservedUnits: 6_945 })),
  Object.freeze({ caseId: "vision-image", model: "embedding-vision", maximumReservedUnits: 2_778 }),
  Object.freeze({ caseId: "vision-video", model: "embedding-vision", maximumReservedUnits: 2_778 })
]);

export function validateAuthorization(env, { submissions, maximumUnits }) {
  assert.equal(env.EXECUTE, "test-only");
  assert.equal(env.AUTHORIZATION_ID, AUTHORIZATION_ID);
  assert.equal(env.MAX_SUBMISSIONS, String(submissions));
  assert.equal(env.MAX_UNITS, String(maximumUnits));
  assert.equal(env.MAX_RETRIES, "0");
  return true;
}

export function validateLedger(usage, { maximumUnits, completed, expectedModels }) {
  assert.equal(usage.reconciliation?.consistent, true);
  assert.equal(usage.subscription?.currency, "USD");
  assert.equal(usage.subscription?.unitScale, 10_000);
  assert.equal(usage.subscription?.hardLimitMicros, maximumUnits);
  assert.equal(usage.subscription?.reservedMicros, 0);
  assert.ok(usage.subscription?.spentMicros <= maximumUnits);
  assert.equal(usage.usage?.length, completed);
  assert.deepEqual(usage.usage.map(item => item.model), expectedModels);
  return true;
}
