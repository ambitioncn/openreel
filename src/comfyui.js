import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "./core.js";

const BASE_URL = "http://100.66.206.27:8188";
const MODEL = "minimax-h3-fl2va-q5-turbo-v4";
const WORKFLOW = "MiniMax-H3-Q5-Turbo-960x544-5s.json";
const VIDEO_MIMES = new Set(["video/mp4", "video/webm"]);

function ownData(env, name) {
  const descriptor = Object.getOwnPropertyDescriptor(env, name);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function exactBoolean(env, name) {
  const value = ownData(env, name);
  if (value === undefined) return false;
  if (value !== "true" && value !== "false") throw new DomainError("COMFYUI_CONFIG_INVALID", `${name} must be true or false`, 503);
  return value === "true";
}

function requiredText(value, field, maximum = 20_000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new DomainError("COMFYUI_INPUT_INVALID", `${field} is required`, 400);
  return value.trim();
}

function principalHash(platform, credential) {
  if (typeof credential === "string") {
    platform.authenticateApiKey(credential);
    return createHash("sha256").update(credential).digest("hex").slice(0, 24);
  }
  if (credential?.kind === "account" && typeof credential.accountId === "string" && credential.accountId) return createHash("sha256").update(`account:${credential.accountId}`).digest("hex").slice(0, 24);
  throw new DomainError("INVALID_API_KEY", "a valid inference principal is required", 401);
}

function promptFrom(input) {
  if (typeof input?.prompt === "string") return requiredText(input.prompt, "input.prompt");
  const text = input?.content?.find?.(part => part?.type === "text")?.text;
  return requiredText(text, "input.content text");
}

function verifyWorkflow(workflow, config) {
  const expected = [
    ["1", "UnetLoaderGGUF", "unet_name", config.baseModel],
    ["5", "MiniMaxH3TurboLoRA", "lora_name", config.lora],
    ["6", "MiniMaxH3ImageToVideo", "width", 960],
    ["6", "MiniMaxH3ImageToVideo", "height", 544],
    ["6", "MiniMaxH3ImageToVideo", "length", 124],
    ["9", "MiniMaxH3TurboSampler", null, null],
    ["15", "SaveVideo", null, null],
  ];
  for (const [id, classType, field, value] of expected) {
    const node = workflow?.[id];
    if (!node || node.class_type !== classType || (field && node.inputs?.[field] !== value)) throw new DomainError("COMFYUI_WORKFLOW_DRIFT", "ModelClaw workflow no longer matches the reviewed MiniMax H3 contract", 503, { nodeId: id, classType, field });
  }
  return structuredClone(workflow);
}

function publicJob(job) {
  return structuredClone({ id: job.id, idempotencyKey: job.idempotencyKey, model: MODEL, capability: "video", status: job.status, providerTaskId: job.promptId, result: job.result || null, error: job.error || null, usage: job.usage || null, createdAt: job.createdAt, updatedAt: job.updatedAt });
}

export function loadComfyUiConfig(env = process.env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) throw new DomainError("COMFYUI_CONFIG_INVALID", "environment must be an object", 503);
  const enabled = exactBoolean(env, "OPENREEL_MODELCLAW_COMFYUI_ENABLED");
  const supplied = ownData(env, "OPENREEL_MODELCLAW_COMFYUI_BASE_URL");
  if (supplied !== undefined && supplied !== BASE_URL) throw new DomainError("COMFYUI_CONFIG_INVALID", `OPENREEL_MODELCLAW_COMFYUI_BASE_URL must exactly match ${BASE_URL}`, 503);
  return Object.freeze({ enabled, baseUrl: BASE_URL, model: MODEL, workflow: WORKFLOW, baseModel: "MiniMax-H3-FL2VA-Pruned-Q5_K_M.gguf", lora: "minimax_h3_turbo_v4_step600_ema.safetensors", width: 960, height: 544, duration: 5, audio: true, maxAssetBytes: 200 * 1024 * 1024 });
}

export function createComfyUiService({ config = loadComfyUiConfig(), platform, fetchImpl = fetch, now = () => new Date().toISOString(), id = randomUUID } = {}) {
  if (!config.enabled) return null;
  if (!platform || typeof fetchImpl !== "function") throw new DomainError("COMFYUI_CONFIG_INVALID", "ModelClaw service dependencies are required", 503);
  const jobs = new Map(), idempotency = new Map();
  const request = async (path, options = {}) => {
    let response;
    try { response = await fetchImpl(`${config.baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(30_000) }); }
    catch { throw new DomainError("COMFYUI_UNAVAILABLE", "ModelClaw ComfyUI is unavailable", 503); }
    if (!response.ok) throw new DomainError("COMFYUI_PROVIDER_ERROR", "ModelClaw ComfyUI request failed", 502, { upstreamStatus: response.status });
    return response;
  };
  const models = () => [{ name: MODEL, capability: "video", provider: "modelclaw-comfyui", currency: "CNY", unitScale: 1_000_000, maxCostMicros: 0, costed: false, pricingVersion: "tailnet-local-compute/v1", schema: { modes: ["text-to-video"], resolutions: ["960x544"], durations: [5], audio: true, maxReferences: 0 } }];
  const submit = async (credential, input = {}) => {
    const ownerHash = principalHash(platform, credential), model = requiredText(input.model, "model", 200), capability = requiredText(input.capability, "capability", 20), idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 500);
    if (model !== MODEL || capability !== "video") throw new DomainError("COMFYUI_MODEL_UNAVAILABLE", "requested ModelClaw model/capability is unavailable", 400);
    const replay = idempotency.get(`${ownerHash}:${idempotencyKey}`);
    if (replay) return publicJob(jobs.get(replay));
    if (input.input?.content?.some?.(part => part?.type !== "text")) throw new DomainError("COMFYUI_INPUT_INVALID", "this reviewed workflow currently supports text-to-video only", 400);
    const prompt = promptFrom(input.input), workflowResponse = await request(`/api/userdata/workflows%2F${encodeURIComponent(config.workflow)}`), workflow = verifyWorkflow(await workflowResponse.json(), config);
    workflow["6"].inputs.prompt = prompt;
    workflow["7"].inputs.noise_seed = Number.parseInt(createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 12), 16);
    const response = await request("/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: `openreel-${ownerHash}` }) });
    const payload = await response.json(), promptId = requiredText(payload?.prompt_id, "ComfyUI prompt_id", 200), createdAt = now(), jobId = `comfyui:${ownerHash}:${id()}`;
    const job = { id: jobId, ownerHash, idempotencyKey, promptId, status: "running", result: null, error: null, usage: null, output: null, createdAt, updatedAt: createdAt };
    jobs.set(jobId, job); idempotency.set(`${ownerHash}:${idempotencyKey}`, jobId); return publicJob(job);
  };
  const owned = (credential, jobId) => { const job = jobs.get(jobId); if (!job || job.ownerHash !== principalHash(platform, credential)) throw new DomainError("NOT_FOUND", "ModelClaw job not found", 404); return job; };
  const poll = async (credential, jobId) => {
    const job = owned(credential, jobId);
    if (["succeeded", "failed", "canceled"].includes(job.status)) return publicJob(job);
    const response = await request(`/history/${encodeURIComponent(job.promptId)}`), history = (await response.json())?.[job.promptId];
    if (!history) return publicJob(job);
    const status = history.status?.status_str;
    if (status === "error") { job.status = "failed"; job.error = { code: "COMFYUI_TASK_FAILED", message: "ModelClaw generation failed" }; }
    else {
      const output = history.outputs?.["15"]?.videos?.[0];
      if (output?.filename) { job.status = "succeeded"; job.output = { filename: output.filename, subfolder: output.subfolder || "", type: output.type || "output" }; job.result = { filename: output.filename }; job.usage = { inputTokens: 0, outputTokens: 0, costMicros: 0, currency: "CNY", unitScale: 1_000_000, pricingVersion: "tailnet-local-compute/v1" }; }
    }
    job.updatedAt = now(); return publicJob(job);
  };
  const download = async (credential, jobId) => {
    const job = owned(credential, jobId);
    if (job.status !== "succeeded" || !job.output) throw new DomainError("NOT_FOUND", "ModelClaw result asset not found", 404);
    const query = new URLSearchParams(job.output), response = await request(`/view?${query}`), mimeType = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase(), declared = Number(response.headers.get("content-length") || 0);
    if (!VIDEO_MIMES.has(mimeType) || declared > config.maxAssetBytes) throw new DomainError("COMFYUI_ASSET_REJECTED", "ModelClaw result asset failed MIME or size validation", 502);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > config.maxAssetBytes) throw new DomainError("COMFYUI_ASSET_REJECTED", "ModelClaw result asset failed size validation", 502);
    return { mimeType, bytes };
  };
  return Object.freeze({ id: "comfyui", models, submit, poll, download });
}

export function createInferenceRouter(services = []) {
  const active = services.filter(Boolean), models = new Map(), jobs = new Map();
  for (const service of active) for (const model of service.models()) {
    if (models.has(model.name)) throw new DomainError("INFERENCE_CONFIG_INVALID", `duplicate inference model ${model.name}`, 503);
    models.set(model.name, service);
  }
  if (!active.length) return null;
  return Object.freeze({
    models: () => active.flatMap(service => service.models()),
    submit: async (principal, request) => { const service = models.get(request?.model); if (!service) throw new DomainError("INFERENCE_MODEL_UNAVAILABLE", "requested model is unavailable", 400); const job = await service.submit(principal, request); jobs.set(job.id, service); return job; },
    poll: (principal, jobId) => { const service = jobs.get(jobId) || active.find(item => jobId.startsWith(`${item.id}:`)); if (!service) throw new DomainError("NOT_FOUND", "inference job not found", 404); return service.poll(principal, jobId); },
    download: (principal, jobId) => { const service = jobs.get(jobId) || active.find(item => jobId.startsWith(`${item.id}:`)); if (!service) throw new DomainError("NOT_FOUND", "inference result asset not found", 404); return service.download(principal, jobId); },
  });
}
