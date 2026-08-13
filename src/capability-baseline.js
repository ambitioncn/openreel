import { createHash } from "node:crypto";

export const libtvAuthenticatedBaseline = Object.freeze({
  schemaVersion: 1,
  source: "authenticated-observed",
  capturedAt: "2026-08-07",
  evidence: "docs/libtv-authenticated-evidence-2026-08-07.md",
  expiresAfterDays: 30,
  counts: { text: 4, image: 16, video: 32, audio: 6, script: 10, storyboard: 10 },
  requiredModes: ["image-to-text", "video-to-text", "text-to-image", "text-to-video", "image-to-video", "audio-to-video", "text-to-audio"],
  controls: ["ordered-references", "camera", "generated-audio", "voice", "speed", "pitch", "volume", "sample-rate", "audio-format"]
});

export function referenceCapabilityCatalog(baseline = libtvAuthenticatedBaseline) {
  if (!baseline || baseline.schemaVersion !== 1 || !baseline.counts || !Array.isArray(baseline.requiredModes) || !Array.isArray(baseline.controls)) throw new TypeError("versioned capability baseline is required");
  const counts = Object.fromEntries(Object.entries(baseline.counts).map(([kind, count]) => {
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError(`baseline count for ${kind} must be a non-negative integer`);
    return [kind, count];
  }));
  return Object.freeze({
    schemaVersion: 1,
    source: baseline.source,
    capturedAt: baseline.capturedAt,
    evidence: baseline.evidence,
    executable: false,
    counts,
    modes: [...new Set(baseline.requiredModes)],
    controls: [...new Set(baseline.controls)]
  });
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function compareCapabilityBaseline(catalog, baseline = libtvAuthenticatedBaseline, { now = new Date() } = {}) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.models)) throw new TypeError("versioned model catalog is required");
  if (!baseline || baseline.schemaVersion !== 1 || !baseline.counts || !Array.isArray(baseline.requiredModes) || !Array.isArray(baseline.controls)) throw new TypeError("versioned capability baseline is required");
  const captured = new Date(`${baseline.capturedAt}T00:00:00Z`), ageDays = Math.floor((now - captured) / 86_400_000);
  if (!Number.isFinite(captured.getTime()) || !Number.isSafeInteger(baseline.expiresAfterDays) || baseline.expiresAfterDays < 1) throw new TypeError("valid baseline capture and expiry are required");
  const modes = new Set(catalog.models.flatMap(model => model.schema.modes || []));
  const controls = new Set(catalog.models.flatMap(model => model.schema.controls || []));
  const countGaps = Object.fromEntries(Object.entries(baseline.counts).map(([kind, target]) => [kind, Math.max(0, target - (catalog.kinds[kind] || 0))]).filter(([, gap]) => gap));
  const missingModes = baseline.requiredModes.filter(mode => !modes.has(mode));
  const missingControls = baseline.controls.filter(control => !controls.has(control));
  const stale = ageDays > baseline.expiresAfterDays;
  return Object.freeze({ schemaVersion: 1, baseline: { source: baseline.source, capturedAt: baseline.capturedAt, evidence: baseline.evidence, fingerprint: fingerprint(baseline), stale, ageDays }, localCatalogFingerprint: catalog.fingerprint, status: stale ? "baseline_stale" : Object.keys(countGaps).length || missingModes.length || missingControls.length ? "gaps_detected" : "covered", countGaps, missingModes, missingControls });
}
