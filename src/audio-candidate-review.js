const DECISIONS = new Set(["accept_for_gate", "reject"]);
const FIELDS = Object.freeze({
  review: ["schema", "status", "decision", "executionAuthorized", "candidate", "reviewer", "providerTerms", "dataHandling", "regionAndTransfer", "outputLicense", "pricing", "technicalEvidence", "requiredTests", "openFindings", "reviewConclusion", "successorGateRequirements"],
  candidate: ["modelId", "providerLegalName", "endpointHost", "productDocumentationUrl", "admissionArtifactSha256"],
  reviewer: ["identity", "organizationOrRole", "independentFromAuthor", "conflictsDeclared", "reviewedAt"],
  providerTerms: ["termsUrl", "termsVersionOrDate", "paidApiUsePermitted", "automatedGenerationPermitted", "suspensionAndRateLimitTermsRecorded", "evidenceRefs"],
  dataHandling: ["inputRetention", "outputRetention", "trainingUse", "subprocessors", "deletionProcess", "sensitiveDataAllowed", "evidenceRefs"],
  regionAndTransfer: ["processingRegions", "storageRegions", "crossBorderTransferBasis", "stagingRegionCompatible", "evidenceRefs"],
  outputLicense: ["commercialUsePermitted", "ownershipOrLicenseGrant", "attributionRequired", "voiceConsentRequirements", "musicAndSfxRestrictions", "indemnityOrWarrantyLimitsRecorded", "evidenceRefs"],
  pricing: ["sourceUrl", "verifiedAt", "currency", "unitScale", "inputUnitsPerMillion", "outputUnitsPerMillion", "maximumReservedUnitsPerCall", "taxAndTierAssumptions", "reproductionCalculation", "evidenceRefs"],
  technicalEvidence: ["admissionPassed", "mode", "controls", "maximumDurationSeconds", "resultMimeTypes", "timeoutSeconds", "automaticRetry", "transportAndSsrfControlsReviewed", "evidenceRefs"],
  requiredTests: ["schemaNegatives", "credentialRedaction", "tenantIsolation", "idempotency", "reservationAndSettlement", "timeoutAndStop", "mimeAndSizeValidation", "licenseAndConsentFixture", "evidenceRefs"],
  successorGateRequirements: ["stagingBaseUrl", "credentialSourceReference", "providerEndpointId", "callCount", "maximumReservedUnitsPerCall", "aggregateMaximumReservedUnits", "stopConditionsApproved", "cleanupAuthorityApproved", "humanApprovalStatement"]
});

const requiredText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
};

const requiredBoolean = (value, field) => {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be boolean`);
  return value;
};

const requiredPositiveInteger = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
  return value;
};

const requiredEvidence = (section, field) => {
  if (!Array.isArray(section?.evidenceRefs) || !section.evidenceRefs.length) throw new TypeError(`${field}.evidenceRefs is required`);
  section.evidenceRefs.forEach((value, index) => requiredText(value, `${field}.evidenceRefs[${index}]`));
};

const exactFields = (value, allowed, field) => {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${field} fields do not match schema`);
};

const resolvedObject = (value, field, ignored = new Set(["evidenceRefs"])) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  for (const [key, item] of Object.entries(value)) {
    if (ignored.has(key)) continue;
    if (item === null || item === undefined || item === "" || (Array.isArray(item) && !item.length)) throw new TypeError(`${field}.${key} must be resolved`);
  }
};

const evidenceSections = ["providerTerms", "dataHandling", "regionAndTransfer", "outputLicense", "pricing", "technicalEvidence", "requiredTests"];

export function validateCompletedAudioCandidateReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review)) throw new TypeError("review must be an object");
  exactFields(review, FIELDS.review, "review");
  if (review.schema !== "openreel-audio-candidate-review/v1") throw new TypeError("review.schema is unsupported");
  if (review.status !== "complete" || !DECISIONS.has(review.decision)) throw new TypeError("review must be complete with an allowed decision");
  if (review.executionAuthorized !== false) throw new TypeError("review.executionAuthorized must remain false");

  resolvedObject(review.candidate, "review.candidate");
  resolvedObject(review.reviewer, "review.reviewer");
  if (review.reviewer.independentFromAuthor !== true) throw new TypeError("review.reviewer must be independent from the author");
  requiredText(review.reviewer.conflictsDeclared, "review.reviewer.conflictsDeclared");

  for (const sectionName of evidenceSections) {
    exactFields(review[sectionName], FIELDS[sectionName], `review.${sectionName}`);
    resolvedObject(review[sectionName], `review.${sectionName}`);
    requiredEvidence(review[sectionName], `review.${sectionName}`);
  }
  if (review.dataHandling.sensitiveDataAllowed !== false) throw new TypeError("review.dataHandling.sensitiveDataAllowed must remain false");
  if (review.technicalEvidence.admissionPassed !== true || review.technicalEvidence.automaticRetry !== false || review.technicalEvidence.transportAndSsrfControlsReviewed !== true) throw new TypeError("review.technicalEvidence must pass admission and safety controls without automatic retry");
  for (const [key, value] of Object.entries(review.requiredTests)) {
    if (key !== "evidenceRefs" && value !== true) throw new TypeError(`review.requiredTests.${key} must pass`);
  }

  requiredPositiveInteger(review.pricing.unitScale, "review.pricing.unitScale");
  const inputRate = Number.isSafeInteger(review.pricing.inputUnitsPerMillion) ? review.pricing.inputUnitsPerMillion : -1;
  const outputRate = Number.isSafeInteger(review.pricing.outputUnitsPerMillion) ? review.pricing.outputUnitsPerMillion : -1;
  requiredPositiveInteger(review.pricing.maximumReservedUnitsPerCall, "review.pricing.maximumReservedUnitsPerCall");
  if (!new Set(["USD", "CNY"]).has(review.pricing.currency) || inputRate < 0 || outputRate < 0 || inputRate + outputRate === 0) throw new TypeError("review.pricing must contain reproducible positive rates in a reviewed billing currency");

  if (!Array.isArray(review.openFindings)) throw new TypeError("review.openFindings must be an array");
  if (review.decision === "accept_for_gate" && review.openFindings.length) throw new TypeError("accepted review cannot contain open findings");
  requiredText(review.reviewConclusion, "review.reviewConclusion");
  exactFields(review.candidate, FIELDS.candidate, "review.candidate");
  exactFields(review.reviewer, FIELDS.reviewer, "review.reviewer");
  exactFields(review.successorGateRequirements, FIELDS.successorGateRequirements, "review.successorGateRequirements");
  resolvedObject(review.successorGateRequirements, "review.successorGateRequirements");
  requiredPositiveInteger(review.successorGateRequirements.callCount, "review.successorGateRequirements.callCount");
  requiredPositiveInteger(review.successorGateRequirements.maximumReservedUnitsPerCall, "review.successorGateRequirements.maximumReservedUnitsPerCall");
  requiredPositiveInteger(review.successorGateRequirements.aggregateMaximumReservedUnits, "review.successorGateRequirements.aggregateMaximumReservedUnits");
  if (review.successorGateRequirements.stopConditionsApproved !== true || review.successorGateRequirements.cleanupAuthorityApproved !== true) throw new TypeError("review.successorGateRequirements must resolve stop and cleanup boundaries");

  return Object.freeze({
    valid: true,
    decision: review.decision,
    executionAuthorized: false,
    requiresHumanGate: review.decision === "accept_for_gate"
  });
}

export const audioCandidateReviewContract = Object.freeze({
  schema: "openreel-audio-candidate-review/v1",
  decisions: Object.freeze([...DECISIONS]),
  executionAuthorized: false
});
