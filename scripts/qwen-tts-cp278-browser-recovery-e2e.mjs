#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createOpenReelServer } from "../server.mjs";
import { createPersistentStore } from "../src/core.js";

const evidenceDir = join(process.cwd(), "docs", "evidence", "cp278-beijing-qwen-one-call");
const source = JSON.parse(readFileSync(join(evidenceDir, "result.json"), "utf8"));
const bytes = readFileSync(join(evidenceDir, "qwen-result.wav"));
assert.equal(source.status, "succeeded");
assert.equal(source.providerCalls, 1);
assert.equal(createHash("sha256").update(bytes).digest("hex"), source.result.sha256);

let forbiddenProviderCalls = 0;
const store = createPersistentStore(join(evidenceDir, "browser-recovery-state.json"));
const project = store.createProject({ name: "CP278 retained real-media browser recovery" });
const session = store.createSession(project.id, { name: "Recovered Qwen audio" });
const node = store.createNode(session.id, { type: "audio" });
const job = store.createQwenTtsCanvasJob(session.id, {
  nodeId: node.id,
  prompt: "你好，这是 OpenReel 北京 staging 单次语音验收。",
  idempotencyKey: "cp278-browser-recovery",
  reviewed: true,
  language: "chinese",
  duration: 1,
  audioSpec: { intent: "voice", speed: 1, pitch: 0, volume: 1, sampleRate: 24000, format: "wav" },
});
const reconciled = store.reconcileQwenTtsCanvasJob(job.id, {
  mimeType: source.result.mimeType,
  bytes,
  inputCharacters: source.request.inputCharacters,
  durationSeconds: source.result.durationSeconds,
  sampleRate: source.result.sampleRate,
  channels: source.result.channels,
  audioFormat: source.result.audioFormat,
  bitsPerSample: source.result.bitsPerSample,
});
const server = createOpenReelServer(store, undefined, {
  qwenTtsService: { synthesize: async () => { forbiddenProviderCalls += 1; throw new Error("provider calls forbidden during retained-media recovery"); } },
  authorizeQwenTts: async () => false,
});
const modulePath = process.env.OPENREEL_PLAYWRIGHT_MODULE;
assert.ok(modulePath, "OPENREEL_PLAYWRIGHT_MODULE is required");
const playwright = await import(pathToFileURL(modulePath).href);
const { chromium } = playwright.default || playwright;
let browser;

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: "/snap/bin/chromium" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  page.on("pageerror", error => failures.push(`pageerror:${error.message}`));
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && !(response.status() === 401 && path === "/api/v1/auth/me")) failures.push(`http:${response.status()}:${path}`);
  });
  await page.goto(base, { waitUntil: "networkidle" });
  const observed = await page.evaluate(async ({ projectId, assetId }) => {
    const snapshot = await (await fetch(`/api/v1/projects/${projectId}`)).json();
    const asset = snapshot.assets.find(item => item.id === assetId);
    const response = await fetch(asset.downloadUrl);
    const downloaded = new Uint8Array(await response.arrayBuffer());
    const playback = await new Promise(resolve => {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve({ loaded: true, duration: audio.duration });
      audio.onerror = () => resolve({ loaded: false, duration: null });
      audio.src = asset.downloadUrl;
      document.body.replaceChildren(audio);
    });
    document.body.insertAdjacentHTML("afterbegin", `<main style="font:20px system-ui;padding:32px"><h1>OpenReel Beijing Qwen retained media</h1><p>Job: succeeded</p><p>Asset: ${asset.mimeType}, ${asset.metadata.duration}s, ${asset.metadata.sampleRate}Hz mono</p></main>`);
    return {
      assetCount: snapshot.assets.length,
      audioClipCount: snapshot.timeline.tracks.filter(track => track.kind === "audio").flatMap(track => track.clips).length,
      download: { status: response.status, contentType: response.headers.get("content-type"), byteLength: downloaded.length },
      playback,
    };
  }, { projectId: project.id, assetId: reconciled.assetId });
  assert.equal(forbiddenProviderCalls, 0);
  assert.equal(observed.assetCount, 1);
  assert.equal(observed.audioClipCount, 1);
  assert.deepEqual(observed.download, { status: 200, contentType: "audio/wav", byteLength: bytes.length });
  assert.equal(observed.playback.loaded, true);
  assert.ok(Math.abs(observed.playback.duration - source.result.durationSeconds) < 0.05);
  assert.deepEqual(failures, []);
  await page.screenshot({ path: join(evidenceDir, "browser-recovery.png"), fullPage: true });
  const result = { version: 1, status: "passed", providerCalls: 0, sourceProviderCalls: 1, sourceSha256: source.result.sha256, assetCount: observed.assetCount, timelineAudioClipCount: observed.audioClipCount, download: observed.download, playback: observed.playback, screenshot: "browser-recovery.png" };
  writeFileSync(join(evidenceDir, "browser-recovery.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
