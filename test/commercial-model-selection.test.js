import test from "node:test";
import assert from "node:assert/strict";
import { commercialVideoModelForQuality, commercialVideoModels } from "../src/commercial-model-selection.js";

const catalog = [
  { name: "minimax-h3", capability: "video" },
  { name: "seedance-2-fast", capability: "video" },
  { name: "seedance-2", capability: "video" },
  { name: "seedream-5", capability: "image" }
];

test("commercial Seedance routing maps fast and quality independently", () => {
  const models = commercialVideoModels(catalog, {
    OPENREEL_COMMERCIAL_FAST_VIDEO_MODEL: "seedance-2-fast",
    OPENREEL_COMMERCIAL_QUALITY_VIDEO_MODEL: "seedance-2"
  });
  assert.deepEqual(models, { fast: "seedance-2-fast", quality: "seedance-2" });
  assert.equal(commercialVideoModelForQuality(models, "fast"), "seedance-2-fast");
  assert.equal(commercialVideoModelForQuality(models, "quality"), "seedance-2");
});

test("commercial routing preserves the legacy single-model fallback", () => {
  assert.deepEqual(commercialVideoModels(catalog, { OPENREEL_COMMERCIAL_VIDEO_MODEL: "minimax-h3" }), { fast: "minimax-h3", quality: "minimax-h3" });
});

test("commercial routing defaults to reviewed Seedance aliases and fails closed on bad configuration", () => {
  assert.deepEqual(commercialVideoModels(catalog, {}), { fast: "seedance-2-fast", quality: "seedance-2" });
  assert.throws(() => commercialVideoModels(catalog, { OPENREEL_COMMERCIAL_FAST_VIDEO_MODEL: "missing" }), error => error.code === "COMMERCIAL_MODEL_UNAVAILABLE");
  assert.throws(() => commercialVideoModelForQuality({ fast: "seedance-2-fast" }, "other"), error => error.code === "COMMERCIAL_MODEL_UNAVAILABLE");
});
