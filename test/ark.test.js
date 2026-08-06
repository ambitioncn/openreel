import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arkMaxRetries, createArkService, createArkTransports, loadArkConfig } from "../src/ark.js";
import { createSqliteBackend } from "../src/durable.js";
import { createPlatform } from "../src/platform.js";
import { VOLCENGINE_PRICING } from "../src/volcengine-pricing.js";
import { createOpenReelServer } from "../server.mjs";
import { createMemoryStore } from "../src/core.js";

const endpoint = "https://ark.example.test/v1/run";
function config(models) { const priced = Object.fromEntries(Object.entries(models).map(([name, model]) => [name, model.inputMicrosPerMillion || model.outputMicrosPerMillion ? model : { ...model, outputMicrosPerMillion: 1 }])); return loadArkConfig({ ARK_ENABLED: "true", OPENREEL_PAID_INFERENCE_ENABLED: "true", ARK_API_KEY: "server-only-secret", ARK_ALLOWED_HOSTS: "ark.example.test,assets.example.test", ARK_MODELS_JSON: JSON.stringify(priced) }); }
function issue(platform, email, limit = 1000) {
  platform.register({ email, password: "password-123" });
  const login = platform.login({ email, password: "password-123" });
  const application = platform.submitKeyApplication(login.token, { reason: "Ark access", requestedLimitMicros: limit });
  platform.approveKeyApplication(application.id, { hardLimitMicros: limit, periodEndsAt: "2099-01-01T00:00:00.000Z" });
  return { token: login.token, ...platform.createApiKey(login.token, { name: "test" }) };
}

test("Ark configuration is explicit, provider-neutral, and never exposes credentials or account endpoints", () => {
  assert.deepEqual(loadArkConfig({}), { enabled: false, models: {}, allowedHosts: [] });
  assert.throws(() => config({ seed: { capability: "text", providerModel: "account-endpoint-id", endpoint: "http://127.0.0.1/run", maxCostMicros: 1 } }), e => e.code === "ARK_URL_REJECTED");
  const ark = config({ planner: { capability: "text", providerModel: "configured-endpoint-id", endpoint, maxCostMicros: 10 } });
  const service = createArkService({ config: ark, platform: createPlatform(), transport: async () => ({}), assetTransport: async () => ({}) });
  assert.deepEqual(service.models(), [{ name: "planner", capability: "text", maxCostMicros: 10, inputMicrosPerMillion: 0, outputMicrosPerMillion: 1, currency: "USD", unitScale: 10_000, pricingVersion: null, asynchronous: false, resultMimeTypes: [] }]);
  assert.equal(JSON.stringify(service.models()).includes("server-only-secret"), false);
  assert.equal(JSON.stringify(service.models()).includes("configured-endpoint-id"), false);
});

test("synchronous Ark calls reserve first, settle trusted usage once, and are idempotent", async () => {
  const platform = createPlatform(), issued = issue(platform, "sync@example.test"), calls = [];
  const ark = config({ planner: { capability: "text", providerModel: "ep-text", endpoint, maxCostMicros: 100, inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 1_000_000 } });
  const service = createArkService({ config: ark, platform, transport: async request => { calls.push(request); assert.equal(platform.usageStatus(issued.token).subscription.reservedMicros, 100); return { usage: { input_tokens: 2, output_tokens: 3 }, result: { plan: "ok" } }; }, assetTransport: async () => ({}) });
  const first = await service.submit(issued.key, { model: "planner", capability: "text", input: { prompt: "plan" }, idempotencyKey: "same" });
  const replay = await service.submit(issued.key, { model: "planner", capability: "text", input: { prompt: "ignored" }, idempotencyKey: "same" });
  assert.equal(first.id, replay.id); assert.equal(calls.length, 1); assert.deepEqual(first.result, { plan: "ok" });
  const usage = platform.usageStatus(issued.token); assert.equal(usage.subscription.reservedMicros, 0); assert.equal(usage.subscription.spentMicros, 5); assert.equal(usage.usage.length, 1);
  assert.equal(JSON.stringify(calls).includes(issued.key), false); assert.equal(calls[0].apiKey, "server-only-secret");
});

test("provider failure and untrusted usage release the full reservation without charging", async () => {
  for (const response of [new Error("secret provider detail"), { result: "missing usage" }]) {
    const platform = createPlatform(), issued = issue(platform, `${Math.random()}@example.test`);
    const service = createArkService({ config: config({ image: { capability: "image", providerModel: "ep-image", endpoint, maxCostMicros: 90 } }), platform, transport: async () => { if (response instanceof Error) throw response; return response; }, assetTransport: async () => ({}) });
    await assert.rejects(service.submit(issued.key, { model: "image", capability: "image", input: { prompt: "x" }, idempotencyKey: "fail" }), e => ["ARK_PROVIDER_ERROR", "ARK_USAGE_UNTRUSTED"].includes(e.code));
    const usage = platform.usageStatus(issued.token); assert.equal(usage.subscription.reservedMicros, 0); assert.equal(usage.subscription.spentMicros, 0); assert.equal(usage.usage[0].status, "failed");
  }
});

test("asynchronous polling, tenant isolation, asset allowlist, MIME and byte limits are enforced", async () => {
  const platform = createPlatform(), owner = issue(platform, "owner@example.test"), stranger = issue(platform, "stranger@example.test"), polls = [];
  const service = createArkService({
    config: config({ video: { capability: "video", providerModel: "ep-video", endpoint, pollEndpoint: "https://ark.example.test/v1/poll", asynchronous: true, maxCostMicros: 100, outputMicrosPerMillion: 1_000_000, resultMimeTypes: ["video/mp4"] } }), platform,
    transport: async request => request.body.task_id ? (polls.push(request), { status: "succeeded", usage: { input_tokens: 0, output_tokens: 4 }, result: { url: "https://assets.example.test/result.mp4" } }) : { task_id: "provider-task" },
    assetTransport: async () => ({ mimeType: "video/mp4", bytes: Buffer.from("video") }), maxAssetBytes: 8
  });
  const job = await service.submit(owner.key, { model: "video", capability: "video", input: { prompt: "x" }, idempotencyKey: "video-1" });
  assert.equal(job.status, "running"); await assert.rejects(service.poll(stranger.key, job.id), e => e.code === "NOT_FOUND");
  const done = await service.poll(owner.key, job.id); assert.equal(done.status, "succeeded"); assert.equal(polls.length, 1);
  const asset = await service.download(owner.key, job.id); assert.equal(asset.mimeType, "video/mp4"); assert.equal(asset.bytes.toString(), "video");
  await assert.rejects(service.download(stranger.key, job.id), e => e.code === "NOT_FOUND");
  done.result.url = "https://127.0.0.1/private"; assert.equal(done.result.url.includes("127.0.0.1"), true); // public clones cannot mutate stored jobs
  assert.equal((await service.download(owner.key, job.id)).bytes.toString(), "video");
});

test("configured mappings cover text, vision, image, video, and available audio without guessed defaults", () => {
  const models = Object.fromEntries(["text", "vision", "image", "video", "audio"].map(capability => [capability, { capability, providerModel: `configured-${capability}`, endpoint, maxCostMicros: 1 }]));
  assert.deepEqual(Object.values(config(models).models).map(x => x.capability), ["text", "vision", "image", "video", "audio"]);
});

test("Volcengine content generation uses a per-model key and normalizes async task responses", async () => {
  const platform = createPlatform(), issued = issue(platform, "volcengine@example.test"), calls = [];
  const ark = loadArkConfig({
    ARK_ENABLED: "true",
    OPENREEL_PAID_INFERENCE_ENABLED: "true",
    ARK_ALLOWED_HOSTS: "ark.example.test,assets.example.test",
    SEEDANCE_KEY: "seedance-only-secret",
    ARK_MODELS_JSON: JSON.stringify({ seedance: { capability: "video", providerModel: "doubao-seedance-2-0-260128", endpoint: "https://ark.example.test/api/v3/contents/generations/tasks", pollEndpoint: "https://ark.example.test/api/v3/contents/generations/tasks", apiKeyEnv: "SEEDANCE_KEY", protocol: "volcengine-content-generation", asynchronous: true, maxCostMicros: 100, outputMicrosPerMillion: 1, resultMimeTypes: ["video/mp4"] } })
  });
  const service = createArkService({ config: ark, platform, transport: async request => {
    calls.push(request);
    if (request.method === "GET") return { id: "task-1", status: "succeeded", content: { video_url: "https://assets.example.test/video.mp4" }, usage: { completion_tokens: 4 } };
    return { id: "task-1" };
  }, assetTransport: async () => ({ mimeType: "video/mp4", bytes: Buffer.from("video") }) });
  const job = await service.submit(issued.key, { model: "seedance", capability: "video", input: { prompt: "ocean sunrise", duration: 5, ratio: "16:9", generate_audio: true }, idempotencyKey: "seedance-1" });
  assert.equal(job.providerTaskId, "task-1");
  assert.equal(calls[0].apiKey, "seedance-only-secret"); assert.equal(calls[0].body.model, "doubao-seedance-2-0-260128"); assert.deepEqual(calls[0].body.content, [{ type: "text", text: "ocean sunrise" }]);
  const done = await service.poll(issued.key, job.id); assert.equal(done.status, "succeeded"); assert.equal(done.result.url, "https://assets.example.test/video.mp4");
  assert.equal(calls[1].method, "GET"); assert.match(calls[1].url, /tasks\/task-1$/); assert.equal(JSON.stringify(service.models()).includes("seedance-only-secret"), false);
});

test("Volcengine presets fall back to the shared provider key", () => {
  const ark = loadArkConfig({
    OPENREEL_VOLCENGINE_API_KEY: "shared-key-fixture",
    OPENREEL_VOLCENGINE_SEEDANCE2_FAST_API_KEY: "stale-model-secret",
    OPENREEL_VOLCENGINE_SEEDANCE2_FAST_MODEL: "doubao-seedance-2-0-fast-260128"
  });
  assert.equal(ark.enabled, true);
  assert.equal(ark.models["seedance-2-fast"].apiKey, "shared-key-fixture");
});

test("production presets map all seven configured models and keep paid calls gated by default", async () => {
  const env = { OPENREEL_VOLCENGINE_API_KEY: "fixture-key" };
  for (const name of ["SEEDANCE2_FAST", "SEEDANCE2", "SEEDREAM5_LITE", "SEEDREAM5_PRO", "SEED21_TURBO", "SEED21_PRO", "EMBEDDING_VISION"]) env[`OPENREEL_VOLCENGINE_${name}_MODEL`] = `configured-${name.toLowerCase()}`;
  const ark = loadArkConfig(env);
  assert.deepEqual(Object.values(ark.models).map(x => x.capability), ["video", "video", "image", "image", "text", "text", "vision"]);
  assert.equal(ark.paidCallsEnabled, false);
  const platform = createPlatform(), issued = issue(platform, "gated@example.test"), service = createArkService({ config: ark, platform, transport: async () => { throw new Error("must not call"); }, assetTransport: async () => ({}) });
  await assert.rejects(service.submit(issued.key, { model: "seedance-2-fast", capability: "video", input: { prompt: "x" }, idempotencyKey: "gated" }), e => e.code === "PAID_INFERENCE_GATED");
  assert.equal(platform.usageStatus(issued.token).subscription.reservedMicros, 0);
});

test("production prices are official costs times 1.5 and paid mode fails closed on zero or unknown prices", () => {
  assert.equal(VOLCENGINE_PRICING.version, "volcengine-2026-08-06-usd-7.20-markup-1.5");
  assert.equal(VOLCENGINE_PRICING.currency, "USD");
  assert.equal(VOLCENGINE_PRICING.unitScale, 10_000);
  assert.equal(VOLCENGINE_PRICING.cnyPerUsd, 7.20);
  assert.deepEqual([
    VOLCENGINE_PRICING.models["seed-2.1-pro"].inputMicrosPerMillion,
    VOLCENGINE_PRICING.models["seed-2.1-pro"].outputMicrosPerMillion,
    VOLCENGINE_PRICING.models["seed-2.1-turbo"].inputMicrosPerMillion,
    VOLCENGINE_PRICING.models["seed-2.1-turbo"].outputMicrosPerMillion
  ], [12_500, 62_500, 6_250, 31_250]);
  assert.equal(VOLCENGINE_PRICING.models["seedream-5-lite"].outputMicrosPerMillion, 459_000_000);
  assert.equal(VOLCENGINE_PRICING.models["seedream-5-pro"].outputMicrosPerMillion, 625_000_000);
  assert.equal(VOLCENGINE_PRICING.models["embedding-vision"].inputMicrosPerMillion, 3_750);
  assert.equal(VOLCENGINE_PRICING.models["seedance-2-fast"].maxCostMicros, 6_945);
  assert.throws(() => loadArkConfig({ ARK_ENABLED: "true", OPENREEL_PAID_INFERENCE_ENABLED: "true", ARK_API_KEY: "fixture", ARK_ALLOWED_HOSTS: "ark.example.test", ARK_MODELS_JSON: JSON.stringify({ unknown: { capability: "text", providerModel: "unknown", endpoint, maxCostMicros: 1 } }) }), error => error.code === "ARK_PRICE_UNKNOWN");
});

test("pricing version is immutable from reservation through the per-model ledger", async () => {
  const platform = createPlatform(), issued = issue(platform, "priced@example.test", 100);
  const service = createArkService({ config: config({ planner: { capability: "text", providerModel: "ep", endpoint, maxCostMicros: 10, outputMicrosPerMillion: 1_000_000, pricingVersion: "test-v1" } }), platform, transport: async () => ({ usage: { input_tokens: 0, output_tokens: 4 }, result: {} }), assetTransport: async () => ({}) });
  await service.submit(issued.key, { model: "planner", capability: "text", input: {}, idempotencyKey: "priced" });
  const status = platform.usageStatus(issued.token);
  assert.equal(status.usage[0].pricingVersion, "test-v1");
  assert.equal(status.usage[0].costMicros, 4);
});

test("Volcengine text, image, and multimodal embedding protocols normalize trusted responses", async () => {
  const models = {
    text: { capability: "text", providerModel: "text-id", endpoint: "https://ark.example.test/chat/completions", protocol: "volcengine-chat-completions", maxCostMicros: 10 },
    image: { capability: "image", providerModel: "image-id", endpoint: "https://ark.example.test/images/generations", protocol: "volcengine-image-generation", maxCostMicros: 10, outputMicrosPerMillion: 10_000_000, resultMimeTypes: ["image/png"] },
    vision: { capability: "vision", providerModel: "vision-id", endpoint: "https://ark.example.test/embeddings/multimodal", protocol: "volcengine-multimodal-embedding", maxCostMicros: 10 }
  };
  const platform = createPlatform(), issued = issue(platform, "protocols@example.test", 100), calls = [];
  const service = createArkService({ config: config(models), platform, transport: async request => {
    calls.push(request);
    if (request.url.includes("chat/")) return { choices: [{ message: { content: "plan" } }], usage: { prompt_tokens: 2, completion_tokens: 3 } };
    if (request.url.includes("images/")) return { data: { url: "https://assets.example.test/image.png" } };
    return { data: { embedding: [0.1, 0.2] }, usage: { total_tokens: 4 } };
  }, assetTransport: async () => ({ mimeType: "image/png", bytes: Buffer.from("png") }) });
  assert.deepEqual((await service.submit(issued.key, { model: "text", capability: "text", input: { prompt: "write" }, idempotencyKey: "text" })).result, { content: "plan" });
  assert.equal((await service.submit(issued.key, { model: "image", capability: "image", input: { prompt: "draw" }, idempotencyKey: "image" })).result.url, "https://assets.example.test/image.png");
  assert.deepEqual((await service.submit(issued.key, { model: "vision", capability: "vision", input: { input: [{ type: "image_url", image_url: "https://assets.example.test/image.png" }] }, idempotencyKey: "vision" })).result.data[0].embedding, [0.1, 0.2]);
  assert.deepEqual(calls.map(x => x.body.model), ["text-id", "image-id", "vision-id"]);
  assert.deepEqual(calls.map(x => x.timeoutMs), [30_000, 120_000, 30_000]);
});

test("trusted settlement at the hard limit automatically suspends the calling key", async () => {
  const platform = createPlatform(), issued = issue(platform, "limit@example.test", 5);
  const service = createArkService({ config: config({ planner: { capability: "text", providerModel: "ep", endpoint, maxCostMicros: 5, outputMicrosPerMillion: 1_000_000 } }), platform, transport: async () => ({ usage: { input_tokens: 0, output_tokens: 5 }, result: {} }), assetTransport: async () => ({}) });
  await service.submit(issued.key, { model: "planner", capability: "text", input: {}, idempotencyKey: "limit" });
  assert.throws(() => platform.authenticateApiKey(issued.key), e => e.code === "INVALID_API_KEY");
  assert.equal(platform.usageStatus(issued.token).keys[0].suspendReason, "hard_limit_reached");
});

test("HTTP inference route authenticates or_live keys and returns only sanitized provider failures", async t => {
  const platform = createPlatform(), issued = issue(platform, "http-ark@example.test");
  const service = createArkService({ config: config({ planner: { capability: "text", providerModel: "ep", endpoint, maxCostMicros: 5 } }), platform, transport: async () => { throw new Error("upstream secret body"); }, assetTransport: async () => ({}) });
  const server = createOpenReelServer(undefined, platform, { production: true, arkService: service, rateLimit: { max: 100 } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/inference/jobs`, body = JSON.stringify({ model: "planner", capability: "text", input: {}, idempotencyKey: "http" });
  const anonymous = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }); assert.equal(anonymous.status, 401);
  const failed = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-openreel-api-key": issued.key }, body });
  assert.equal(failed.status, 502); const error = await failed.json(); assert.equal(error.error.code, "ARK_PROVIDER_ERROR"); assert.equal(JSON.stringify(error).includes("upstream secret body"), false);
});

test("canvas Ark route maps generic aspect and audio parameters to provider fields", async t => {
  const platform = createPlatform(), issued = issue(platform, "canvas-http@example.test"), ownerId = platform.authenticate(issued.token).id, store = createMemoryStore(); store.createUser({ id: ownerId, name: "Canvas" }); const project = store.createProject({ name: "Canvas" }, ownerId), session = store.createSession(project.id, { name: "Main" }, ownerId), node = store.createNode(session.id, { type: "video" }, ownerId); let providerInput;
  const arkService = { submit: async (_key, request) => { providerInput = request.input; return { id: "ark-http", model: request.model, capability: request.capability, status: "running" }; }, models: () => [], poll: async () => {}, download: async () => {} };
  const server = createOpenReelServer(store, platform, { production: true, arkService, rateLimit: { max: 100 } }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/sessions/${session.id}/ark-jobs`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${issued.token}`, "x-openreel-api-key": issued.key }, body: JSON.stringify({ nodeId: node.id, model: "seedance", capability: "video", prompt: "ocean", idempotencyKey: "canvas", parameters: { aspect: "16:9", audio: true, duration: 5 } }) });
  assert.equal(response.status, 201); assert.equal(providerInput.ratio, "16:9"); assert.equal(providerInput.generate_audio, true); assert.equal(providerInput.duration, 5);
});

test("provider failures expose only a sanitized upstream HTTP status", async () => {
  const platform = createPlatform(), issued = issue(platform, "status@example.test");
  const service = createArkService({ config: config({ image: { capability: "image", providerModel: "ep", endpoint, maxCostMicros: 5 } }), platform, transport: async () => { throw Object.assign(new Error("private upstream response"), { status: 400 }); }, assetTransport: async () => ({}) });
  await assert.rejects(service.submit(issued.key, { model: "image", capability: "image", input: {}, idempotencyKey: "status" }), error => {
    assert.equal(error.code, "ARK_PROVIDER_ERROR"); assert.equal(error.details.upstreamStatus, 400); assert.equal(JSON.stringify(error).includes("private upstream response"), false); return true;
  });
});

test("Ark canvas jobs persist validated output as a tenant asset and append video to the timeline", () => {
  const store = createMemoryStore(); store.createUser({ id: "owner", name: "Owner" }); store.createUser({ id: "other", name: "Other" });
  const project = store.createProject({ name: "Ark canvas" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), node = store.createNode(session.id, { type: "video" }, "owner");
  const arkJob = { id: "ark-1", model: "seedance-2-fast", capability: "video", status: "running" };
  const local = store.createArkCanvasJob(session.id, { nodeId: node.id, prompt: "ocean", parameters: { duration: 7 } }, arkJob, "owner");
  assert.equal(store.createArkCanvasJob(session.id, { nodeId: node.id, prompt: "duplicate" }, arkJob, "owner").id, local.id);
  const done = store.reconcileArkCanvasJob(local.id, { ...arkJob, status: "succeeded" }, { mimeType: "video/mp4", bytes: Buffer.from("video-fixture") }, "owner");
  const snapshot = store.snapshot(project.id, "owner"); assert.equal(done.state, "succeeded"); assert.equal(snapshot.assets[0].metadata.arkJobId, "ark-1"); assert.equal(snapshot.timeline.tracks[0].clips[0].assetId, done.assetId); assert.equal(snapshot.timeline.tracks[0].clips[0].outPoint, 7);
  assert.deepEqual(store.assetContent(project.id, done.assetId, undefined, "owner").bytes, Buffer.from("video-fixture"));
  assert.throws(() => store.arkCanvasJob(local.id, "other"), error => error.code === "FORBIDDEN");
});

test("Ark jobs, owner scope, idempotency, polling metadata, results and settlement survive restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-ark-restart-")), platformFile = join(root, "platform.json"), databaseFile = join(root, "openreel.sqlite");
  let platform = createPlatform({ file: platformFile }), owner = issue(platform, "restart@example.test"), backend = createSqliteBackend(databaseFile, { assetRoot: join(root, "assets") }), submits = 0, polls = 0;
  const arkConfig = config({ video: { capability: "video", providerModel: "ep-video", endpoint, pollEndpoint: "https://ark.example.test/poll", asynchronous: true, maxCostMicros: 100, outputMicrosPerMillion: 1_000_000 } });
  let service = createArkService({ config: arkConfig, platform, store: backend.arkJobs, transport: async request => request.body.task_id ? (polls++, { status: "succeeded", usage: { input_tokens: 0, output_tokens: 7 }, result: { id: "result" } }) : (submits++, { task_id: "provider-task" }), assetTransport: async () => ({}) });
  const submitted = await service.submit(owner.key, { model: "video", capability: "video", input: {}, idempotencyKey: "restart" });
  backend.close(); platform = createPlatform({ file: platformFile }); backend = createSqliteBackend(databaseFile, { assetRoot: join(root, "assets") });
  service = createArkService({ config: arkConfig, platform, store: backend.arkJobs, transport: async request => request.body.task_id ? (polls++, { status: "succeeded", usage: { input_tokens: 0, output_tokens: 7 }, result: { id: "result" } }) : (submits++, { task_id: "duplicate" }), assetTransport: async () => ({}) });
  assert.equal((await service.submit(owner.key, { model: "video", capability: "video", input: { changed: true }, idempotencyKey: "restart" })).id, submitted.id);
  const done = await service.poll(owner.key, submitted.id); assert.equal(done.status, "succeeded"); assert.deepEqual(done.result, { id: "result" });
  backend.close(); platform = createPlatform({ file: platformFile }); backend = createSqliteBackend(databaseFile, { assetRoot: join(root, "assets") });
  service = createArkService({ config: arkConfig, platform, store: backend.arkJobs, transport: async () => { throw new Error("must not call"); }, assetTransport: async () => ({}) });
  assert.equal((await service.poll(owner.key, submitted.id)).status, "succeeded"); assert.equal(submits, 1); assert.equal(polls, 1); assert.equal(platform.usageStatus(owner.token).usage.length, 1); backend.close();
});

test("concurrent duplicate submits reserve and call provider once", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-ark-concurrent-")), backend = createSqliteBackend(join(root, "db.sqlite"), { assetRoot: join(root, "assets") }), platform = createPlatform(), owner = issue(platform, "concurrent@example.test"); let calls = 0;
  const service = createArkService({ config: config({ planner: { capability: "text", providerModel: "ep", endpoint, maxCostMicros: 10 } }), platform, store: backend.arkJobs, transport: async () => { calls++; await Promise.resolve(); return { usage: { input_tokens: 0, output_tokens: 0 }, result: {} }; }, assetTransport: async () => ({}) });
  const results = await Promise.all(Array.from({ length: 8 }, () => service.submit(owner.key, { model: "planner", capability: "text", input: {}, idempotencyKey: "one" })));
  assert.equal(new Set(results.map(x => x.id)).size, 1); assert.equal(calls, 1); assert.equal(platform.usageStatus(owner.token).usage.length, 1); backend.close();
});

test("a crash in the durable settling phase is recovered exactly once", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-ark-crash-")), platformFile = join(root, "platform.json"), databaseFile = join(root, "db.sqlite"); let platform = createPlatform({ file: platformFile }), owner = issue(platform, "crash@example.test"), backend = createSqliteBackend(databaseFile, { assetRoot: join(root, "assets") });
  const reservation = platform.reserveUsage(owner.key, { model: "planner", maxCostMicros: 10, idempotencyKey: "ark:crash" }), ownerHash = createHash("sha256").update(owner.key).digest("hex");
  backend.arkJobs.create({ id: "crashed-job", ownerHash, idempotencyKey: "crash", model: "planner", capability: "text", status: "settling", providerTaskId: null, reservationId: reservation.id, rates: { input: 0, output: 1_000_000 }, settlement: { failed: false, response: { usage: { input_tokens: 0, output_tokens: 3 }, result: { recovered: true } } }, result: null, error: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  backend.close(); platform = createPlatform({ file: platformFile }); backend = createSqliteBackend(databaseFile, { assetRoot: join(root, "assets") });
  const service = createArkService({ config: config({ planner: { capability: "text", providerModel: "ep", endpoint, maxCostMicros: 10, outputMicrosPerMillion: 1_000_000 } }), platform, store: backend.arkJobs, transport: async () => { throw new Error("must not call provider"); }, assetTransport: async () => ({}) });
  const [a, b] = await Promise.all([service.poll(owner.key, "crashed-job"), service.poll(owner.key, "crashed-job")]);
  assert.equal(a.status, "succeeded"); assert.equal(b.status, "succeeded"); assert.deepEqual(a.result, { recovered: true }); assert.equal(platform.usageStatus(owner.token).usage.length, 1); backend.close();
});

test("transport rejects private and rebound DNS and bounds Retry-After by total timeout", async () => {
  const privateTransport = createArkTransports({ resolver: async () => [{ address: "127.0.0.1", family: 4 }], fetchImpl: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(privateTransport.request({ url: endpoint, apiKey: "x", body: {}, timeoutMs: 100, idempotencyKey: "x" }), e => e.code === "ARK_URL_REJECTED");
  let resolutions = 0; const rebound = createArkTransports({ resolver: async () => [{ address: ++resolutions === 1 ? "93.184.216.34" : "93.184.216.35", family: 4 }], fetchImpl: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(rebound.request({ url: endpoint, apiKey: "x", body: {}, timeoutMs: 100, idempotencyKey: "x" }), e => e.code === "ARK_URL_REJECTED");
  let clock = 0, attempts = 0; const delays = [], retrying = createArkTransports({ retries: 5, resolver: async () => [{ address: "93.184.216.34", family: 4 }], nowMs: () => clock, sleep: async ms => { delays.push(ms); clock += ms; }, totalTimeoutMs: 2500, maxRetryAfterMs: 1000, fetchImpl: async () => { attempts++; return { ok: false, status: 429, headers: { get: () => "60" } }; } });
  await assert.rejects(retrying.request({ url: endpoint, apiKey: "x", body: {}, timeoutMs: 10_000, idempotencyKey: "x" }), e => e.status === 504);
  assert.deepEqual(delays, [1000, 1000, 500]); assert.equal(attempts, 3);
});

test("Ark max retries defaults safely, accepts zero, and rejects invalid values", () => {
  assert.equal(arkMaxRetries({}), 2);
  assert.equal(arkMaxRetries({ OPENREEL_ARK_MAX_RETRIES: "0" }), 0);
  for (const value of ["-1", "1.5", "", "nope", "9007199254740992"]) assert.throws(() => arkMaxRetries({ OPENREEL_ARK_MAX_RETRIES: value }), e => e.code === "ARK_CONFIG_INVALID");
});

test("legacy generic team settlement cannot be client-forged", async t => {
  const platform = createPlatform(); platform.register({ email: "settle@example.test", password: "password-123" }); const token = platform.login({ email: "settle@example.test", password: "password-123" }).token, team = platform.createTeam(token, { name: "Settle" }), reservation = platform.reserve(token, team.id, { kind: "video", idempotencyKey: "reserve" });
  const server = createOpenReelServer(undefined, platform, { production: true, rateLimit: { max: 100 } }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/teams/${team.id}/budget/settle`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ reservationId: reservation.id, actualAmount: 0 }) });
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, "FORBIDDEN"); assert.equal(platform.budgetStatus(token, team.id).reserved, reservation.amount);
});
