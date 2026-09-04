import test from "node:test";
import assert from "node:assert/strict";
import { routeWorkbenchModels, workbenchRouteSummary } from "../src/workbench-model-router.js";

const models = [
  { id: "local-image", kind: "image", adapterId: "local-deterministic" },
  { id: "seedream-5-pro", kind: "image", adapterId: "ark" },
  { id: "seedance-2-fast", kind: "video", adapterId: "ark" },
  { id: "seedance-2-pro", kind: "video", adapterId: "ark" },
  { id: "local-audio", kind: "audio", adapterId: "local-deterministic" }
];

test("beginner router selects deterministic fast and quality routes", () => {
  const fast = routeWorkbenchModels(models, "fast"), quality = routeWorkbenchModels(models, "quality");
  assert.equal(fast.routes.image.id, "local-image");
  assert.equal(fast.routes.video.id, "seedance-2-fast");
  assert.equal(quality.routes.image.id, "seedream-5-pro");
  assert.equal(quality.routes.video.id, "seedance-2-pro");
  assert.equal(quality.routes.audio.id, "local-audio");
});

test("beginner router fails closed for missing capabilities", () => {
  const route = routeWorkbenchModels([], "fast");
  assert.deepEqual(route.routes, { image: null, video: null, audio: null });
  assert.match(workbenchRouteSummary(route), /0\/3/);
  assert.throws(() => routeWorkbenchModels(models, "unknown"), /fast or quality/);
});
