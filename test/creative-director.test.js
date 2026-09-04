import test from "node:test";
import assert from "node:assert/strict";
import { createCreativeDirection, reviewDirectedCut } from "../src/creative-director.js";

const direction = () => createCreativeDirection({
  type: "advertisement",
  objective: "Make viewers understand the product in eight seconds",
  audience: "First-time mobile creators",
  singleMessage: "A polished short can start from one clear idea",
  tone: "Confident and warm",
  storyboard: { shots: [
    { id: "s1", intent: "Earn attention", requiredBeat: "Show the painful blank canvas", duration: 3 },
    { id: "s2", intent: "Deliver the promise", requiredBeat: "Reveal the finished short", duration: 5 }
  ] }
});
const shotReview = (shotId, accepted = true) => ({ schema: "openreel-commercial-shot-quality/v1", shotId, accepted, action: accepted ? "accept" : "retry_shot", failures: accepted ? [] : ["reference_drift"] });
const compositionReview = (accepted = true) => ({ schema: "openreel-commercial-composition-quality/v1", accepted, action: accepted ? "accept" : "recompose", failures: accepted ? [] : ["audio_video_drift"] });
const generationEvidence = (cutId = "cut-1", revision = 1, status = "succeeded") => ({ schema: "openreel-generation-evidence/v1", cutId, revision, status });
const editorialScores = (overrides = {}) => ({ hook: 0.9, productClarity: 0.95, brandFit: 0.85, conversionIntent: 0.8, ...overrides });

test("turns a brief into explicit shot intent and a director-owned quality contract", () => {
  const result = direction();
  assert.equal(result.schema, "openreel-creative-direction/v2");
  assert.equal(result.strategy.type, "advertisement");
  assert.deepEqual(result.shots.map(shot => shot.intent), ["Earn attention", "Deliver the promise"]);
  assert.deepEqual(result.qualityPolicy, { owner: "director", threshold: 0.8, dimensions: ["hook", "productClarity", "brandFit", "conversionIntent"], failClosed: true });
});

test("approves only when shot, composition and editorial evidence all pass", () => {
  const result = reviewDirectedCut({ direction: direction(), cutId: "cut-1", revision: 1, generationEvidence: generationEvidence(), shotReviews: [shotReview("s1"), shotReview("s2")], compositionReview: compositionReview(), editorialScores: editorialScores() });
  assert.equal(result.generationStatus, "succeeded");
  assert.equal(result.qualificationStatus, "approved");
  assert.equal(result.releaseEligible, true);
  assert.deepEqual(result.responsibility, { owner: "director", decision: "accept", evidenceComplete: true });
});

test("rejects the cut and issues scoped revision directives for every failure", () => {
  const result = reviewDirectedCut({ direction: direction(), cutId: "cut-1", revision: 1, generationEvidence: generationEvidence(), shotReviews: [shotReview("s1", false), shotReview("s2")], compositionReview: compositionReview(false), editorialScores: editorialScores({ hook: 0.6, brandFit: 0.7 }) });
  assert.equal(result.generationStatus, "succeeded");
  assert.equal(result.qualificationStatus, "revision_required");
  assert.equal(result.releaseEligible, false);
  assert.deepEqual(result.directives.map(item => item.scope), ["shot", "composition", "editorial", "editorial"]);
  assert.equal(result.responsibility.decision, "reject");
});

test("accepts a corrected successor only when it revises the immediately rejected cut", () => {
  const first = reviewDirectedCut({ direction: direction(), cutId: "cut-1", revision: 1, generationEvidence: generationEvidence(), shotReviews: [shotReview("s1", false), shotReview("s2")], compositionReview: compositionReview(), editorialScores: editorialScores() });
  const second = reviewDirectedCut({ direction: direction(), cutId: "cut-1", revision: 2, generationEvidence: generationEvidence("cut-1", 2), previousReview: first, shotReviews: [shotReview("s1"), shotReview("s2")], compositionReview: compositionReview(), editorialScores: editorialScores() });
  assert.equal(second.qualificationStatus, "approved");
  assert.throws(() => reviewDirectedCut({ direction: direction(), cutId: "other", revision: 2, generationEvidence: generationEvidence("other", 2), previousReview: first, shotReviews: [shotReview("s1"), shotReview("s2")], compositionReview: compositionReview(), editorialScores: editorialScores() }), /previousReview/);
});

test("fails closed on missing evidence, mismatched shots and incomplete editorial scores", () => {
  const common = { direction: direction(), cutId: "cut-1", revision: 1, generationEvidence: generationEvidence(), compositionReview: compositionReview(), editorialScores: editorialScores() };
  assert.throws(() => reviewDirectedCut({ ...common, shotReviews: [shotReview("s1")] }), /cover every directed shot/);
  assert.throws(() => reviewDirectedCut({ ...common, shotReviews: [shotReview("s1"), shotReview("wrong")] }), /match the directed shot ids/);
  assert.throws(() => reviewDirectedCut({ ...common, shotReviews: [shotReview("s1"), shotReview("s2")], editorialScores: { hook: 1 } }), /exactly/);
});

test("generation success is necessary but never sufficient for qualification", () => {
  const common = { direction: direction(), cutId: "cut-1", revision: 1, shotReviews: [shotReview("s1", false), shotReview("s2")], compositionReview: compositionReview(), editorialScores: editorialScores() };
  const rejected = reviewDirectedCut({ ...common, generationEvidence: generationEvidence() });
  assert.equal(rejected.generationStatus, "succeeded");
  assert.equal(rejected.qualificationStatus, "revision_required");
  assert.equal(rejected.releaseEligible, false);
  assert.throws(() => reviewDirectedCut(common), /generationEvidence/);
  assert.throws(() => reviewDirectedCut({ ...common, generationEvidence: generationEvidence("cut-1", 1, "failed") }), /generationEvidence/);
});
