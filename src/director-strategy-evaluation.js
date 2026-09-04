import { DomainError } from "./core.js";
import { validateDirectorEvaluationSet } from "./director-evaluation-set.js";
import { getCreativeStrategy, listCreativeStrategyTypes } from "./creative-strategies.js";

const reject = message => { throw new DomainError("DIRECTOR_STRATEGY_EVALUATION_INVALID", message, 422); };
const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) reject(`${label} fields are invalid`);
};

export function evaluateDirectorStrategies(evaluationSet, evidence) {
  const set = validateDirectorEvaluationSet(evaluationSet);
  if (!Array.isArray(evidence) || evidence.length !== evaluationSet.cases.length) reject("evidence must cover every evaluation case exactly once");
  const byId = new Map(evidence.map(item => [item?.caseId, item]));
  if (byId.size !== evidence.length || evaluationSet.cases.some(item => !byId.has(item.id))) reject("evidence must match evaluation case ids exactly");
  const results = evaluationSet.cases.map(item => {
    const observed = byId.get(item.id);
    exactKeys(observed, ["schema", "caseId", "strategy", "observedBeats", "scores", "severeTechnicalErrors"], `evidence ${item.id}`);
    if (observed.schema !== "openreel-director-strategy-evidence/v1" || observed.strategy !== item.strategy) reject(`strategy evidence binding is invalid for ${item.id}`);
    const strategy = getCreativeStrategy(item.strategy);
    if (!Array.isArray(observed.observedBeats) || new Set(observed.observedBeats).size !== observed.observedBeats.length) reject(`observed beats are invalid for ${item.id}`);
    const missingBeats = strategy.requiredBeats.filter(beat => !observed.observedBeats.includes(beat));
    exactKeys(observed.scores, strategy.qualityDimensions, `scores ${item.id}`);
    const failedDimensions = strategy.qualityDimensions.filter(dimension => !Number.isFinite(observed.scores[dimension]) || observed.scores[dimension] < strategy.minimumScore || observed.scores[dimension] > 1);
    if (!Array.isArray(observed.severeTechnicalErrors) || observed.severeTechnicalErrors.some(error => typeof error !== "string" || !error.trim())) reject(`severe technical errors are invalid for ${item.id}`);
    const failures = [...observed.severeTechnicalErrors.map(error => `severe:${error}`), ...missingBeats.map(beat => `missing_beat:${beat}`), ...failedDimensions.map(dimension => `below_threshold:${dimension}`)];
    return Object.freeze({ caseId: item.id, strategy: item.strategy, status: failures.length ? "failed" : "passed", failures: Object.freeze(failures) });
  });
  const strategies = Object.fromEntries(listCreativeStrategyTypes().map(type => [type, results.filter(result => result.strategy === type).every(result => result.status === "passed") ? "passed" : "failed"]));
  const qualified = results.every(result => result.status === "passed");
  return Object.freeze({ schema: "openreel-director-strategy-evaluation/v1", evaluationSetFingerprint: set.fingerprint, status: qualified ? "qualified" : "rejected", releaseEligible: qualified, strategies: Object.freeze(strategies), results: Object.freeze(results) });
}
