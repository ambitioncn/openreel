#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenReelServer } from "../server.mjs";
import { createPersistentStore } from "../src/core.js";
import { createQwenTtsClient, loadQwenTtsConfig } from "../src/qwen-tts.js";

const authorization = "CP278-BEIJING-STAGING-QWEN-ONE-CALL";
const prompt = "你好，这是 OpenReel 北京 staging 单次语音验收。";
const outputDir = resolve(process.env.OPENREEL_CP278_OUTPUT || "./cp278-evidence");
const reservationFile = join(outputDir, "reservation.json");
const resultFile = join(outputDir, "result.json");
const stateFile = join(outputDir, "openreel-state.json");
const wavFile = join(outputDir, "qwen-result.wav");

mkdirSync(outputDir, { recursive: true, mode: 0o700 });
writeFileSync(reservationFile, `${JSON.stringify({ version: 1, authorization, status: "reserved", providerCalls: 0 }, null, 2)}\n`, { flag: "wx", mode: 0o600 });

let providerCalls = 0;
const countedFetch = async (url, options) => {
  providerCalls += 1;
  if (providerCalls !== 1) throw new Error("single-call budget exceeded");
  return fetch(url, options);
};
const qwenTtsService = createQwenTtsClient({
  config: loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" }),
  fetchImpl: countedFetch,
  timeoutMs: 60_000,
});
const store = createPersistentStore(stateFile);
const project = store.createProject({ name: "CP278 Beijing staging" });
const session = store.createSession(project.id, { name: "Qwen one-call acceptance" });
const node = store.createNode(session.id, { type: "audio" });
const server = createOpenReelServer(store, undefined, {
  qwenTtsService,
  authorizeQwenTts: async ({ job }) => job.prompt === prompt && providerCalls === 0,
});
let terminal = { version: 1, authorization, status: "failed_before_submission", providerCalls: 0, retries: 0 };

async function json(base, path, method = "GET", value) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  return { status: response.status, body: await response.json() };
}

try {
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await json(base, `/api/v1/sessions/${session.id}/qwen-tts-jobs`, "POST", {
    nodeId: node.id,
    prompt,
    idempotencyKey: `cp278-${randomUUID()}`,
    reviewed: true,
    language: "chinese",
    duration: 1,
    audioSpec: { intent: "voice", speed: 1, pitch: 0, volume: 1, sampleRate: 24000, format: "wav" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(providerCalls, 0);

  const executed = await json(base, `/api/v1/jobs/${created.body.id}/qwen-tts-run`, "POST", {});
  assert.equal(providerCalls, 1);
  assert.equal(executed.status, 201, JSON.stringify(executed.body));
  assert.equal(executed.body.state, "succeeded");

  const snapshot = await json(base, `/api/v1/projects/${project.id}`);
  assert.equal(snapshot.status, 200);
  const asset = snapshot.body.assets.find(item => item.id === executed.body.assetId);
  assert.ok(asset);
  const response = await fetch(`${base}${asset.downloadUrl}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.ok(bytes.length > 44);
  assert.equal(snapshot.body.timeline.tracks.filter(track => track.kind === "audio").flatMap(track => track.clips).length, 1);
  writeFileSync(wavFile, bytes, { flag: "wx", mode: 0o600 });

  terminal = {
    version: 1,
    authorization,
    status: "succeeded",
    providerCalls,
    retries: 0,
    environment: { host: "beijing-staging", loopbackOnly: true, productionServiceChanged: false },
    request: { endpoint: "http://100.124.97.3:8004/v1/audio/speech", inputCharacters: [...prompt].length, language: "chinese", responseFormat: "wav" },
    result: {
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mimeType: asset.mimeType,
      durationSeconds: asset.metadata.duration,
      sampleRate: asset.metadata.sampleRate,
      channels: asset.metadata.channels,
      audioFormat: asset.metadata.audioFormat,
      bitsPerSample: asset.metadata.bitsPerSample,
    },
    durable: { jobState: executed.body.state, assetCount: snapshot.body.assets.length, timelineAudioClipCount: 1, downloadStatus: response.status },
    cost: { ceilingCny: 30, estimatedCny: 0, basis: "owner-operated Tailnet model; no paid-provider or billing endpoint used" },
    externalActions: { qwenSynthesisRequests: 1, retries: 0, deployments: 0, productionServiceChanges: 0, credentialChanges: 0, publicWrites: 0 },
  };
} catch (error) {
  terminal = {
    version: 1,
    authorization,
    status: providerCalls === 0 ? "failed_before_submission" : "terminal_failure_after_single_call",
    providerCalls,
    retries: 0,
    error: { name: error?.name || "Error", code: error?.code || null, message: error?.message || "unknown failure" },
    externalActions: { qwenSynthesisRequests: providerCalls, retries: 0, deployments: 0, productionServiceChanges: 0, credentialChanges: 0, publicWrites: 0 },
  };
} finally {
  if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
  writeFileSync(resultFile, `${JSON.stringify(terminal, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  writeFileSync(reservationFile, `${JSON.stringify({ version: 1, authorization, status: providerCalls === 0 ? "reserved" : "consumed", providerCalls }, null, 2)}\n`, { mode: 0o600 });
}

console.log(JSON.stringify({ status: terminal.status, providerCalls, retries: 0, evidence: resultFile }));
if (terminal.status !== "succeeded") process.exitCode = 1;
