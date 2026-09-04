#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = mkdtempSync(join(tmpdir(), "openreel-publishing-browser-"));
const port = String(20000 + Math.floor(Math.random() * 20000));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: port, OPENREEL_DATABASE: join(root, "openreel.sqlite"), OPENREEL_ASSETS: join(root, "assets"), OPENREEL_PLATFORM: join(root, "platform.json"), OPENREEL_SESSION_SECRET: randomBytes(32).toString("hex") },
  stdio: ["ignore", "ignore", "pipe"]
});
let serverError = "";
child.stderr.on("data", chunk => { serverError += chunk; });

async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${base}/health/ready`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`publishing browser server did not become ready: ${serverError}`);
}

const accounts = { platforms: [
  { platform: "tiktok", status: "connected", accountId: "tiktok-owner", displayName: "TikTok Creator", canPublish: true, capabilities: { privacyOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], interactions: { comment: true, duet: false, stitch: true } } },
  { platform: "douyin", status: "connected", accountId: "douyin-owner", displayName: "抖音创作者", canPublish: true, capabilities: { privacyOptions: ["public", "private"] } },
  { platform: "instagram_reels", status: "connected", accountId: "instagram-owner", displayName: "Instagram Creator", canPublish: true, capabilities: { privacyOptions: [] } },
  { platform: "youtube_shorts", status: "connected", accountId: "youtube-owner", displayName: "YouTube Creator", canPublish: true, capabilities: { privacyOptions: ["private", "unlisted", "public"], audienceRequired: true } }
] };
const validatedBatch = { schema: "openreel-publishing-batch-view/v1", id: "browser-batch-1", confirmationRequired: true, canCancel: true, summary: { status: "awaiting_confirmation", counts: { awaiting_confirmation: 4 } }, destinations: [
  { platform: "tiktok", accountId: "tiktok-owner", state: "awaiting_confirmation", attempts: 0, retryable: false, error: null, remote: null },
  { platform: "douyin", accountId: "douyin-owner", state: "awaiting_confirmation", attempts: 0, retryable: false, error: null, remote: null },
  { platform: "instagram_reels", accountId: "instagram-owner", state: "awaiting_confirmation", attempts: 0, retryable: false, error: null, remote: null },
  { platform: "youtube_shorts", accountId: "youtube-owner", state: "awaiting_confirmation", attempts: 0, retryable: false, error: null, remote: null }
] };
const partialBatch = { schema: "openreel-publishing-batch-view/v1", id: "browser-batch-1", confirmationRequired: false, canCancel: true, summary: { status: "attention_required", counts: { failed: 1, unknown_remote: 1, published: 2 } }, destinations: [
  { platform: "tiktok", accountId: "tiktok-owner", state: "failed", attempts: 1, retryable: true, error: { message: "平台繁忙" }, remote: null },
  { platform: "douyin", accountId: "douyin-owner", state: "unknown_remote", attempts: 1, retryable: false, error: null, remote: null },
  { platform: "instagram_reels", accountId: "instagram-owner", state: "published", attempts: 1, retryable: false, error: null, remote: { id: "redacted-fixture" } },
  { platform: "youtube_shorts", accountId: "youtube-owner", state: "published", attempts: 1, retryable: false, error: null, remote: { id: "redacted-fixture" } }
] };

async function exercise(browser, name, viewport) {
  const page = await browser.newPage({ viewport });
  const calls = { create: 0, validate: 0, recover: 0, confirm: 0, advance: 0, retry: 0, cancel: 0, reconcile: 0 }, createdBodies = [];
  const failures = [];
  page.on("pageerror", error => failures.push(`pageerror:${error.message}`));
  await installLocalPlanningFixture(page);
  await page.route("**/api/v1/publishing/accounts", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(accounts) }));
  await page.route(/\/api\/v1\/publishing\/batches(?:\/[^/]+(?:\/[^/]+)?)?$/, async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    if (method === "POST" && path.endsWith("/batches")) { calls.create++; createdBodies.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(validatedBatch) }); }
    if (method === "POST" && path.endsWith("/validate")) { calls.validate++; return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(validatedBatch) }); }
    if (method === "GET") { calls.recover++; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(partialBatch) }); }
    if (path.endsWith("/retry")) calls.retry++;
    if (path.endsWith("/cancel")) calls.cancel++;
    if (path.endsWith("/reconcile")) calls.reconcile++;
    if (["/retry", "/cancel", "/reconcile"].some(suffix => path.endsWith(suffix))) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(partialBatch) });
    if (path.endsWith("/confirm")) calls.confirm++;
    if (path.endsWith("/advance")) calls.advance++;
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { message: "blocked in browser qualification" } }) });
  });
  await page.route(/\/api\/v1\/projects\/[^/]+$/, async route => {
    const response = await route.fetch(), value = await response.json();
    if (value.story && !value.assets.some(item => item.id === "render-browser-1")) value.assets.push({ id: "render-browser-1", role: "render", kind: "video", mimeType: "video/mp4", downloadUrl: "/browser-fixture.mp4", metadata: { sha256: "a".repeat(64) } });
    await route.fulfill({ response, json: value });
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.click("#show-register");
  await page.fill("#register-email", `${name}-${Date.now()}@openreel.invalid`);
  await page.fill("#register-password", "bounded-browser-pass-123");
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#creator-workbench:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#workflow-state")?.textContent?.startsWith("Ready:"));
  await page.click("#start-short-video");
  await page.fill("#short-video-brief", "一键发布浏览器验收短片");
  await page.click("#short-video-brief-form button[type=submit]");
  await page.waitForSelector("#final-workbench:not([hidden])");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#final-workbench:not([hidden])");
  await page.check('#publishing-destinations input[value="tiktok"]');
  await page.check('#publishing-destinations input[value="douyin"]');
  await page.check('#publishing-destinations input[value="instagram_reels"]');
  await page.check('#publishing-destinations input[value="youtube_shorts"]');
  await page.selectOption('#publishing-overrides [data-platform="tiktok"] select[name="privacy"]', "SELF_ONLY");
  await page.uncheck('#publishing-overrides [data-platform="tiktok"] input[name="allowComment"]');
  await page.evaluate(() => { const button = document.querySelector("#publishing-preflight"); button.click(); button.click(); });
  await page.waitForFunction(() => document.querySelectorAll("#publishing-results li").length === 4);
  assert.equal(await page.locator('#publishing-results li').filter({ hasText: "awaiting_confirmation" }).count(), 4, "all four destinations must pass validation");
  assert.equal(await page.locator("#publishing-confirm").isDisabled(), true, "final publication must stay disabled");
  assert.match(await page.locator("#publishing-progress").textContent(), /真实发布仍需主人/);
  assert.equal(calls.create, 1, "duplicate preflight clicks must create one batch");
  assert.equal(calls.validate, 1, "duplicate preflight clicks must validate once");
  if (viewport.width <= 760) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "mobile publishing UI has horizontal overflow");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#final-workbench:not([hidden])");
  await page.click("#publishing-recover");
  await page.waitForFunction(() => document.querySelectorAll("#publishing-results li").length === 4);
  assert.equal(await page.locator('#publishing-results li').filter({ hasText: "published" }).count(), 2);
  assert.equal(await page.locator('#publishing-results li').filter({ hasText: "failed" }).count(), 1);
  assert.equal(await page.locator('#publishing-results li').filter({ hasText: "unknown_remote" }).count(), 1);
  await page.click('[data-publishing-action="retry"]');
  await page.click('[data-publishing-action="reconcile"]');
  await page.click("#publishing-cancel");
  assert.deepEqual(calls, { create: 1, validate: 1, recover: 1, confirm: 0, advance: 0, retry: 1, cancel: 1, reconcile: 1 });
  assert.deepEqual(createdBodies[0].destinations, [
    { platform: "tiktok", accountId: "tiktok-owner", metadata: { privacy: "SELF_ONLY", allowComment: false, allowDuet: false, allowStitch: true } },
    { platform: "douyin", accountId: "douyin-owner", metadata: { privacy: "public" } },
    { platform: "instagram_reels", accountId: "instagram-owner", metadata: { shareToFeed: false } },
    { platform: "youtube_shorts", accountId: "youtube-owner", metadata: { privacy: "private", madeForKids: false } }
  ]);
  assert.equal(failures.length, 0, failures.join("\n"));
  await page.close();
  return { viewport: `${viewport.width}x${viewport.height}`, allDestinationValidation: true, duplicateClickSuppressed: true, partialFailureRecovery: true, retry: true, cancel: true, reconciliation: true, finalPublicationDisabled: true };
}

async function installLocalPlanningFixture(page) {
  await page.route(/\/api\/v1\/projects\/[^/]+\/workbench-plan$/, async route => {
    const request = route.request(), match = new URL(request.url()).pathname.match(/\/projects\/([^/]+)\/workbench-plan$/), projectId = match[1], input = request.postDataJSON(), headers = request.headers();
    const apiHeaders = { "content-type": "application/json", cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] };
    const storyResponse = await fetch(`${base}/api/v1/projects/${projectId}/story`, { method: "PUT", headers: apiHeaders, body: JSON.stringify({ title: input.brief, synopsis: input.brief, hooks: ["发布预检", "结果先行", "安全确认"], selectedHook: 0, production: { voice: "natural", captions: true, music: "light", safeZone: "tiktok" }, scenes: [1, 2, 3].map(order => ({ title: `镜头 ${order}`, summary: `发布验收 ${order}` })) }) });
    assert.equal(storyResponse.status, 200); const story = await storyResponse.json();
    const storyboardResponse = await fetch(`${base}/api/v1/projects/${projectId}/storyboard`, { method: "PUT", headers: apiHeaders, body: JSON.stringify({ shots: story.scenes.map((scene, index) => ({ sceneId: scene.id, prompt: `发布验收画面 ${index + 1}`, duration: Number(input.duration) / 3 })) }) });
    assert.equal(storyboardResponse.status, 200); const storyboard = await storyboardResponse.json();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ story, storyboard, planning: { model: "local-browser-fixture", jobId: "fixture", attempts: 1 } }) });
  });
}

let browser;
try {
  await ready();
  const executablePath = process.env.OPENREEL_CHROMIUM_EXECUTABLE || (existsSync("/snap/bin/chromium") ? "/snap/bin/chromium" : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const desktop = await exercise(browser, "desktop", { width: 1440, height: 900 });
  const mobile = await exercise(browser, "mobile", { width: 390, height: 844 });
  console.log(JSON.stringify({ status: "passed", graphicalBrowser: "chromium", isolatedLoopback: true, providerCalls: 0, publicationCalls: 0, desktop, mobile }));
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
}
