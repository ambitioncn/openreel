import { DomainError } from "./core.js";

const LIMITS = Object.freeze({ minWidth: 720, minHeight: 1280, minMotion: 0.03, maxBlack: 0.08, maxFrozen: 0.12, minReference: 0.72 });

function required(value, name, max = 2_000) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || [...result].length > max) throw new DomainError("COMMERCIAL_QUALITY_INPUT_INVALID", `${name} is required and must be at most ${max} characters`, 422);
  return result;
}

function number(value, name, minimum, maximum) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw new DomainError("COMMERCIAL_QUALITY_INPUT_INVALID", `${name} must be between ${minimum} and ${maximum}`, 422);
  return result;
}

function entities(value = []) {
  if (!Array.isArray(value) || value.length > 20) throw new DomainError("COMMERCIAL_QUALITY_INPUT_INVALID", "continuityEntities must contain at most 20 entries", 422);
  return value.map((entity, index) => {
    const attributes = entity?.attributes;
    if (!attributes || Array.isArray(attributes) || typeof attributes !== "object") throw new DomainError("COMMERCIAL_QUALITY_INPUT_INVALID", `continuityEntities[${index}].attributes must be an object`, 422);
    const locked = Array.isArray(entity.lockedAttributes) ? [...new Set(entity.lockedAttributes)] : [];
    if (locked.some(key => typeof key !== "string" || !required(attributes[key], `continuityEntities[${index}].attributes.${key}`, 300))) throw new DomainError("COMMERCIAL_QUALITY_INPUT_INVALID", `continuityEntities[${index}] has an invalid locked attribute`, 422);
    return { id: required(entity.id, `continuityEntities[${index}].id`, 100), name: required(entity.name, `continuityEntities[${index}].name`, 200), locked: locked.sort().map(key => `${key}=${attributes[key].trim()}`) };
  });
}

export function compileConsistencyAwareStoryboard(input = {}) {
  const shots = input.storyboard?.shots;
  if (!Array.isArray(shots) || !shots.length || shots.length > 12) throw new DomainError("COMMERCIAL_QUALITY_INPUT_INVALID", "storyboard must contain 1-12 shots", 422);
  const continuity = entities(input.continuityEntities);
  const globalLock = continuity.length ? continuity.map(entity => `${entity.name}[${entity.id}]: ${entity.locked.join(", ") || "identity and appearance from reference"}`).join("; ") : "preserve product, character and scene identity from supplied references";
  const compiled = shots.map((shot, index) => {
    const id = required(shot?.id || `shot-${index + 1}`, `storyboard.shots[${index}].id`, 100);
    const prompt = required(shot?.prompt, `storyboard.shots[${index}].prompt`);
    const duration = number(shot?.duration, `storyboard.shots[${index}].duration`, 1, 10);
    const previous = index ? shots[index - 1] : null;
    return Object.freeze({ id, duration, prompt: [`SHOT ${index + 1}/${shots.length}: ${prompt}`, `CONTINUITY LOCK: ${globalLock}.`, previous ? `MATCH PREVIOUS SHOT ${required(previous.id || `shot-${index}`, "previous shot id", 100)}: preserve subject geometry, wardrobe/product packaging, lighting direction and screen direction; change only the requested action/camera.` : "ESTABLISH MASTER LOOK: use supplied references as the canonical identity and scene baseline.", "OUTPUT: vertical 9:16, stable anatomy/text/logo, coherent motion, no scene cut inside the shot."].join("\n"), continuityEntityIds: continuity.map(entity => entity.id), previousShotId: previous ? required(previous.id || `shot-${index}`, "previous shot id", 100) : null });
  });
  return Object.freeze({ schema: "openreel-consistency-storyboard/v1", shots: Object.freeze(compiled), qualityLimits: LIMITS });
}

export function evaluateCommercialShotQuality(input = {}) {
  const shotId = required(input.shotId, "shotId", 100);
  const expectedDuration = number(input.expectedDuration, "expectedDuration", 1, 10);
  const probe = input.probe;
  if (!probe || Array.isArray(probe) || typeof probe !== "object") throw new DomainError("COMMERCIAL_QUALITY_INPUT_INVALID", "probe is required", 422);
  const width = number(probe.width, "probe.width", 1, 16_384), height = number(probe.height, "probe.height", 1, 16_384);
  const duration = number(probe.duration, "probe.duration", 0.01, 60), motion = number(probe.motionScore, "probe.motionScore", 0, 1);
  const black = number(probe.blackFrameRatio, "probe.blackFrameRatio", 0, 1), frozen = number(probe.frozenFrameRatio, "probe.frozenFrameRatio", 0, 1);
  const reference = number(probe.referenceSimilarity, "probe.referenceSimilarity", 0, 1);
  const failures = [];
  if (width < LIMITS.minWidth || height < LIMITS.minHeight || Math.abs(width / height - 9 / 16) > 0.02) failures.push("invalid_vertical_frame");
  if (Math.abs(duration - expectedDuration) > Math.max(0.5, expectedDuration * 0.12)) failures.push("duration_mismatch");
  if (motion < LIMITS.minMotion) failures.push("insufficient_motion");
  if (black > LIMITS.maxBlack) failures.push("excess_black_frames");
  if (frozen > LIMITS.maxFrozen) failures.push("excess_frozen_frames");
  if (reference < LIMITS.minReference) failures.push("reference_drift");
  const retryable = failures.filter(item => item !== "reference_drift");
  const action = failures.length === 0 ? "accept" : reference < 0.5 ? "degrade" : retryable.length ? "retry_shot" : "degrade";
  return Object.freeze({ schema: "openreel-commercial-shot-quality/v1", shotId, accepted: action === "accept", action, failures: Object.freeze(failures), explanation: failures.length ? `Shot failed deterministic checks: ${failures.join(", ")}.` : "Shot passed all deterministic continuity and media checks.", limits: LIMITS, observed: Object.freeze({ width, height, duration, motionScore: motion, blackFrameRatio: black, frozenFrameRatio: frozen, referenceSimilarity: reference }) });
}
