import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { COMMERCIAL_PERCEPTUAL_IDEMPOTENCY_VERSION, COMMERCIAL_PERCEPTUAL_MAX_OBSERVATION_CHARS, createArkCommercialPerceptualEvaluator } from "../src/ark-commercial-perceptual-evaluator.js";

const sha = value => createHash("sha256").update(`bytes:${value}`).digest("hex");
const input = { evaluationRunId: "commercial-job-1", binding: { projectId: "p1", storyboardVersion: 3 }, director: { shots: [{ shotId: "s1", style: "warm" }] }, storyboard: [{ id: "s1", prompt: "show product", duration: 5 }], media: [{ shotId: "s1", assetId: "video-1", sha256: sha("video-1") }], render: { assetId: "render-1", sha256: sha("render-1") } };
const model = { name: "director-model", capability: "text", currency: "CNY", unitScale: 1_000_000, maxCostMicros: 200_000 };

function fixture({ malformed = false, content = null, finishReason = "stop", usage = null } = {}) {
  const calls = [];
  const arkService = { models: () => [model], submit: async (_principal, request) => {
    calls.push(request);
    const final = request.input.messages[1].content[0].text.startsWith("Evaluate the finished commercial"), dimensions = final ? ["story", "pacing", "continuity"] : ["intent", "beat", "composition", "visual_identity_consistency", "performance_naturalness"];
    return { id: `job-${calls.length}`, idempotencyKey: request.idempotencyKey, status: "succeeded", result: { content: content ?? (malformed ? "{}" : JSON.stringify({ scores: Object.fromEntries(dimensions.map(dimension => [dimension, 0.9])), observed: final ? "consistent product story" : "clear product reveal" })), finishReason }, usage: usage || { inputTokens: 100, outputTokens: 20, costMicros: 10_000, currency: "CNY", unitScale: 1_000_000, pricingVersion: "v1" } };
  } };
  const artifactReader = async (_principal, _projectId, assetId) => ({ bytes: Buffer.from(`bytes:${assetId}`), manifest: { mimeType: "video/mp4" } });
  return { evaluator: createArkCommercialPerceptualEvaluator({ arkService, artifactReader, model: model.name, maximumCostCnyPerCall: 0.2 }), calls };
}

test("Ark commercial evaluator binds bytes, strict scores, usage and maximum", async () => {
  const { evaluator, calls } = fixture(), result = await evaluator({ kind: "account", accountId: "owner" }, input);
  assert.equal(result.schema, "openreel-commercial-perceptual-evaluation/v2");
  assert.equal(result.shots[0].evidence.assetId, "video-1");
  assert.deepEqual(Object.keys(result.shots[0].scores), ["intent", "beat", "composition", "visual_identity_consistency", "performance_naturalness"]);
  assert.equal(result.final.evidence.sha256, sha("render-1"));
  assert.deepEqual(result.usage, { currency: "CNY", unitScale: 1_000_000, costMicros: 20_000, inputTokens: 200, outputTokens: 40, pricingVersion: "v1" });
  assert.deepEqual(result.maximum, { currency: "CNY", maximumCostCny: 0.4, maximumCostCnyPerCall: 0.2, calls: 2 });
  assert.equal(calls.length, 2); assert.equal(calls[0].input.messages[1].content[1].video_url.url, `data:video/mp4;base64,${Buffer.from("bytes:video-1").toString("base64")}`);
  assert.equal(calls[0].input.temperature, 0); assert.equal(calls[0].input.jsonOutput, true);
  assert.equal(calls[0].input.max_completion_tokens, 2_000);
  assert.equal(calls[0].maximumCostMicros, 200_000);
  assert.match(calls[0].input.messages[1].content[0].text, /visual_identity_consistency/);
  assert.match(calls[0].input.messages[1].content[0].text, /performance_naturalness/);
  assert.match(calls[0].input.messages[1].content[0].text, /product, prop, or other object/);
  assert.match(calls[0].input.messages[1].content[0].text, /Do not assign zero merely because no person/);
  assert.match(calls[1].input.messages[1].content[0].text, /one-shot commercial/);
  assert.match(calls[1].input.messages[1].content[0].text, /temporal consistency within that shot/);
  assert.match(calls[1].input.messages[1].content[0].text, /platform-required AI provenance label/);
  assert.match(calls[1].input.messages[1].content[0].text, /still penalize any other unplanned text/);
  assert.match(calls[1].input.messages[1].content[0].text, /wide establish -> closer material\/detail inspection -> balanced hero presentation/);
  assert.match(calls[1].input.messages[1].content[0].text, /deterministic reframing of the same byte-bound product frame/);
  assert.match(calls[1].input.messages[1].content[0].text, /continuity should reward preservation of geometry, material, color, tabletop, background, and lighting/);
  assert.match(calls[0].idempotencyKey, new RegExp(`^${COMMERCIAL_PERCEPTUAL_IDEMPOTENCY_VERSION}:[a-f0-9]{64}$`));
  assert.equal(result.identity.calls[0].idempotencyKey, calls[0].idempotencyKey);
});

test("Ark commercial evaluator binds idempotency to run and bytes and rejects mismatched replay", async () => {
  const first = fixture(), second = fixture(), changed = fixture();
  await first.evaluator({ kind: "account", accountId: "owner" }, input);
  await second.evaluator({ kind: "account", accountId: "owner" }, { ...input, evaluationRunId: "commercial-job-2" });
  await changed.evaluator({ kind: "account", accountId: "owner" }, { ...input, media: [{ ...input.media[0], assetId: "video-2", sha256: sha("video-2") }] });
  assert.notEqual(first.calls[0].idempotencyKey, second.calls[0].idempotencyKey);
  assert.notEqual(first.calls[0].idempotencyKey, changed.calls[0].idempotencyKey);

  const evaluator = createArkCommercialPerceptualEvaluator({
    arkService: { models: () => [model], submit: async () => ({ id: "old", idempotencyKey: "legacy-key", status: "succeeded", result: { content: JSON.stringify({ scores: { intent: 1, beat: 1, composition: 1, visual_identity_consistency: 1, performance_naturalness: 1 }, observed: "old bytes" }) }, usage: { inputTokens: 1, outputTokens: 1, costMicros: 1, currency: "CNY", unitScale: 1_000_000, pricingVersion: "v1" } }) },
    artifactReader: async (_principal, _projectId, assetId) => ({ bytes: Buffer.from(`bytes:${assetId}`), manifest: { mimeType: "video/mp4" } }),
    model: model.name,
    maximumCostCnyPerCall: 0.2
  });
  await assert.rejects(evaluator({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_QUALITY_EVIDENCE_INVALID" && /replay identity/.test(error.message));
});

test("Ark commercial evaluator rejects embedding or unbounded routes", () => {
  const artifactReader = async () => ({ bytes: Buffer.from("x"), mimeType: "video/mp4" });
  assert.throws(() => createArkCommercialPerceptualEvaluator({ arkService: { submit() {}, models: () => [{ ...model, capability: "vision" }] }, artifactReader, model: model.name, maximumCostCnyPerCall: 0.2 }), error => error.code === "COMMERCIAL_QUALITY_UNAVAILABLE");
  assert.throws(() => createArkCommercialPerceptualEvaluator({ arkService: { submit() {}, models: () => [{ ...model, maxCostMicros: 0 }] }, artifactReader, model: model.name, maximumCostCnyPerCall: 0.2 }), error => error.code === "COMMERCIAL_QUALITY_UNAVAILABLE");
  assert.throws(() => createArkCommercialPerceptualEvaluator({ arkService: { submit() {}, models: () => [model] }, artifactReader, model: model.name }), error => error.code === "COMMERCIAL_QUALITY_UNAVAILABLE");
});

test("Ark commercial evaluator fails closed on malformed scores or usage", async () => {
  await assert.rejects(fixture({ malformed: true }).evaluator({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_QUALITY_EVIDENCE_INVALID");
  await assert.rejects(fixture({ usage: { inputTokens: 1 } }).evaluator({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_QUALITY_EVIDENCE_INVALID");
  await assert.rejects(fixture({ usage: { inputTokens: 1, outputTokens: 1, costMicros: 210_000, currency: "CNY", unitScale: 1_000_000, pricingVersion: "v1" } }).evaluator({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_QUALITY_COST_LIMIT");
  await assert.rejects(fixture().evaluator({ kind: "account", accountId: "owner" }, { ...input, media: [{ ...input.media[0], sha256: "0".repeat(64) }] }), error => error.code === "COMMERCIAL_QUALITY_EVIDENCE_INVALID");
});

test("Ark commercial evaluator classifies truncated, incomplete and empty output without retry", async () => {
  for (const [options, diagnostic] of [
    [{ finishReason: "length", content: '{"scores":{' }, "MODEL_OUTPUT_TOKEN_LIMIT"],
    [{ content: '{"scores":{' }, "MODEL_OUTPUT_INCOMPLETE_JSON"],
    [{ content: "   " }, "MODEL_OUTPUT_EMPTY"]
  ]) await assert.rejects(fixture(options).evaluator({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_QUALITY_EVIDENCE_INVALID" && error.details?.retryable === false && error.details?.qualityDiagnostic === diagnostic);
});

test("Ark commercial evaluator preserves bounded long observations and rejects over-limit evidence", async () => {
  const observed = "visual evidence ".repeat(108).slice(0, 1_620);
  const content = JSON.stringify({ scores: { story: 0.9, pacing: 0.9, continuity: 0.9 }, observed });
  const { evaluator } = fixture({ content });
  const finalOnly = { ...input, media: [] };
  const result = await evaluator({ kind: "account", accountId: "owner" }, finalOnly);
  assert.equal(result.final.observed, observed);
  assert.equal(result.final.evidence.observed, observed);

  const tooLong = "x".repeat(COMMERCIAL_PERCEPTUAL_MAX_OBSERVATION_CHARS + 1);
  await assert.rejects(
    fixture({ content: JSON.stringify({ scores: { story: 0.9, pacing: 0.9, continuity: 0.9 }, observed: tooLong }) }).evaluator({ kind: "account", accountId: "owner" }, finalOnly),
    error => error.code === "COMMERCIAL_QUALITY_EVIDENCE_INVALID"
  );
});
