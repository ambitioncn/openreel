#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = mkdtempSync(join(tmpdir(), "openreel-workbench-browser-"));
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
  throw new Error(`workbench server did not become ready: ${serverError}`);
}

async function exercise(browser, name, viewport) {
  const page = await browser.newPage({ viewport });
  const failures = [];
  page.on("pageerror", error => failures.push(`pageerror:${error.message}`));
  page.on("response", response => { if (response.status() >= 500) failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`); });
  await installLocalPlanningFixture(page);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.click("#show-register");
  await page.fill("#register-email", `${name}-${Date.now()}@openreel.invalid`);
  await page.fill("#register-password", "bounded-browser-pass-123");
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#creator-workbench:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#workflow-state")?.textContent?.startsWith("Ready:"));
  const initialProjectCount = await page.locator("#workbench-projects article").count();
  assert.ok(await page.locator("#workspace-shell").evaluate(element => element.classList.contains("workbench-mode")), "beginner workbench is not the default signed-in mode");
  assert.equal(await page.locator('#short-video-flow [aria-label="创作步骤"]').count(), 1, "guided flow lacks an accessible label");
  await page.click("#start-short-video");
  await page.fill("#short-video-brief", "三步拍出清晰的咖啡教学短片");
  await page.selectOption("#short-video-type", "knowledge");
  await page.selectOption("#short-video-duration", "30");
  await page.click("#short-video-brief-form button[type=submit]");
  await page.waitForSelector("#script-editor:not([hidden])");
  assert.equal(await page.locator("#workbench-projects article").count(), initialProjectCount + 1, "new creative must create a distinct work");
  assert.equal(await page.locator("#workbench-projects article.current strong").textContent(), "三步拍出清晰的咖啡教学短片");
  assert.equal(await page.locator('input[name="short-video-hook"]').count(), 3);
  assert.equal(await page.locator("#storyboard-shots article").count(), 3);
  await page.check('input[name="creative-target"][value="current"]');
  await page.fill("#short-video-brief", "明确选择当前作品后的新主题");
  await page.click("#short-video-brief-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#short-video-state")?.textContent?.includes("explicit confirmation"));
  assert.equal(await page.locator("#workbench-projects article").count(), initialProjectCount + 1, "unconfirmed current-work write must not create or overwrite a work");
  await page.check("#creative-current-confirm");
  await page.click("#short-video-brief-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("#short-video-state")?.textContent?.includes("已确认继续当前作品"));
  assert.equal(await page.locator("#workbench-projects article").count(), initialProjectCount + 1, "confirmed current-work write must retain explicit selected work");
  await page.fill("#short-video-script", `${name} 可编辑脚本正文`);
  await page.fill("#storyboard-shots article:first-child .shot-line", `${name} 第一镜台词`);
  await page.click("#save-script-storyboard");
  await page.waitForFunction(expected => document.querySelector("#editor-state")?.textContent?.includes("已保存") && document.querySelector("#short-video-script")?.value === expected, `${name} 可编辑脚本正文`);
  if (viewport.width <= 760) {
    const layout = await page.locator("#storyboard-shots article:first-child").evaluate(element => ({ columns: getComputedStyle(element).gridTemplateColumns.split(" ").length, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
    assert.equal(layout.columns, 1, "mobile storyboard editor must stack to one column");
    assert.equal(layout.overflow, false, "mobile workbench has horizontal overflow");
  }
  await page.click("#advanced-canvas");
  assert.ok(await page.locator("#creator-workbench").isHidden(), "advanced canvas toggle did not leave the workbench");
  await page.click("#workbench-home");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#script-editor:not([hidden])");
  assert.equal(await page.locator("#short-video-script").inputValue(), `${name} 可编辑脚本正文`);
  assert.equal(failures.length, 0, failures.join("\n"));
  await page.close();
  return { viewport: `${viewport.width}x${viewport.height}`, distinctWorkDefault: true, explicitCurrentWorkConfirmation: true, editableScript: true, editableStoryboard: true, persistenceReload: true, advancedCanvasReachable: true };
}

async function installLocalPlanningFixture(page) {
  await page.route(/\/api\/v1\/projects\/[^/]+\/workbench-plan$/, async route => {
    const request = route.request(), match = new URL(request.url()).pathname.match(/\/projects\/([^/]+)\/workbench-plan$/), projectId = match[1], input = request.postDataJSON(), headers = request.headers();
    const apiHeaders = { "content-type": "application/json", cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] };
    const scenes = [1, 2, 3].map(order => ({ title: `镜头 ${order}`, summary: `${input.brief} · 第 ${order} 段` }));
    const storyResponse = await fetch(`${base}/api/v1/projects/${projectId}/story`, { method: "PUT", headers: apiHeaders, body: JSON.stringify({ title: input.brief, synopsis: input.brief, hooks: ["问题切入", "结果先行", "三步教学"], selectedHook: 0, production: { voice: "natural", captions: true, music: "light", safeZone: "tiktok" }, scenes }) });
    assert.equal(storyResponse.status, 200); const story = await storyResponse.json();
    const shotDuration = Number(input.duration) / 3, storyboardResponse = await fetch(`${base}/api/v1/projects/${projectId}/storyboard`, { method: "PUT", headers: apiHeaders, body: JSON.stringify({ shots: story.scenes.map((scene, index) => ({ sceneId: scene.id, prompt: `${input.brief} · 画面 ${index + 1}`, duration: shotDuration })) }) });
    assert.equal(storyboardResponse.status, 200); const storyboard = await storyboardResponse.json();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ story, storyboard, planning: { model: "local-browser-fixture", jobId: "fixture", attempts: 1 } }) });
  });
}

let browser;
try {
  await ready();
  const systemChromium = "/snap/bin/chromium";
  const executablePath = process.env.OPENREEL_CHROMIUM_EXECUTABLE || (existsSync(systemChromium) ? systemChromium : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const desktop = await exercise(browser, "desktop", { width: 1440, height: 900 });
  const mobile = await exercise(browser, "mobile", { width: 390, height: 844 });
  console.log(JSON.stringify({ status: "passed", graphicalBrowser: "chromium", isolatedLoopback: true, providerCalls: 0, accessibilityLabels: true, desktop, mobile }));
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
}
