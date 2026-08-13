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
});
