#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createOpenReelServer } from "../server.mjs";
import { createPersistentStore } from "../src/core.js";
import { createQwenTtsClient, loadQwenTtsConfig } from "../src/qwen-tts.js";

const exactInput = "你好，这是 OpenReel 语音链路测试。";
const authorization = "A-01-QWEN-CHINESE-ONE-CALL-V2";
const evidenceDir = join(process.cwd(), "docs", "evidence", "a01-qwen-one-call-v2");
const evidenceFile = join(evidenceDir, "result.json");
const reservationFile = join(evidenceDir, "reservation.json");
const stateFile = join(evidenceDir, "openreel-state.json");
const wavFile = join(evidenceDir, "qwen-result.wav");
const screenshotFile = join(evidenceDir, "browser-result.png");

mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
if (existsSync(evidenceFile)) {
  throw new Error(`${authorization} has already been executed; refusing another request`);
}
if (existsSync(reservationFile)) {
  const reservation = JSON.parse(readFileSync(reservationFile, "utf8"));
  if (reservation.authorization !== authorization || reservation.status !== "reserved" || reservation.providerCalls !== 0) {
    throw new Error(`${authorization} reservation is not safely resumable`);
  }
} else {
  writeFileSync(reservationFile, `${JSON.stringify({ version: 2, authorization, status: "reserved", providerCalls: 0 }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}

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
const server = createOpenReelServer(store, undefined, {
  qwenTtsService,
  authorizeQwenTts: async ({ job }) => job.prompt === exactInput && providerCalls === 0,
});
const playwrightModule = process.env.OPENREEL_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.OPENREEL_PLAYWRIGHT_MODULE).href
  : "playwright";
const playwright = await import(playwrightModule);
const { chromium } = playwright.default || playwright;
let browser;
let terminal = { status: "failed_before_submission", providerCalls: 0 };

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserFailures = [];
  page.on("pageerror", error => browserFailures.push(`pageerror:${error.message}`));
  page.on("response", response => {
    if (response.status() >= 500) browserFailures.push(`http:${response.status()}:${new URL(response.url()).pathname}`);
  });

  await page.goto(base, { waitUntil: "networkidle" });
  await page.click("#show-register");
  await page.fill("#register-email", `qwen-one-call-${Date.now()}@openreel.invalid`);
  await page.fill("#register-password", "private-qwen-evidence-123");
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#workspace-shell:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#workflow-state")?.textContent?.startsWith("Ready:"));
  await page.click('#node-tools button:has-text("audio")');
  await page.waitForSelector(".node-audio.selected");
  await page.selectOption("#generation-model", "qwen-tts-tailnet");
  await page.fill("#generation-prompt", exactInput);
  await page.fill("#audio-language", "chinese");
  await page.selectOption("#audio-sample-rate", "24000");
  await page.check("#audio-reviewed");
  await page.click("#generate");
  await page.waitForFunction(() => document.querySelector("#generation-state")?.textContent?.includes("No voice was generated"));

  const execution = await page.evaluate(async () => {
    const projects = await (await fetch("/api/v1/projects")).json();
    const project = projects.find(item => item.status === "active");
    const snapshot = await (await fetch(`/api/v1/projects/${project.id}`)).json();
    const job = snapshot.nodes.flatMap(node => node.runs || []).find(item => item.provider === "qwen-tts-tailnet");
    const response = await fetch(`/api/v1/jobs/${job.id}/qwen-tts-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return { status: response.status, body: await response.json(), projectId: project.id, jobId: job.id };
  });
  assert.equal(providerCalls, 1);
  assert.equal(execution.status, 201, JSON.stringify(execution.body));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#workspace-shell:not([hidden])");
  const observed = await page.evaluate(async ({ projectId, jobId }) => {
    const snapshot = await (await fetch(`/api/v1/projects/${projectId}`)).json();
    const job = snapshot.nodes.flatMap(node => node.runs || []).find(item => item.id === jobId);
    const asset = snapshot.assets.find(item => item.id === job.assetId);
    const response = await fetch(asset.downloadUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const playback = await new Promise(resolve => {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve({ loaded: true, duration: audio.duration });
      audio.onerror = () => resolve({ loaded: false, duration: null });
      audio.src = asset.downloadUrl;
    });
    return {
      job: { id: job.id, state: job.state, assetId: job.assetId },
      asset,
      timeline: snapshot.timeline,
      download: { status: response.status, contentType: response.headers.get("content-type"), byteLength: bytes.length },
      playback,
    };
  }, execution);
  assert.equal(observed.job.state, "succeeded");
  assert.equal(observed.download.status, 200);
  assert.equal(observed.download.contentType, "audio/wav");
  assert.equal(observed.playback.loaded, true);
  assert.equal(browserFailures.length, 0, browserFailures.join("\n"));

  const retained = store.assetContent(execution.projectId, observed.job.assetId).bytes;
  writeFileSync(wavFile, retained, { mode: 0o600 });
  await page.screenshot({ path: screenshotFile, fullPage: true });
  terminal = {
    version: 1,
    authorization,
    status: "succeeded",
    providerCalls,
    retries: 0,
    paidSpendAuthorized: false,
    request: { endpoint: "http://100.124.97.3:8004/v1/audio/speech", inputCharacters: [...exactInput].length, responseFormat: "wav", language: "chinese", optionalVoiceFieldsSent: false },
    result: {
      byteLength: retained.length,
      sha256: createHash("sha256").update(retained).digest("hex"),
      mimeType: observed.asset.mimeType,
      durationSeconds: observed.asset.metadata.duration,
      sampleRate: observed.asset.metadata.sampleRate,
      channels: observed.asset.metadata.channels,
      audioFormat: observed.asset.metadata.audioFormat,
      bitsPerSample: observed.asset.metadata.bitsPerSample,
    },
    durable: {
      jobState: observed.job.state,
      assetCount: 1,
      timelineAudioClipCount: observed.timeline.tracks.filter(track => track.kind === "audio").flatMap(track => track.clips).length,
      browserDownloadStatus: observed.download.status,
      browserPlaybackMetadataLoaded: observed.playback.loaded,
      browserPlaybackDuration: observed.playback.duration,
    },
    privateEvidence: ["openreel-state.json", "qwen-result.wav", "browser-result.png"],
    externalActions: { qwenSynthesisRequests: 1, deployments: 0, credentialChanges: 0, publicWrites: 0, libtvWrites: 0 },
  };
} catch (error) {
  terminal = {
    version: 1,
    authorization,
    status: providerCalls === 0 ? "failed_before_submission" : "terminal_failure_after_single_call",
    providerCalls,
    retries: 0,
    error: { name: error?.name || "Error", code: error?.code || null, message: error?.message || "unknown failure", details: error?.details || null },
    externalActions: { qwenSynthesisRequests: providerCalls, deployments: 0, credentialChanges: 0, publicWrites: 0, libtvWrites: 0 },
  };
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  writeFileSync(evidenceFile, `${JSON.stringify(terminal, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  writeFileSync(reservationFile, `${JSON.stringify({ version: 2, authorization, status: providerCalls === 0 ? "reserved" : "consumed", providerCalls }, null, 2)}\n`, { mode: 0o600 });
}

console.log(JSON.stringify({ status: terminal.status, providerCalls, retries: 0, evidence: evidenceFile }));
if (terminal.status !== "succeeded") process.exitCode = 1;
