import test from "node:test";
import assert from "node:assert/strict";
import { modelControlView, selectedModelControls } from "../src/model-controls.js";

test("model controls expose known schema controls in catalog order", () => {
  assert.deepEqual(modelControlView({ controls: ["voice", "camera", "voice"] }), [
    { id: "voice", label: "Voice controls" },
    { id: "camera", label: "Camera controls" }
  ]);
});

test("model controls fail closed for malformed and unknown capabilities", () => {
  assert.deepEqual(modelControlView({ controls: ["unknown", null] }), []);
  assert.deepEqual(modelControlView({ controls: "voice" }), []);
  assert.deepEqual(selectedModelControls({ controls: ["voice"] }, ["voice", "camera", "voice"]), { voice: true });
});
