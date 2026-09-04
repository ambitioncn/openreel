import test from "node:test";
import assert from "node:assert/strict";
import { createCommercialMasterImageInspector } from "../src/commercial-master-image-inspector.js";

const model = { name: "vision", capability: "text", currency: "CNY", unitScale: 1_000_000, maxCostMicros: 200_000 };

test("master inspector binds master and reference bytes and rejects any dimension below threshold", async () => {
  let request;
  const arkService = { models: () => [model], submit: async (_principal, value) => { request = value; return { status: "succeeded", result: { content: JSON.stringify({ scores: { single_product: 1, geometry_handle: 0.4, color_material_texture: 0.9, environment_lighting: 0.9, no_text_panels_duplicates: 1 }, observed: "handle is detached" }) }, usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 100_000 } }; } };
  const inspect = createCommercialMasterImageInspector({ arkService, model: "vision", maximumCostCnyPerCall: 0.2 });
  const result = await inspect({ accountId: "owner" }, { evaluationRunId: "run", binding: { projectId: "p" }, master: { assetId: "m", mimeType: "image/png", bytes: Buffer.from("master") }, references: [{ assetId: "r", mimeType: "image/png", bytes: Buffer.from("reference") }], continuity: ["handle=right"] });
  assert.equal(result.accepted, false);
  assert.equal(result.scores.geometry_handle, 0.4);
  assert.notEqual(result.evidence.master.sha256, result.evidence.references[0].sha256);
  assert.match(request.input.messages[1].content[0].text, /handle count, shape, orientation and attachment/);
  assert.equal(request.maximumCostMicros, 200_000);
});
