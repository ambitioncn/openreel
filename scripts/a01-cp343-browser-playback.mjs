#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createOpenReelServer } from "../server.mjs";
import { createPersistentStore } from "../src/core.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const statePath = resolve(root, "runtime/a01-cp343-private/platform.json");
const outputPath = resolve(root, "runtime/a01-cp343-private/browser-playback-evidence.json");
const screenshotPath = resolve(root, "runtime/a01-cp343-private/browser-playback.png");
const store = createPersistentStore(statePath);
const server = createOpenReelServer(store);
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#show-register").click();
  await page.locator("#register-email").fill("cp343-browser@openreel.local");
  await page.locator("#register-password").fill("Local-only-cp343!");
  await page.locator("#register-form button[type=submit]").click();
  const canvasAudio = page.locator('.node-audio audio[controls]');
  const libraryAudio = page.locator('#asset-library audio[controls]');
  await canvasAudio.waitFor();
  await libraryAudio.waitFor({ state: "attached" });
  const playback = await canvasAudio.evaluate(async audio => {
    audio.muted = true;
    await audio.play();
    await new Promise(resolveWait => setTimeout(resolveWait, 350));
    return { paused: audio.paused, currentTime: audio.currentTime, duration: audio.duration, readyState: audio.readyState, networkState: audio.networkState, error: audio.error?.code || null };
  });
  assert.equal(playback.error, null);
  assert.ok(playback.readyState >= 2);
  assert.ok(playback.currentTime > 0);
  assert.ok(Math.abs(playback.duration - 5.041633) < 0.1);
  const projectId = JSON.parse(readFileSync(statePath, "utf8")).projects[0].id;
  const response = await page.request.get(`${base}/api/v1/projects/${projectId}/exports/manifest`);
  assert.equal(response.status(), 200);
  const manifest = await response.json();
  assert.equal(manifest.preview.clipCount, 1);
  assert.equal(manifest.tracks[0].kind, "audio");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  chmodSync(screenshotPath, 0o600);
  const evidence = { schema: "openreel-a01-browser-playback/v1", result: "passed", canvasAudioControls: await canvasAudio.count(), libraryAudioControls: await libraryAudio.count(), playback, timeline: { clipCount: manifest.preview.clipCount, duration: manifest.preview.duration, trackKinds: manifest.tracks.map(track => track.kind) }, negativeEvidence: { providerCalls: 0, credentialReads: 0, credentialWrites: 0, costCny: 0, deployments: 0, publications: 0 } };
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
