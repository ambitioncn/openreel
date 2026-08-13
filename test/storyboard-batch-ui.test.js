import test from "node:test";
import assert from "node:assert/strict";
import { activeStoryboardJob, retryableStoryboardJob, storyboardBatchView } from "../src/storyboard-batch-ui.js";

const batch = (state, states) => ({ state, cost: { amount: 0, currency: "CNY", unitScale: 1_000_000, basis: "local deterministic adapter; no paid provider call" }, jobs: states.map((jobState, storyboardOrder) => ({ id: `job-${storyboardOrder}`, storyboardOrder, state: jobState, prompt: `shot ${storyboardOrder + 1}` })) });

test("storyboard batch view exposes ordered progress and valid controls", () => {
  const running = batch("running", ["succeeded", "running", "queued"]), view = storyboardBatchView(running);
  assert.equal(view.summary, "running · 1/3 shots finished · cost CNY 0.0000 (local deterministic adapter; no paid provider call)");
  assert.deepEqual(view.jobs.map(job => job.order), [1, 2, 3]);
  assert.equal(view.canAdvance, true); assert.equal(view.canCancel, true); assert.equal(view.canRetry, false);
  assert.equal(activeStoryboardJob(running).id, "job-1");
});

test("failed storyboard batch offers only retry for the stopped shot", () => {
  const failed = batch("failed", ["succeeded", "canceled", "queued"]), view = storyboardBatchView(failed);
  assert.equal(view.canAdvance, false); assert.equal(view.canCancel, false); assert.equal(view.canRetry, true);
  assert.equal(retryableStoryboardJob(failed).id, "job-1");
});

test("completed and absent batches expose no controls", () => {
  const succeeded = storyboardBatchView(batch("succeeded", ["succeeded", "succeeded"]));
  assert.equal(succeeded.summary, "succeeded · 2/2 shots finished · cost CNY 0.0000 (local deterministic adapter; no paid provider call)");
  assert.equal(succeeded.canAdvance, false); assert.equal(succeeded.canCancel, false); assert.equal(succeeded.canRetry, false);
  assert.equal(storyboardBatchView(null).canAdvance, false);
});
