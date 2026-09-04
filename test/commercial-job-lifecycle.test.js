import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommercialJobLifecycle, createFileCommercialJobStore, createMemoryCommercialJobStore } from "../src/commercial-job-lifecycle.js";

const principal = { kind: "account", accountId: "owner-1" };
const input = { idempotencyKey: "film-1", script: "hello", storyboard: { shots: [{ id: "s1", prompt: "lamp", duration: 5 }] }, models: { image: "image", video: "video" } };
const qualified = (extra = {}) => ({ status: "qualified", releaseEligible: true, quality: { accepted: true }, ...extra });

test("commercial jobs are owner-scoped, idempotent and persist terminal results", async () => {
  const calls = [], lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async (_principal, request) => (calls.push(request.idempotencyKey), qualified()) }, id: () => "job-1" });
  const created = lifecycle.create(principal, input);
  assert.equal(lifecycle.create(principal, input).id, created.id);
  assert.equal((await lifecycle.execute(principal, created.id)).status, "succeeded");
  assert.deepEqual(calls, ["film-1"]);
  assert.equal((await lifecycle.execute(principal, created.id)).attempts, 1);
  assert.throws(() => lifecycle.get({ kind: "account", accountId: "other" }, created.id), error => error.code === "COMMERCIAL_JOB_NOT_FOUND");
});

test("commercial jobs durably record confirmed estimate, stage progress and trusted settlement", async () => {
  const store = createMemoryCommercialJobStore();
  const lifecycle = createCommercialJobLifecycle({ store, orchestrator: { run: async (_principal, _request, { progress }) => { await progress("images"); assert.equal(store.get("job-cost").stage, "images"); await progress("voice", { shotId: "s1" }); return qualified({ cost: { currency: "CNY", status: "settled", settledCny: 3.25 } }); } }, id: () => "job-cost" });
  const created = lifecycle.create(principal, { ...input, estimatedCostCny: 4.5 });
  assert.deepEqual(created.cost, { currency: "CNY", status: "quoted", estimatedCny: 4.5, settledCny: null });
  const done = await lifecycle.execute(principal, created.id);
  assert.equal(done.stage, "voice"); assert.deepEqual(done.stageDetail, { shotId: "s1" });
  assert.deepEqual(done.cost, { currency: "CNY", status: "settled", estimatedCny: 4.5, settledCny: 3.25 });
});

test("generation success is rejected without quality approval and seven-stage evidence persists", async () => {
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async (_principal, _request, { progress }) => { await progress("images"); await progress("compose"); await progress("quality"); return { status: "quality_failed", generationStatus: "succeeded", qualificationStatus: "rejected", releaseEligible: false, quality: { accepted: false, shots: [{ shotId: "s1", accepted: false }], final: { accepted: false } }, shots: [{ id: "s1", status: "failed" }] }; } }, id: () => "job-quality-rejected" });
  const result = await lifecycle.execute(principal, lifecycle.create(principal, input).id);
  assert.equal(result.status, "failed");
  assert.equal(result.result.generationStatus, "succeeded");
  assert.equal(result.result.releaseEligible, false);
  assert.equal(result.error.code, "COMMERCIAL_QUALITY_REJECTED");
  assert.equal(result.director.stages.length, 7);
  assert.deepEqual(result.director.stages.map(stage => stage.status), ["accepted", "accepted", "accepted", "accepted", "accepted", "accepted", "rejected"]);
  assert.ok(result.director.stages.every(stage => stage.evidence));
});

test("retry is bounded and reuses the paid-provider idempotency key", async () => {
  const keys = []; let attempt = 0;
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async (_principal, request) => { keys.push(request.idempotencyKey); if (!attempt++) throw Object.assign(new Error("upstream"), { status: 503 }); return qualified(); } }, id: () => "job-retry", maxAttempts: 2 });
  const job = lifecycle.create(principal, input);
  const failed = await lifecycle.execute(principal, job.id);
  assert.equal(failed.status, "failed"); assert.equal(failed.retryable, true);
  lifecycle.retry(principal, job.id);
  const succeeded = await lifecycle.execute(principal, job.id);
  assert.equal(succeeded.status, "succeeded"); assert.equal(succeeded.attempts, 2);
  assert.deepEqual(keys, ["film-1", "film-1"]);
});

test("renderer failures retain only safe durable diagnostics", async () => {
  const failure = Object.assign(new Error("private /tmp/input path"), { code: "RENDER_FAILED", status: 500, details: { rendererDiagnostic: "RENDER_INPUT_DECODE_FAILED", stderrSha256: "a".repeat(64), stderr: "private /tmp/input path" } });
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { throw failure; } }, id: () => "job-render-failure" });
  const failed = await lifecycle.execute(principal, lifecycle.create(principal, { ...input, idempotencyKey: "render-failure" }).id);
  assert.deepEqual(failed.error, { code: "RENDER_FAILED", message: "commercial generation failed", rendererDiagnostic: "RENDER_INPUT_DECODE_FAILED", stderrSha256: "a".repeat(64) });
  assert.equal(JSON.stringify(failed).includes("/tmp/input"), false);
  assert.equal(failed.cost.status, "unsettled");
});

test("post-generation failures retain trusted settled cost without exposing raw error details", async () => {
  const failure = Object.assign(new Error("private composition failure"), { code: "VERSION_CONFLICT", status: 409, details: { terminalCost: { currency: "CNY", status: "settled", settledCny: 12.74976, generationSettledCny: 12.74976, evaluationSettledCny: 0 }, privateValue: "must-not-persist" } });
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { throw failure; } }, id: () => "job-settled-failure" });
  const failed = await lifecycle.execute(principal, lifecycle.create(principal, { ...input, idempotencyKey: "settled-failure" }).id);
  assert.deepEqual(failed.cost, { currency: "CNY", status: "settled", estimatedCny: null, settledCny: 12.74976, generationSettledCny: 12.74976, evaluationSettledCny: 0 });
  assert.equal(JSON.stringify(failed).includes("must-not-persist"), false);
});

test("quality truncation retains a safe diagnostic and is not retryable", async () => {
  const failure = Object.assign(new Error("raw model output must not persist"), { code: "COMMERCIAL_QUALITY_EVIDENCE_INVALID", status: 502, details: { retryable: false, qualityDiagnostic: "MODEL_OUTPUT_TOKEN_LIMIT", content: "private raw output" } });
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { throw failure; } }, id: () => "job-quality" });
  lifecycle.create(principal, { ...input, idempotencyKey: "quality-diagnostic" });
  const failed = await lifecycle.execute(principal, "job-quality");
  assert.equal(failed.retryable, false);
  assert.deepEqual(failed.error, { code: "COMMERCIAL_QUALITY_EVIDENCE_INVALID", message: "commercial generation failed", qualityDiagnostic: "MODEL_OUTPUT_TOKEN_LIMIT" });
  assert.equal(JSON.stringify(failed).includes("private raw output"), false);
});

test("Qwen voice failures retain only bounded provider diagnostics", async () => {
  for (const [details, expected] of [
    [{ upstreamStatus: 503, privateBody: "provider private response" }, { provider: "qwen-tts-tailnet", category: "http", upstreamStatus: 503 }],
    [{ causeCode: "UND_ERR_CONNECT_TIMEOUT", url: "http://private-tailnet/service" }, { provider: "qwen-tts-tailnet", category: "transport", causeCode: "UND_ERR_CONNECT_TIMEOUT" }],
    [{ causeCode: "private value with spaces", token: "secret" }, { provider: "qwen-tts-tailnet", category: "transport" }],
  ]) {
    const failure = Object.assign(new Error("private provider failure"), { code: "QWEN_TTS_PROVIDER_ERROR", status: 502, details });
    const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { throw failure; } }, id: () => crypto.randomUUID() });
    const failed = await lifecycle.execute(principal, lifecycle.create(principal, { ...input, idempotencyKey: crypto.randomUUID() }).id);
    assert.deepEqual(failed.error, { code: "QWEN_TTS_PROVIDER_ERROR", message: "commercial generation failed", providerDiagnostic: expected });
    const serialized = JSON.stringify(failed);
    assert.equal(serialized.includes("provider private response"), false);
    assert.equal(serialized.includes("private-tailnet"), false);
    assert.equal(serialized.includes("secret"), false);
  }
});

test("Ark failures retain only bounded provider diagnostics", async () => {
  const failure = Object.assign(new Error("private provider response"), { code: "ARK_PROVIDER_ERROR", status: 502, details: { upstreamStatus: 400, providerCode: "InvalidParameter", providerParam: "content[1].image_url", providerRequestIdHash: "0123456789abcdef", providerMessage: "must not persist", token: "secret" } });
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { throw failure; } }, id: () => "job-ark-failure" });
  const failed = await lifecycle.execute(principal, lifecycle.create(principal, { ...input, idempotencyKey: "ark-diagnostic" }).id);
  assert.deepEqual(failed.error, { code: "ARK_PROVIDER_ERROR", message: "commercial generation failed", providerDiagnostic: { provider: "volcengine-ark", category: "http", upstreamStatus: 400, providerCode: "InvalidParameter", providerParam: "content[1].image_url", providerRequestIdHash: "0123456789abcdef" } });
  const serialized = JSON.stringify(failed);
  assert.equal(serialized.includes("must not persist"), false);
  assert.equal(serialized.includes("secret"), false);
});

test("queued cancellation makes no provider call", async () => {
  let calls = 0;
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { calls += 1; } }, id: () => "job-cancel" });
  const job = lifecycle.create(principal, input);
  assert.equal(lifecycle.cancel(principal, job.id).status, "canceled");
  assert.equal((await lifecycle.execute(principal, job.id)).status, "canceled");
  assert.equal(calls, 0);
});

test("restart recovery requeues active work and closes cancel-requested work", () => {
  const store = createMemoryCommercialJobStore([
    { id: "running", ownerId: "owner-1", idempotencyKey: "a", status: "running", cancelRequested: false },
    { id: "canceling", ownerId: "owner-1", idempotencyKey: "b", status: "running", cancelRequested: true }
  ]);
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => ({ status: "succeeded" }) }, store });
  assert.deepEqual(lifecycle.recover().map(job => [job.id, job.status]), [["running", "queued"], ["canceling", "canceled"]]);
});

test("file store survives reconstruction with intact idempotency and recoverable state", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-commercial-")), "jobs.json");
  const first = createCommercialJobLifecycle({ orchestrator: { run: async () => ({ status: "succeeded" }) }, store: createFileCommercialJobStore(file), id: () => "durable-job" });
  first.create(principal, input);
  const second = createCommercialJobLifecycle({ orchestrator: { run: async () => ({ status: "succeeded" }) }, store: createFileCommercialJobStore(file) });
  assert.equal(second.create(principal, input).id, "durable-job");
  assert.equal(second.recover()[0].status, "queued");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).schema, "openreel-commercial-job-store/v1");
});

test("file store preserves complete v2 director quality result and quote split after restart", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-commercial-quality-")), "jobs.json"), quality = { schema: "openreel-commercial-quality-result/v2", accepted: false, releaseEligible: false, evaluation: { provider: "fixture", model: "free-fixture-v1", usage: { currency: "CNY", costMicros: 0, unitScale: 1_000_000 } }, shots: [{ shotId: "s1", qualificationStatus: "rejected", accepted: false, creativeFailures: ["beat"], technicalFailures: [], evidence: { assetId: "video-1", sha256: "a".repeat(64), byteLength: 32 } }], final: { qualificationStatus: "rejected", releaseEligible: false, directorFailures: ["pacing"], technicalFailures: [], evidence: { assetId: "render-1", sha256: "b".repeat(64), byteLength: 64 } } };
  const first = createCommercialJobLifecycle({ orchestrator: { run: async () => ({ status: "quality_failed", generationStatus: "succeeded", qualificationStatus: "rejected", releaseEligible: false, quality, shots: [{ id: "s1", status: "failed" }] }) }, store: createFileCommercialJobStore(file), id: () => "durable-quality-job" });
  const created = first.create(principal, { ...input, quoteCost: { estimatedCny: 3, generationEstimatedCny: 2, evaluationEstimatedCny: 1 }, estimatedCostCny: 3 });
  await first.execute(principal, created.id);
  const second = createCommercialJobLifecycle({ orchestrator: { run: async () => { throw new Error("terminal replay must not execute"); } }, store: createFileCommercialJobStore(file) }), restored = second.get(principal, created.id);
  assert.equal(restored.status, "failed"); assert.equal(restored.result.generationStatus, "succeeded"); assert.deepEqual(restored.result.quality, quality); assert.equal(restored.cost.evaluationEstimatedCny, 1); assert.equal(restored.director.stages.at(-1).status, "rejected");
});
