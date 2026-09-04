import test from "node:test";
import assert from "node:assert/strict";
import { commercialJobView, planFailedShotRedo } from "../src/commercial-job-ux.js";

test("beginner view presents bounded progress and distinguishes estimated from settled cost", () => {
  const running = commercialJobView({ status: "running", stage: "videos", cost: { estimatedCny: 8.126, status: "reserved" } });
  assert.deepEqual(running.progress, { completed: 2, total: 6, percent: 33, terminal: false });
  assert.equal(running.cost.label, "预估 ¥8.13，尚未最终结算");
  const done = commercialJobView({ status: "succeeded", stage: "quality", cost: { estimatedCny: 8.13, status: "settled", settledCny: 7.8 } });
  assert.equal(done.progress.percent, 100);
  assert.equal(done.cost.label, "实际 ¥7.80");
});

test("failure copy is safe, actionable and never exposes provider diagnostics", () => {
  const view = commercialJobView({ status: "failed", retryable: true, error: { code: "COMMERCIAL_PROVIDER_FAILED", message: "secret upstream body" } });
  assert.equal(view.message, "云端生成暂时失败，请稍后重试失败的部分。");
  assert.equal(JSON.stringify(view).includes("secret upstream body"), false);
  assert.equal(view.actions.canRetry, true);
});

test("local redo preserves successful shots and starts no paid action", () => {
  const job = { id: "job-1", status: "failed", result: { shots: [{ id: "s1", status: "succeeded", assetIds: ["image-1", "video-1"] }, { id: "s2", status: "failed", quality: { creativeFailures: ["visual_identity_consistency", "performance_naturalness"], technicalFailures: [] } }] } };
  assert.deepEqual(planFailedShotRedo(job), { schema: "openreel-commercial-redo-plan/v1", sourceJobId: "job-1", shotIds: ["s2"], preservedShotIds: ["s1"], preservedAssets: [{ shotId: "s1", assetIds: ["image-1", "video-1"] }], reasons: { s2: ["visual_identity_consistency", "performance_naturalness"] }, paidActionStarted: false, confirmationRequired: true });
  assert.deepEqual(commercialJobView(job).actions.failedShotIds, ["s2"]);
  assert.throws(() => planFailedShotRedo({ ...job, status: "succeeded" }), error => error.code === "COMMERCIAL_REDO_INVALID");
  assert.throws(() => planFailedShotRedo({ ...job, result: { shots: [{ id: "s1", status: "succeeded" }, job.result.shots[1]] } }), error => error.code === "COMMERCIAL_REDO_INVALID");
});
