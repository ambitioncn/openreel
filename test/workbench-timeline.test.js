import test from "node:test";
import assert from "node:assert/strict";
import { workbenchTimeline, workbenchCostHint } from "../src/workbench-timeline.js";

test("simplified timeline preserves shot order and offsets", () => {
  assert.deepEqual(workbenchTimeline({ shots: [{ id: "a", duration: 8 }, { id: "b", duration: 12 }] }), [
    { id: "a", order: 1, start: 0, end: 8, duration: 8, redoRevision: 0 },
    { id: "b", order: 2, start: 8, end: 20, duration: 12, redoRevision: 0 }
  ]);
});

test("cost hint is deterministic, quality-sensitive, and preflight-only", () => {
  const board = { shots: [{ duration: 10 }, { duration: 20 }] };
  assert.deepEqual(workbenchCostHint(board, "fast"), { seconds: 30, estimatedCny: 0.54, currency: "CNY", preference: "fast", basis: "preflight estimate only; no paid inference was started" });
  assert.equal(workbenchCostHint(board, "quality").estimatedCny, 1.56);
  assert.throws(() => workbenchCostHint(board, "ultra"), TypeError);
});
