#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const base = process.env.OPENREEL_BROWSER_E2E_BASE, packetPath = process.env.OPENREEL_BROWSER_PACKET;
assert.ok(base?.startsWith("http://127.0.0.1:"));
const packet = JSON.parse(readFileSync(packetPath, "utf8"));
const executablePath = process.env.OPENREEL_BROWSER_EXECUTABLE_PATH?.trim();
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"], ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.fill("#login-email", packet.email); await page.fill("#login-password", packet.password); await page.click('#login-form button[type="submit"]');
  await page.waitForSelector("#workspace-shell:not([hidden])");
  const observed = await page.evaluate(async ({ projectId, assetId }) => {
    const assets = await (await fetch(`/api/v1/projects/${projectId}/assets`)).json();
    const project = await (await fetch(`/api/v1/projects/${projectId}`)).json();
    const assetUrl = `/api/v1/projects/${projectId}/assets/${assetId}/content`;
    const response = await fetch(assetUrl); if (!response.ok) throw new Error(`asset load failed: ${response.status}`);
    const blob = await response.blob(), url = URL.createObjectURL(blob), video = document.createElement("video"); video.muted = true; video.src = url; document.body.append(video);
    const observe = target => new Promise(resolve => { const timer = setTimeout(() => resolve({ loaded: false, duration: null, reason: "timeout", mediaErrorCode: target.error?.code ?? null, canPlayType: target.canPlayType(blob.type) }), 30000); target.onloadedmetadata = async () => { clearTimeout(timer); try { await target.play(); } catch {} resolve({ loaded: true, duration: target.duration, readyState: target.readyState, reason: null, mediaErrorCode: null, canPlayType: target.canPlayType(blob.type) }); }; target.onerror = () => { clearTimeout(timer); resolve({ loaded: false, duration: null, reason: "media_error", mediaErrorCode: target.error?.code ?? null, canPlayType: target.canPlayType(blob.type) }); }; target.load(); });
    const playback = await observe(video);
    const directVideo = document.createElement("video"); directVideo.muted = true; directVideo.src = assetUrl; document.body.append(directVideo);
    const directPlayback = await observe(directVideo);
    URL.revokeObjectURL(url);
    const clips = project.timeline.tracks.filter(track => track.kind === "video").flatMap(track => track.clips);
    return { assetCount: assets.length, clipCount: clips.length, mimeType: blob.type, bytes: blob.size, playback, directPlayback };
  }, packet);
  if (observed.mimeType !== "video/mp4" || observed.bytes <= 0 || observed.clipCount !== 1 || !observed.directPlayback.loaded || !(observed.directPlayback.duration > 0)) {
    process.stdout.write(JSON.stringify({ status: "stopped", acceptanceStage: "browser_playback", graphicalBrowser: "chromium", isolatedLoopback: true, ...observed }) + "\n");
    throw Object.assign(new Error("browser playback acceptance failed"), { code: "BROWSER_PLAYBACK_FAILED" });
  }
  process.stdout.write(JSON.stringify({ status: "passed", graphicalBrowser: "chromium", isolatedLoopback: true, assetCount: observed.assetCount, videoClipCount: observed.clipCount, mimeType: observed.mimeType, bytes: observed.bytes, blobObjectUrlPlayback: observed.playback, directAssetUrlPlayback: observed.directPlayback, playbackMetadataLoaded: true, playbackDurationSeconds: observed.directPlayback.duration }) + "\n");
} finally { await browser.close(); }
