import test from "node:test";
import assert from "node:assert/strict";
import { compareCapabilityBaseline, libtvAuthenticatedBaseline, referenceCapabilityCatalog } from "../src/capability-baseline.js";
import { createModelCatalog } from "../src/model-catalog.js";

const catalog = createModelCatalog([{ id: "image-local", kind: "image", adapterId: "local", schema: { modes: ["text-to-image"], controls: ["camera"], maxReferences: 4 } }]);

test("authenticated baseline comparison reports explicit count, mode, and control gaps", () => {
  const result = compareCapabilityBaseline(catalog, libtvAuthenticatedBaseline, { now: new Date("2026-08-08T00:00:00Z") });
  assert.equal(result.status, "gaps_detected");
  assert.equal(result.countGaps.image, 15);
  assert.equal(result.countGaps.video, 32);
  assert.ok(result.missingModes.includes("audio-to-video"));
  assert.ok(result.missingControls.includes("voice"));
  assert.equal(result.baseline.stale, false);
  assert.match(result.baseline.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.configured, {
    modelCount: 1,
    counts: { image: 1 },
    adapterIds: ["local"],
    adapterModelCounts: { local: 1 },
    modes: ["text-to-image"],
    modeModelCounts: { "text-to-image": 1 },
    modeModelIds: { "text-to-image": ["image-local"] },
    controls: ["camera"],
    controlModelCounts: { camera: 1 },
    controlModelIds: { camera: ["image-local"] }
  });
});

test("stale authenticated evidence fails closed instead of claiming coverage", () => {
  const covered = { ...libtvAuthenticatedBaseline, counts: { image: 1 }, requiredModes: ["text-to-image"], controls: ["camera"] };
  const result = compareCapabilityBaseline(catalog, covered, { now: new Date("2026-10-01T00:00:00Z") });
  assert.equal(result.status, "baseline_stale");
  assert.equal(result.baseline.stale, true);
});

test("malformed baselines and catalogs are rejected", () => {
  assert.throws(() => compareCapabilityBaseline({}, libtvAuthenticatedBaseline), /catalog/);
  assert.throws(() => compareCapabilityBaseline(catalog, { schemaVersion: 1 }), /baseline/);
  assert.throws(() => compareCapabilityBaseline(catalog, { ...libtvAuthenticatedBaseline, source: " " }), /source and evidence/);
  assert.throws(() => compareCapabilityBaseline(catalog, { ...libtvAuthenticatedBaseline, capturedAt: "2026-02-30" }), /capture and expiry/);
  assert.throws(() => compareCapabilityBaseline(catalog, { ...libtvAuthenticatedBaseline, capturedAt: "2026-13-01" }), /capture and expiry/);
  assert.throws(() => compareCapabilityBaseline(catalog, { ...libtvAuthenticatedBaseline, requiredModes: ["text-to-image", "text-to-image"] }), /unique non-empty/);
  assert.throws(() => compareCapabilityBaseline(catalog, { ...libtvAuthenticatedBaseline, controls: [""] }), /canonical non-empty/);
  assert.throws(() => compareCapabilityBaseline(catalog, { ...libtvAuthenticatedBaseline, controls: [" voice"] }), /canonical non-empty/);
  assert.throws(() => compareCapabilityBaseline(catalog, { ...libtvAuthenticatedBaseline, unexpected: true }), /unknown capability baseline field/);
  assert.throws(() => compareCapabilityBaseline(catalog, libtvAuthenticatedBaseline, { now: new Date("invalid") }), /comparison time/);
  assert.throws(() => compareCapabilityBaseline(catalog, libtvAuthenticatedBaseline, { now: new Date("2026-08-06T23:59:59Z") }), /precede/);
});

test("authenticated baseline comparison rejects forged or internally inconsistent catalogs", () => {
  assert.throws(() => compareCapabilityBaseline({ ...catalog, fingerprint: "0".repeat(64) }, libtvAuthenticatedBaseline), /integrity check failed/);
  assert.throws(() => compareCapabilityBaseline({ ...catalog, modelCount: catalog.modelCount + 1 }, libtvAuthenticatedBaseline), /integrity check failed/);
  assert.throws(() => compareCapabilityBaseline({ ...catalog, kinds: { image: 99 } }, libtvAuthenticatedBaseline), /integrity check failed/);
  assert.throws(() => compareCapabilityBaseline({ ...catalog, models: [{ ...catalog.models[0], schema: null }] }, libtvAuthenticatedBaseline), /integrity check failed/);
});

test("reference capability catalog represents the observed target without making it executable", () => {
  const result = referenceCapabilityCatalog(libtvAuthenticatedBaseline);
  assert.equal(result.executable, false);
  assert.deepEqual(result.counts, libtvAuthenticatedBaseline.counts);
  assert.deepEqual(result.modes, libtvAuthenticatedBaseline.requiredModes);
  assert.deepEqual(result.controls, libtvAuthenticatedBaseline.controls);
  assert.equal("models" in result, false);
  assert.equal("adapterId" in result, false);
});

test("reference capability catalog rejects invalid counts", () => {
  assert.throws(() => referenceCapabilityCatalog({ ...libtvAuthenticatedBaseline, counts: { image: -1 } }), /count/);
  assert.throws(() => referenceCapabilityCatalog({ ...libtvAuthenticatedBaseline, counts: { "": 1 } }), /count/);
  assert.throws(() => referenceCapabilityCatalog({ ...libtvAuthenticatedBaseline, evidence: "" }), /source and evidence/);
});

test("baseline outputs are deeply immutable and use a canonical fingerprint", () => {
  const result = compareCapabilityBaseline(catalog, libtvAuthenticatedBaseline, { now: new Date("2026-08-08T00:00:00Z") });
  const reordered = compareCapabilityBaseline(catalog, {
    ...libtvAuthenticatedBaseline,
    counts: Object.fromEntries(Object.entries(libtvAuthenticatedBaseline.counts).reverse()),
    requiredModes: [...libtvAuthenticatedBaseline.requiredModes].reverse(),
    controls: [...libtvAuthenticatedBaseline.controls].reverse()
  }, { now: new Date("2026-08-08T00:00:00Z") });
  const reference = referenceCapabilityCatalog(libtvAuthenticatedBaseline);
  assert.equal(reordered.baseline.fingerprint, result.baseline.fingerprint);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.baseline), true);
  assert.equal(Object.isFrozen(result.countGaps), true);
  assert.equal(Object.isFrozen(result.missingModes), true);
  assert.equal(Object.isFrozen(result.configured), true);
  assert.equal(Object.isFrozen(result.configured.controlModelIds.camera), true);
  assert.equal(Object.isFrozen(reference.counts), true);
  assert.equal(Object.isFrozen(reference.modes), true);
});

test("baseline fingerprints do not depend on host locale collation", () => {
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error("locale collation must not affect a baseline identity"); };
  try {
    const baseline = {
      ...libtvAuthenticatedBaseline,
      counts: { "äudio": 1, video: 1, image: 1 },
      requiredModes: ["text-to-video", "image-to-video"],
      controls: ["voice", "camera"]
    };
    const result = compareCapabilityBaseline(catalog, baseline, { now: new Date("2026-08-08T00:00:00Z") });
    const reordered = compareCapabilityBaseline(catalog, {
      ...baseline,
      counts: { image: 1, video: 1, "äudio": 1 },
      requiredModes: [...baseline.requiredModes].reverse(),
      controls: [...baseline.controls].reverse()
    }, { now: new Date("2026-08-08T00:00:00Z") });
    assert.equal(result.baseline.fingerprint, reordered.baseline.fingerprint);
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});
