import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL_EXPORT_LIMITS, reviewedExportSelection, exportSuccessMessage } from "../src/export-ui.js";

test("local export selection requires review and fails closed", () => {
  assert.throws(() => reviewedExportSelection({ format: "mp4", quality: "preview-360p" }), /Review the timeline/);
  assert.throws(() => reviewedExportSelection({ reviewed: true, format: "webm", quality: "preview-360p" }), /only MP4/);
  assert.deepEqual(reviewedExportSelection({ reviewed: true, format: "mp4", quality: "preview-360p" }), { format: "mp4", quality: "preview-360p" });
  assert.deepEqual(LOCAL_EXPORT_LIMITS, { maxClips: 100, maxDuration: 600 });
});

test("local export result distinguishes render from deterministic replay", () => {
  const result = { format: "mp4", quality: "preview-360p", duration: 2, asset: { byteLength: 42 } };
  assert.match(exportSuccessMessage({ ...result, replayed: false }), /rendered mp4 preview-360p/);
  assert.match(exportSuccessMessage({ ...result, replayed: true }), /reused mp4 preview-360p/);
});
