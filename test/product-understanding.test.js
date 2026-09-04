import test from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/core.js";
import { createProductUnderstandingService, understandProductPage } from "../src/product-understanding.js";

const page = (extracted = {}) => ({ schema: "openreel-product-page/v1", source: { requestedUrl: "https://shop.example/item", finalUrl: "https://shop.example/item", redirects: [], contentType: "text/html", byteLength: 100, sha256: "a".repeat(64), fetchedAt: "2026-08-20T00:00:00.000Z" }, extracted: { title: "Pocket Light", description: "A compact rechargeable light. It includes three brightness levels.", text: "Pocket Light A compact rechargeable light. It includes three brightness levels.", ...extracted } });

test("product understanding binds every derived fact to fetched evidence", () => {
  const result = understandProductPage(page());
  assert.equal(result.status, "grounded"); assert.ok(result.confidence > 0.5); assert.equal(result.source.mode, "fetched");
  const ids = new Set(result.evidence.map(item => item.id));
  assert.ok(result.facts.length >= 2); assert.ok(result.facts.every(fact => fact.evidenceIds.every(id => ids.has(id))));
  assert.equal(result.creativeContext.audience, null); assert.ok(result.creativeContext.unsupportedFields.includes("price"));
});

test("sparse product evidence remains partial and requires review", () => {
  const result = understandProductPage(page({ description: "", text: "Short" }));
  assert.equal(result.status, "partial"); assert.equal(result.requiresReview, true); assert.deepEqual(result.creativeContext.valuePropositions, []);
});

test("invalid page provenance is rejected", () => {
  assert.throws(() => understandProductPage({ ...page(), source: { ...page().source, sha256: "bad" } }), error => error.code === "PRODUCT_EVIDENCE_INVALID");
});

test("fetch failure degrades only to explicit user input and marks it unverified", async () => {
  const service = createProductUnderstandingService(async () => { throw new DomainError("PRODUCT_URL_TIMEOUT", "timeout", 504); });
  const result = await service({ url: "https://shop.example/item", fallback: { name: "Pocket Light", benefits: ["Rechargeable"] } });
  assert.equal(result.status, "fallback"); assert.equal(result.confidence, 0); assert.equal(result.requiresReview, true); assert.equal(result.source.fetchError.code, "PRODUCT_URL_TIMEOUT"); assert.ok(result.evidence.every(item => item.source.mode === "user_input"));
});

test("fetch failure without meaningful fallback preserves the original safe error", async () => {
  const service = createProductUnderstandingService(async () => { throw new DomainError("PRODUCT_URL_TIMEOUT", "timeout", 504); });
  await assert.rejects(service({ url: "https://shop.example/item", fallback: {} }), error => error.code === "PRODUCT_URL_TIMEOUT");
});

test("real model understanding retains job, usage, hashes and fetched quote provenance", async () => {
  const content = JSON.stringify({ name: "Pocket Light", summary: "A compact rechargeable light.", valuePropositions: ["It includes three brightness levels."], audience: null, evidenceQuotes: ["Pocket Light", "A compact rechargeable light.", "It includes three brightness levels."] });
  const arkService = { models: () => [{ name: "seed-text", capability: "text" }], submit: async (principal, request) => { assert.equal(principal.accountId, "owner"); assert.equal(request.capability, "text"); return { id: "model-job-1", status: "succeeded", result: { content }, usage: { costMicros: 9, currency: "CNY", unitScale: 1_000_000, inputTokens: 10, outputTokens: 20 } }; } };
  const result = await createProductUnderstandingService(async () => page(), arkService)({ url: "https://shop.example/item", idempotencyKey: "product-1", principal: { accountId: "owner" } });
  assert.equal(result.status, "model_grounded"); assert.equal(result.model.model, "seed-text"); assert.equal(result.model.jobId, "model-job-1"); assert.equal(result.model.usage.costMicros, 9); assert.match(result.model.promptSha256, /^[a-f0-9]{64}$/); assert.ok(result.facts.every(fact => fact.evidenceIds.length === 1));
});

test("real model understanding requests bounded deterministic JSON output", async () => {
  const value = { name: "Pocket Light", summary: "A compact rechargeable light.", valuePropositions: ["It includes three brightness levels."], audience: null, evidenceQuotes: ["Pocket Light", "A compact rechargeable light.", "It includes three brightness levels."] };
  const arkService = { models: () => [{ name: "seed-text", capability: "text" }], submit: async (_principal, request) => {
    assert.deepEqual(request.input, { prompt: request.input.prompt, temperature: 0, max_completion_tokens: 2000, disableThinking: true, jsonOutput: true });
    return { id: "fenced", status: "succeeded", result: { content: `\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n` } };
  } };
  const result = await createProductUnderstandingService(async () => page(), arkService)({ url: "https://shop.example/item", idempotencyKey: "fenced", principal: { kind: "account", accountId: "owner" } });
  assert.equal(result.status, "model_grounded");
  assert.equal(result.model.jobId, "fenced");
});

test("model output normalization rejects prose, multiple fences and oversized output", async () => {
  for (const content of ["Here is the result: {}", "```json\n{}\n```\n```json\n{}\n```", "{" + " ".repeat(100_000) + "}"]) {
    const arkService = { models: () => [{ name: "seed-text", capability: "text" }], submit: async () => ({ id: "invalid", status: "succeeded", result: { content } }) };
    await assert.rejects(createProductUnderstandingService(async () => page(), arkService)({ url: "https://shop.example/item", idempotencyKey: "invalid", principal: { kind: "account", accountId: "owner" } }), error => error.code === "PRODUCT_MODEL_OUTPUT_INVALID");
  }
});

test("model understanding drops paraphrases while retaining directly quoted claims", async () => {
  const content = JSON.stringify({ name: "Pocket Light", summary: "A paraphrased summary", valuePropositions: ["It includes three brightness levels.", "Another paraphrase"], audience: null, evidenceQuotes: ["Pocket Light", "A compact rechargeable light.", "It includes three brightness levels."] });
  const arkService = { models: () => [{ name: "seed-text", capability: "text" }], submit: async () => ({ id: "partial-grounding", status: "succeeded", result: { content } }) };
  const result = await createProductUnderstandingService(async () => page(), arkService)({ url: "https://shop.example/item", idempotencyKey: "partial-grounding", principal: { kind: "account", accountId: "owner" } });
  assert.deepEqual(result.facts.map(item => [item.field, item.value]), [["name", "Pocket Light"], ["feature", "It includes three brightness levels."]]);
  assert.equal(result.creativeContext.summary, null);
  assert.deepEqual(result.creativeContext.valuePropositions, ["It includes three brightness levels."]);
});

test("model absence and unsupported model claims fail closed", async () => {
  await assert.rejects(createProductUnderstandingService(async () => page())({ url: "https://shop.example/item", idempotencyKey: "missing" }), error => error.code === "PRODUCT_MODEL_UNAVAILABLE");
  const arkService = { models: () => [{ name: "seed-text", capability: "text" }], submit: async () => ({ id: "bad", status: "succeeded", result: { content: JSON.stringify({ name: "Invented", summary: null, valuePropositions: [], audience: null, evidenceQuotes: ["not on page"] }) } }) };
  await assert.rejects(createProductUnderstandingService(async () => page(), arkService)({ url: "https://shop.example/item", idempotencyKey: "bad", principal: { accountId: "owner" } }), error => error.code === "PRODUCT_MODEL_EVIDENCE_INVALID");
});
