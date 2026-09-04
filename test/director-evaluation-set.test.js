import test from "node:test";
import assert from "node:assert/strict";
import { DIRECTOR_EVALUATION_SET, validateDirectorEvaluationSet } from "../src/director-evaluation-set.js";

const copy = () => structuredClone(DIRECTOR_EVALUATION_SET);

test("fixed director evaluation set deterministically covers every required dimension and strategy", () => {
  const first = validateDirectorEvaluationSet(DIRECTOR_EVALUATION_SET);
  const second = validateDirectorEvaluationSet(copy());
  assert.equal(first.caseCount, 15);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first.coverage, { strategies: 5, aspectRatio: 3, durationSeconds: 3, medium: 4, audioMode: 4 });
  assert.ok(Object.isFrozen(DIRECTOR_EVALUATION_SET));
  assert.ok(DIRECTOR_EVALUATION_SET.cases.every(Object.isFrozen));
});

test("coverage omissions, unknown values, duplicate ids, and schema drift fail closed", () => {
  const missing = copy();
  missing.cases = missing.cases.filter(item => item.medium !== "product");
  assert.throws(() => validateDirectorEvaluationSet(missing), error => error.code === "DIRECTOR_EVALUATION_SET_INVALID" && /missing medium coverage/.test(error.message));
  const unknown = copy();
  unknown.cases[0].audioMode = "voiceover";
  assert.throws(() => validateDirectorEvaluationSet(unknown), error => error.code === "DIRECTOR_EVALUATION_SET_INVALID" && /unsupported audioMode/.test(error.message));
  const duplicate = copy();
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => validateDirectorEvaluationSet(duplicate), error => error.code === "DIRECTOR_EVALUATION_SET_INVALID" && /unique/.test(error.message));
  const drift = copy();
  drift.cases[0].unreviewed = true;
  assert.throws(() => validateDirectorEvaluationSet(drift), error => error.code === "DIRECTOR_EVALUATION_SET_INVALID" && /fields are invalid/.test(error.message));
});
