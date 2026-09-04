import { createHash } from "node:crypto";
import { DomainError } from "./core.js";

const reject = message => { throw new DomainError("DIRECTOR_FEEDBACK_INVALID", message, 422); };
const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) reject(`${label} fields are invalid`);
};
const nonEmpty = (value, label) => {
  if (typeof value !== "string" || !value.trim()) reject(`${label} is required`);
  return value.trim();
};
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function recordDirectorFeedback(input) {
  exactKeys(input, ["schema", "feedbackId", "workflowId", "revisionId", "stage", "evidenceId", "rating", "tags", "comment"], "feedback");
  if (input.schema !== "openreel-director-feedback/v1") reject("feedback schema is invalid");
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) reject("rating must be an integer from 1 to 5");
  if (!Array.isArray(input.tags) || !input.tags.length || input.tags.some(tag => typeof tag !== "string" || !tag.trim()) || new Set(input.tags).size !== input.tags.length) reject("tags must be unique non-empty strings");
  const record = {
    schema: input.schema,
    feedbackId: nonEmpty(input.feedbackId, "feedbackId"),
    workflowId: nonEmpty(input.workflowId, "workflowId"),
    revisionId: nonEmpty(input.revisionId, "revisionId"),
    stage: nonEmpty(input.stage, "stage"),
    evidenceId: nonEmpty(input.evidenceId, "evidenceId"),
    rating,
    tags: Object.freeze([...input.tags]),
    comment: nonEmpty(input.comment, "comment")
  };
  return Object.freeze({ ...record, fingerprint: fingerprint(record) });
}

export function createLearningProposal({ proposalId, policyId, baselineVersion, feedback, candidateChange }) {
  if (!Array.isArray(feedback)) reject("proposal feedback must be an array");
  const records = feedback.map(recordDirectorFeedback);
  if (!records.length) reject("proposal requires attributable feedback");
  if (new Set(records.map(item => item.fingerprint)).size !== records.length) reject("proposal feedback must be unique");
  const proposal = {
    schema: "openreel-director-learning-proposal/v1",
    proposalId: nonEmpty(proposalId, "proposalId"),
    policyId: nonEmpty(policyId, "policyId"),
    baselineVersion: nonEmpty(baselineVersion, "baselineVersion"),
    feedbackFingerprints: records.map(item => item.fingerprint),
    candidateChange: nonEmpty(candidateChange, "candidateChange"),
    status: "proposed",
    productionMutationApplied: false
  };
  return Object.freeze({ ...proposal, fingerprint: fingerprint(proposal) });
}

export function evaluateLearningProposal(proposal, evaluation) {
  if (proposal?.schema !== "openreel-director-learning-proposal/v1" || proposal?.status !== "proposed" || proposal?.productionMutationApplied !== false) reject("proposal is not eligible for offline evaluation");
  exactKeys(evaluation, ["schema", "proposalFingerprint", "evaluationSetFingerprint", "baselinePassed", "candidatePassed", "regressions"], "offline evaluation");
  if (evaluation.schema !== "openreel-director-learning-evaluation/v1" || evaluation.proposalFingerprint !== proposal.fingerprint) reject("offline evaluation binding is invalid");
  if (typeof evaluation.baselinePassed !== "boolean" || typeof evaluation.candidatePassed !== "boolean" || !Array.isArray(evaluation.regressions) || evaluation.regressions.some(nonEmptyRegression => typeof nonEmptyRegression !== "string" || !nonEmptyRegression.trim())) reject("offline evaluation results are invalid");
  const accepted = evaluation.baselinePassed && evaluation.candidatePassed && evaluation.regressions.length === 0;
  return Object.freeze({ ...proposal, status: accepted ? "offline_qualified" : "offline_rejected", productionMutationApplied: false, evaluation: Object.freeze({ ...evaluation }) });
}

export function authorizeLearningPromotion(evaluated, approval) {
  if (evaluated?.status !== "offline_qualified" || evaluated?.productionMutationApplied !== false) reject("only an offline-qualified proposal can be promoted");
  exactKeys(approval, ["schema", "proposalFingerprint", "reviewer", "decision"], "promotion approval");
  if (approval.schema !== "openreel-director-learning-approval/v1" || approval.proposalFingerprint !== evaluated.fingerprint || approval.decision !== "approved") reject("explicit matching approval is required");
  return Object.freeze({ ...evaluated, status: "approved_for_policy_update", productionMutationApplied: false, approvedBy: nonEmpty(approval.reviewer, "reviewer") });
}
