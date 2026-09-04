import test from "node:test";
import assert from "node:assert/strict";
import { compareModelCatalogs, createModelCatalog, validateProviderMappings } from "../src/model-catalog.js";

const models = [
  { id: "video-local", kind: "video", adapterId: "local", schema: { modes: ["text-to-video"], durations: [5], maxReferences: 2 } },
  { id: "image-local", kind: "image", adapterId: "local", schema: { modes: ["text-to-image"], maxReferences: 4 } }
];

test("model catalog is versioned, deterministic, sorted, and reports capability counts", () => {
  const first = createModelCatalog(models), reordered = createModelCatalog([...models].reverse());
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.sourceRevision, "openreel-model-catalog/v1");
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.fingerprint, reordered.fingerprint);
  assert.deepEqual(first.models.map(model => model.id), ["image-local", "video-local"]);
  assert.deepEqual(first.kinds, { image: 1, video: 1 });
});

test("model catalog fingerprint changes on schema drift", () => {
  const before = createModelCatalog(models), after = createModelCatalog(models.map(model => model.id === "video-local" ? { ...model, schema: { ...model.schema, durations: [5, 10] } } : model));
  assert.notEqual(before.fingerprint, after.fingerprint);
});

test("model catalog fails closed on duplicates and malformed schemas", () => {
  assert.throws(() => createModelCatalog([...models, models[0]]), /duplicate model id/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "video", adapterId: "local", schema: { durations: "5" } }]), /must be an array/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "unknown", adapterId: "local" }]), /required/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "image", adapterId: "local", schema: { maxReferences: -1 } }]), /non-negative integer/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "video", adapterId: "local", schema: [] }]), /schema must be an object/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "video", adapterId: "local", schema: { providerMagic: true } }]), /not supported/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "video", adapterId: "local", providerModel: "silent-drift", schema: {} }]), /field providerModel is not supported/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "video", adapterId: "local", schema: { durations: [0, Infinity] } }]), /positive finite numbers/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "video", adapterId: "local", schema: { durations: [5, 5] } }]), /must not contain duplicates/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "video", adapterId: "local", schema: { audio: "yes" } }]), /must be a boolean/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "image", adapterId: "local", schema: { aspects: ["16:9", ""] } }]), /non-empty strings/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "video", adapterId: "local", schema: { modes: ["text-to-video", " text-to-video "] } }]), /must not contain duplicates/);
  assert.throws(() => createModelCatalog([{ id: "bad", kind: "video", adapterId: "local", schema: { controls: ["camera", ""] } }]), /non-empty strings/);
  assert.throws(() => createModelCatalog(models, { sourceRevision: " " }), /sourceRevision/);
});

test("model catalog and mapping reports are deeply immutable", () => {
  const catalog = createModelCatalog(models);
  assert.throws(() => { catalog.kinds.video = 99; }, TypeError);
  assert.throws(() => { catalog.models.push({}); }, TypeError);
  assert.throws(() => { catalog.models[0].schema.modes.push("image-to-image"); }, TypeError);

  const report = validateProviderMappings(catalog);
  assert.throws(() => { report.mappings[0].modes.push("image-to-video"); }, TypeError);
  assert.throws(() => { report.issues.push({ code: "INJECTED" }); }, TypeError);
});

test("model catalog normalizes string capability values before fingerprinting", () => {
  const plain = createModelCatalog(models);
  const padded = createModelCatalog(models.map(model => ({
    ...model,
    schema: Object.fromEntries(Object.entries(model.schema).map(([key, value]) => [
      key,
      Array.isArray(value) && value.every(item => typeof item === "string") ? value.map(item => ` ${item} `) : value
    ]))
  })));
  assert.deepEqual(padded.models, plain.models);
  assert.equal(padded.fingerprint, plain.fingerprint);
});

test("model catalog normalizes the source revision before fingerprinting", () => {
  const plain = createModelCatalog(models, { sourceRevision: "catalog/v2" });
  const padded = createModelCatalog(models, { sourceRevision: "  catalog/v2  " });
  assert.equal(padded.sourceRevision, "catalog/v2");
  assert.equal(padded.fingerprint, plain.fingerprint);
});

test("model catalog identity does not depend on host locale collation", () => {
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error("locale collation must not affect model catalog identity"); };
  try {
    const localizedModels = [
      { id: "äudio-local", kind: "audio", adapterId: "local", schema: { modes: ["text-to-audio"] } },
      ...models
    ];
    const first = createModelCatalog(localizedModels, { sourceRevision: "catalog/locale-independent" });
    const reordered = createModelCatalog([...localizedModels].reverse(), { sourceRevision: "catalog/locale-independent" });
    assert.equal(first.fingerprint, reordered.fingerprint);
    assert.deepEqual(first.models.map(model => model.id), ["image-local", "video-local", "äudio-local"]);
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test("provider mapping validation is credential-free and detects semantic drift", () => {
  const valid = validateProviderMappings(createModelCatalog(models));
  assert.equal(valid.status, "valid");
  assert.equal(valid.executedProviderCalls, false);
  assert.equal(valid.catalogFingerprint, createModelCatalog(models).fingerprint);
  const invalid = validateProviderMappings(createModelCatalog([{ id: "bad", kind: "video", adapterId: "ark", schema: { modes: ["text-to-image"], controls: ["camera"] } }]));
  assert.equal(invalid.status, "invalid");
  assert.deepEqual(invalid.issues.map(issue => issue.code), ["MODE_KIND_MISMATCH"]);
  assert.throws(() => validateProviderMappings({}), /catalog/);
});

test("provider mapping validation rejects forged or internally inconsistent catalogs", () => {
  const catalog = createModelCatalog(models);
  assert.throws(() => validateProviderMappings({ ...catalog, fingerprint: "0".repeat(64) }), /integrity check failed/);
  assert.throws(() => validateProviderMappings({ ...catalog, modelCount: catalog.modelCount + 1 }), /integrity check failed/);
  assert.throws(() => validateProviderMappings({ ...catalog, kinds: { video: 99 } }), /integrity check failed/);
  assert.throws(() => validateProviderMappings({ ...catalog, models: [...catalog.models, { ...catalog.models[0] }] }), /duplicate model id/);
});

test("catalog drift is observable and fails closed without provider calls", () => {
  const previous = createModelCatalog(models, { sourceRevision: "catalog/previous" });
  const current = createModelCatalog([
    { ...models[0], schema: { ...models[0].schema, durations: [5, 10] } },
    { id: "audio-local", kind: "audio", adapterId: "local", schema: { modes: ["text-to-audio"] } }
  ], { sourceRevision: "catalog/current" });
  const report = compareModelCatalogs(previous, current);
  assert.equal(report.status, "review_required");
  assert.equal(report.failClosed, true);
  assert.equal(report.executedProviderCalls, false);
  assert.deepEqual(report.reviewReasons, ["source_revision_changed", "models_added", "models_removed", "models_changed"]);
  assert.deepEqual(report.reviewReasonCounts, { source_revision_changed: 1, models_added: 1, models_removed: 1, models_changed: 1 });
  assert.deepEqual(report.reviewImpact, {
    metadataChanged: true,
    modelSetChanged: true,
    modelStructureChanged: true,
    affectedModelCount: 3,
    reviewLanes: { metadata: true, inventory: true, taxonomy: false, routing: false, capabilities: true },
    reviewLaneCounts: { metadata: 1, inventory: 2, taxonomy: 0, routing: 0, capabilities: 1 },
    reviewLaneModelIds: { metadata: [], inventory: ["audio-local", "image-local"], taxonomy: [], routing: [], capabilities: ["video-local"] }
  });
  assert.deepEqual(report.added, ["audio-local"]);
  assert.deepEqual(report.removed, ["image-local"]);
  assert.deepEqual(report.changed.map(change => change.modelId), ["video-local"]);
  assert.deepEqual(report.changed[0].changedFields, ["schema.durations"]);
  assert.deepEqual(report.driftCounts, { sourceRevision: 1, added: 1, removed: 1, changed: 1, affectedModels: 3, changedFields: 1, affectedKinds: 3, affectedAdapters: 1, kindTransitions: 0, adapterTransitions: 0 });
  assert.deepEqual(report.affectedModelIds, ["audio-local", "image-local", "video-local"]);
  assert.deepEqual(report.changedFields, ["schema.durations"]);
  assert.deepEqual(report.changedFieldCounts, { "schema.durations": 1 });
  assert.deepEqual(report.changedFieldModelIds, { "schema.durations": ["video-local"] });
  assert.deepEqual(report.driftByKind, {
    image: { added: 0, removed: 1, changedBefore: 0, changedAfter: 0 },
    video: { added: 0, removed: 0, changedBefore: 1, changedAfter: 1 },
    audio: { added: 1, removed: 0, changedBefore: 0, changedAfter: 0 }
  });
  assert.deepEqual(report.driftModelIdsByKind, {
    image: { added: [], removed: ["image-local"], changedBefore: [], changedAfter: [] },
    video: { added: [], removed: [], changedBefore: ["video-local"], changedAfter: ["video-local"] },
    audio: { added: ["audio-local"], removed: [], changedBefore: [], changedAfter: [] }
  });
  assert.deepEqual(report.affectedAdapterIds, ["local"]);
  assert.deepEqual(report.driftByAdapter, {
    local: { added: 1, removed: 1, changedBefore: 1, changedAfter: 1 }
  });
  assert.deepEqual(report.driftModelIdsByAdapter, {
    local: { added: ["audio-local"], removed: ["image-local"], changedBefore: ["video-local"], changedAfter: ["video-local"] }
  });
  assert.deepEqual(report.kindTransitions, {});
  assert.deepEqual(report.adapterTransitions, {});
  assert.deepEqual(report.kindTransitionCounts, {});
  assert.deepEqual(report.adapterTransitionCounts, {});
  assert.throws(() => { report.changed[0].after.schema.durations.push(20); }, TypeError);
  assert.throws(() => { report.changed[0].changedFields.push("adapterId"); }, TypeError);
  assert.throws(() => { report.affectedModelIds.push("forged"); }, TypeError);
  assert.throws(() => { report.driftCounts.changed = 99; }, TypeError);
  assert.throws(() => { report.changedFieldCounts["schema.durations"] = 99; }, TypeError);
  assert.throws(() => { report.changedFieldModelIds["schema.durations"].push("forged"); }, TypeError);
  assert.throws(() => { report.driftByKind.video.changedAfter = 99; }, TypeError);
  assert.throws(() => { report.driftModelIdsByKind.video.changedAfter.push("forged"); }, TypeError);
  assert.throws(() => { report.affectedAdapterIds.push("forged"); }, TypeError);
  assert.throws(() => { report.driftByAdapter.local.changedAfter = 99; }, TypeError);
  assert.throws(() => { report.driftModelIdsByAdapter.local.added.push("forged"); }, TypeError);
  assert.throws(() => { report.reviewImpact.affectedModelCount = 99; }, TypeError);
  assert.throws(() => { report.reviewImpact.reviewLanes.routing = true; }, TypeError);
  assert.throws(() => { report.reviewImpact.reviewLaneCounts.inventory = 99; }, TypeError);
  assert.throws(() => { report.reviewImpact.reviewLaneModelIds.inventory.push("forged"); }, TypeError);
});

test("catalog drift identifies adapter, kind, and canonical schema fields", () => {
  const previous = createModelCatalog([
    { id: "media", kind: "image", adapterId: "local", schema: { modes: ["text-to-image"], aspects: ["1:1"], controls: ["seed"] } }
  ]);
  const current = createModelCatalog([
    { id: "media", kind: "video", adapterId: "ark", schema: { modes: ["text-to-video"], durations: [5], controls: ["camera"] } }
  ]);
  const report = compareModelCatalogs(previous, current);
  assert.deepEqual(report.changed[0].changedFields, [
    "kind",
    "adapterId",
    "schema.aspects",
    "schema.controls",
    "schema.durations",
    "schema.modes"
  ]);
  assert.equal(report.status, "review_required");
  assert.equal(report.failClosed, true);
  assert.equal(report.executedProviderCalls, false);
  assert.deepEqual(report.reviewReasons, ["models_changed"]);
  assert.deepEqual(report.reviewReasonCounts, { models_changed: 1 });
  assert.deepEqual(report.reviewImpact, {
    metadataChanged: false,
    modelSetChanged: false,
    modelStructureChanged: true,
    affectedModelCount: 1,
    reviewLanes: { metadata: false, inventory: false, taxonomy: true, routing: true, capabilities: true },
    reviewLaneCounts: { metadata: 0, inventory: 0, taxonomy: 1, routing: 1, capabilities: 1 },
    reviewLaneModelIds: { metadata: [], inventory: [], taxonomy: ["media"], routing: ["media"], capabilities: ["media"] }
  });
  assert.deepEqual(report.driftCounts, { sourceRevision: 0, added: 0, removed: 0, changed: 1, affectedModels: 1, changedFields: 6, affectedKinds: 2, affectedAdapters: 2, kindTransitions: 1, adapterTransitions: 1 });
  assert.deepEqual(report.affectedModelIds, ["media"]);
  assert.deepEqual(report.changedFields, ["adapterId", "kind", "schema.aspects", "schema.controls", "schema.durations", "schema.modes"]);
  assert.deepEqual(report.changedFieldCounts, {
    adapterId: 1,
    kind: 1,
    "schema.aspects": 1,
    "schema.controls": 1,
    "schema.durations": 1,
    "schema.modes": 1
  });
  assert.deepEqual(report.changedFieldModelIds, {
    adapterId: ["media"],
    kind: ["media"],
    "schema.aspects": ["media"],
    "schema.controls": ["media"],
    "schema.durations": ["media"],
    "schema.modes": ["media"]
  });
  assert.deepEqual(report.driftByKind, {
    image: { added: 0, removed: 0, changedBefore: 1, changedAfter: 0 },
    video: { added: 0, removed: 0, changedBefore: 0, changedAfter: 1 }
  });
  assert.deepEqual(report.driftModelIdsByKind, {
    image: { added: [], removed: [], changedBefore: ["media"], changedAfter: [] },
    video: { added: [], removed: [], changedBefore: [], changedAfter: ["media"] }
  });
  assert.deepEqual(report.affectedAdapterIds, ["ark", "local"]);
  assert.deepEqual(report.driftByAdapter, {
    ark: { added: 0, removed: 0, changedBefore: 0, changedAfter: 1 },
    local: { added: 0, removed: 0, changedBefore: 1, changedAfter: 0 }
  });
  assert.deepEqual(report.driftModelIdsByAdapter, {
    ark: { added: [], removed: [], changedBefore: [], changedAfter: ["media"] },
    local: { added: [], removed: [], changedBefore: ["media"], changedAfter: [] }
  });
  assert.deepEqual(report.kindTransitions, { "image->video": ["media"] });
  assert.deepEqual(report.adapterTransitions, { "local->ark": ["media"] });
  assert.deepEqual(report.kindTransitionCounts, { "image->video": 1 });
  assert.deepEqual(report.adapterTransitionCounts, { "local->ark": 1 });
  assert.throws(() => { report.kindTransitions["image->video"].push("forged"); }, TypeError);
  assert.throws(() => { report.adapterTransitions["local->ark"].push("forged"); }, TypeError);
});

test("catalog drift reports unchanged only for identical verified catalogs", () => {
  const catalog = createModelCatalog(models);
  const report = compareModelCatalogs(catalog, catalog);
  assert.equal(report.status, "unchanged");
  assert.equal(report.hasDrift, false);
  assert.equal(report.failClosed, false);
  assert.deepEqual(report.reviewReasons, []);
  assert.deepEqual(report.reviewReasonCounts, {});
  assert.deepEqual(report.reviewImpact, {
    metadataChanged: false,
    modelSetChanged: false,
    modelStructureChanged: false,
    affectedModelCount: 0,
    reviewLanes: { metadata: false, inventory: false, taxonomy: false, routing: false, capabilities: false },
    reviewLaneCounts: { metadata: 0, inventory: 0, taxonomy: 0, routing: 0, capabilities: 0 },
    reviewLaneModelIds: { metadata: [], inventory: [], taxonomy: [], routing: [], capabilities: [] }
  });
  assert.equal(report.sourceRevisionChanged, false);
  assert.deepEqual(report.added, []);
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.changed, []);
  assert.deepEqual(report.driftCounts, { sourceRevision: 0, added: 0, removed: 0, changed: 0, affectedModels: 0, changedFields: 0, affectedKinds: 0, affectedAdapters: 0, kindTransitions: 0, adapterTransitions: 0 });
  assert.deepEqual(report.affectedModelIds, []);
  assert.deepEqual(report.changedFields, []);
  assert.deepEqual(report.changedFieldCounts, {});
  assert.deepEqual(report.changedFieldModelIds, {});
  assert.deepEqual(report.driftByKind, {});
  assert.deepEqual(report.driftModelIdsByKind, {});
  assert.deepEqual(report.affectedAdapterIds, []);
  assert.deepEqual(report.driftByAdapter, {});
  assert.deepEqual(report.driftModelIdsByAdapter, {});
  assert.deepEqual(report.kindTransitions, {});
  assert.deepEqual(report.adapterTransitions, {});
  assert.throws(() => compareModelCatalogs({ ...catalog, fingerprint: "0".repeat(64) }, catalog), /integrity check failed/);
});

test("catalog source revision drift is observable and fails closed even when models are unchanged", () => {
  const previous = createModelCatalog(models, { sourceRevision: "catalog/revision-1" });
  const current = createModelCatalog(models, { sourceRevision: "catalog/revision-2" });
  const report = compareModelCatalogs(previous, current);
  assert.equal(report.status, "review_required");
  assert.equal(report.hasDrift, true);
  assert.equal(report.failClosed, true);
  assert.equal(report.sourceRevisionChanged, true);
  assert.deepEqual(report.reviewReasons, ["source_revision_changed"]);
  assert.deepEqual(report.reviewReasonCounts, { source_revision_changed: 1 });
  assert.deepEqual(report.reviewImpact, {
    metadataChanged: true,
    modelSetChanged: false,
    modelStructureChanged: false,
    affectedModelCount: 0,
    reviewLanes: { metadata: true, inventory: false, taxonomy: false, routing: false, capabilities: false },
    reviewLaneCounts: { metadata: 1, inventory: 0, taxonomy: 0, routing: 0, capabilities: 0 },
    reviewLaneModelIds: { metadata: [], inventory: [], taxonomy: [], routing: [], capabilities: [] }
  });
  assert.equal(report.previousSourceRevision, "catalog/revision-1");
  assert.equal(report.currentSourceRevision, "catalog/revision-2");
  assert.deepEqual(report.added, []);
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.changed, []);
  assert.deepEqual(report.driftCounts, { sourceRevision: 1, added: 0, removed: 0, changed: 0, affectedModels: 0, changedFields: 0, affectedKinds: 0, affectedAdapters: 0, kindTransitions: 0, adapterTransitions: 0 });
  assert.deepEqual(report.affectedModelIds, []);
  assert.deepEqual(report.changedFields, []);
  assert.deepEqual(report.changedFieldCounts, {});
  assert.deepEqual(report.changedFieldModelIds, {});
  assert.deepEqual(report.driftByKind, {});
  assert.deepEqual(report.driftModelIdsByKind, {});
  assert.deepEqual(report.affectedAdapterIds, []);
  assert.deepEqual(report.driftByAdapter, {});
  assert.deepEqual(report.driftModelIdsByAdapter, {});
  assert.deepEqual(report.kindTransitions, {});
  assert.deepEqual(report.adapterTransitions, {});
  assert.throws(() => { report.currentSourceRevision = "forged"; }, TypeError);
});

test("catalog drift counts repeated field changes across models deterministically", () => {
  const previous = createModelCatalog([
    { id: "a", kind: "video", adapterId: "local", schema: { durations: [5], controls: ["seed"] } },
    { id: "b", kind: "video", adapterId: "local", schema: { durations: [5], controls: ["seed"] } }
  ]);
  const current = createModelCatalog([
    { id: "a", kind: "video", adapterId: "ark", schema: { durations: [10], controls: ["seed"] } },
    { id: "b", kind: "video", adapterId: "local", schema: { durations: [10], controls: ["camera"] } }
  ]);
  const report = compareModelCatalogs(previous, current);
  assert.deepEqual(report.changedFields, ["adapterId", "schema.controls", "schema.durations"]);
  assert.deepEqual(report.changedFieldCounts, {
    adapterId: 1,
    "schema.controls": 1,
    "schema.durations": 2
  });
  assert.deepEqual(report.changedFieldModelIds, {
    adapterId: ["a"],
    "schema.controls": ["b"],
    "schema.durations": ["a", "b"]
  });
  assert.equal(report.driftCounts.changedFields, 3);
  assert.deepEqual(report.kindTransitions, {});
  assert.deepEqual(report.adapterTransitions, { "local->ark": ["a"] });
  assert.equal(report.status, "review_required");
});

test("catalog drift groups repeated transitions deterministically", () => {
  const previous = createModelCatalog([
    { id: "b", kind: "image", adapterId: "local", schema: {} },
    { id: "a", kind: "image", adapterId: "local", schema: {} }
  ]);
  const current = createModelCatalog([
    { id: "a", kind: "video", adapterId: "ark", schema: {} },
    { id: "b", kind: "video", adapterId: "ark", schema: {} }
  ]);
  const report = compareModelCatalogs(previous, current);
  assert.deepEqual(report.kindTransitions, { "image->video": ["a", "b"] });
  assert.deepEqual(report.adapterTransitions, { "local->ark": ["a", "b"] });
  assert.deepEqual(report.kindTransitionCounts, { "image->video": 2 });
  assert.deepEqual(report.adapterTransitionCounts, { "local->ark": 2 });
  assert.deepEqual(report.reviewReasons, ["models_changed"]);
  assert.deepEqual(report.reviewReasonCounts, { models_changed: 2 });
  assert.equal(report.driftCounts.kindTransitions, 1);
  assert.equal(report.driftCounts.adapterTransitions, 1);
  assert.throws(() => { report.kindTransitionCounts["image->video"] = 99; }, TypeError);
  assert.throws(() => { report.reviewReasons.push("forged"); }, TypeError);
  assert.throws(() => { report.reviewReasonCounts.models_changed = 99; }, TypeError);
  assert.equal(report.executedProviderCalls, false);
  assert.equal(report.failClosed, true);
});
