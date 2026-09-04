#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

const base = process.env.OPENREEL_BROWSER_E2E_BASE;
const sourcePath = process.env.OPENREEL_T01_VIDEO;
const evidencePath = process.env.OPENREEL_T01_EVIDENCE;
assert.ok(base?.startsWith("http://127.0.0.1:"), "browser E2E must target an isolated loopback server");
assert.ok(sourcePath, "OPENREEL_T01_VIDEO is required");
assert.ok(evidencePath, "OPENREEL_T01_EVIDENCE is required");
const sourceBytes = readFileSync(sourcePath);
assert.equal(sourceBytes.subarray(4, 8).toString(), "ftyp", "source is not an MP4 container");

const browser = await chromium.launch({ headless: true, executablePath: process.env.OPENREEL_CHROMIUM_EXECUTABLE || chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const failures = [];
page.on("pageerror", error => failures.push(`pageerror:${error.stack || error.message}`));
page.on("response", response => { if (response.status() >= 500) failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`); });

try {
  const marker = Date.now();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.click("#show-register");
  await page.fill("#register-email", `t01-real-video-${marker}@openreel.invalid`);
  await page.fill("#register-password", "bounded-browser-pass-123");
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#workspace-shell:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#workflow-state")?.textContent?.startsWith("Ready:"));

  await page.setInputFiles("#reference-upload", sourcePath);
  await page.waitForFunction(() => document.querySelector("#upload-state")?.textContent?.startsWith("Uploaded:"));
  const observed = await page.evaluate(async () => {
    const csrf = (await (await fetch("/api/v1/auth/csrf")).json()).csrfToken;
    const projects = await (await fetch("/api/v1/projects")).json();
    const project = projects.find(item => item.status === "active");
    const snapshot = await (await fetch(`/api/v1/projects/${project.id}`)).json();
    const assets = await (await fetch(`/api/v1/projects/${project.id}/assets`)).json();
    const source = assets.find(item => item.kind === "video" && item.role === "reference");
    if (!source) throw new Error("uploaded representative video is missing");
    const playback = await new Promise(resolve => {
      const video = document.createElement("video");
      const finish = loaded => resolve({ loaded, readyState: video.readyState, duration: video.duration, errorCode: video.error?.code || null });
      video.onloadeddata = () => finish(true);
      video.onerror = () => finish(false);
      video.src = source.downloadUrl;
      video.load();
    });
    const response = await fetch(`/api/v1/projects/${project.id}/timeline`, { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ version: snapshot.timeline.version, tracks: [{ kind: "video", clips: [{ assetId: source.id, inPoint: 0, outPoint: Math.min(3, playback.duration), start: 0 }] }] }) });
    if (!response.ok) throw new Error(`timeline update failed: ${response.status}`);
    return { projectId: project.id, source, playback };
  });
  assert.equal(observed.source.byteLength, sourceBytes.length);
  assert.equal(observed.playback.loaded, true, `source playback failed with code ${observed.playback.errorCode}`);
  assert.ok(observed.playback.duration >= 3, "representative source must be at least three seconds");

  await page.check("#render-reviewed");
  await page.click("#render-export");
  await page.waitForSelector("#render-download:not([hidden])");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#render-download");
  const download = await downloadPromise;
  const downloadPath = await download.path();
  assert.ok(downloadPath, "graphical download did not produce a local file");
  const downloadedBytes = readFileSync(downloadPath);
  assert.equal(downloadedBytes.subarray(4, 8).toString(), "ftyp", "download is not an MP4 container");
  assert.equal(failures.length, 0, failures.join("\n"));

  const evidence = {
    schema: "openreel-t01-real-video-browser-download-e2e/v1",
    status: "passed",
    scope: "isolated_loopback_graphical_browser",
    source: { origin: "locally-encoded-representative-multishot-video", mimeType: observed.source.mimeType, bytes: sourceBytes.length, sha256: createHash("sha256").update(sourceBytes).digest("hex"), browserPlayback: observed.playback },
    export: { format: "mp4", quality: "preview-360p", downloadedBytes: downloadedBytes.length, sha256: createHash("sha256").update(downloadedBytes).digest("hex"), signature: "ftyp", graphicalDownload: true },
    safety: { providerCalls: 0, paidModelCalls: 0, consumedProviderAuthorizationsReused: false, libtvLogin: false, deployments: 0, productionChanges: 0, publications: 0 },
    limitations: ["The representative input is a locally encoded real H.264/MP4 video, not a newly generated Provider output.", "Authenticated LibTV format and quality comparison is explicitly deferred."],
    projectCompletion: "in_progress"
  };
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await browser.close();
}
