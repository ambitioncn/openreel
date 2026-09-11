import test from "node:test";
import assert from "node:assert/strict";
import { prepareWorkflowShortcutApplication, workflowShortcutCatalog } from "../src/workflow-shortcuts.js";

test("authenticated image shortcuts map to versioned local review-only templates", () => {
  const first = workflowShortcutCatalog(), second = workflowShortcutCatalog();
  assert.equal(first.schema, "openreel-workflow-shortcut-catalog/v1");
  assert.equal(first.templates.length, 16);
  assert.equal(new Set(first.templates.map(item => item.id)).size, 16);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(first.templates.every(item => item.input.kind === "image-reference"));
  assert.ok(first.templates.every(item => item.plan[0].promptSource === "user"));
  assert.ok(first.templates.every(item => item.autoRun === false));
  assert.ok(first.templates.every(item => item.labelEn && !/[\u3400-\u9fff]/u.test(item.labelEn)));
  assert.ok(first.templates.some(item => item.id === "continuous_storyboard_grid_25" && item.output === "grid-25"));
  assert.ok(first.templates.some(item => item.id === "frame_prediction_minus_5s" && item.output === "minus-5s"));
});

test("shortcut applications preserve reviewed prompt and reference provenance without a run", () => {
  const prepared = prepareWorkflowShortcutApplication("character_setting_sheet", { prompt: " Keep the jacket ", referenceAssetIds: ["asset-1", "asset-1", "asset-2"], position: { x: 10, y: 20 } });
  const content = JSON.parse(prepared.content);
  assert.equal(prepared.type, "image");
  assert.equal(prepared.title, "角色设定图");
  assert.equal(content.prompt, "Keep the jacket");
  assert.deepEqual(content.referenceAssetIds, ["asset-1", "asset-2"]);
  assert.match(content.catalogFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(prepared.position, { x: 10, y: 20 });
  assert.throws(() => prepareWorkflowShortcutApplication("unknown", { prompt: "x", referenceAssetIds: ["asset-1"] }), error => error.code === "NOT_FOUND");
  assert.throws(() => prepareWorkflowShortcutApplication("character_setting_sheet", { prompt: "", referenceAssetIds: ["asset-1"] }), error => error.code === "INVALID_INPUT");
  assert.throws(() => prepareWorkflowShortcutApplication("character_setting_sheet", { prompt: "x", referenceAssetIds: [] }), error => error.code === "INVALID_INPUT");
});
