import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDirectorFinalQuality, FINAL_QUALITY_SCHEMA, REQUIRED_FINAL_TECHNICAL_CHECKS } from "../src/director-final-quality.js";

const sha = char => char.repeat(64);
const evidence = artifactId => ({ artifactId, sha256: sha("a"), observed: "deterministic observation" });
const shot = (shotId, qualificationStatus = "approved", char = "b") => ({ schema: "openreel-director-shot-quality-result/v1", projectId: "p-1", workflowId: "wf-1", revision: 3, shotId, fingerprint: sha(char), qualificationStatus, accepted: qualificationStatus === "approved" });
const valid = () => ({ schema: FINAL_QUALITY_SCHEMA, projectId: "p-1", workflowId: "wf-1", revision: 3, cutId: "cut-1", renderAsset: { assetId: "render-1", sha256: sha("f"), status: "succeeded" }, expectedShotIds: ["s-1", "s-2"], shotResults: [shot("s-1"), shot("s-2", "approved", "c")], compositionEvidence: { schema: "openreel-final-composition-evidence/v1", workflowId: "wf-1", revision: 3, renderAssetSha256: sha("f"), technicalChecks: REQUIRED_FINAL_TECHNICAL_CHECKS.map((checkId, index) => ({ checkId, status: "passed", severity: ["container_integrity", "audio_integrity"].includes(checkId) ? "severe" : "major", evidence: evidence(`composition-${index}`) })) }, directorPolicy: { threshold: 0.8, dimensions: ["story_coherence", "pacing", "intent_delivery"] }, directorChecks: ["story_coherence", "pacing", "intent_delivery"].map((dimension, index) => ({ dimension, score: 0.9, evidence: evidence(`director-${index}`) })) });

test("approves release only when every bound gate passes", () => {
  const result = evaluateDirectorFinalQuality(valid());
  assert.equal(result.qualificationStatus, "approved"); assert.equal(result.releaseEligible, true); assert.equal(result.generationStatus, "succeeded"); assert.ok(Object.isFrozen(result.directorChecks[0].evidence));
});
test("render success remains separate from qualification", () => {
  const input = valid(); input.shotResults[1] = shot("s-2", "rejected", "e"); const result = evaluateDirectorFinalQuality(input);
  assert.equal(result.generationStatus, "succeeded"); assert.equal(result.qualificationStatus, "rejected"); assert.equal(result.releaseEligible, false);
});
test("severe final or shot defects hard-fail", () => {
  const composition = valid(); composition.compositionEvidence.technicalChecks.find(check => check.checkId === "container_integrity").status = "failed";
  assert.equal(evaluateDirectorFinalQuality(composition).qualificationStatus, "hard_failed");
  const failedShot = valid(); failedShot.shotResults[0] = shot("s-1", "hard_failed", "e"); assert.equal(evaluateDirectorFinalQuality(failedShot).qualificationStatus, "hard_failed");
});
test("single major or director failures cannot be averaged away", () => {
  const major = valid(); major.compositionEvidence.technicalChecks.find(check => check.checkId === "av_sync").status = "failed"; assert.equal(evaluateDirectorFinalQuality(major).qualificationStatus, "rejected");
  const director = valid(); director.directorChecks.find(check => check.dimension === "pacing").score = 0.79; assert.deepEqual(evaluateDirectorFinalQuality(director).directorFailures, ["pacing"]);
});
test("missing, duplicate, stale, malformed, and failed evidence fail closed", () => {
  const missing = valid(); missing.shotResults.pop(); assert.throws(() => evaluateDirectorFinalQuality(missing), /every expected shot/);
  const duplicate = valid(); duplicate.shotResults[1] = shot("s-1", "approved", "e"); assert.throws(() => evaluateDirectorFinalQuality(duplicate), /every expected shot/);
  const stale = valid(); stale.compositionEvidence.revision = 2; assert.throws(() => evaluateDirectorFinalQuality(stale), /exact render revision/);
  const malformed = valid(); malformed.directorChecks[0].evidence.sha256 = "bad"; assert.throws(() => evaluateDirectorFinalQuality(malformed), /sha256/);
  const failed = valid(); failed.renderAsset.status = "failed"; assert.throws(() => evaluateDirectorFinalQuality(failed), /succeeded render/);
});
