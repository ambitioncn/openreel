import { createHash } from "node:crypto";
import { createModelCatalog } from "./model-catalog.js";

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

const BASELINE_FIELDS = new Set(["schemaVersion", "source", "capturedAt", "evidence", "expiresAfterDays", "counts", "requiredModes", "controls"]);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function validateBaseline(baseline) {
  if (!baseline || baseline.schemaVersion !== 1 || !baseline.counts || typeof baseline.counts !== "object" || Array.isArray(baseline.counts) || !Array.isArray(baseline.requiredModes) || !Array.isArray(baseline.controls)) throw new TypeError("versioned capability baseline is required");
  if (Object.keys(baseline).some(field => !BASELINE_FIELDS.has(field))) throw new TypeError("unknown capability baseline field");
  if (typeof baseline.source !== "string" || !baseline.source.trim() || typeof baseline.evidence !== "string" || !baseline.evidence.trim()) throw new TypeError("baseline source and evidence are required");
  const captured = typeof baseline.capturedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(baseline.capturedAt) ? new Date(`${baseline.capturedAt}T00:00:00.000Z`) : null;
  if (!captured || !Number.isFinite(captured.getTime()) || captured.toISOString().slice(0, 10) !== baseline.capturedAt || !Number.isSafeInteger(baseline.expiresAfterDays) || baseline.expiresAfterDays < 1) throw new TypeError("valid baseline capture and expiry are required");
  const counts = Object.fromEntries(Object.entries(baseline.counts).map(([kind, count]) => {
    if (!kind.trim() || !Number.isSafeInteger(count) || count < 0) throw new TypeError(`baseline count for ${kind} must be a non-negative integer`);
    return [kind, count];
  }));
  const list = (values, field) => {
    if (values.some(value => typeof value !== "string" || value !== value.trim() || !value)) throw new TypeError(`baseline ${field} must contain canonical non-empty strings`);
    if (new Set(values).size !== values.length) throw new TypeError(`baseline ${field} must contain unique non-empty strings`);
    return [...values];
  };
  return deepFreeze({
    schemaVersion: 1,
    source: baseline.source.trim(),
    capturedAt: baseline.capturedAt,
    evidence: baseline.evidence.trim(),
    expiresAfterDays: baseline.expiresAfterDays,
    counts,
    requiredModes: list(baseline.requiredModes, "modes"),
    controls: list(baseline.controls, "controls")
  });
}

export function referenceCapabilityCatalog(baseline = libtvAuthenticatedBaseline) {
  const normalized = validateBaseline(baseline);
  return deepFreeze({
    schemaVersion: 1,
    source: normalized.source,
    capturedAt: normalized.capturedAt,
    evidence: normalized.evidence,
    executable: false,
    counts: normalized.counts,
    modes: normalized.requiredModes,
    controls: normalized.controls
  });
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function baselineFingerprint(baseline) {
  const canonicalStrings = values => [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return fingerprint({
    schemaVersion: baseline.schemaVersion,
    source: baseline.source,
    capturedAt: baseline.capturedAt,
    evidence: baseline.evidence,
    expiresAfterDays: baseline.expiresAfterDays,
    counts: Object.fromEntries(Object.entries(baseline.counts).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
    requiredModes: canonicalStrings(baseline.requiredModes),
    controls: canonicalStrings(baseline.controls)
  });
}

function validateCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.models) || typeof catalog.sourceRevision !== "string" || !catalog.sourceRevision.trim() || typeof catalog.fingerprint !== "string") throw new TypeError("versioned model catalog is required");
  const verified = createModelCatalog(catalog.models, { sourceRevision: catalog.sourceRevision });
  if (verified.fingerprint !== catalog.fingerprint || verified.modelCount !== catalog.modelCount || JSON.stringify(verified.kinds) !== JSON.stringify(catalog.kinds)) throw new TypeError("model catalog integrity check failed");
  return verified;
}

export function compareCapabilityBaseline(catalog, baseline = libtvAuthenticatedBaseline, { now = new Date() } = {}) {
  const verifiedCatalog = validateCatalog(catalog);
  const normalized = validateBaseline(baseline);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("valid comparison time is required");
  const captured = new Date(`${normalized.capturedAt}T00:00:00Z`), ageDays = Math.floor((now - captured) / 86_400_000);
  if (ageDays < 0) throw new TypeError("comparison time cannot precede baseline capture");
  const modes = new Set(verifiedCatalog.models.flatMap(model => model.schema.modes || []));
  const controls = new Set(verifiedCatalog.models.flatMap(model => model.schema.controls || []));
  const sorted = values => [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const modelIdsBy = field => Object.fromEntries(sorted(new Set(verifiedCatalog.models.flatMap(model => model.schema[field] || []))).map(value => [
    value,
    verifiedCatalog.models.filter(model => (model.schema[field] || []).includes(value)).map(model => model.id)
  ]));
  const adapterIds = sorted(new Set(verifiedCatalog.models.map(model => model.adapterId)));
  const adapterModelCounts = Object.fromEntries(adapterIds.map(adapterId => [adapterId, verifiedCatalog.models.filter(model => model.adapterId === adapterId).length]));
  const modeModelIds = modelIdsBy("modes"), controlModelIds = modelIdsBy("controls");
  const configured = {
    modelCount: verifiedCatalog.modelCount,
    counts: verifiedCatalog.kinds,
    adapterIds,
    adapterModelCounts,
    modes: Object.keys(modeModelIds),
    modeModelCounts: Object.fromEntries(Object.entries(modeModelIds).map(([mode, modelIds]) => [mode, modelIds.length])),
    modeModelIds,
    controls: Object.keys(controlModelIds),
    controlModelCounts: Object.fromEntries(Object.entries(controlModelIds).map(([control, modelIds]) => [control, modelIds.length])),
    controlModelIds
  };
  const countGaps = Object.fromEntries(Object.entries(normalized.counts).map(([kind, target]) => [kind, Math.max(0, target - (verifiedCatalog.kinds[kind] || 0))]).filter(([, gap]) => gap));
  const missingModes = normalized.requiredModes.filter(mode => !modes.has(mode));
  const missingControls = normalized.controls.filter(control => !controls.has(control));
  const stale = ageDays > normalized.expiresAfterDays;
  return deepFreeze({ schemaVersion: 1, baseline: { source: normalized.source, capturedAt: normalized.capturedAt, evidence: normalized.evidence, fingerprint: baselineFingerprint(normalized), stale, ageDays }, localCatalogFingerprint: verifiedCatalog.fingerprint, configured, status: stale ? "baseline_stale" : Object.keys(countGaps).length || missingModes.length || missingControls.length ? "gaps_detected" : "covered", countGaps, missingModes, missingControls });
}
