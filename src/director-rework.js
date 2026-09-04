import { createHash } from "node:crypto";

export const DIRECTOR_REWORK_SCHEMA = "openreel-director-rework/v1";
const invalid = message => { throw new TypeError(message); };
const money = (value, name, allowZero = false) => {
  if (!Number.isFinite(value) || value < (allowZero ? 0 : 0.01) || Math.round(value * 100) !== value * 100) invalid(`${name} must be a CNY amount with at most two decimals`);
  return value;
};
const freeze = value => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createDirectorReworkState(finalQuality, policy) {
  if (finalQuality?.schema !== "openreel-director-final-quality-result/v1" || !["rejected", "hard_failed", "approved"].includes(finalQuality.qualificationStatus)) invalid("a final quality result is required");
  if (!Number.isSafeInteger(policy?.maxAttempts) || policy.maxAttempts < 1) invalid("maxAttempts must be a positive integer");
  const budgetCny = money(policy.budgetCny, "budgetCny");
  const directives = finalQuality.qualificationStatus === "rejected" ? buildDirectives(finalQuality) : [];
  const status = finalQuality.qualificationStatus === "approved" ? "qualified" : finalQuality.qualificationStatus === "hard_failed" ? "hard_failed" : directives.length ? "actionable" : "exhausted";
  return seal({ schema: DIRECTOR_REWORK_SCHEMA, projectId: finalQuality.projectId, workflowId: finalQuality.workflowId, revision: finalQuality.revision, sourceQualityFingerprint: finalQuality.fingerprint, policy: { maxAttempts: policy.maxAttempts, budgetCny }, attemptsUsed: 0, spentCny: 0, directives, attempts: [], status, stopReason: status === "hard_failed" ? "severe_technical_failure" : status === "qualified" ? "already_qualified" : directives.length ? null : "no_safe_local_directive" });
}

export function recordDirectorReworkAttempt(state, input) {
  validateDirectorReworkState(state);
  if (state.status !== "actionable") invalid("rework is not actionable");
  const directive = state.directives.find(item => item.id === input?.directiveId);
  if (!directive) invalid("directiveId must select a current directive");
  const estimatedCostCny = money(input.estimatedCostCny, "estimatedCostCny", true);
  const actualCostCny = money(input.actualCostCny, "actualCostCny", true);
  if (actualCostCny > estimatedCostCny) invalid("actualCostCny cannot exceed the explicitly approved estimate");
  if (state.attemptsUsed + 1 > state.policy.maxAttempts) invalid("retry limit is exhausted");
  if (state.spentCny + estimatedCostCny > state.policy.budgetCny) invalid("CNY budget is exhausted");
  if (!input.evidenceId || typeof input.evidenceId !== "string") invalid("evidenceId is required; blind retry is forbidden");
  if (!['succeeded', 'failed'].includes(input.outcome)) invalid("outcome must be succeeded or failed");

  const directives = input.outcome === "succeeded" ? state.directives.filter(item => item.id !== directive.id) : [...state.directives];
  const attemptsUsed = state.attemptsUsed + 1;
  const spentCny = Math.round((state.spentCny + actualCostCny) * 100) / 100;
  const limitReached = attemptsUsed >= state.policy.maxAttempts || directives.length && spentCny >= state.policy.budgetCny;
  const status = directives.length === 0 ? "rework_complete" : limitReached ? "exhausted" : "actionable";
  return seal({ ...withoutFingerprint(state), attemptsUsed, spentCny, directives, attempts: [...state.attempts, { sequence: attemptsUsed, directiveId: directive.id, estimatedCostCny, actualCostCny, outcome: input.outcome, evidenceId: input.evidenceId }], status, stopReason: status === "exhausted" ? (attemptsUsed >= state.policy.maxAttempts ? "retry_limit" : "budget_limit") : null });
}

export function restoreDirectorReworkState(snapshot) {
  validateDirectorReworkState(snapshot);
  return freeze(structuredClone(snapshot));
}

export function validateDirectorReworkState(state) {
  if (!state || state.schema !== DIRECTOR_REWORK_SCHEMA || !/^[a-f0-9]{64}$/.test(state.fingerprint || "")) invalid("rework state is invalid");
  if (fingerprint(withoutFingerprint(state)) !== state.fingerprint) invalid("rework state fingerprint is invalid");
  if (!Number.isSafeInteger(state.attemptsUsed) || state.attemptsUsed !== state.attempts?.length || state.attemptsUsed > state.policy?.maxAttempts) invalid("rework attempt state is inconsistent");
  money(state.policy.budgetCny, "budgetCny"); money(state.spentCny, "spentCny", true);
  if (state.spentCny > state.policy.budgetCny || !["actionable", "exhausted", "rework_complete", "qualified", "hard_failed"].includes(state.status)) invalid("rework budget or status is inconsistent");
  return state;
}

function buildDirectives(result) {
  const directives = result.failedShots.map(shotId => ({ id: `shot:${shotId}`, scope: "shot", shotId, reasons: ["shot_quality_failed"], action: "regenerate_shot" }));
  const reasons = [...result.technicalFailures, ...result.directorFailures];
  if (reasons.length) directives.push({ id: "composition:final", scope: "composition", shotId: null, reasons, action: "revise_composition" });
  return directives;
}
function withoutFingerprint(value) { const { fingerprint: ignored, ...rest } = value; return structuredClone(rest); }
function seal(value) { const normalized = withoutFingerprint(value); return freeze({ ...normalized, fingerprint: fingerprint(normalized) }); }
