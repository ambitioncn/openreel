import { createHash } from "node:crypto";
import { COMMERCIAL_PERCEPTUAL_MAX_OBSERVATION_CHARS } from "./ark-commercial-perceptual-evaluator.js";

export const FINAL_QUALITY_SCHEMA = "openreel-director-final-quality/v1";
export const REQUIRED_FINAL_TECHNICAL_CHECKS = Object.freeze(["container_integrity", "duration_timeline", "av_sync", "audio_integrity", "caption_safe_zone", "resolution"]);
const SEVERE = new Set(["container_integrity", "audio_integrity"]);
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
const freeze = value => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export function evaluateDirectorFinalQuality(input) {
  exact(input, ["schema", "projectId", "workflowId", "revision", "cutId", "renderAsset", "expectedShotIds", "shotResults", "compositionEvidence", "directorPolicy", "directorChecks"], "final quality input");
  if (input.schema !== FINAL_QUALITY_SCHEMA) invalid("final quality schema is invalid");
  for (const key of ["projectId", "workflowId", "cutId"]) id(input[key], key);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) invalid("revision must be a positive integer");
  exact(input.renderAsset, ["assetId", "sha256", "status"], "renderAsset");
  id(input.renderAsset.assetId, "renderAsset.assetId"); hash(input.renderAsset.sha256, "renderAsset.sha256");
  if (input.renderAsset.status !== "succeeded") invalid("a succeeded render asset is required");

  if (!Array.isArray(input.expectedShotIds) || !input.expectedShotIds.length || new Set(input.expectedShotIds).size !== input.expectedShotIds.length) invalid("expectedShotIds must be unique and non-empty");
  input.expectedShotIds.forEach((shotId, index) => id(shotId, `expectedShotIds[${index}]`));
  if (!Array.isArray(input.shotResults) || input.shotResults.length !== input.expectedShotIds.length) invalid("shotResults must cover every expected shot exactly once");
  const shotById = new Map(input.shotResults.map(result => [result?.shotId, result]));
  if (shotById.size !== input.expectedShotIds.length || input.expectedShotIds.some(shotId => !shotById.has(shotId))) invalid("shotResults must cover every expected shot exactly once");
  const shotResults = input.expectedShotIds.map(shotId => validateShot(shotById.get(shotId), input));

  exact(input.compositionEvidence, ["schema", "workflowId", "revision", "renderAssetSha256", "technicalChecks"], "compositionEvidence");
  if (input.compositionEvidence.schema !== "openreel-final-composition-evidence/v1" || input.compositionEvidence.workflowId !== input.workflowId || input.compositionEvidence.revision !== input.revision || input.compositionEvidence.renderAssetSha256 !== input.renderAsset.sha256) invalid("compositionEvidence must bind the exact render revision");
  const technicalChecks = validateTechnical(input.compositionEvidence.technicalChecks);

  exact(input.directorPolicy, ["threshold", "dimensions"], "directorPolicy");
  if (!Number.isFinite(input.directorPolicy.threshold) || input.directorPolicy.threshold < 0 || input.directorPolicy.threshold > 1) invalid("director threshold must be between 0 and 1");
  if (!Array.isArray(input.directorPolicy.dimensions) || !input.directorPolicy.dimensions.length || new Set(input.directorPolicy.dimensions).size !== input.directorPolicy.dimensions.length) invalid("director dimensions must be unique and non-empty");
  input.directorPolicy.dimensions.forEach((dimension, index) => id(dimension, `directorPolicy.dimensions[${index}]`));
  if (!Array.isArray(input.directorChecks) || input.directorChecks.length !== input.directorPolicy.dimensions.length) invalid("directorChecks must cover every policy dimension exactly once");
  const directorByDimension = new Map(input.directorChecks.map(check => [check?.dimension, check]));
  if (directorByDimension.size !== input.directorPolicy.dimensions.length || input.directorPolicy.dimensions.some(dimension => !directorByDimension.has(dimension))) invalid("directorChecks must cover every policy dimension exactly once");
  const directorChecks = input.directorPolicy.dimensions.map(dimension => {
    const check = directorByDimension.get(dimension);
    exact(check, ["dimension", "score", "evidence"], `directorChecks.${dimension}`);
    if (!Number.isFinite(check.score) || check.score < 0 || check.score > 1) invalid("director score must be between 0 and 1");
    return { dimension, score: check.score, status: check.score >= input.directorPolicy.threshold ? "passed" : "failed", evidence: evidence(check.evidence, `directorChecks.${dimension}.evidence`) };
  });
  const failedShots = shotResults.filter(result => !result.accepted).map(result => result.shotId);
  const severeFailures = technicalChecks.filter(check => check.status === "failed" && check.severity === "severe").map(check => check.checkId);
  const technicalFailures = technicalChecks.filter(check => check.status === "failed").map(check => check.checkId);
  const directorFailures = directorChecks.filter(check => check.status === "failed").map(check => check.dimension);
  const hardFailed = shotResults.some(result => result.qualificationStatus === "hard_failed") || severeFailures.length;
  const qualificationStatus = hardFailed ? "hard_failed" : failedShots.length || technicalFailures.length || directorFailures.length ? "rejected" : "approved";
  const normalized = { schema: "openreel-director-final-quality-result/v1", projectId: input.projectId, workflowId: input.workflowId, revision: input.revision, cutId: input.cutId, renderAsset: { ...input.renderAsset }, expectedShotIds: [...input.expectedShotIds], shotResults, compositionEvidence: { schema: input.compositionEvidence.schema, workflowId: input.workflowId, revision: input.revision, renderAssetSha256: input.renderAsset.sha256, technicalChecks }, directorPolicy: { threshold: input.directorPolicy.threshold, dimensions: [...input.directorPolicy.dimensions] }, directorChecks, generationStatus: "succeeded", qualificationStatus, releaseEligible: qualificationStatus === "approved", failedShots, severeFailures, technicalFailures, directorFailures, decisionPolicy: "all_shots_composition_and_director_checks_must_pass" };
  return freeze({ ...normalized, fingerprint: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") });
}

function validateShot(result, input) {
  if (!result || result.schema !== "openreel-director-shot-quality-result/v1" || result.projectId !== input.projectId || result.workflowId !== input.workflowId || result.revision !== input.revision) invalid("shotResults must bind the exact project workflow revision");
  id(result.shotId, "shotResults.shotId"); hash(result.fingerprint, "shotResults.fingerprint");
  if (!["approved", "rejected", "hard_failed"].includes(result.qualificationStatus) || result.accepted !== (result.qualificationStatus === "approved")) invalid("shotResults qualification is invalid");
  return { schema: result.schema, shotId: result.shotId, fingerprint: result.fingerprint, qualificationStatus: result.qualificationStatus, accepted: result.accepted };
}
function validateTechnical(checks) {
  if (!Array.isArray(checks) || checks.length !== REQUIRED_FINAL_TECHNICAL_CHECKS.length) invalid("technicalChecks must cover every required check exactly once");
  const byId = new Map(checks.map(check => [check?.checkId, check]));
  if (byId.size !== REQUIRED_FINAL_TECHNICAL_CHECKS.length || REQUIRED_FINAL_TECHNICAL_CHECKS.some(checkId => !byId.has(checkId))) invalid("technicalChecks must cover every required check exactly once");
  return REQUIRED_FINAL_TECHNICAL_CHECKS.map(checkId => {
    const check = byId.get(checkId); exact(check, ["checkId", "status", "severity", "evidence"], `technicalChecks.${checkId}`);
    if (!["passed", "failed"].includes(check.status)) invalid("technical check status is invalid");
    const severity = SEVERE.has(checkId) ? "severe" : "major";
    if (check.severity !== severity) invalid(`${checkId} severity must be ${severity}`);
    return { checkId, status: check.status, severity, evidence: evidence(check.evidence, `technicalChecks.${checkId}.evidence`) };
  });
}
function evidence(value, name) {
  exact(value, ["artifactId", "sha256", "observed"], name); id(value.artifactId, `${name}.artifactId`); hash(value.sha256, `${name}.sha256`);
  if (typeof value.observed !== "string" || !value.observed.trim() || value.observed.length > COMMERCIAL_PERCEPTUAL_MAX_OBSERVATION_CHARS) invalid(`${name}.observed must be a bounded non-empty string`);
  return { ...value };
}
