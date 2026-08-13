import test from "node:test";
import assert from "node:assert/strict";
import { createModelCatalog, validateProviderMappings } from "../src/model-catalog.js";

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
});

test("provider mapping validation is credential-free and detects semantic drift", () => {
  const valid = validateProviderMappings(createModelCatalog(models));
  assert.equal(valid.status, "valid");
  assert.equal(valid.executedProviderCalls, false);
  assert.equal(valid.catalogFingerprint, createModelCatalog(models).fingerprint);
  const invalid = validateProviderMappings(createModelCatalog([{ id: "bad", kind: "video", adapterId: "ark", schema: { modes: ["text-to-image", "text-to-image"], controls: ["camera", "camera"] } }]));
  assert.equal(invalid.status, "invalid");
  assert.deepEqual(new Set(invalid.issues.map(issue => issue.code)), new Set(["MODE_KIND_MISMATCH", "DUPLICATE_MODE", "DUPLICATE_CONTROL"]));
  assert.throws(() => validateProviderMappings({}), /catalog/);
});
