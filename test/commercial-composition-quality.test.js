import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCommercialComposition, planCommercialComposition } from "../src/commercial-composition-quality.js";

test("plans ordered captions inside a platform safe zone and a speech-first mix", () => {
  const plan = planCommercialComposition({ safeZone: "tiktok", music: "light", storyboard: { shots: [{ id: "s1", duration: 3, caption: "先看亮点" }, { id: "s2", duration: 4, caption: "再看细节" }] } });
  assert.equal(plan.duration, 7);
  assert.deepEqual(plan.timeline.map(({ start, end }) => ({ start, end })), [{ start: 0, end: 3 }, { start: 3, end: 7 }]);
  assert.deepEqual(plan.safeZone, { top: 0.08, right: 0.16, bottom: 0.2, left: 0.08 });
  assert.deepEqual(plan.audio, { voiceGainDb: -3, musicGainDb: -18, speechDuckDb: -9, peakCeilingDbfs: -1, targetLufs: -14 });
});

test("accepts a timed, safe and normalized final composition", () => {
  const plan = planCommercialComposition({ music: "none", storyboard: { shots: [{ duration: 5, prompt: "产品登场" }] } });
  const result = evaluateCommercialComposition({ plan, probe: { duration: 5.05, peakDbfs: -1.2, loudnessLufs: -14.5, captionSafeZoneViolations: 0, maxAvDriftSeconds: 0.04 } });
  assert.equal(result.accepted, true); assert.equal(result.action, "accept"); assert.deepEqual(result.failures, []);
});

test("accepts the exact reviewed storyboard prompt as its caption", () => {
  const prompt = "Vertical close-up of a girl's bare feet sinking into warm golden sand, shallow turquoise waves lapping gently at her ankles as she shifts her weight to start moving.";
  const plan = planCommercialComposition({ safeZone: "tiktok", music: "light", storyboard: { shots: [{ id: "s1", duration: 5, prompt }] } });
  assert.equal(plan.timeline[0].caption, prompt);
});

test("requests deterministic recomposition with explainable quality failures", () => {
  const plan = planCommercialComposition({ storyboard: { shots: [{ duration: 5, prompt: "产品登场" }] } });
  const result = evaluateCommercialComposition({ plan, probe: { duration: 6, peakDbfs: -0.2, loudnessLufs: -20, captionSafeZoneViolations: 2, maxAvDriftSeconds: 0.2 } });
  assert.deepEqual(result.failures, ["duration_mismatch", "caption_safe_zone_violation", "audio_peak_clipping", "loudness_out_of_range", "audio_video_drift"]);
  assert.equal(result.action, "recompose");
});

test("fails closed on unsupported platforms, malformed captions and probes", () => {
  assert.throws(() => planCommercialComposition({ safeZone: "other", storyboard: { shots: [{ duration: 2, prompt: "x" }] } }), /safeZone/);
  assert.throws(() => planCommercialComposition({ storyboard: { shots: [{ duration: 2, caption: "" }] } }), /caption/);
  const plan = planCommercialComposition({ captions: false, storyboard: { shots: [{ duration: 2 }] } });
  assert.throws(() => evaluateCommercialComposition({ plan, probe: { duration: 2 } }), /peakDbfs/);
});
