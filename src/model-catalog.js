import { createHash } from "node:crypto";

const KINDS = new Set(["text", "vision", "image", "video", "audio", "script"]);
const FIELDS = ["modes", "aspects", "resolutions", "durations", "controls"];
const MODEL_FIELDS = new Set(["id", "kind", "adapterId", "schema"]);
const SCHEMA_FIELDS = new Set([...FIELDS, "audio", "maxReferences"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createModelCatalog(models, { sourceRevision = "openreel-model-catalog/v1" } = {}) {
  if (!Array.isArray(models)) throw new TypeError("models must be an array");
  if (typeof sourceRevision !== "string" || !sourceRevision.trim()) throw new TypeError("sourceRevision must be a non-empty string");
  const seen = new Set(), normalized = models.map(model => {
    if (!model || typeof model !== "object" || typeof model.id !== "string" || !model.id.trim() || !KINDS.has(model.kind) || typeof model.adapterId !== "string" || !model.adapterId.trim()) throw new TypeError("model id, kind, and adapterId are required");
    for (const field of Object.keys(model)) if (!MODEL_FIELDS.has(field)) throw new TypeError(`model ${model.id.trim()} field ${field} is not supported`);
    const id = model.id.trim();
    if (seen.has(id)) throw new TypeError(`duplicate model id: ${id}`);
    seen.add(id);
    const rawSchema = model.schema || {};
    if (!rawSchema || typeof rawSchema !== "object" || Array.isArray(rawSchema)) throw new TypeError(`model ${id} schema must be an object`);
    const schema = { ...rawSchema };
    for (const field of Object.keys(schema)) if (!SCHEMA_FIELDS.has(field)) throw new TypeError(`model ${id} schema.${field} is not supported`);
    for (const field of FIELDS) if (schema[field] !== undefined && !Array.isArray(schema[field])) throw new TypeError(`model ${id} schema.${field} must be an array`);
    for (const field of ["modes", "aspects", "resolutions", "controls"]) {
      if (schema[field]?.some(value => typeof value !== "string" || !value.trim())) throw new TypeError(`model ${id} schema.${field} must contain non-empty strings`);
      const normalizedValues = schema[field]?.map(value => value.trim());
      if (normalizedValues && new Set(normalizedValues).size !== normalizedValues.length) throw new TypeError(`model ${id} schema.${field} must not contain duplicates`);
      if (normalizedValues) schema[field] = normalizedValues;
    }
    if (schema.durations?.some(value => typeof value !== "number" || !Number.isFinite(value) || value <= 0)) throw new TypeError(`model ${id} schema.durations must contain positive finite numbers`);
    if (schema.durations && new Set(schema.durations).size !== schema.durations.length) throw new TypeError(`model ${id} schema.durations must not contain duplicates`);
    if (schema.audio !== undefined && typeof schema.audio !== "boolean") throw new TypeError(`model ${id} schema.audio must be a boolean`);
    if (schema.maxReferences !== undefined && (!Number.isSafeInteger(schema.maxReferences) || schema.maxReferences < 0)) throw new TypeError(`model ${id} schema.maxReferences must be a non-negative integer`);
    return canonical({ id, kind: model.kind, adapterId: model.adapterId.trim(), schema: canonical(schema) });
  }).sort((a, b) => compareCodeUnits(a.id, b.id));
  const normalizedRevision = sourceRevision.trim();
  const fingerprint = createHash("sha256").update(JSON.stringify({ sourceRevision: normalizedRevision, models: normalized })).digest("hex");
  return deepFreeze({ schemaVersion: 1, sourceRevision: normalizedRevision, fingerprint, modelCount: normalized.length, kinds: Object.fromEntries([...KINDS].map(kind => [kind, normalized.filter(model => model.kind === kind).length]).filter(([, count]) => count)), models: normalized });
}

export function validateProviderMappings(catalog) {
  const verified = verifiedCatalog(catalog);
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
  return deepFreeze({ schemaVersion: 1, catalogFingerprint: catalog.fingerprint, executedProviderCalls: false, status: issues.length ? "invalid" : "valid", mappings, issues });
}

function verifiedCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.models) || typeof catalog.sourceRevision !== "string" || typeof catalog.fingerprint !== "string") throw new TypeError("versioned model catalog is required");
  const verified = createModelCatalog(catalog.models, { sourceRevision: catalog.sourceRevision });
  if (verified.fingerprint !== catalog.fingerprint || verified.modelCount !== catalog.modelCount || JSON.stringify(verified.kinds) !== JSON.stringify(catalog.kinds)) throw new TypeError("model catalog integrity check failed");
  return verified;
}

export function compareModelCatalogs(previousCatalog, currentCatalog) {
  const previous = verifiedCatalog(previousCatalog), current = verifiedCatalog(currentCatalog);
  const previousById = new Map(previous.models.map(model => [model.id, model]));
  const currentById = new Map(current.models.map(model => [model.id, model]));
  const added = current.models.filter(model => !previousById.has(model.id)).map(model => model.id);
  const removed = previous.models.filter(model => !currentById.has(model.id)).map(model => model.id);
  const changed = current.models.filter(model => previousById.has(model.id) && JSON.stringify(previousById.get(model.id)) !== JSON.stringify(model)).map(model => {
    const before = previousById.get(model.id);
    const changedFields = [];
    if (before.kind !== model.kind) changedFields.push("kind");
    if (before.adapterId !== model.adapterId) changedFields.push("adapterId");
    const schemaFields = [...new Set([...Object.keys(before.schema), ...Object.keys(model.schema)])].sort(compareCodeUnits);
    for (const field of schemaFields) if (JSON.stringify(before.schema[field]) !== JSON.stringify(model.schema[field])) changedFields.push(`schema.${field}`);
    return { modelId: model.id, changedFields, before, after: model };
  });
  const sourceRevisionChanged = previous.sourceRevision !== current.sourceRevision;
  const hasDrift = sourceRevisionChanged || added.length > 0 || removed.length > 0 || changed.length > 0;
  const reviewReasons = [
    sourceRevisionChanged && "source_revision_changed",
    added.length > 0 && "models_added",
    removed.length > 0 && "models_removed",
    changed.length > 0 && "models_changed"
  ].filter(Boolean);
  const reviewReasonCounts = Object.fromEntries(reviewReasons.map(reason => [reason, ({
    source_revision_changed: sourceRevisionChanged ? 1 : 0,
    models_added: added.length,
    models_removed: removed.length,
    models_changed: changed.length
  })[reason]]));
  const affectedModelIds = [...new Set([...added, ...removed, ...changed.map(change => change.modelId)])].sort(compareCodeUnits);
  const reviewImpact = {
    metadataChanged: sourceRevisionChanged,
    modelSetChanged: added.length > 0 || removed.length > 0,
    modelStructureChanged: changed.length > 0,
    affectedModelCount: affectedModelIds.length,
    reviewLanes: {
      metadata: sourceRevisionChanged,
      inventory: added.length > 0 || removed.length > 0,
      taxonomy: changed.some(change => change.changedFields.includes("kind")),
      routing: changed.some(change => change.changedFields.includes("adapterId")),
      capabilities: changed.some(change => change.changedFields.some(field => field.startsWith("schema.")))
    },
    reviewLaneCounts: {
      metadata: sourceRevisionChanged ? 1 : 0,
      inventory: added.length + removed.length,
      taxonomy: changed.filter(change => change.changedFields.includes("kind")).length,
      routing: changed.filter(change => change.changedFields.includes("adapterId")).length,
      capabilities: changed.filter(change => change.changedFields.some(field => field.startsWith("schema."))).length
    },
    reviewLaneModelIds: {
      metadata: [],
      inventory: [...added, ...removed].sort(compareCodeUnits),
      taxonomy: changed.filter(change => change.changedFields.includes("kind")).map(change => change.modelId),
      routing: changed.filter(change => change.changedFields.includes("adapterId")).map(change => change.modelId),
      capabilities: changed.filter(change => change.changedFields.some(field => field.startsWith("schema."))).map(change => change.modelId)
    }
  };
  const changedFields = [...new Set(changed.flatMap(change => change.changedFields))].sort(compareCodeUnits);
  const changedFieldCounts = Object.fromEntries(changedFields.map(field => [
    field,
    changed.reduce((count, change) => count + (change.changedFields.includes(field) ? 1 : 0), 0)
  ]));
  const changedFieldModelIds = Object.fromEntries(changedFields.map(field => [
    field,
    changed.filter(change => change.changedFields.includes(field)).map(change => change.modelId)
  ]));
  const driftByKind = Object.fromEntries([...KINDS].map(kind => [kind, {
    added: added.filter(modelId => currentById.get(modelId).kind === kind).length,
    removed: removed.filter(modelId => previousById.get(modelId).kind === kind).length,
    changedBefore: changed.filter(change => change.before.kind === kind).length,
    changedAfter: changed.filter(change => change.after.kind === kind).length
  }]).filter(([, counts]) => Object.values(counts).some(Boolean)));
  const driftModelIdsByKind = Object.fromEntries(Object.keys(driftByKind).map(kind => [kind, {
    added: added.filter(modelId => currentById.get(modelId).kind === kind),
    removed: removed.filter(modelId => previousById.get(modelId).kind === kind),
    changedBefore: changed.filter(change => change.before.kind === kind).map(change => change.modelId),
    changedAfter: changed.filter(change => change.after.kind === kind).map(change => change.modelId)
  }]));
  const affectedAdapterIds = [...new Set([
    ...added.map(modelId => currentById.get(modelId).adapterId),
    ...removed.map(modelId => previousById.get(modelId).adapterId),
    ...changed.flatMap(change => [change.before.adapterId, change.after.adapterId])
  ])].sort(compareCodeUnits);
  const driftByAdapter = Object.fromEntries(affectedAdapterIds.map(adapterId => [adapterId, {
    added: added.filter(modelId => currentById.get(modelId).adapterId === adapterId).length,
    removed: removed.filter(modelId => previousById.get(modelId).adapterId === adapterId).length,
    changedBefore: changed.filter(change => change.before.adapterId === adapterId).length,
    changedAfter: changed.filter(change => change.after.adapterId === adapterId).length
  }]));
  const driftModelIdsByAdapter = Object.fromEntries(affectedAdapterIds.map(adapterId => [adapterId, {
    added: added.filter(modelId => currentById.get(modelId).adapterId === adapterId),
    removed: removed.filter(modelId => previousById.get(modelId).adapterId === adapterId),
    changedBefore: changed.filter(change => change.before.adapterId === adapterId).map(change => change.modelId),
    changedAfter: changed.filter(change => change.after.adapterId === adapterId).map(change => change.modelId)
  }]));
  const kindTransitions = Object.fromEntries(changed
    .filter(change => change.before.kind !== change.after.kind)
    .map(change => [`${change.before.kind}->${change.after.kind}`, change.modelId])
    .reduce((entries, [transition, modelId]) => {
      const existing = entries.find(([key]) => key === transition);
      if (existing) existing[1].push(modelId);
      else entries.push([transition, [modelId]]);
      return entries;
    }, []).sort(([left], [right]) => compareCodeUnits(left, right)));
  const adapterTransitions = Object.fromEntries(changed
    .filter(change => change.before.adapterId !== change.after.adapterId)
    .map(change => [`${change.before.adapterId}->${change.after.adapterId}`, change.modelId])
    .reduce((entries, [transition, modelId]) => {
      const existing = entries.find(([key]) => key === transition);
      if (existing) existing[1].push(modelId);
      else entries.push([transition, [modelId]]);
      return entries;
    }, []).sort(([left], [right]) => compareCodeUnits(left, right)));
  const kindTransitionCounts = Object.fromEntries(Object.entries(kindTransitions).map(([transition, modelIds]) => [transition, modelIds.length]));
  const adapterTransitionCounts = Object.fromEntries(Object.entries(adapterTransitions).map(([transition, modelIds]) => [transition, modelIds.length]));
  return deepFreeze({
    schemaVersion: 1,
    previousFingerprint: previous.fingerprint,
    currentFingerprint: current.fingerprint,
    previousSourceRevision: previous.sourceRevision,
    currentSourceRevision: current.sourceRevision,
    sourceRevisionChanged,
    executedProviderCalls: false,
    hasDrift,
    status: hasDrift ? "review_required" : "unchanged",
    failClosed: hasDrift,
    reviewReasons,
    reviewReasonCounts,
    reviewImpact,
    driftCounts: {
      sourceRevision: sourceRevisionChanged ? 1 : 0,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      affectedModels: affectedModelIds.length,
      changedFields: changedFields.length,
      affectedKinds: Object.keys(driftByKind).length,
      affectedAdapters: affectedAdapterIds.length,
      kindTransitions: Object.keys(kindTransitions).length,
      adapterTransitions: Object.keys(adapterTransitions).length
    },
    affectedModelIds,
    changedFields,
    changedFieldCounts,
    changedFieldModelIds,
    driftByKind,
    driftModelIdsByKind,
    affectedAdapterIds,
    driftByAdapter,
    driftModelIdsByAdapter,
    kindTransitions,
    adapterTransitions,
    kindTransitionCounts,
    adapterTransitionCounts,
    added,
    removed,
    changed
  });
}
