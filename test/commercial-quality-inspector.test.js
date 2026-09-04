import test from "node:test";
import assert from "node:assert/strict";
import { createCommercialQualityInspector } from "../src/commercial-quality-inspector.js";

const mp4 = () => Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(32)]);
const request = { binding: { projectId: "p1" }, storyboard: [{ id: "s1", duration: 5 }], director: { shots: [{ shotId: "s1", roleEntityIds: ["role"], sceneEntityIds: ["scene"], style: "warm", referenceAssetIds: ["ref"] }] }, artifacts: [{ id: "video-1", kind: "video", shotId: "s1" }], render: { asset: { id: "render-1" } } };
const evaluator = ({ score = 0.9, identityScore = score, performanceScore = score, observed = null } = {}) => async (_principal, input) => ({ schema: "openreel-commercial-perceptual-evaluation/v2", provider: "fixture", model: "free-fixture-v2", shotPolicy: { threshold: 0.8, dimensions: ["intent", "beat", "composition", "visual_identity_consistency", "performance_naturalness"] }, shots: input.media.map(item => ({ shotId: item.shotId, scores: { intent: score, beat: score, composition: score, visual_identity_consistency: identityScore, performance_naturalness: performanceScore }, evidence: { assetId: item.assetId, sha256: item.sha256, observed: observed || "fixture shot observation" } })), finalPolicy: { threshold: 0.8, dimensions: ["story", "pacing", "continuity"] }, final: { scores: { story: score, pacing: score, continuity: score }, evidence: { assetId: input.render.assetId, sha256: input.render.sha256, observed: observed || "fixture final observation" } }, usage: { currency: "CNY", costMicros: 0, unitScale: 1_000_000 } });

test("quality inspector records byte-backed shot and final evidence", async () => {
  const inspector = createCommercialQualityInspector({ artifactReader: async (_principal, _projectId, assetId) => ({ bytes: mp4(), assetId }), perceptualEvaluator: evaluator() });
  const result = await inspector({ accountId: "owner" }, request);
  assert.equal(result.accepted, true); assert.equal(result.releaseEligible, true);
  assert.match(result.shots[0].evidence.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.final.evidence.assetId, "render-1");
});

test("quality inspector preserves a 1620-character perceptual observation through every dimension", async () => {
  const observed = "visible continuity evidence ".repeat(63).slice(0, 1_620);
  const inspector = createCommercialQualityInspector({ artifactReader: async (_principal, _projectId, assetId) => ({ bytes: mp4(), assetId }), perceptualEvaluator: evaluator({ observed }) });
  const result = await inspector({ accountId: "owner" }, request);
  assert.equal(result.releaseEligible, true);
  assert.ok(result.shots[0].creativeChecks.every(check => check.evidence.observed === observed));
  assert.ok(result.final.directorChecks.every(check => check.evidence.observed === observed));
});

test("quality inspector reads the shot binding from a retained production asset manifest", async () => {
  const productionRequest = { ...request, artifacts: [{ id: "video-1", kind: "video", metadata: { shotId: "s1" } }] };
  const reads = [];
  const inspector = createCommercialQualityInspector({ artifactReader: async (_principal, _projectId, assetId) => { reads.push(assetId); return { bytes: mp4(), assetId }; }, perceptualEvaluator: evaluator() });
  const result = await inspector({ accountId: "owner" }, productionRequest);
  assert.equal(result.releaseEligible, true);
  assert.deepEqual(reads, ["video-1", "render-1"]);
  assert.equal(result.shots[0].evidence.assetId, "video-1");
});

test("quality inspector fails closed for missing or invalid media", async () => {
  const inspector = createCommercialQualityInspector({ artifactReader: async () => ({ bytes: Buffer.from("not-video") }), perceptualEvaluator: evaluator() });
  const result = await inspector({ accountId: "owner" }, request);
  assert.equal(result.accepted, false); assert.equal(result.releaseEligible, false);
  assert.equal(result.shots[0].checks.playableMp4, false); assert.equal(result.final.accepted, false);
});

test("quality inspector rejects technically valid media when perceptual director score fails", async () => {
  const inspector = createCommercialQualityInspector({ artifactReader: async (_principal, _projectId, assetId) => ({ bytes: mp4(), assetId }), perceptualEvaluator: evaluator({ score: 0.79 }) });
  const result = await inspector({ accountId: "owner" }, request);
  assert.equal(result.accepted, false); assert.equal(result.shots[0].qualificationStatus, "rejected"); assert.deepEqual(result.shots[0].creativeFailures, ["intent", "beat", "composition", "visual_identity_consistency", "performance_naturalness"]); assert.equal(result.final.releaseEligible, false);
});

test("quality inspector fails closed on explicit identity or performance perception", async () => {
  for (const [dimension, scores] of [["visual_identity_consistency", { identityScore: 0.79 }], ["performance_naturalness", { performanceScore: 0.79 }]]) {
    const inspector = createCommercialQualityInspector({ artifactReader: async (_principal, _projectId, assetId) => ({ bytes: mp4(), assetId }), perceptualEvaluator: evaluator(scores) });
    const result = await inspector({ accountId: "owner" }, request);
    assert.equal(result.releaseEligible, false);
    assert.deepEqual(result.shots[0].creativeFailures, [dimension]);
    assert.equal(result.final.releaseEligible, false);
  }
});

test("quality inspector requires an explicit perceptual evaluator", () => {
  assert.throws(() => createCommercialQualityInspector({ artifactReader: async () => ({ bytes: mp4() }) }), error => error.code === "COMMERCIAL_QUALITY_UNAVAILABLE");
});

test("quality inspector rejects malformed perceptual evidence", async () => {
  const inspector = createCommercialQualityInspector({ artifactReader: async () => ({ bytes: mp4() }), perceptualEvaluator: async () => ({ schema: "wrong" }) });
  await assert.rejects(inspector({ accountId: "owner" }, request), error => error.code === "COMMERCIAL_QUALITY_EVIDENCE_INVALID");
});

test("quality inspector rejects missing, extra, legacy, or byte-unbound eight-dimension evidence", async () => {
  const valid = evaluator();
  const mutations = [
    value => ({ ...value, schema: "openreel-commercial-perceptual-evaluation/v1" }),
    value => ({ ...value, shotPolicy: { ...value.shotPolicy, dimensions: value.shotPolicy.dimensions.slice(0, -1) } }),
    value => ({ ...value, shotPolicy: { ...value.shotPolicy, dimensions: [...value.shotPolicy.dimensions, "extra"] } }),
    value => ({ ...value, shots: value.shots.map(item => ({ ...item, evidence: { ...item.evidence, sha256: "0".repeat(64) } })) }),
    value => ({ ...value, final: { ...value.final, evidence: { ...value.final.evidence, assetId: "other-render" } } })
  ];
  for (const mutate of mutations) {
    let providerCalls = 0;
    const inspector = createCommercialQualityInspector({ artifactReader: async () => ({ bytes: mp4() }), perceptualEvaluator: async (...args) => { providerCalls += 1; return mutate(await valid(...args)); } });
    await assert.rejects(inspector({ accountId: "owner" }, request), error => error.code === "COMMERCIAL_QUALITY_EVIDENCE_INVALID");
    assert.equal(providerCalls, 1);
  }
});
