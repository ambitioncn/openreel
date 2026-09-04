import test from "node:test";
import assert from "node:assert/strict";
import { CONTINUITY_BIBLE_SCHEMA, createContinuityBible, createShotStateLedger, SHOT_STATE_LEDGER_SCHEMA } from "../src/director-continuity.js";
import { evaluateDirectorShotQuality, REQUIRED_TECHNICAL_CHECKS, SHOT_QUALITY_SCHEMA } from "../src/director-shot-quality.js";

const sha = char => char.repeat(64);
const entities = [
  ["hero", "character", "face"], ["room", "scene", "light"], ["cup", "prop", "color"], ["look", "style", "palette"], ["cam", "camera", "lens"]
].map(([entityId, kind, attribute]) => ({ entityId, kind, version: 1, attributes: { [attribute]: "locked" }, lockedAttributes: [attribute] }));
const context = () => {
  const bible = createContinuityBible({ schema: CONTINUITY_BIBLE_SCHEMA, projectId: "p-1", revision: 1, entities });
  const snapshot = bible.entities.map(entity => ({ entityId: entity.entityId, kind: entity.kind, version: entity.version, state: { ...entity.attributes } }));
  const ledger = createShotStateLedger({ schema: SHOT_STATE_LEDGER_SCHEMA, projectId: "p-1", workflowId: "wf-1", revision: 2, bibleRevision: 1, bibleFingerprint: bible.fingerprint, shots: [{ shotId: "s-1", sequence: 1, inputSnapshot: snapshot, outputSnapshot: snapshot, driftEvidence: [] }] }, bible);
  return ledger;
};
const evidence = (id, char = "a") => ({ artifactId: id, sha256: sha(char), observed: "deterministic observation" });
const validInput = ledger => ({
  schema: SHOT_QUALITY_SCHEMA, projectId: "p-1", workflowId: "wf-1", revision: 2, shotId: "s-1", continuityLedgerFingerprint: ledger.fingerprint,
  generationAsset: { assetId: "asset-1", sha256: sha("f"), status: "succeeded" },
  technicalChecks: REQUIRED_TECHNICAL_CHECKS.map((checkId, index) => ({ checkId, status: "passed", severity: ["duration_match", "resolution_match"].includes(checkId) ? "major" : "severe", evidence: evidence(`tech-${index}`, "b") })),
  creativePolicy: { threshold: 0.8, dimensions: ["intent", "beat", "composition"] },
  creativeChecks: ["intent", "beat", "composition"].map((dimension, index) => ({ dimension, score: 0.9, evidence: evidence(`creative-${index}`, "c") }))
});

test("approves only complete revision-bound technical and creative evidence", () => {
  const ledger = context(), result = evaluateDirectorShotQuality(validInput(ledger), ledger);
  assert.equal(result.qualificationStatus, "approved");
  assert.equal(result.generationStatus, "succeeded");
  assert.equal(result.accepted, true);
  assert.equal(result.decisionPolicy, "all_required_checks_must_pass_no_averaging");
  assert.ok(Object.isFrozen(result.technicalChecks[0].evidence));
});

test("severe technical defects hard-fail despite perfect creative scores", () => {
  const ledger = context(), input = validInput(ledger);
  input.technicalChecks.find(check => check.checkId === "frame_integrity").status = "failed";
  input.creativeChecks.forEach(check => { check.score = 1; });
  const result = evaluateDirectorShotQuality(input, ledger);
  assert.equal(result.qualificationStatus, "hard_failed");
  assert.equal(result.accepted, false);
  assert.deepEqual(result.severeFailures, ["frame_integrity"]);
});

test("a single major or creative failure cannot be averaged away", () => {
  const ledger = context(), major = validInput(ledger);
  major.technicalChecks.find(check => check.checkId === "duration_match").status = "failed";
  assert.equal(evaluateDirectorShotQuality(major, ledger).qualificationStatus, "rejected");
  const creative = validInput(ledger);
  creative.creativeChecks.find(check => check.dimension === "beat").score = 0.79;
  const result = evaluateDirectorShotQuality(creative, ledger);
  assert.equal(result.qualificationStatus, "rejected");
  assert.deepEqual(result.creativeFailures, ["beat"]);
});

test("fails closed on missing, duplicate, malformed, and stale evidence", () => {
  const ledger = context();
  const missing = validInput(ledger); missing.technicalChecks.pop();
  assert.throws(() => evaluateDirectorShotQuality(missing, ledger), /every required check/);
  const duplicate = validInput(ledger); duplicate.creativeChecks[2].dimension = "beat";
  assert.throws(() => evaluateDirectorShotQuality(duplicate, ledger), /every policy dimension/);
  const malformed = validInput(ledger); malformed.technicalChecks[0].evidence.sha256 = "bad";
  assert.throws(() => evaluateDirectorShotQuality(malformed, ledger), /sha256/);
  const stale = validInput(ledger); stale.revision = 3;
  assert.throws(() => evaluateDirectorShotQuality(stale, ledger), /exact continuity ledger/);
});

test("generation success and continuity acceptance are mandatory but not qualification", () => {
  const ledger = context(), failedGeneration = validInput(ledger);
  failedGeneration.generationAsset.status = "failed";
  assert.throws(() => evaluateDirectorShotQuality(failedGeneration, ledger), /succeeded generation/);
  const blockedLedger = { ...ledger, shots: [{ ...ledger.shots[0], continuityStatus: "blocked" }] };
  assert.throws(() => evaluateDirectorShotQuality(validInput(ledger), blockedLedger), /accepted continuity/);
});
