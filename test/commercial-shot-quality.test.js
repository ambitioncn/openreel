import test from "node:test";
import assert from "node:assert/strict";
import { compileConsistencyAwareStoryboard, evaluateCommercialShotQuality } from "../src/commercial-shot-quality.js";

test("compiles locked identity and prior-shot continuity into bounded prompts", () => {
  const result = compileConsistencyAwareStoryboard({
    continuityEntities: [{ id: "product-1", name: "Bottle", attributes: { color: "amber", label: "white serif" }, lockedAttributes: ["label", "color"] }],
    storyboard: { shots: [{ id: "s1", prompt: "Bottle on table", duration: 3 }, { id: "s2", prompt: "Hand picks it up", duration: 4 }] }
  });
  assert.equal(result.schema, "openreel-consistency-storyboard/v1");
  assert.match(result.shots[0].prompt, /color=amber, label=white serif/);
  assert.match(result.shots[1].prompt, /MATCH PREVIOUS SHOT s1/);
  assert.deepEqual(result.shots[1].continuityEntityIds, ["product-1"]);
});

test("accepts a conforming vertical shot", () => {
  const result = evaluateCommercialShotQuality({ shotId: "s1", expectedDuration: 4, probe: { width: 1080, height: 1920, duration: 4.1, motionScore: 0.4, blackFrameRatio: 0.01, frozenFrameRatio: 0.02, referenceSimilarity: 0.9 } });
  assert.equal(result.action, "accept");
  assert.equal(result.accepted, true);
  assert.deepEqual(result.failures, []);
});

test("requests a local retry with explainable deterministic failures", () => {
  const result = evaluateCommercialShotQuality({ shotId: "s2", expectedDuration: 4, probe: { width: 1920, height: 1080, duration: 6, motionScore: 0, blackFrameRatio: 0.2, frozenFrameRatio: 0.4, referenceSimilarity: 0.8 } });
  assert.equal(result.action, "retry_shot");
  assert.deepEqual(result.failures, ["invalid_vertical_frame", "duration_mismatch", "insufficient_motion", "excess_black_frames", "excess_frozen_frames"]);
});

test("fails closed to degradation when reference identity is severely lost", () => {
  const result = evaluateCommercialShotQuality({ shotId: "s3", expectedDuration: 3, probe: { width: 1080, height: 1920, duration: 3, motionScore: 0.3, blackFrameRatio: 0, frozenFrameRatio: 0, referenceSimilarity: 0.2 } });
  assert.equal(result.action, "degrade");
  assert.deepEqual(result.failures, ["reference_drift"]);
});

test("rejects malformed continuity and probe inputs", () => {
  assert.throws(() => compileConsistencyAwareStoryboard({ storyboard: { shots: [] } }), /1-12 shots/);
  assert.throws(() => compileConsistencyAwareStoryboard({ continuityEntities: [{ id: "x", name: "X", attributes: {}, lockedAttributes: ["missing"] }], storyboard: { shots: [{ prompt: "x", duration: 2 }] } }), /attributes\.missing/);
  assert.throws(() => evaluateCommercialShotQuality({ shotId: "s", expectedDuration: 2, probe: { width: 1080 } }), /probe.height/);
});
