import assert from "node:assert/strict";
import test from "node:test";
import template from "../docs/audio-candidate-review-template.json" with { type: "json" };
import { validateCompletedAudioCandidateReview } from "../src/audio-candidate-review.js";

const completed = () => {
  const value = structuredClone(template);
  value.status = "complete";
  value.decision = "accept_for_gate";
  value.reviewConclusion = "Evidence is complete; prepare a separate bounded human gate.";
  for (const section of [value.candidate, value.reviewer, value.providerTerms, value.dataHandling, value.regionAndTransfer, value.outputLicense, value.pricing, value.technicalEvidence, value.requiredTests, value.successorGateRequirements]) {
    for (const key of Object.keys(section)) {
      if (key === "evidenceRefs") section[key] = ["evidence/audio-review/item-1.json"];
      else if (section[key] === null) section[key] = typeof key === "string" && (key.startsWith("paid") || key.endsWith("Permitted") || key.endsWith("Recorded") || key.endsWith("Compatible") || key.endsWith("Required") || key.endsWith("Reviewed") || key.endsWith("Approved")) ? true : "reviewed";
      else if (Array.isArray(section[key]) && !section[key].length) section[key] = ["reviewed"];
    }
  }
  Object.assign(value.reviewer, { independentFromAuthor: true, conflictsDeclared: "none" });
  Object.assign(value.pricing, { currency: "USD", unitScale: 10000, inputUnitsPerMillion: 0, outputUnitsPerMillion: 500, maximumReservedUnitsPerCall: 1000 });
  Object.assign(value.technicalEvidence, { admissionPassed: true, maximumDurationSeconds: 30, timeoutSeconds: 60, automaticRetry: false, transportAndSsrfControlsReviewed: true });
  for (const key of Object.keys(value.requiredTests)) if (key !== "evidenceRefs") value.requiredTests[key] = true;
  Object.assign(value.successorGateRequirements, { callCount: 1, maximumReservedUnitsPerCall: 1000, aggregateMaximumReservedUnits: 1000, stopConditionsApproved: true, cleanupAuthorityApproved: true });
  return value;
};

test("completed audio review remains non-executable and only prepares a human gate", () => {
  assert.deepEqual(validateCompletedAudioCandidateReview(completed()), {
    valid: true,
    decision: "accept_for_gate",
    executionAuthorized: false,
    requiresHumanGate: true
  });
});

test("completed review accepts reproducible first-party CNY pricing without invented FX conversion", () => {
  const value = completed();
  Object.assign(value.pricing, {
    currency: "CNY",
    unitScale: 10000,
    inputUnitsPerMillion: 0,
    outputUnitsPerMillion: 500,
    reproductionCalculation: "CNY 5 / 10,000 characters = CNY 500 / 1,000,000 characters"
  });
  assert.equal(validateCompletedAudioCandidateReview(value).valid, true);
});

test("completed audio review fails closed on authority, independence, evidence, tests, pricing, and findings", () => {
  for (const mutate of [
    value => { value.executionAuthorized = true; },
    value => { value.unknown = true; },
    value => { value.pricing.secret = "not-allowed"; },
    value => { value.reviewer.independentFromAuthor = false; },
    value => { value.providerTerms.evidenceRefs = []; },
    value => { value.requiredTests.tenantIsolation = false; },
    value => { value.pricing.outputUnitsPerMillion = 0; },
    value => { value.openFindings = ["unresolved retention"]; },
    value => { value.successorGateRequirements.callCount = null; }
  ]) {
    const value = completed(); mutate(value); assert.throws(() => validateCompletedAudioCandidateReview(value));
  }
});

test("blank template is not misrepresented as a completed review", () => {
  assert.throws(() => validateCompletedAudioCandidateReview(structuredClone(template)));
});
