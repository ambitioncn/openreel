import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { DomainError } from "./core.js";
import { VOLCENGINE_PRICING, volcenginePrice } from "./volcengine-pricing.js";

const CAPABILITIES = new Set(["text", "vision", "image", "video", "audio"]);
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const blockedAddresses = new BlockList();
for (const [network, prefix, family] of [["0.0.0.0", 8, "ipv4"], ["10.0.0.0", 8, "ipv4"], ["100.64.0.0", 10, "ipv4"], ["127.0.0.0", 8, "ipv4"], ["169.254.0.0", 16, "ipv4"], ["172.16.0.0", 12, "ipv4"], ["192.0.0.0", 24, "ipv4"], ["192.168.0.0", 16, "ipv4"], ["198.18.0.0", 15, "ipv4"], ["224.0.0.0", 4, "ipv4"], ["::", 128, "ipv6"], ["::1", 128, "ipv6"], ["fc00::", 7, "ipv6"], ["fe80::", 10, "ipv6"], ["ff00::", 8, "ipv6"]]) blockedAddresses.addSubnet(network, prefix, family);

function requiredText(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new DomainError("ARK_CONFIG_INVALID", `${name} is required`, 503);
  return value.trim();
}

function safeUrl(value, allowedHosts, name = "endpoint") {
  let url;
  try { url = new URL(value); } catch { throw new DomainError("ARK_CONFIG_INVALID", `${name} must be a valid URL`, 503); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || isIP(host) || host === "localhost" || host.endsWith(".local") || !allowedHosts.has(host)) throw new DomainError("ARK_URL_REJECTED", `${name} is outside the configured HTTPS allowlist`, 503);
  return url;
}

function publicAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6 && address.toLowerCase().startsWith("::ffff:")) return publicAddress(address.slice(7));
  return !blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function resolvePublic(url, resolver) {
  const read = async () => (await resolver(url.hostname, { all: true, verbatim: true })).map(x => x.address).sort();
  let first, second;
  try { first = await read(); second = await read(); } catch { throw new DomainError("ARK_URL_REJECTED", "Ark hostname could not be safely resolved", 503); }
  if (!first.length || first.some(x => !publicAddress(x)) || first.join(",") !== second.join(",")) throw new DomainError("ARK_URL_REJECTED", "Ark hostname resolved to a blocked or unstable address", 503);
  return first;
}

function pinnedFetch(url, options, addresses) {
  return new Promise((resolve, reject) => {
    const target = new URL(url), address = addresses[0], family = isIP(address);
    const request = httpsRequest(target, { method: options.method || "GET", headers: options.headers, signal: options.signal, servername: target.hostname, lookup: (_hostname, lookupOptions, callback) => lookupOptions?.all ? callback(null, [{ address, family }]) : callback(null, address, family) }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => { const bytes = Buffer.concat(chunks), headers = { get: name => response.headers[String(name).toLowerCase()] ?? null }; resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, headers, json: async () => JSON.parse(bytes.toString("utf8")), body: { getReader: () => { let sent = false; return { read: async () => sent ? { done: true } : (sent = true, { done: false, value: bytes }), cancel: async () => {} }; } } }); });
    });
    request.on("error", reject); if (options.body) request.write(options.body); request.end();
  });
}

function modelMap(value, allowedHosts, env) {
  let parsed;
  try { parsed = JSON.parse(value || "{}"); } catch { throw new DomainError("ARK_CONFIG_INVALID", "ARK_MODELS_JSON must be valid JSON", 503); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new DomainError("ARK_CONFIG_INVALID", "ARK_MODELS_JSON must be an object", 503);
  return Object.fromEntries(Object.entries(parsed).map(([name, item]) => {
    if (!item || typeof item !== "object" || !CAPABILITIES.has(item.capability)) throw new DomainError("ARK_CONFIG_INVALID", `model ${name} has an invalid capability`, 503);
    const endpoint = safeUrl(requiredText(item.endpoint, `model ${name} endpoint`), allowedHosts);
    const maxCostMicros = Number(item.maxCostMicros), inputMicrosPerMillion = Number(item.inputMicrosPerMillion || 0), outputMicrosPerMillion = Number(item.outputMicrosPerMillion || 0);
    for (const [field, number] of Object.entries({ maxCostMicros, inputMicrosPerMillion, outputMicrosPerMillion })) if (!Number.isSafeInteger(number) || number < 0) throw new DomainError("ARK_CONFIG_INVALID", `model ${name} ${field} must be a non-negative safe integer`, 503);
    const apiKey = item.apiKeyEnv ? requiredText(env[item.apiKeyEnv], item.apiKeyEnv) : null;
    return [name, Object.freeze({ name, capability: item.capability, providerModel: requiredText(item.providerModel, `model ${name} providerModel`), endpoint: endpoint.href, pollEndpoint: item.pollEndpoint ? safeUrl(item.pollEndpoint, allowedHosts, "pollEndpoint").href : null, apiKey, protocol: item.protocol || "generic", maxCostMicros, inputMicrosPerMillion, outputMicrosPerMillion, pricingVersion: item.pricingVersion ? requiredText(item.pricingVersion, `model ${name} pricingVersion`) : null, asynchronous: Boolean(item.asynchronous), resultMimeTypes: Array.isArray(item.resultMimeTypes) ? item.resultMimeTypes.map(String) : [] })];
  }));
}

export function loadArkConfig(env = process.env) {
  const volcengineBase = String(env.OPENREEL_VOLCENGINE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
  const presets = {};
  for (const [name, modelEnv, capability, path, protocol, asynchronous, resultMimeTypes] of [
    ["seedance-2-fast", "OPENREEL_VOLCENGINE_SEEDANCE2_FAST_MODEL", "video", "contents/generations/tasks", "volcengine-content-generation", true, ["video/mp4"]],
    ["seedance-2", "OPENREEL_VOLCENGINE_SEEDANCE2_MODEL", "video", "contents/generations/tasks", "volcengine-content-generation", true, ["video/mp4"]],
    ["seedream-5-lite", "OPENREEL_VOLCENGINE_SEEDREAM5_LITE_MODEL", "image", "images/generations", "volcengine-image-generation", false, ["image/png", "image/jpeg", "image/webp"]],
    ["seedream-5-pro", "OPENREEL_VOLCENGINE_SEEDREAM5_PRO_MODEL", "image", "images/generations", "volcengine-image-generation", false, ["image/png", "image/jpeg", "image/webp"]],
    ["seed-2.1-turbo", "OPENREEL_VOLCENGINE_SEED21_TURBO_MODEL", "text", "chat/completions", "volcengine-chat-completions", false, []],
    ["seed-2.1-pro", "OPENREEL_VOLCENGINE_SEED21_PRO_MODEL", "text", "chat/completions", "volcengine-chat-completions", false, []],
    ["embedding-vision", "OPENREEL_VOLCENGINE_EMBEDDING_VISION_MODEL", "vision", "embeddings/multimodal", "volcengine-multimodal-embedding", false, []]
  ]) {
    if (env.OPENREEL_VOLCENGINE_API_KEY?.trim() && env[modelEnv]?.trim()) {
      const price = volcenginePrice(name);
      if (!price) throw new DomainError("ARK_PRICE_UNKNOWN", `model ${name} has no approved price`, 503);
      presets[name] = { capability, providerModel: env[modelEnv].trim(), endpoint: `${volcengineBase}/${path}`, ...(asynchronous ? { pollEndpoint: `${volcengineBase}/${path}` } : {}), apiKeyEnv: "OPENREEL_VOLCENGINE_API_KEY", protocol, asynchronous, ...price, pricingVersion: VOLCENGINE_PRICING.version, resultMimeTypes };
    }
  }
  const enabled = env.ARK_ENABLED === "true" || Object.keys(presets).length > 0;
  if (!enabled) return Object.freeze({ enabled: false, models: {}, allowedHosts: [] });
  const apiKey = env.ARK_API_KEY?.trim() || null;
  const allowedHosts = new Set([new URL(volcengineBase).hostname, ...String(env.ARK_ALLOWED_HOSTS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean)]);
  if (!allowedHosts.size) throw new DomainError("ARK_CONFIG_INVALID", "ARK_ALLOWED_HOSTS is required", 503);
  let explicit = {};
  try { explicit = JSON.parse(env.ARK_MODELS_JSON || "{}"); } catch { throw new DomainError("ARK_CONFIG_INVALID", "ARK_MODELS_JSON must be valid JSON", 503); }
  const models = modelMap(JSON.stringify({ ...presets, ...explicit }), allowedHosts, env);
  if (env.OPENREEL_PAID_INFERENCE_ENABLED === "true") {
    for (const model of Object.values(models)) if (model.maxCostMicros <= 0 || model.inputMicrosPerMillion + model.outputMicrosPerMillion <= 0) throw new DomainError("ARK_PRICE_UNKNOWN", `model ${model.name} has no approved positive price`, 503);
  }
  if (!apiKey && Object.values(models).some(model => !model.apiKey)) throw new DomainError("ARK_CONFIG_INVALID", "ARK_API_KEY or a per-model apiKeyEnv is required", 503);
  return Object.freeze({ enabled, paidCallsEnabled: env.OPENREEL_PAID_INFERENCE_ENABLED === "true", apiKey, allowedHosts: [...allowedHosts], models });
}

export function arkMaxRetries(env = process.env) {
  const value = env.OPENREEL_ARK_MAX_RETRIES ?? "2";
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new DomainError("ARK_CONFIG_INVALID", "OPENREEL_ARK_MAX_RETRIES must be a non-negative safe integer", 503);
  return Number(value);
}

export function createArkTransports({ fetchImpl = globalThis.fetch, retries = 2, resolver = lookup, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), baseDelayMs = 100, maxDelayMs = 2_000, maxRetryAfterMs = 5_000, totalTimeoutMs = 120_000, nowMs = Date.now } = {}) {
  const fetchResolved = (url, options, addresses) => fetchImpl === globalThis.fetch ? pinnedFetch(url, options, addresses) : fetchImpl(url, { ...options, validatedAddresses: addresses });
  const request = async ({ url, apiKey, body, timeoutMs, idempotencyKey, method = "POST" }) => {
    const parsed = new URL(url), started = nowMs(), budget = Math.min(timeoutMs, totalTimeoutMs);
    for (let attempt = 0; ; attempt += 1) {
      const elapsed = nowMs() - started, remaining = budget - elapsed;
      if (remaining <= 0) throw Object.assign(new Error("provider timeout"), { status: 504 });
      const addresses = await resolvePublic(parsed, resolver);
      let response;
      try { response = await fetchResolved(url, { method, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-idempotency-key": idempotencyKey }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(remaining), redirect: "error" }, addresses); }
      catch (cause) { if (attempt >= retries) throw Object.assign(new Error("provider unavailable", { cause }), { status: 502 }); response = null; }
      if (response && (!RETRYABLE.has(response.status) || attempt >= retries)) { if (!response.ok) throw Object.assign(new Error("provider rejected request"), { status: response.status }); try { return await response.json(); } catch { throw Object.assign(new Error("invalid provider response"), { status: 502 }); } }
      const retryAfter = Number(response?.headers?.get?.("retry-after"));
      const delay = Math.min(Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : baseDelayMs * (2 ** attempt), maxDelayMs, maxRetryAfterMs, budget - (nowMs() - started));
      if (delay <= 0) throw Object.assign(new Error("provider timeout"), { status: 504 });
      await sleep(delay);
    }
  };
  const asset = async ({ url, apiKey, timeoutMs, maxBytes }) => {
    const parsed = new URL(url), addresses = await resolvePublic(parsed, resolver);
    const response = await fetchResolved(url, { headers: { authorization: `Bearer ${apiKey}` }, redirect: "error", signal: AbortSignal.timeout(Math.min(timeoutMs, totalTimeoutMs)) }, addresses);
    if (!response.ok) throw Object.assign(new Error("asset unavailable"), { status: response.status });
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxBytes) throw Object.assign(new Error("asset too large"), { status: 502 });
    const reader = response.body?.getReader(), chunks = []; let length = 0;
    if (!reader) throw Object.assign(new Error("asset body missing"), { status: 502 });
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maxBytes) { await reader.cancel(); throw Object.assign(new Error("asset too large"), { status: 502 }); } chunks.push(Buffer.from(value)); }
    return { mimeType: response.headers.get("content-type"), bytes: Buffer.concat(chunks) };
  };
  return Object.freeze({ request, asset });
}

function sanitizeProviderError(error) {
  const status = Number(error?.status);
  const upstreamStatus = Number.isSafeInteger(status) && status >= 400 && status <= 599 ? status : null;
  return new DomainError("ARK_PROVIDER_ERROR", "Ark provider request failed", status === 429 ? 429 : 502, { ...(status === 429 ? { retryable: true } : {}), upstreamStatus });
}

function trustedUsage(value) {
  const usage = value?.usage;
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) throw new DomainError("ARK_USAGE_UNTRUSTED", "Ark response did not contain trusted usage", 502);
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
}

function publicJob(job) {
  return structuredClone({ id: job.id, model: job.model, capability: job.capability, status: job.status, providerTaskId: job.providerTaskId, result: job.result, error: job.error, createdAt: job.createdAt, updatedAt: job.updatedAt });
}

function providerRequest(model, operation, input, taskId) {
  if (model.protocol === "generic") return { url: operation === "poll" ? model.pollEndpoint : model.endpoint, method: "POST", body: operation === "poll" ? { task_id: taskId } : { model: model.providerModel, capability: model.capability, input } };
  if (operation === "poll") return { url: `${model.pollEndpoint.replace(/\/$/, "")}/${encodeURIComponent(taskId)}`, method: "GET", body: null };
  const value = input && typeof input === "object" ? input : {};
  if (model.protocol === "volcengine-chat-completions") return { url: model.endpoint, method: "POST", body: { model: model.providerModel, messages: Array.isArray(value.messages) ? value.messages : [{ role: "user", content: requiredText(value.prompt, "input.prompt") }], ...(value.temperature === undefined ? {} : { temperature: value.temperature }), ...(value.max_completion_tokens === undefined ? {} : { max_completion_tokens: value.max_completion_tokens }) } };
  if (model.protocol === "volcengine-multimodal-embedding") return { url: model.endpoint, method: "POST", body: { model: model.providerModel, input: value.input ?? input } };
  if (model.protocol === "volcengine-image-generation") return { url: model.endpoint, method: "POST", body: { model: model.providerModel, prompt: requiredText(value.prompt, "input.prompt"), ...(value.size ? { size: value.size } : {}), ...(value.seed === undefined ? {} : { seed: value.seed }), ...(value.watermark === undefined ? {} : { watermark: Boolean(value.watermark) }), response_format: value.response_format || "url" } };
  const content = Array.isArray(value.content) ? value.content : [{ type: "text", text: requiredText(value.prompt, "input.prompt") }];
  return { url: model.endpoint, method: "POST", body: { model: model.providerModel, content, ...(value.generate_audio === undefined ? {} : { generate_audio: Boolean(value.generate_audio) }), ...(value.resolution ? { resolution: value.resolution } : {}), ...(value.ratio ? { ratio: value.ratio } : {}), ...(value.duration ? { duration: value.duration } : {}), ...(value.watermark === undefined ? {} : { watermark: Boolean(value.watermark) }) } };
}

function providerResponse(model, operation, response) {
  if (model.protocol === "generic") return response;
  if (model.protocol === "volcengine-content-generation" && operation === "submit") return { task_id: response?.id };
  const usage = response?.usage || {};
  if (model.protocol === "volcengine-chat-completions") return { usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens }, result: { content: response?.choices?.[0]?.message?.content ?? null } };
  if (model.protocol === "volcengine-multimodal-embedding") return { usage: { input_tokens: usage.prompt_tokens ?? usage.total_tokens, output_tokens: 0 }, result: { data: Array.isArray(response?.data) ? response.data : (response?.data ? [response.data] : []) } };
  if (model.protocol === "volcengine-image-generation") { const data = Array.isArray(response?.data) ? response.data[0] : response?.data; return { usage: { input_tokens: 0, output_tokens: data ? 1 : 0 }, result: data ?? null }; }
  return { status: response?.status, usage: { input_tokens: Number.isSafeInteger(usage.input_tokens) ? usage.input_tokens : 0, output_tokens: Number.isSafeInteger(usage.output_tokens) ? usage.output_tokens : (Number.isSafeInteger(usage.completion_tokens) ? usage.completion_tokens : 0) }, result: response?.content?.video_url ? { url: response.content.video_url } : null };
}

export function createArkService({ config, platform, transport, assetTransport, store = null, now = () => new Date().toISOString(), id = () => crypto.randomUUID(), maxAssetBytes = 100 * 1024 * 1024 } = {}) {
  if (!config?.enabled) return null;
  if (!platform || typeof transport !== "function" || typeof assetTransport !== "function") throw new DomainError("ARK_CONFIG_INVALID", "Ark service dependencies are required", 503);
  const jobs = new Map(), idempotency = new Map(), locks = new Map(), allowedHosts = new Set(config.allowedHosts);
  const memoryStore = { get: jobId => jobs.has(jobId) ? { job: jobs.get(jobId), version: 1 } : null, getByIdempotency: (ownerHash, key) => { const jobId = idempotency.get(`${ownerHash}:${key}`); return jobId ? { job: jobs.get(jobId), version: 1 } : null; }, create: job => { const replay = memoryStore.getByIdempotency(job.ownerHash, job.idempotencyKey); if (replay) return replay; jobs.set(job.id, structuredClone(job)); idempotency.set(`${job.ownerHash}:${job.idempotencyKey}`, job.id); return { job: structuredClone(job), version: 1 }; }, update: job => { jobs.set(job.id, structuredClone(job)); return { job: structuredClone(job), version: 1 }; } };
  const storage = store || memoryStore;
  const locked = async (key, operation) => { while (locks.has(key)) await locks.get(key); let release; const pending = new Promise(resolve => { release = resolve; }); locks.set(key, pending); try { return await operation(); } finally { locks.delete(key); release(); } };
  const owner = secret => createHash("sha256").update(secret).digest("hex");
  const modelFor = (name, capability) => { const model = config.models[name]; if (!model || model.capability !== capability) throw new DomainError("ARK_MODEL_UNAVAILABLE", "requested model/capability mapping is unavailable", 400); return model; };
  const call = async (model, operation, body, idempotencyKey) => {
    const request = providerRequest(model, operation, operation === "poll" ? null : body, operation === "poll" ? body.task_id : null);
    const timeoutMs = operation === "submit" && model.capability === "image" ? 120_000 : 30_000;
    try { return providerResponse(model, operation, await transport({ ...request, apiKey: model.apiKey || config.apiKey, timeoutMs, idempotencyKey })); }
    catch (error) { throw sanitizeProviderError(error); }
  };
  const settle = (secret, job, response, failed = false) => {
    const usage = failed ? { inputTokens: 0, outputTokens: 0 } : trustedUsage(response);
    platform.settleUsage(secret, job.reservationId, { ...usage, inputMicrosPerMillion: job.rates.input, outputMicrosPerMillion: job.rates.output, pricingVersion: job.rates.version, failed });
  };
  const submit = async (secret, request = {}) => {
    platform.authenticateApiKey(secret);
    if (!config.paidCallsEnabled) throw new DomainError("PAID_INFERENCE_GATED", "paid inference is disabled until an operator approves a budget", 403);
    const idempotencyKey = requiredText(request.idempotencyKey, "idempotencyKey"), ownerHash = owner(secret), replayKey = `${ownerHash}:${idempotencyKey}`;
    return locked(replayKey, async () => {
      let record = storage.getByIdempotency(ownerHash, idempotencyKey), job, model;
      if (record) { job = record.job; if (job.status !== "submitting") return publicJob(job); model = modelFor(job.model, job.capability); }
      else {
        const capability = requiredText(request.capability, "capability"); model = modelFor(requiredText(request.model, "model"), capability);
        const reservation = platform.reserveUsage(secret, { model: model.name, maxCostMicros: model.maxCostMicros, pricingVersion: model.pricingVersion, idempotencyKey: `ark:${idempotencyKey}` });
        record = storage.create({ id: id(), ownerHash, idempotencyKey, model: model.name, capability, providerInput: structuredClone(request.input ?? null), status: "submitting", providerTaskId: null, reservationId: reservation.id, rates: { input: model.inputMicrosPerMillion, output: model.outputMicrosPerMillion, version: model.pricingVersion }, settlement: null, result: null, error: null, createdAt: now(), updatedAt: now() });
        job = record.job; if (job.reservationId !== reservation.id) return publicJob(job);
      }
      try {
        const response = await call(model, "submit", job.providerInput, idempotencyKey);
        if (model.asynchronous) { job.providerTaskId = requiredText(response?.task_id, "Ark task_id"); job.status = "running"; }
        else { job.settlement = { response, failed: false }; job.status = "settling"; record = storage.update(job, record.version); settle(secret, job, response); job.status = "succeeded"; job.result = response.result ?? null; job.settlement = null; }
      } catch (error) {
        job.status = "failed"; job.error = { code: error.code || "ARK_PROVIDER_ERROR", message: "Ark request failed" };
        try { settle(secret, job, null, true); } catch { /* preserve the original sanitized failure */ }
        job.updatedAt = now(); storage.update(job, record.version); throw error;
      }
      job.updatedAt = now(); storage.update(job, record.version); return publicJob(job);
    });
  };
  const poll = async (secret, jobId) => {
    return locked(`job:${jobId}`, async () => {
    platform.authenticateApiKey(secret); let record = storage.get(jobId), job = record?.job;
    if (!job || job.ownerHash !== owner(secret)) throw new DomainError("NOT_FOUND", "Ark job not found", 404);
    if (TERMINAL.has(job.status)) return publicJob(job);
    if (job.status === "settling" && job.settlement) { settle(secret, job, job.settlement.response, job.settlement.failed); job.status = job.settlement.failed ? "failed" : "succeeded"; job.result = job.settlement.response?.result ?? null; job.settlement = null; job.updatedAt = now(); return publicJob(storage.update(job, record.version).job); }
    const model = config.models[job.model];
    if (!model.pollEndpoint) throw new DomainError("ARK_CONFIG_INVALID", "poll endpoint is not configured", 503);
    let response;
    try { response = await call(model, "poll", { task_id: job.providerTaskId }, job.id); }
    catch (error) { throw error; }
    if (response.status === "succeeded") { job.settlement = { response, failed: false }; job.status = "settling"; record = storage.update(job, record.version); settle(secret, job, response); job.status = "succeeded"; job.result = response.result ?? null; job.settlement = null; }
    else if (["failed", "canceled"].includes(response.status)) { job.settlement = { response: null, failed: true }; job.status = "settling"; record = storage.update(job, record.version); settle(secret, job, null, true); job.status = response.status; job.error = { code: "ARK_TASK_FAILED", message: "Ark task did not complete" }; job.settlement = null; }
    else job.status = "running";
    job.updatedAt = now(); return publicJob(storage.update(job, record.version).job);
    });
  };
  const download = async (secret, jobId) => {
    platform.authenticateApiKey(secret); const job = storage.get(jobId)?.job;
    if (!job || job.ownerHash !== owner(secret) || job.status !== "succeeded") throw new DomainError("NOT_FOUND", "Ark result asset not found", 404);
    const model = config.models[job.model], url = safeUrl(job.result?.url, allowedHosts, "result URL");
    let response; try { response = await assetTransport({ url: url.href, apiKey: model.apiKey || config.apiKey, timeoutMs: 30_000, maxBytes: maxAssetBytes }); } catch (error) { throw sanitizeProviderError(error); }
    const mimeType = String(response?.mimeType || "").split(";", 1)[0].toLowerCase(), bytes = Buffer.from(response?.bytes || []);
    if (!model.resultMimeTypes.includes(mimeType) || !bytes.length || bytes.length > maxAssetBytes) throw new DomainError("ARK_ASSET_REJECTED", "Ark result asset failed MIME or size validation", 502);
    return { mimeType, bytes };
  };
  return Object.freeze({ models: () => Object.values(config.models).map(({ endpoint, pollEndpoint, providerModel, apiKey, protocol, ...item }) => structuredClone(item)), submit, poll, download });
}
