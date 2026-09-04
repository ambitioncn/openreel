import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/core.js";
import { createCommercialJobLifecycle } from "../src/commercial-job-lifecycle.js";
import { createCommercialQualityInspector } from "../src/commercial-quality-inspector.js";
import { requireCommercialRelease } from "../src/commercial-release-gate.js";
import { createWorkbenchCommercialService } from "../src/workbench-commercial.js";

const shotDimensions = ["intent", "beat", "composition", "visual_identity_consistency", "performance_naturalness"];
const finalDimensions = ["story", "pacing", "continuity"];
const mp4 = valid => valid ? Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(32)]) : Buffer.from("invalid");
const request = { binding: { projectId: "project" }, storyboard: [{ id: "shot", duration: 5 }], director: { shots: [{ shotId: "shot", roleEntityIds: ["role"], sceneEntityIds: ["scene"], style: "natural", referenceAssetIds: ["reference"] }] }, artifacts: [{ id: "video", kind: "video", shotId: "shot" }], render: { asset: { id: "render" } } };

function evaluation(input, scores = {}) {
  const score = dimension => scores[dimension] ?? 0.9;
  return { schema: "openreel-commercial-perceptual-evaluation/v2", provider: "deterministic-local", model: "zero-paid-matrix-v1", shotPolicy: { threshold: 0.8, dimensions: shotDimensions }, shots: input.media.map(item => ({ shotId: item.shotId, scores: Object.fromEntries(shotDimensions.map(dimension => [dimension, score(dimension)])), evidence: { assetId: item.assetId, sha256: item.sha256, observed: "deterministic local observation" } })), finalPolicy: { threshold: 0.8, dimensions: finalDimensions }, final: { scores: Object.fromEntries(finalDimensions.map(dimension => [dimension, score(dimension)])), evidence: { assetId: input.render.assetId, sha256: input.render.sha256, observed: "deterministic local observation" } }, usage: { currency: "CNY", costMicros: 0, unitScale: 1_000_000 } };
}

test("commercial eight-dimension zero-paid pass and rejection matrix", async () => {
  let paidProviderCalls = 0;
  const inspect = async ({ scores, validMedia = true, malformed = false } = {}) => createCommercialQualityInspector({ artifactReader: async () => ({ bytes: mp4(validMedia) }), perceptualEvaluator: async (_principal, input) => malformed ? { schema: "malformed" } : evaluation(input, scores) })({ accountId: "owner" }, request);
  const passed = await inspect();
  assert.equal(passed.releaseEligible, true);
  for (const [dimension, expected] of [["visual_identity_consistency", "visual_identity_consistency"], ["performance_naturalness", "performance_naturalness"]]) {
    const rejected = await inspect({ scores: { [dimension]: 0.79 } });
    assert.equal(rejected.releaseEligible, false); assert.deepEqual(rejected.shots[0].creativeFailures, [expected]);
  }
  assert.equal((await inspect({ validMedia: false })).releaseEligible, false, "technical media failure rejects");
  await assert.rejects(inspect({ malformed: true }), error => error.code === "COMMERCIAL_QUALITY_EVIDENCE_INVALID");

  const identity = { projectVersion: 1, storyVersion: 1, storyboardVersion: 1 }, candidate = { status: "succeeded", ownerId: "owner", input: { projectId: "project", ...identity }, result: { status: "qualified", qualificationStatus: "approved", releaseEligible: true, quality: passed } };
  assert.equal(requireCommercialRelease({ commercialJobs: { listOwned: () => [candidate] }, ownerId: "owner", projectId: "project", assetId: "render", assetSha256: passed.final.evidence.sha256, revisionIdentity: identity }).status, "succeeded");
  assert.throws(() => requireCommercialRelease({ commercialJobs: { listOwned: () => [{ ...candidate, input: { ...candidate.input, storyboardVersion: 0 } }] }, ownerId: "owner", projectId: "project", assetId: "render", assetSha256: passed.final.evidence.sha256, revisionIdentity: identity }), error => error.code === "COMMERCIAL_RELEASE_EVIDENCE_INVALID");

  const store = createMemoryStore(), project = store.createProject({ name: "Zero paid" }, "local-owner"), story = store.upsertStory(project.id, { scenes: [{ title: "One", summary: "Line" }] }, "local-owner"), storyboard = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Shot", duration: 5 }] }, "local-owner"), current = store.snapshot(project.id, "local-owner");
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { paidProviderCalls += 1; throw new Error("paid provider must not run before confirmation"); } } }), service = createWorkbenchCommercialService({ lifecycle, snapshot: (projectId, ownerId) => store.snapshot(projectId, ownerId), estimate: () => ({ estimatedCny: 2, models: { image: "image", video: "video" } }) }), principal = { accountId: "local-owner" };
  const quote = service.quote(principal, project.id, { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version });
  assert.throws(() => service.confirm(principal, project.id, { quoteId: quote.id, idempotencyKey: "unconfirmed" }), error => error.code === "COMMERCIAL_CONFIRMATION_REQUIRED");
  assert.equal(paidProviderCalls, 0);
});
