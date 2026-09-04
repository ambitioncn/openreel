import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenReelServer } from "../server.mjs";
import { createCommercialJobLifecycle, createFileCommercialJobStore } from "../src/commercial-job-lifecycle.js";

const principal = { accountId: "local-owner" };
const dimensions = ["intent", "beat", "composition", "visual_identity_consistency", "performance_naturalness"];
const finalDimensions = ["story", "pacing", "continuity"];

async function listen(lifecycle) {
  const server = createOpenReelServer(undefined, undefined, { commercialLifecycle: lifecycle, commercialEstimate: () => ({}) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("commercial v2 quality evidence survives restart and stays bound to the API project", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-commercial-http-")), "jobs.json");
  const quality = {
    schema: "openreel-commercial-quality-result/v2", accepted: false, releaseEligible: false,
    evaluation: { provider: "fixture", model: "free-fixture-v2", usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 0 }, maximum: { currency: "CNY", maximumCostCny: 0.2, maximumCostCnyPerCall: 0.1, calls: 2 } },
    shots: [{ shotId: "shot-1", accepted: false, qualificationStatus: "rejected", creativePolicy: { threshold: 0.8, dimensions }, creativeFailures: ["visual_identity_consistency"], technicalFailures: [], evidence: { assetId: "video-1", sha256: "a".repeat(64), byteLength: 32 } }],
    final: { accepted: false, releaseEligible: false, qualificationStatus: "rejected", directorPolicy: { threshold: 0.8, dimensions: finalDimensions }, directorFailures: [], technicalFailures: [], evidence: { assetId: "render-1", sha256: "b".repeat(64), byteLength: 64 } }
  };
  const first = createCommercialJobLifecycle({ store: createFileCommercialJobStore(file), id: () => "job-http-v2", orchestrator: { run: async () => ({ status: "quality_failed", generationStatus: "succeeded", qualificationStatus: "rejected", releaseEligible: false, quality, cost: { currency: "CNY", status: "settled", settledCny: 1.25, generationSettledCny: 1.25, evaluationSettledCny: 0 }, shots: [{ id: "shot-1", status: "failed", assetIds: ["image-1", "video-1"] }] }) } });
  const created = first.create(principal, { projectId: "project-1", projectVersion: 2, storyVersion: 3, storyboardVersion: 4, idempotencyKey: "commercial-http-v2", estimatedCostCny: 2, quoteCost: { generationEstimatedCny: 1.8, evaluationEstimatedCny: 0.2, evaluation: { schema: "openreel-commercial-perceptual-evaluation/v2", shotDimensions: dimensions, finalDimensions, calls: 2, necessity: "actual generated shot bytes and final render bytes must be evaluated" } } });
  await first.execute(principal, created.id);

  const restored = createCommercialJobLifecycle({ store: createFileCommercialJobStore(file), orchestrator: { run: async () => { throw new Error("terminal job must not replay"); } } });
  const running = await listen(restored);
  try {
    const response = await fetch(`${running.base}/api/v1/projects/project-1/commercial/jobs/${created.id}`);
    assert.equal(response.status, 200);
    const job = await response.json();
    assert.deepEqual(job.result.quality, quality);
    assert.deepEqual(job.cost, { currency: "CNY", status: "settled", estimatedCny: 2, generationEstimatedCny: 1.8, evaluationEstimatedCny: 0.2, evaluation: job.cost.evaluation, settledCny: 1.25, generationSettledCny: 1.25, evaluationSettledCny: 0 });
    assert.equal(job.result.generationStatus, "succeeded");
    assert.equal(job.result.qualificationStatus, "rejected");
    assert.equal(job.result.releaseEligible, false);

    const wrongProject = await fetch(`${running.base}/api/v1/projects/project-2/commercial/jobs/${created.id}`);
    assert.equal(wrongProject.status, 404);
    assert.equal((await wrongProject.json()).error.code, "COMMERCIAL_JOB_NOT_FOUND");
  } finally {
    await new Promise(resolve => running.server.close(resolve));
  }
});
