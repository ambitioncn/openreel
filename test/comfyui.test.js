import test from "node:test";
import assert from "node:assert/strict";
import { createComfyUiService, createInferenceRouter, loadComfyUiConfig } from "../src/comfyui.js";

const workflow = {
  "1": { class_type: "UnetLoaderGGUF", inputs: { unet_name: "MiniMax-H3-FL2VA-Pruned-Q5_K_M.gguf" } },
  "5": { class_type: "MiniMaxH3TurboLoRA", inputs: { lora_name: "minimax_h3_turbo_v4_step600_ema.safetensors" } },
  "6": { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "old", width: 960, height: 544, length: 124 } },
  "7": { class_type: "RandomNoise", inputs: { noise_seed: 1 } },
  "9": { class_type: "MiniMaxH3TurboSampler", inputs: {} },
  "15": { class_type: "SaveVideo", inputs: {} },
};

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body instanceof Uint8Array ? body : JSON.stringify(body), { status, headers: body instanceof Uint8Array ? headers : { "content-type": "application/json", ...headers } });
}

test("ModelClaw config is disabled by default and pins the reviewed Tailnet endpoint", () => {
  assert.equal(loadComfyUiConfig({}).enabled, false);
  const config = loadComfyUiConfig({ OPENREEL_MODELCLAW_COMFYUI_ENABLED: "true" });
  assert.equal(config.baseUrl, "http://100.66.206.27:8188");
  assert.equal(config.model, "minimax-h3-fl2va-q5-turbo-v4");
  assert.throws(() => loadComfyUiConfig({ OPENREEL_MODELCLAW_COMFYUI_ENABLED: "TRUE" }), error => error.code === "COMFYUI_CONFIG_INVALID");
  assert.throws(() => loadComfyUiConfig({ OPENREEL_MODELCLAW_COMFYUI_BASE_URL: "http://127.0.0.1:8188" }), error => error.code === "COMFYUI_CONFIG_INVALID");
});

test("ModelClaw service submits the pinned workflow, polls, and downloads the video", async () => {
  const calls = [], platform = { authenticateApiKey: key => { assert.equal(key, "key"); return { account: { id: "owner" } }; } };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/api/userdata/")) return response(workflow);
    if (url.endsWith("/prompt")) {
      const submitted = JSON.parse(options.body).prompt;
      assert.equal(submitted["6"].inputs.prompt, "A cinematic product reveal");
      assert.notEqual(submitted["7"].inputs.noise_seed, 1);
      return response({ prompt_id: "prompt-1" });
    }
    if (url.includes("/history/")) return response({ "prompt-1": { status: { status_str: "success" }, outputs: { "15": { videos: [{ filename: "result.mp4", subfolder: "video", type: "output" }] } } } });
    if (url.includes("/view?")) return response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected ${url}`);
  };
  const service = createComfyUiService({ config: loadComfyUiConfig({ OPENREEL_MODELCLAW_COMFYUI_ENABLED: "true" }), platform, fetchImpl, id: () => "job-1", now: () => "2026-08-30T00:00:00.000Z" });
  const submitted = await service.submit("key", { model: "minimax-h3-fl2va-q5-turbo-v4", capability: "video", input: { prompt: "A cinematic product reveal" }, idempotencyKey: "same" });
  assert.equal(submitted.status, "running");
  assert.equal((await service.submit("key", { model: submitted.model, capability: "video", input: { prompt: "ignored on replay" }, idempotencyKey: "same" })).id, submitted.id);
  const complete = await service.poll("key", submitted.id);
  assert.equal(complete.status, "succeeded");
  assert.equal(complete.usage.costMicros, 0);
  assert.deepEqual(await service.download("key", submitted.id), { mimeType: "video/mp4", bytes: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]) });
  assert.equal(calls.filter(call => call.url.endsWith("/prompt")).length, 1);
});

test("ModelClaw recognizes SaveVideo MP4 metadata returned in ComfyUI images", async () => {
  const platform = { authenticateApiKey: () => ({ account: { id: "owner" } }) };
  const fetchImpl = async (url) => {
    if (url.includes("/api/userdata/")) return response(workflow);
    if (url.endsWith("/prompt")) return response({ prompt_id: "prompt-save-video" });
    if (url.includes("/history/")) return response({
      "prompt-save-video": {
        status: { status_str: "success", completed: true },
        outputs: { "15": { images: [{ filename: "result.mp4", subfolder: "video", type: "output" }], animated: [true] } },
      },
    });
    if (url.includes("/view?")) return response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected ${url}`);
  };
  const service = createComfyUiService({ config: loadComfyUiConfig({ OPENREEL_MODELCLAW_COMFYUI_ENABLED: "true" }), platform, fetchImpl, id: () => "job-save-video" });
  const submitted = await service.submit("key", { model: "minimax-h3-fl2va-q5-turbo-v4", capability: "video", input: { prompt: "A cinematic product reveal" }, idempotencyKey: "save-video" });
  assert.equal((await service.poll("key", submitted.id)).status, "succeeded");
  assert.equal((await service.download("key", submitted.id)).mimeType, "video/mp4");
});

test("ModelClaw uploads and wires one first-frame reference", async () => {
  const platform = { authenticateApiKey: () => ({ account: { id: "owner" } }) }, image = Buffer.from("image-bytes");
  const fetchImpl = async (url, options = {}) => {
    if (url.includes("/api/userdata/")) return response(workflow);
    if (url.endsWith("/upload/image")) {
      assert.equal(options.method, "POST"); assert.ok(options.body instanceof FormData);
      return response({ name: "uploaded.png", subfolder: "", type: "input" });
    }
    if (url.endsWith("/prompt")) {
      const submitted = JSON.parse(options.body).prompt;
      assert.deepEqual(submitted["6"].inputs.first_frame, ["16", 0]);
      assert.deepEqual(submitted["16"], { class_type: "LoadImage", inputs: { image: "uploaded.png" } });
      return response({ prompt_id: "prompt-image" });
    }
    throw new Error(`unexpected ${url}`);
  };
  const service = createComfyUiService({ config: loadComfyUiConfig({ OPENREEL_MODELCLAW_COMFYUI_ENABLED: "true" }), platform, fetchImpl, id: () => "job-image" });
  const submitted = await service.submit("key", { model: "minimax-h3-fl2va-q5-turbo-v4", capability: "video", input: { content: [{ type: "text", text: "Animate this frame" }, { type: "image_url", role: "first_frame", image_url: { url: `data:image/png;base64,${image.toString("base64")}` } }] }, idempotencyKey: "image" });
  assert.equal(submitted.status, "running");
  assert.deepEqual(service.models()[0].schema.modes, ["text-to-video", "image-to-video"]);
  assert.equal(service.models()[0].schema.maxReferences, 1);
});

test("ModelClaw fails closed on workflow drift and unsupported references", async () => {
  const platform = { authenticateApiKey: () => ({ account: { id: "owner" } }) };
  const drift = structuredClone(workflow); drift["1"].inputs.unet_name = "other.gguf";
  const service = createComfyUiService({ config: loadComfyUiConfig({ OPENREEL_MODELCLAW_COMFYUI_ENABLED: "true" }), platform, fetchImpl: async () => response(drift) });
  await assert.rejects(() => service.submit("key", { model: "minimax-h3-fl2va-q5-turbo-v4", capability: "video", input: { prompt: "x" }, idempotencyKey: "a" }), error => error.code === "COMFYUI_WORKFLOW_DRIFT");
  await assert.rejects(() => service.submit("key", { model: "minimax-h3-fl2va-q5-turbo-v4", capability: "video", input: { content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "http://unsafe.example/image.png" } }] }, idempotencyKey: "b" }), error => error.code === "COMFYUI_INPUT_INVALID");
});

test("inference router exposes and routes ModelClaw without an Ark service", async () => {
  const service = { id: "comfyui", models: () => [{ name: "m", capability: "video" }], submit: async () => ({ id: "comfyui:job" }), poll: async () => "polled", download: async () => "downloaded" };
  const router = createInferenceRouter([null, service]);
  assert.deepEqual(router.models(), [{ name: "m", capability: "video" }]);
  assert.equal((await router.submit({}, { model: "m" })).id, "comfyui:job");
  assert.equal(await router.poll({}, "comfyui:job"), "polled");
  assert.equal(await router.download({}, "comfyui:job"), "downloaded");
});
