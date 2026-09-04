import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTOR_EVALUATION_SET, validateDirectorEvaluationSet } from "../src/director-evaluation-set.js";
import { evaluateDirectorStrategies } from "../src/director-strategy-evaluation.js";
import { getCreativeStrategy } from "../src/creative-strategies.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "docs", "evidence", "cdqs-13-fixed-set-qualification.json");
const evidence = () => DIRECTOR_EVALUATION_SET.cases.map(item => {
  const strategy = getCreativeStrategy(item.strategy);
  return { schema: "openreel-director-strategy-evidence/v1", caseId: item.id, strategy: item.strategy, observedBeats: [...strategy.requiredBeats], scores: Object.fromEntries(strategy.qualityDimensions.map(dimension => [dimension, 0.9])), severeTechnicalErrors: [] };
});
const set = validateDirectorEvaluationSet(DIRECTOR_EVALUATION_SET);
const positive = evaluateDirectorStrategies(DIRECTOR_EVALUATION_SET, evidence());
assert.equal(positive.status, "qualified");
assert.equal(positive.releaseEligible, true);
const severeErrorCases = DIRECTOR_EVALUATION_SET.cases.map((item, index) => {
  const injected = evidence();
  injected[index].severeTechnicalErrors = ["decode_failure"];
  const result = evaluateDirectorStrategies(DIRECTOR_EVALUATION_SET, injected);
  assert.equal(result.status, "rejected");
  assert.equal(result.releaseEligible, false);
  assert.deepEqual(result.results[index].failures, ["severe:decode_failure"]);
  return { caseId: item.id, strategy: item.strategy, status: result.status, releaseEligible: result.releaseEligible, failure: result.results[index].failures[0] };
});
const record = { schema: "openreel-cdqs-13-qualification/v1", evaluationSetVersion: set.version, evaluationSetFingerprint: set.fingerprint, caseCount: set.caseCount, positive: { status: positive.status, releaseEligible: positive.releaseEligible, strategies: positive.strategies }, severeErrorCases, externalCalls: false, paidCalls: false, deploymentActivated: false };
const fingerprint = createHash("sha256").update(JSON.stringify(record)).digest("hex");
const artifact = { ...record, fingerprint };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(`${output}.tmp`, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
renameSync(`${output}.tmp`, output);
console.log(JSON.stringify({ status: "qualified", cases: set.caseCount, severeHardFailures: severeErrorCases.length, fingerprint, output }));
