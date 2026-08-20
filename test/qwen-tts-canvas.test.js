import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentStore } from "../src/core.js";
import { createOpenReelServer } from "../server.mjs";

const audioSpec = { intent: "voice", voice: "Narrator", speed: 1, pitch: 0, volume: 1, sampleRate: 16000, format: "wav" };
const wav = Buffer.alloc(44 + 32_000);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(32_000, 40);
const verified = { inputCharacters: 2, durationSeconds: 1, audioFormat: "pcm", bitsPerSample: 16, sampleRate: 16_000, channels: 1 };

function createFloatWav(factFrames = 16_000) {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(3, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(16_000, 4);
  format.writeUInt32LE(64_000, 8);
  format.writeUInt16LE(4, 12);
  format.writeUInt16LE(32, 14);
  const audio = Buffer.alloc(64_000);
  const fact = Buffer.alloc(4);
  fact.writeUInt32LE(factFrames);
  const payload = Buffer.concat([
    Buffer.from("WAVEfmt "), Buffer.from([16, 0, 0, 0]), format,
    Buffer.from("fact"), Buffer.from([4, 0, 0, 0]), fact,
    Buffer.from("data"), Buffer.from([0, 250, 0, 0]), audio,
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function fixture(store) {
  const project = store.createProject({ name: "Qwen canvas" });
  const session = store.createSession(project.id, { name: "Voice" });
  const node = store.createNode(session.id, { type: "audio" });
  return { project, session, node };
}

async function json(base, path, method = "GET", value) {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  return { status: response.status, body: await response.json() };
}

test("Qwen TTS canvas jobs are tenant-scoped, durable, reviewed and idempotent without calling a provider", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-qwen-canvas-")), "state.json"), store = createPersistentStore(file), { project, session, node } = fixture(store);
  let getterReads = 0;
  const accessorInput = { nodeId: node.id, reviewed: true, audioSpec, idempotencyKey: "accessor" };
  Object.defineProperty(accessorInput, "prompt", { enumerable: true, get: () => { getterReads += 1; return "hidden"; } });
  const hiddenInput = { nodeId: node.id, prompt: "你好", reviewed: true, audioSpec, idempotencyKey: "hidden" };
  Object.defineProperty(hiddenInput, "authorized", { value: true, enumerable: false });
  for (const input of [
    null,
    [],
    Object.create({ nodeId: node.id, prompt: "你好", reviewed: true, audioSpec, idempotencyKey: "inherited" }),
    { nodeId: node.id, prompt: "你好", reviewed: true, audioSpec, idempotencyKey: "unknown", authorized: true },
    { nodeId: node.id, prompt: "你好", reviewed: true, audioSpec, idempotencyKey: "symbol", [Symbol("authority")]: true },
    accessorInput,
    hiddenInput,
  ]) assert.throws(() => store.createQwenTtsCanvasJob(session.id, input), error => error.code === "QWEN_TTS_INPUT_INVALID");
  assert.equal(getterReads, 0);
  assert.throws(() => store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "你好", idempotencyKey: "q1", audioSpec }), error => error.code === "REVIEW_REQUIRED");
  assert.throws(() => store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "你好", idempotencyKey: "q1", reviewed: true, audioSpec: { ...audioSpec, format: "mp3" } }), error => error.code === "QWEN_TTS_INPUT_INVALID");
  assert.throws(() => store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "字".repeat(1001), idempotencyKey: "long", reviewed: true, audioSpec }), error => error.code === "QWEN_TTS_INPUT_INVALID");
  assert.throws(() => store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "你好", idempotencyKey: "optional-long", reviewed: true, audioSpec, instruct: "😀".repeat(501) }), error => error.code === "QWEN_TTS_INPUT_INVALID");
  const created = store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "你好", idempotencyKey: "q1", reviewed: true, audioSpec, language: "😀".repeat(500), duration: 2 });
  const replay = store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "你好", idempotencyKey: "q1", reviewed: true, audioSpec, language: "😀".repeat(500), duration: 2 });
  assert.equal(replay.id, created.id); assert.equal(created.state, "queued"); assert.equal(created.provider, "qwen-tts-tailnet"); assert.match(created.requestFingerprint, /^[a-f0-9]{64}$/);
  for (const drift of [
    { prompt: "不同" },
    { duration: 3 },
    { language: "zh" },
    { audioSpec: { ...audioSpec, voice: "Other" } },
  ]) assert.throws(() => store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "你好", idempotencyKey: "q1", reviewed: true, audioSpec, language: "😀".repeat(500), duration: 2, ...drift }), error => error.code === "IDEMPOTENCY_CONFLICT" && error.status === 409);
  assert.equal(store.snapshot(project.id).jobs.length, 1);
  const recovered = createPersistentStore(file), job = recovered.qwenTtsCanvasJob(created.id);
  assert.equal(job.prompt, "你好"); assert.equal(job.parameters.language, "😀".repeat(500)); assert.equal(recovered.snapshot(project.id).assets.length, 0);
});

test("validated Qwen WAV results become durable assets, timeline clips and export evidence", () => {
  const store = createPersistentStore(join(mkdtempSync(join(tmpdir(), "openreel-qwen-result-")), "state.json")), { project, session, node } = fixture(store);
  const created = store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "旁白", idempotencyKey: "q2", reviewed: true, audioSpec, duration: 3 });
  assert.throws(() => store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/mpeg", bytes: wav, durationSeconds: 1 }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.throws(() => store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/wav", bytes: wav }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.throws(() => store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/wav", bytes: wav, durationSeconds: 601 }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.throws(() => store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/wav", bytes: Buffer.from("not wav"), durationSeconds: 1, sampleRate: 16_000, channels: 1 }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.throws(() => store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/wav", bytes: wav, ...verified, durationSeconds: 2 }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.throws(() => store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/wav", bytes: wav, ...verified, sampleRate: 24_000 }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.throws(() => store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/wav", bytes: wav, ...verified, inputCharacters: 999 }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.throws(() => store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/wav", bytes: wav, ...verified, audioFormat: "ieee-float" }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.throws(() => store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/wav", bytes: wav, ...verified, bitsPerSample: 24 }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  const drifted = store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "采样率", idempotencyKey: "q3", reviewed: true, audioSpec: { ...audioSpec, sampleRate: 24_000 } });
  assert.throws(() => store.reconcileQwenTtsCanvasJob(drifted.id, { mimeType: "audio/wav", bytes: wav, ...verified, inputCharacters: 3 }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.equal(store.qwenTtsCanvasJob(drifted.id).state, "queued");
  const done = store.reconcileQwenTtsCanvasJob(created.id, { mimeType: "audio/wav", bytes: wav, ...verified });
  const snapshot = store.snapshot(project.id), manifest = store.exportManifest(project.id);
  assert.equal(done.state, "succeeded"); assert.equal(snapshot.assets[0].role, "result"); assert.equal(snapshot.assets[0].metadata.inputCharacters, 2); assert.equal(snapshot.assets[0].metadata.duration, 1); assert.equal(snapshot.assets[0].metadata.audioFormat, "pcm"); assert.equal(snapshot.assets[0].metadata.bitsPerSample, 16); assert.equal(snapshot.timeline.tracks[0].kind, "audio"); assert.equal(snapshot.timeline.tracks[0].clips[0].outPoint, 1); assert.equal(manifest.preview.duration, 1); assert.equal(manifest.assets[0].mimeType, "audio/wav");
  assert.deepEqual(store.assetContent(project.id, done.assetId).bytes, wav);
});

test("IEEE-float fact provenance is reverified before durable canvas mutation", () => {
  const store = createPersistentStore(join(mkdtempSync(join(tmpdir(), "openreel-qwen-float-result-")), "state.json")), { project, session, node } = fixture(store);
  const rejected = store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "浮点", idempotencyKey: "float-bad", reviewed: true, audioSpec });
  const malformed = createFloatWav(15_999);
  assert.throws(() => store.reconcileQwenTtsCanvasJob(rejected.id, {
    mimeType: "audio/wav", bytes: malformed, inputCharacters: 2, durationSeconds: 1,
    audioFormat: "ieee-float", bitsPerSample: 32, sampleRate: 16_000, channels: 1,
  }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.equal(store.qwenTtsCanvasJob(rejected.id).state, "queued");
  assert.equal(store.snapshot(project.id).assets.length, 0);
  assert.equal(store.exportManifest(project.id).assets.length, 0);

  const accepted = store.createQwenTtsCanvasJob(session.id, { nodeId: node.id, prompt: "浮点", idempotencyKey: "float-good", reviewed: true, audioSpec });
  const bytes = createFloatWav();
  const done = store.reconcileQwenTtsCanvasJob(accepted.id, {
    mimeType: "audio/wav", bytes, inputCharacters: 2, durationSeconds: 1,
    audioFormat: "ieee-float", bitsPerSample: 32, sampleRate: 16_000, channels: 1,
  });
  const snapshot = store.snapshot(project.id);
  assert.equal(done.state, "succeeded");
  assert.equal(snapshot.assets.length, 1);
  assert.equal(snapshot.assets[0].metadata.audioFormat, "ieee-float");
  assert.equal(snapshot.assets[0].metadata.bitsPerSample, 32);
  assert.equal(snapshot.timeline.tracks[0].clips[0].outPoint, 1);
  assert.deepEqual(store.assetContent(project.id, done.assetId).bytes, bytes);
});

test("HTTP creation remains local while execution fails closed unless a server-side gate authorizes it", async (t) => {
  let calls = 0;
  const service = { synthesize: async () => { calls += 1; return { mimeType: "audio/wav", bytes: wav, ...verified }; } };
  const denied = createOpenReelServer(undefined, undefined, { qwenTtsService: service, authorizeQwenTts: async () => "true" });
  await new Promise(resolve => denied.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => denied.close(resolve)));
  const base = `http://127.0.0.1:${denied.address().port}`;
  const models = await json(base, "/api/v1/models");
  const qwen = models.body.find(model => model.id === "qwen-tts-tailnet");
  assert.equal(qwen.adapterId, "qwen-tts");
  assert.equal(qwen.schema.execution, "server-authorized-only");
  const project = (await json(base, "/api/v1/projects", "POST", { name: "Denied" })).body;
  const session = (await json(base, `/api/v1/projects/${project.id}/sessions`, "POST", { name: "Voice" })).body;
  const node = (await json(base, `/api/v1/sessions/${session.id}/nodes`, "POST", { type: "audio" })).body;
  const created = await json(base, `/api/v1/sessions/${session.id}/qwen-tts-jobs`, "POST", { nodeId: node.id, prompt: "门控", idempotencyKey: "http-q1", reviewed: true, audioSpec, duration: 2 });
  assert.equal(created.status, 201); assert.equal(calls, 0);
  const run = await json(base, `/api/v1/jobs/${created.body.id}/qwen-tts-run`, "POST", {});
  assert.equal(run.status, 403); assert.equal(run.body.error.code, "QWEN_TTS_CALL_GATED"); assert.equal(calls, 0);
});
