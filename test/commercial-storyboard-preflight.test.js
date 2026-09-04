import test from "node:test";
import assert from "node:assert/strict";
import { qualifyCommercialStoryboardPolicySafety, qualifyCommercialStoryboardStrategy } from "../src/commercial-storyboard-preflight.js";

const strategy = { intent: "same performer", storyboard: { shots: [
  { strategyBeat: "hook", prompt: "same performer notices a dropped scarf and reaches for it", duration: 4 },
  { strategyBeat: "development", prompt: "same performer catches the scarf and turns with a natural smile", duration: 5 },
  { strategyBeat: "payoff", prompt: "same performer returns the scarf and shares a warm relieved smile", duration: 4 }
] } };

test("accepts a distinct three-beat arc using only production-proven 4/5-second durations without provider calls", () => {
  const result = qualifyCommercialStoryboardStrategy(strategy);
  assert.deepEqual({ accepted: result.accepted, beats: result.beats, totalDuration: result.totalDuration, paidProviderCalls: result.paidProviderCalls }, { accepted: true, beats: ["hook", "development", "payoff"], totalDuration: 13, paidProviderCalls: 0 });
});

test("accepts a legal equal-duration three-shot strategy instead of forcing duration variation", () => {
  const value = structuredClone(strategy);
  value.storyboard.shots.forEach(shot => { shot.duration = 4; });
  const result = qualifyCommercialStoryboardStrategy(value);
  assert.deepEqual(result.pacing, { durations: [4, 4, 4], varied: false });
  assert.equal(result.totalDuration, 12);
});

test("synchronously rejects unsupported seedance-2-fast shot durations before any provider call", () => {
  for (const duration of [1, 3, 6, 10]) {
    const value = structuredClone(strategy);
    value.storyboard.shots[0].duration = duration;
    assert.throws(() => qualifyCommercialStoryboardStrategy(value), error => error.code === "COMMERCIAL_STORYBOARD_STRATEGY_INVALID" && error.status === 422 && /4 or 5 seconds/.test(error.message));
  }
});

test("rejects the prior single-shot prompt-only acceptance shape", () => {
  assert.throws(() => qualifyCommercialStoryboardStrategy({ intent: "same performer", storyboard: { shots: [{ prompt: "same performer waves", duration: 5 }] } }), error => error.code === "COMMERCIAL_STORYBOARD_STRATEGY_INVALID");
});

test("rejects duplicated visuals, missing intent, and a broken arc", () => {
  for (const mutate of [
    value => { value.storyboard.shots[1].prompt = value.storyboard.shots[0].prompt; },
    value => { value.storyboard.shots[1].prompt = "a different subject enters"; },
    value => { value.storyboard.shots[1].strategyBeat = "payoff"; }
  ]) {
    const value = structuredClone(strategy); mutate(value);
    assert.throws(() => qualifyCommercialStoryboardStrategy(value), error => error.code === "COMMERCIAL_STORYBOARD_STRATEGY_INVALID");
  }
});

const policySafe = { identityReference: { width: 1024, height: 1024, sha256: "a".repeat(64) }, declarations: { referenceRights: "owned_or_licensed", performer: "fictional_adult", brands: "none", publicFigures: "none" }, storyboard: { shots: [
  { prompt: "fictional adult performer notices an unbranded blue cloth in a controlled studio" },
  { prompt: "fictional adult performer folds the unbranded blue cloth in a controlled studio" },
  { prompt: "fictional adult performer places the unbranded blue cloth down in a controlled studio" }
] } };

test("accepts a locally auditable policy-safe test shape without claiming provider certainty", () => {
  const result = qualifyCommercialStoryboardPolicySafety(policySafe);
  assert.deepEqual({ accepted: result.accepted, paidProviderCalls: result.paidProviderCalls, providerPolicyGuaranteed: result.providerPolicyGuaranteed }, { accepted: true, paidProviderCalls: 0, providerPolicyGuaranteed: false });
});

test("accepts an object-only privacy-safe profile and rejects missing privacy constraints", () => {
  const value = { identityReference: { width: 1024, height: 1024, sha256: "b".repeat(64) }, declarations: { referenceRights: "owned_or_licensed", performer: "object_only", brands: "none", publicFigures: "none" }, storyboard: { shots: [
    { prompt: "object-only unbranded blue scarf in an empty neutral studio, no people, no faces, no personal information" },
    { prompt: "object-only unbranded blue scarf moves in an empty neutral studio, no people, no faces, no personal information" },
    { prompt: "object-only unbranded blue scarf rests in an empty neutral studio, no people, no faces, no personal information" }
  ] } };
  assert.equal(qualifyCommercialStoryboardPolicySafety(value).performerProfile, "object_only");
  value.storyboard.shots[1].prompt = "object-only unbranded scarf in a neutral studio";
  assert.throws(() => qualifyCommercialStoryboardPolicySafety(value), error => error.code === "COMMERCIAL_STORYBOARD_POLICY_PREFLIGHT_INVALID");
});

test("fails closed for the prior 1x1 placeholder identity reference", () => {
  const value = structuredClone(policySafe);
  value.identityReference = { width: 1, height: 1, sha256: "a".repeat(64) };
  assert.throws(() => qualifyCommercialStoryboardPolicySafety(value), error => error.code === "COMMERCIAL_STORYBOARD_POLICY_PREFLIGHT_INVALID" && /256x256/.test(error.message));
});

test("fails closed when provenance declarations or per-shot neutral constraints are absent", () => {
  for (const mutate of [
    value => { delete value.declarations.referenceRights; },
    value => { value.declarations.publicFigures = "unspecified"; },
    value => { value.storyboard.shots[0].prompt = "a famous actor catches a branded red scarf in a crowded plaza"; }
  ]) {
    const value = structuredClone(policySafe); mutate(value);
    assert.throws(() => qualifyCommercialStoryboardPolicySafety(value), error => error.code === "COMMERCIAL_STORYBOARD_POLICY_PREFLIGHT_INVALID");
  }
});
