import { DomainError } from "./core.js";

const SAFE_ZONES = Object.freeze({
  tiktok: Object.freeze({ top: 0.08, right: 0.16, bottom: 0.2, left: 0.08 }),
  reels: Object.freeze({ top: 0.08, right: 0.08, bottom: 0.18, left: 0.08 }),
  shorts: Object.freeze({ top: 0.08, right: 0.12, bottom: 0.18, left: 0.08 })
});

function invalid(message) { throw new DomainError("COMMERCIAL_COMPOSITION_INVALID", message, 422); }
function number(value, name, min, max) { if (!Number.isFinite(value) || value < min || value > max) invalid(`${name} must be between ${min} and ${max}`); return value; }

export function planCommercialComposition(input = {}) {
  const shots = input.storyboard?.shots;
  if (!Array.isArray(shots) || !shots.length || shots.length > 12) invalid("storyboard must contain 1-12 shots");
  const safeZone = SAFE_ZONES[input.safeZone || "tiktok"];
  if (!safeZone) invalid("safeZone is unsupported");
  const captions = input.captions !== false;
  let cursor = 0;
  const timeline = shots.map((shot, index) => {
    const duration = number(shot?.duration, `storyboard.shots[${index}].duration`, 1, 10);
    const start = cursor; cursor += duration;
    const caption = captions ? String(shot.caption || shot.prompt || "").trim() : "";
    if (captions && (!caption || [...caption].length > 2_000)) invalid(`storyboard.shots[${index}].caption must contain 1-2000 characters`);
    return Object.freeze({ shotId: String(shot.id || `shot-${index + 1}`), start, end: cursor, caption });
  });
  return Object.freeze({ schema: "openreel-commercial-composition/v1", duration: cursor, safeZone, timeline: Object.freeze(timeline), audio: Object.freeze({ voiceGainDb: -3, musicGainDb: input.music === "none" ? null : -18, speechDuckDb: input.music === "none" ? null : -9, peakCeilingDbfs: -1, targetLufs: -14 }) });
}

export function evaluateCommercialComposition(input = {}) {
  const plan = input.plan;
  if (plan?.schema !== "openreel-commercial-composition/v1") invalid("a commercial composition plan is required");
  const probe = input.probe;
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) invalid("probe is required");
  const duration = number(probe.duration, "probe.duration", 0.01, 180);
  const peak = number(probe.peakDbfs, "probe.peakDbfs", -120, 0);
  const loudness = number(probe.loudnessLufs, "probe.loudnessLufs", -70, 0);
  const captionViolations = number(probe.captionSafeZoneViolations, "probe.captionSafeZoneViolations", 0, 1_000);
  const avDrift = number(probe.maxAvDriftSeconds, "probe.maxAvDriftSeconds", 0, 60);
  const failures = [];
  if (Math.abs(duration - plan.duration) > Math.max(0.25, plan.duration * 0.02)) failures.push("duration_mismatch");
  if (captionViolations) failures.push("caption_safe_zone_violation");
  if (peak > plan.audio.peakCeilingDbfs) failures.push("audio_peak_clipping");
  if (Math.abs(loudness - plan.audio.targetLufs) > 2) failures.push("loudness_out_of_range");
  if (avDrift > 0.08) failures.push("audio_video_drift");
  return Object.freeze({ schema: "openreel-commercial-composition-quality/v1", accepted: failures.length === 0, action: failures.length ? "recompose" : "accept", failures: Object.freeze(failures), explanation: failures.length ? `Final composition failed deterministic checks: ${failures.join(", ")}.` : "Final composition passed caption, timing and audio checks." });
}
