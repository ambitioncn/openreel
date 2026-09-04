import { createHash } from "node:crypto";
import { COMMERCIAL_PERCEPTUAL_MAX_OBSERVATION_CHARS } from "./ark-commercial-perceptual-evaluator.js";

export const SHOT_QUALITY_SCHEMA = "openreel-director-shot-quality/v1";
export const REQUIRED_TECHNICAL_CHECKS = Object.freeze(["decodable_video", "frame_integrity", "audio_integrity", "duration_match", "resolution_match", "safety"]);
const SEVERE_TECHNICAL_CHECKS = new Set(["decodable_video", "frame_integrity", "audio_integrity", "safety"]);

const invalid = message => { throw new TypeError(message); };
const exact = (value, keys, name) => {
  if (!value || Array.isArray(value) || typeof value !== "object") invalid(`${name} must be an object`);
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(`${name} fields are invalid`);
};
const id = (value, name) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) invalid(`${name} must be a canonical id`);
  return value;
};
const hash = (value, name) => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid(`${name} must be a sha256 digest`);
  return value;
};
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export function evaluateDirectorShotQuality(input, continuityLedger) {
  exact(input, ["schema", "projectId", "workflowId", "revision", "shotId", "continuityLedgerFingerprint", "generationAsset", "technicalChecks", "creativePolicy", "creativeChecks"], "shot quality input");
  if (input.schema !== SHOT_QUALITY_SCHEMA) invalid("shot quality schema is invalid");
  for (const key of ["projectId", "workflowId", "shotId"]) id(input[key], key);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) invalid("revision must be a positive integer");
  validateContinuityBinding(input, continuityLedger);

  exact(input.generationAsset, ["assetId", "sha256", "status"], "generationAsset");
  id(input.generationAsset.assetId, "generationAsset.assetId");
  hash(input.generationAsset.sha256, "generationAsset.sha256");
  if (input.generationAsset.status !== "succeeded") invalid("a succeeded generation asset is required");

  if (!Array.isArray(input.technicalChecks) || input.technicalChecks.length !== REQUIRED_TECHNICAL_CHECKS.length) invalid("technicalChecks must cover every required check exactly once");
  const technicalById = new Map(input.technicalChecks.map(check => [check?.checkId, check]));
  if (technicalById.size !== REQUIRED_TECHNICAL_CHECKS.length || REQUIRED_TECHNICAL_CHECKS.some(checkId => !technicalById.has(checkId))) invalid("technicalChecks must cover every required check exactly once");
  const technicalChecks = REQUIRED_TECHNICAL_CHECKS.map(checkId => {
    const check = technicalById.get(checkId);
    exact(check, ["checkId", "status", "severity", "evidence"], `technicalChecks.${checkId}`);
    if (!["passed", "failed"].includes(check.status)) invalid("technical check status is invalid");
    const requiredSeverity = SEVERE_TECHNICAL_CHECKS.has(checkId) ? "severe" : "major";
    if (check.severity !== requiredSeverity) invalid(`${checkId} severity must be ${requiredSeverity}`);
    return { checkId, status: check.status, severity: check.severity, evidence: evidence(check.evidence, `technicalChecks.${checkId}.evidence`) };
  });

  exact(input.creativePolicy, ["threshold", "dimensions"], "creativePolicy");
  if (!Number.isFinite(input.creativePolicy.threshold) || input.creativePolicy.threshold < 0 || input.creativePolicy.threshold > 1) invalid("creative threshold must be between 0 and 1");
  if (!Array.isArray(input.creativePolicy.dimensions) || !input.creativePolicy.dimensions.length || new Set(input.creativePolicy.dimensions).size !== input.creativePolicy.dimensions.length) invalid("creative dimensions must be unique and non-empty");
  input.creativePolicy.dimensions.forEach((dimension, index) => id(dimension, `creativePolicy.dimensions[${index}]`));
  if (!Array.isArray(input.creativeChecks) || input.creativeChecks.length !== input.creativePolicy.dimensions.length) invalid("creativeChecks must cover every policy dimension exactly once");
  const creativeByDimension = new Map(input.creativeChecks.map(check => [check?.dimension, check]));
  if (creativeByDimension.size !== input.creativePolicy.dimensions.length || input.creativePolicy.dimensions.some(dimension => !creativeByDimension.has(dimension))) invalid("creativeChecks must cover every policy dimension exactly once");
  const creativeChecks = input.creativePolicy.dimensions.map(dimension => {
    const check = creativeByDimension.get(dimension);
    exact(check, ["dimension", "score", "evidence"], `creativeChecks.${dimension}`);
    if (!Number.isFinite(check.score) || check.score < 0 || check.score > 1) invalid("creative score must be between 0 and 1");
    return { dimension, score: check.score, status: check.score >= input.creativePolicy.threshold ? "passed" : "failed", evidence: evidence(check.evidence, `creativeChecks.${dimension}.evidence`) };
  });

  const severeFailures = technicalChecks.filter(check => check.status === "failed" && check.severity === "severe").map(check => check.checkId);
  const technicalFailures = technicalChecks.filter(check => check.status === "failed").map(check => check.checkId);
  const creativeFailures = creativeChecks.filter(check => check.status === "failed").map(check => check.dimension);
  const qualificationStatus = severeFailures.length ? "hard_failed" : technicalFailures.length || creativeFailures.length ? "rejected" : "approved";
  const normalized = {
    schema: "openreel-director-shot-quality-result/v1", projectId: input.projectId, workflowId: input.workflowId, revision: input.revision, shotId: input.shotId,
    continuityLedgerFingerprint: input.continuityLedgerFingerprint, generationAsset: { ...input.generationAsset }, technicalChecks, creativePolicy: { threshold: input.creativePolicy.threshold, dimensions: [...input.creativePolicy.dimensions] }, creativeChecks,
    generationStatus: "succeeded", qualificationStatus, accepted: qualificationStatus === "approved", severeFailures, technicalFailures, creativeFailures,
    decisionPolicy: "all_required_checks_must_pass_no_averaging"
  };
  return freeze({ ...normalized, fingerprint: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") });
}

function validateContinuityBinding(input, ledger) {
  if (!ledger || ledger.schema !== "openreel-shot-state-ledger/v1" || ledger.projectId !== input.projectId || ledger.workflowId !== input.workflowId || ledger.revision !== input.revision || ledger.fingerprint !== input.continuityLedgerFingerprint) invalid("shot quality must bind the exact continuity ledger revision");
  hash(input.continuityLedgerFingerprint, "continuityLedgerFingerprint");
  const shot = ledger.shots?.find(item => item.shotId === input.shotId);
  if (!shot || shot.continuityStatus !== "accepted") invalid("shot requires accepted continuity evidence");
}

function evidence(value, name) {
  exact(value, ["artifactId", "sha256", "observed"], name);
  id(value.artifactId, `${name}.artifactId`);
  hash(value.sha256, `${name}.sha256`);
  if (typeof value.observed !== "string" || !value.observed.trim() || value.observed.length > COMMERCIAL_PERCEPTUAL_MAX_OBSERVATION_CHARS) invalid(`${name}.observed must be a bounded non-empty string`);
  return { ...value };
}
