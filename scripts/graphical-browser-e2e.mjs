#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.OPENREEL_BROWSER_E2E_BASE;
assert.ok(base?.startsWith("http://127.0.0.1:"), "browser E2E must target an isolated loopback server");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const failures = [];
page.on("pageerror", error => failures.push(`pageerror:${error.message}`));
page.on("response", response => { if (response.status() >= 500) failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`); });

try {
  const marker = Date.now();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.click("#show-register");
  await page.fill("#register-email", `browser-e2e-${marker}@openreel.invalid`);
  await page.fill("#register-password", "bounded-browser-pass-123");
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#workspace-shell:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#workflow-state")?.textContent?.startsWith("Ready:"));

  await page.click('#node-tools button:has-text("video")');
  await page.waitForSelector(".node-video.selected");
  const localModel = await page.locator("#generation-model option").evaluateAll(options => options.map(option => option.value).find(value => value.toLowerCase().includes("local")) || "");
  assert.ok(localModel, "no local zero-provider video model is available");
  await page.selectOption("#generation-model", localModel);
  await page.fill("#generation-prompt", "Deterministic zero-provider graphical browser proof");
  await page.click("#generate");
  await page.waitForFunction(() => document.querySelector("#node-history")?.textContent?.includes("succeeded"));

  await page.click("#build-story");
  await page.waitForFunction(() => document.querySelector("#workflow-state")?.textContent?.startsWith("Success:"));
  await page.evaluate(async () => {
    const csrf = (await (await fetch("/api/v1/auth/csrf")).json()).csrfToken;
    const projects = await (await fetch("/api/v1/projects")).json();
    const project = projects.find(item => item.status === "active");
    const assets = await (await fetch(`/api/v1/projects/${project.id}/assets`)).json();
    const video = assets.find(item => item.kind === "video");
    if (!video) throw new Error("generated video asset is missing");
    const response = await fetch(`/api/v1/projects/${project.id}/timeline`, { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ version: 1, tracks: [{ kind: "video", clips: [{ assetId: video.id, inPoint: 0, outPoint: 1, start: 0 }] }] }) });
    if (!response.ok) throw new Error(`timeline update failed: ${response.status}`);
  });
  await page.check("#render-reviewed");
  await page.click("#render-export");
  await page.waitForSelector("#render-download:not([hidden])");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#render-download");
  const download = await downloadPromise;
  const path = await download.path();
  assert.ok(path, "render download did not produce a local file");
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(4, 8).toString(), "ftyp", "download is not an MP4 container");

  await page.click("#tutorials");
  await page.waitForSelector("#tutorial-dialog[open] .tutorial-card");
  const tutorialCount = await page.locator(".tutorial-card").count();
  assert.ok(tutorialCount > 0, "tutorial catalog is empty");
  await page.click("#tutorial-dialog .dialog-close");

  await page.click("#logout");
  await page.waitForSelector("#auth-shell:not([hidden])");
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(JSON.stringify({ status: "passed", graphicalBrowser: "chromium", viewport: "1440x900", registrationLogin: true, canvasVideoNode: true, localGeneration: true, storyStoryboard: true, reviewedMp4Download: true, mp4Bytes: bytes.length, mp4Signature: "ftyp", tutorialsVisible: tutorialCount, logout: true, providerCalls: 0 }));
} finally {
  await browser.close();
}
