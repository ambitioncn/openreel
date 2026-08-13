import { createHash } from "node:crypto";

const KINDS = new Set(["text", "vision", "image", "video", "audio", "script"]);
const FIELDS = ["modes", "aspects", "resolutions", "durations", "controls"];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function createModelCatalog(models, { sourceRevision = "openreel-model-catalog/v1" } = {}) {
  if (!Array.isArray(models)) throw new TypeError("models must be an array");
  const seen = new Set(), normalized = models.map(model => {
    if (!model || typeof model !== "object" || typeof model.id !== "string" || !model.id.trim() || !KINDS.has(model.kind) || typeof model.adapterId !== "string" || !model.adapterId.trim()) throw new TypeError("model id, kind, and adapterId are required");
    const id = model.id.trim();
    if (seen.has(id)) throw new TypeError(`duplicate model id: ${id}`);
    seen.add(id);
    const schema = model.schema || {};
    for (const field of FIELDS) if (schema[field] !== undefined && !Array.isArray(schema[field])) throw new TypeError(`model ${id} schema.${field} must be an array`);
    if (schema.maxReferences !== undefined && (!Number.isSafeInteger(schema.maxReferences) || schema.maxReferences < 0)) throw new TypeError(`model ${id} schema.maxReferences must be a non-negative integer`);
    return canonical({ id, kind: model.kind, adapterId: model.adapterId.trim(), schema: canonical(schema) });
  }).sort((a, b) => a.id.localeCompare(b.id));
  const fingerprint = createHash("sha256").update(JSON.stringify({ sourceRevision, models: normalized })).digest("hex");
  return Object.freeze({ schemaVersion: 1, sourceRevision, fingerprint, modelCount: normalized.length, kinds: Object.fromEntries([...KINDS].map(kind => [kind, normalized.filter(model => model.kind === kind).length]).filter(([, count]) => count)), models: normalized });
}

export function validateProviderMappings(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.models)) throw new TypeError("versioned model catalog is required");
  const issues = [];
  const mappings = catalog.models.map(model => {
    const modes = model.schema.modes || [], controls = model.schema.controls || [];
    for (const mode of modes) {
      if (typeof mode !== "string" || !mode.trim()) issues.push({ modelId: model.id, code: "INVALID_MODE" });
      else if (mode.split("-to-").at(-1) !== model.kind) issues.push({ modelId: model.id, code: "MODE_KIND_MISMATCH", mode, kind: model.kind });
    }
    if (new Set(modes).size !== modes.length) issues.push({ modelId: model.id, code: "DUPLICATE_MODE" });
    if (controls.some(control => typeof control !== "string" || !control.trim())) issues.push({ modelId: model.id, code: "INVALID_CONTROL" });
    if (new Set(controls).size !== controls.length) issues.push({ modelId: model.id, code: "DUPLICATE_CONTROL" });
    return { modelId: model.id, adapterId: model.adapterId, kind: model.kind, modes: [...modes], controls: [...controls] };
  });
  return Object.freeze({ schemaVersion: 1, catalogFingerprint: catalog.fingerprint, executedProviderCalls: false, status: issues.length ? "invalid" : "valid", mappings, issues });
}
