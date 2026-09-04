import test from "node:test";
import assert from "node:assert/strict";
import { authorizeLearningPromotion, createLearningProposal, evaluateLearningProposal, recordDirectorFeedback } from "../src/director-feedback-learning.js";

const feedback = () => ({ schema: "openreel-director-feedback/v1", feedbackId: "f-1", workflowId: "w-1", revisionId: "r-3", stage: "automatic_qc", evidenceId: "e-9", rating: 2, tags: ["weak_hook"], comment: "Opening does not establish the promise." });
const proposal = () => createLearningProposal({ proposalId: "p-1", policyId: "talking_head", baselineVersion: "v1", feedback: [feedback()], candidateChange: "Require an explicit promise in the opening beat." });
const evaluation = value => ({ schema: "openreel-director-learning-evaluation/v1", proposalFingerprint: value.fingerprint, evaluationSetFingerprint: "fixed-set-v1", baselinePassed: true, candidatePassed: true, regressions: [] });

test("feedback is attributable to revision, stage, and evidence", () => {
  const result = recordDirectorFeedback(feedback());
  assert.equal(result.revisionId, "r-3");
  assert.equal(result.stage, "automatic_qc");
  assert.equal(result.evidenceId, "e-9");
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test("learning remains a proposal until offline evaluation and explicit review", () => {
  const created = proposal();
  assert.equal(created.productionMutationApplied, false);
  const qualified = evaluateLearningProposal(created, evaluation(created));
  assert.equal(qualified.status, "offline_qualified");
  assert.equal(qualified.productionMutationApplied, false);
  const approved = authorizeLearningPromotion(qualified, { schema: "openreel-director-learning-approval/v1", proposalFingerprint: created.fingerprint, reviewer: "director-review", decision: "approved" });
  assert.equal(approved.status, "approved_for_policy_update");
  assert.equal(approved.productionMutationApplied, false);
});

test("missing attribution, regressions, stale evidence, and silent promotion fail closed", () => {
  assert.throws(() => recordDirectorFeedback({ ...feedback(), evidenceId: "" }), /evidenceId/);
  const created = proposal();
  const rejected = evaluateLearningProposal(created, { ...evaluation(created), regressions: ["tutorial regression"] });
  assert.equal(rejected.status, "offline_rejected");
  assert.throws(() => authorizeLearningPromotion(rejected, {}), /offline-qualified/);
  assert.throws(() => evaluateLearningProposal(created, { ...evaluation(created), proposalFingerprint: "stale" }), /binding/);
  assert.throws(() => authorizeLearningPromotion(evaluateLearningProposal(created, evaluation(created)), { schema: "openreel-director-learning-approval/v1", proposalFingerprint: created.fingerprint, reviewer: "director-review", decision: "rejected" }), /approval/);
});
