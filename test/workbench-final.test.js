import test from "node:test";
import assert from "node:assert/strict";
import { finalPreview, publishingDraft } from "../src/workbench-final.js";

test("publishing copy uses the selected hook and remains bounded", () => {
  const draft = publishingDraft({ title: "咖啡技巧", hooks: ["A", "三步让咖啡更香"], selectedHook: 1, synopsis: "先预热杯子。\n再控制水温。" });
  assert.equal(draft.title, "咖啡技巧"); assert.match(draft.copy, /^三步让咖啡更香/); assert.ok(draft.copy.length <= 1000);
});

test("final preview selects only a rendered MP4 and fails closed without timeline clips", () => {
  const image = { id: "image", role: "render", mimeType: "image/png" }, video = { id: "video", role: "render", mimeType: "video/mp4" };
  assert.deepEqual(finalPreview({ assets: [image], timeline: { tracks: [] } }), { asset: null, canExport: false });
  assert.deepEqual(finalPreview({ assets: [image, video], timeline: { tracks: [{ clips: [{ id: "clip" }] }] } }), { asset: video, canExport: true });
});
