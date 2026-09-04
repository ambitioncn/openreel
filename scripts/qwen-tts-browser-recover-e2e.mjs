#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createOpenReelServer } from "../server.mjs";
import { createPersistentStore } from "../src/core.js";

const evidenceDir = join(process.cwd(), "docs", "evidence", "a01-qwen-one-call-v2");
const stateFile = join(evidenceDir, "openreel-state.json");
const reservation = JSON.parse(readFileSync(join(evidenceDir, "reservation.json"), "utf8"));
assert.deepEqual({ status: reservation.status, providerCalls: reservation.providerCalls }, { status: "consumed", providerCalls: 1 });

let forbiddenProviderCalls = 0;
const store = createPersistentStore(stateFile);
const server = createOpenReelServer(store, undefined, {
  qwenTtsService: { synthesize: async () => { forbiddenProviderCalls += 1; throw new Error("provider calls are forbidden during recovery"); } },
  authorizeQwenTts: async () => false,
});
const playwrightModule = process.env.OPENREEL_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.OPENREEL_PLAYWRIGHT_MODULE).href
  : "playwright";
const playwright = await import(playwrightModule);
const { chromium } = playwright.default || playwright;
let browser;

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  page.on("pageerror", error => failures.push(`pageerror:${error.message}`));
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && !(response.status() === 401 && path === "/api/v1/auth/me")) failures.push(`http:${response.status()}:${path}`);
  });
  await page.goto(base, { waitUntil: "networkidle" });
  const observed = await page.evaluate(async () => {
    const projects = await (await fetch("/api/v1/projects")).json();
    const project = projects.find(item => item.status === "active");
    const snapshot = await (await fetch(`/api/v1/projects/${project.id}`)).json();
    const job = snapshot.nodes.flatMap(node => node.runs || []).find(item => item.provider === "qwen-tts-tailnet");
    const asset = snapshot.assets.find(item => item.id === job.assetId);
    const response = await fetch(asset.downloadUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const playback = await new Promise(resolve => {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve({ loaded: true, duration: audio.duration });
      audio.onerror = () => resolve({ loaded: false, duration: null });
      audio.src = asset.downloadUrl;
      document.body.replaceChildren(audio);
    });
    document.body.insertAdjacentHTML("afterbegin", `<main style="font:20px system-ui;padding:32px"><h1>OpenReel Qwen TTS retained evidence</h1><p>Job: ${job.state}</p><p>Asset: ${asset.mimeType}, ${asset.metadata.duration}s, ${asset.metadata.sampleRate}Hz mono</p></main>`);
    return {
      jobState: job.state,
      assetCount: snapshot.assets.length,
      audioClipCount: snapshot.timeline.tracks.filter(track => track.kind === "audio").flatMap(track => track.clips).length,
      download: { status: response.status, contentType: response.headers.get("content-type"), byteLength: bytes.length },
      playback,
    };
  });
  assert.equal(observed.jobState, "succeeded");
  assert.equal(observed.assetCount, 1);
  assert.equal(observed.audioClipCount, 1);
  assert.deepEqual(observed.download, { status: 200, contentType: "audio/wav", byteLength: 165164 });
  assert.equal(observed.playback.loaded, true);
  assert.ok(Math.abs(observed.playback.duration - 3.44) < 0.05);
  assert.equal(forbiddenProviderCalls, 0);
  assert.deepEqual(failures, []);
  await page.screenshot({ path: join(evidenceDir, "browser-recovered-result.png"), fullPage: true });
  const result = { version: 1, status: "passed", providerCalls: 0, jobState: observed.jobState, assetCount: observed.assetCount, timelineAudioClipCount: observed.audioClipCount, download: observed.download, playback: observed.playback, screenshot: "browser-recovered-result.png" };
  writeFileSync(join(evidenceDir, "browser-recovered-result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
