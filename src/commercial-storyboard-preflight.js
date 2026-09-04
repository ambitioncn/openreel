import { DomainError } from "./core.js";

export const COMMERCIAL_ARC_BEATS = Object.freeze(["hook", "development", "payoff"]);

const normalized = value => typeof value === "string" ? value.trim().toLowerCase() : "";

export function qualifyCommercialStoryboardStrategy(input = {}) {
  const shots = input.storyboard?.shots;
  if (!Array.isArray(shots) || shots.length < 3 || shots.length > 12) throw new DomainError("COMMERCIAL_STORYBOARD_STRATEGY_INVALID", "a paid acceptance candidate requires 3-12 structurally distinct shots", 422);
  const beats = shots.map((shot, index) => normalized(shot?.strategyBeat || COMMERCIAL_ARC_BEATS[index]));
  const prompts = shots.map(shot => normalized(shot?.prompt));
  const durations = shots.map(shot => Number(shot?.duration));
  if (beats.slice(0, 3).some((beat, index) => beat !== COMMERCIAL_ARC_BEATS[index])) throw new DomainError("COMMERCIAL_STORYBOARD_STRATEGY_INVALID", "the opening arc must progress hook, development, payoff", 422);
  if (prompts.some(prompt => !prompt) || new Set(prompts).size !== prompts.length) throw new DomainError("COMMERCIAL_STORYBOARD_STRATEGY_INVALID", "every strategy shot needs a distinct observable prompt", 422);
  if (durations.some(duration => ![4, 5].includes(duration))) throw new DomainError("COMMERCIAL_STORYBOARD_STRATEGY_INVALID", "seedance-2-fast strategy shot durations must be 4 or 5 seconds", 422);
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const intent = normalized(input.intent);
  if (!intent || prompts.some(prompt => !prompt.includes(intent))) throw new DomainError("COMMERCIAL_STORYBOARD_STRATEGY_INVALID", "every shot must preserve the declared visual intent", 422);
  return Object.freeze({ schema: "openreel-commercial-storyboard-strategy-preflight/v1", accepted: true, intent, beats: Object.freeze(beats), shotCount: shots.length, totalDuration, pacing: Object.freeze({ durations, varied: new Set(durations).size > 1 }), paidProviderCalls: 0 });
}

export function qualifyCommercialStoryboardPolicySafety(input = {}) {
  const shots = input.storyboard?.shots;
  const reference = input.identityReference;
  const declarations = input.declarations;
  if (!Array.isArray(shots) || shots.length === 0) throw new DomainError("COMMERCIAL_STORYBOARD_POLICY_PREFLIGHT_INVALID", "storyboard shots are required for policy preflight", 422);
  if (!reference || !Number.isInteger(reference.width) || !Number.isInteger(reference.height) || reference.width < 256 || reference.height < 256 || !/^[a-f0-9]{64}$/i.test(reference.sha256 || "")) {
    throw new DomainError("COMMERCIAL_STORYBOARD_POLICY_PREFLIGHT_INVALID", "a byte-backed identity reference of at least 256x256 with SHA-256 is required", 422);
  }
  const performerProfile = declarations?.performer;
  if (declarations?.referenceRights !== "owned_or_licensed" || !["fictional_adult", "object_only"].includes(performerProfile) || declarations?.brands !== "none" || declarations?.publicFigures !== "none") {
    throw new DomainError("COMMERCIAL_STORYBOARD_POLICY_PREFLIGHT_INVALID", "explicit rights, an allowed performer profile, no-brand and no-public-figure declarations are required", 422);
  }
  const prompts = shots.map(shot => normalized(shot?.prompt));
  const requiredTerms = performerProfile === "object_only"
    ? ["object-only", "no people", "no faces", "no personal information", "neutral studio", "unbranded"]
    : ["fictional adult performer", "controlled studio", "unbranded"];
  if (prompts.some(prompt => !prompt || requiredTerms.some(term => !prompt.includes(term)))) {
    throw new DomainError("COMMERCIAL_STORYBOARD_POLICY_PREFLIGHT_INVALID", "every shot must preserve all constraints for the declared performer profile", 422);
  }
  return Object.freeze({ schema: "openreel-commercial-storyboard-policy-safety-preflight/v1", accepted: true, performerProfile, shotCount: shots.length, referenceSha256: reference.sha256.toLowerCase(), paidProviderCalls: 0, providerPolicyGuaranteed: false });
}
