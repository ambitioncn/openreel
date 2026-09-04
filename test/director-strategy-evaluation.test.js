import test from "node:test";
import assert from "node:assert/strict";
import { DIRECTOR_EVALUATION_SET } from "../src/director-evaluation-set.js";
import { evaluateDirectorStrategies } from "../src/director-strategy-evaluation.js";
import { getCreativeStrategy } from "../src/creative-strategies.js";

const evidence = () => DIRECTOR_EVALUATION_SET.cases.map(item => {
  const strategy = getCreativeStrategy(item.strategy);
  return { schema: "openreel-director-strategy-evidence/v1", caseId: item.id, strategy: item.strategy, observedBeats: [...strategy.requiredBeats], scores: Object.fromEntries(strategy.qualityDimensions.map(dimension => [dimension, 0.9])), severeTechnicalErrors: [] };
});

test("qualifies all five strategies only when every fixed-set case passes", () => {
  const result = evaluateDirectorStrategies(DIRECTOR_EVALUATION_SET, evidence());
  assert.equal(result.status, "qualified");
  assert.equal(result.releaseEligible, true);
  assert.deepEqual(result.strategies, { comedy: "passed", talking_head: "passed", advertisement: "passed", narrative: "passed", tutorial: "passed" });
  assert.equal(result.results.length, 15);
});

test("missing beats and one below-threshold dimension reject without averaging", () => {
  const input = evidence();
  input[0].observedBeats = input[0].observedBeats.slice(1);
  input[0].scores.hook = 0.79;
  const result = evaluateDirectorStrategies(DIRECTOR_EVALUATION_SET, input);
  assert.equal(result.status, "rejected");
  assert.equal(result.releaseEligible, false);
  assert.equal(result.strategies.comedy, "failed");
  assert.deepEqual(result.results[0].failures, ["missing_beat:setup", "below_threshold:hook"]);
});

test("a severe technical error hard-fails an otherwise perfect case", () => {
  const input = evidence();
  input[7].severeTechnicalErrors = ["decode_failure"];
  const result = evaluateDirectorStrategies(DIRECTOR_EVALUATION_SET, input);
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.results[7].failures, ["severe:decode_failure"]);
});

test("missing, duplicate, stale-strategy, and malformed score evidence fail closed", () => {
  const missing = evidence().slice(1);
  assert.throws(() => evaluateDirectorStrategies(DIRECTOR_EVALUATION_SET, missing), /cover every evaluation case/);
  const duplicate = evidence(); duplicate[1].caseId = duplicate[0].caseId;
  assert.throws(() => evaluateDirectorStrategies(DIRECTOR_EVALUATION_SET, duplicate), /match evaluation case ids/);
  const stale = evidence(); stale[0].strategy = "tutorial";
  assert.throws(() => evaluateDirectorStrategies(DIRECTOR_EVALUATION_SET, stale), /binding is invalid/);
  const malformed = evidence(); delete malformed[0].scores.hook;
  assert.throws(() => evaluateDirectorStrategies(DIRECTOR_EVALUATION_SET, malformed), /scores .* fields are invalid/);
});
