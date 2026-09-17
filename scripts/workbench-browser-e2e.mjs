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
  assert.equal(await page.locator("html").getAttribute("lang"), "en", "English must be the default locale");
  assert.deepEqual(await page.locator("[data-language-selector]").evaluateAll(selects => selects.map(select => select.value)), ["en", "en"], "language selectors must start in sync");
  assert.equal(await page.locator('#short-video-flow [aria-label="Creation steps"]').count(), 1, "English guided flow lacks an accessible label");
  await page.locator("[data-language-selector]").first().selectOption("zh-CN");
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN", "Simplified Chinese locale was not applied");
  assert.deepEqual(await page.locator("[data-language-selector]").evaluateAll(selects => selects.map(select => select.value)), ["zh-CN", "zh-CN"], "language selectors did not stay in sync");
  assert.equal(await page.locator('#short-video-flow [aria-label="创作步骤"]').count(), 1, "Chinese guided flow lacks an accessible label");
  await page.locator("[data-language-selector]").first().selectOption("en");
  await page.click("#show-register");
  await page.fill("#register-email", `${name}-${Date.now()}@openreel.invalid`);
  await page.fill("#register-password", "bounded-browser-pass-123");
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#creator-workbench:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#workflow-state")?.textContent?.startsWith("Ready:"));
  const initialProjectCount = await page.locator("#workbench-projects article").count();
  assert.ok(await page.locator("#workspace-shell").evaluate(element => element.classList.contains("workbench-mode")), "beginner workbench is not the default signed-in mode");
  assert.equal(new URL(page.url()).hash, "#home");
  assert.equal(await page.locator('[data-route][aria-current="page"]').textContent(), "Home");
  assert.ok(await page.locator(".topbar-brand strong").isVisible(), "OpenReel title is obscured");
  assert.equal(await page.locator(".topbar").evaluate(element => element.scrollWidth <= element.clientWidth), true, "topbar overflows horizontally");
  const navHeights = await page.locator(".primary-tabs [data-route]").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  assert.ok(Math.max(...navHeights) - Math.min(...navHeights) <= 1, "primary navigation buttons are not consistently sized");
  const languageAlignment = async () => page.locator(".topbar .language-picker").evaluate(label => { const a = label.getBoundingClientRect(), b = label.querySelector("select").getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2); });
  assert.ok(await languageAlignment() <= 1, "English language selector is not vertically aligned");
  await page.click("#projects-page-nav");
  await page.waitForSelector('[data-workspace-page="projects"]:not([hidden])');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "Projects page has horizontal overflow");
  assert.doesNotMatch(await page.locator('[data-workspace-page="projects"] .page-heading').innerText(), /[\u3400-\u9fff]/, "English Projects page heading still contains Chinese");
  const typography = await page.locator('[data-workspace-page="projects"]').evaluate(section => ({ heading: parseFloat(getComputedStyle(section.querySelector("h1")).fontSize), body: parseFloat(getComputedStyle(section.querySelector(".page-heading > p:last-child")).fontSize), metadata: parseFloat(getComputedStyle(section.querySelector(".project-open small")).fontSize) }));
  assert.ok(typography.heading >= 28 && typography.body >= 14 && typography.metadata >= 13, `Projects typography is not legible: ${JSON.stringify(typography)}`);
  const projectActionHeights = await page.locator("#workbench-projects article:first-child > div button").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  assert.ok(Math.max(...projectActionHeights) - Math.min(...projectActionHeights) <= 1, "English project actions are not vertically aligned");
  await page.click("#projects-back");
  assert.equal(new URL(page.url()).hash, "#home", "Projects Back button did not return home");
  await page.click("#projects-page-nav");
  await page.click("#toggle-new-project");
  await page.fill("#new-project-name", "Disposable browser project");
  await page.click("#new-project-form button[type=submit]");
  try { await page.waitForFunction(() => document.querySelector("#workbench-projects article.current strong")?.textContent === "Disposable browser project", null, { timeout: 5000 }); }
  catch (error) { throw new Error(`disposable project did not become current: ${JSON.stringify({ cards: await page.locator("#workbench-projects article strong").allTextContents(), state: await page.locator("#workflow-state").textContent(), shelf: await page.locator("#project-shelf-state").textContent(), failures })}`, { cause: error }); }
  assert.equal(await page.locator("#workbench-projects article").count(), initialProjectCount + 1, "creating a disposable project did not add exactly one card");
  page.once("dialog", dialog => dialog.dismiss());
  await page.click("#workbench-projects article.current .project-delete");
  assert.equal(await page.locator("#workbench-projects article").count(), initialProjectCount + 1, "canceling deletion removed the project");
  page.once("dialog", dialog => dialog.accept("Disposable browser project"));
  await page.click("#workbench-projects article.current .project-delete");
  await page.waitForFunction(count => document.querySelectorAll("#workbench-projects article").length === count, initialProjectCount);
  assert.match(await page.locator("#project-shelf-state").textContent(), /Deleted/);
  await page.click("#workspace-menu summary");
  await page.click("#connections-page-nav");
  await page.waitForSelector('[data-workspace-page="connections"]:not([hidden])');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "Connections page has horizontal overflow");
  assert.doesNotMatch(await page.locator('[data-workspace-page="connections"]:not([hidden])').innerText(), /[\u3400-\u9fff]/, "English Connections page still contains Chinese");
  await page.goBack();
  await page.waitForSelector('[data-workspace-page="projects"]:not([hidden])');
  assert.equal(new URL(page.url()).hash, "#projects", "browser Back did not restore the Projects route");
  await page.goForward();
  await page.waitForSelector('[data-workspace-page="connections"]:not([hidden])');
  assert.equal(new URL(page.url()).hash, "#connections", "browser Forward did not restore the Connections route");
  await page.click("#workbench-home");
  assert.equal(await page.locator('#short-video-flow [aria-label="Creation steps"]').count(), 1, "guided flow lacks an accessible label");
  await page.click("#start-short-video");
  assert.equal(new URL(page.url()).hash, "#creator", "create must navigate to a dedicated Creator Workspace route");
  assert.ok(await page.locator(".workbench-hero").isHidden(), "home hero leaked into Creator Workspace");
  assert.equal(await page.locator('label:has(input[name="intake-source"][value="copy"])').textContent(), "Paste existing script");
  assert.doesNotMatch(await page.locator("#creator-workbench").innerText(), /[\u3400-\u9fff]/, "English Creator Workspace still contains Chinese");
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
  await page.waitForFunction(() => document.querySelector("#short-video-state")?.textContent?.includes("Confirmed continuing the current project"));
  assert.equal(await page.locator("#workbench-projects article").count(), initialProjectCount + 1, "confirmed current-work write must retain explicit selected work");
  await page.fill("#short-video-script", `${name} 可编辑脚本正文`);
  await page.fill("#storyboard-shots article:first-child .shot-line", `${name} 第一镜台词`);
  await page.click("#save-script-storyboard");
  await page.waitForFunction(expected => document.querySelector("#editor-state")?.textContent?.includes("Saved") && document.querySelector("#short-video-script")?.value === expected, `${name} 可编辑脚本正文`);
  for (const target of ["brief-panel", "script-editor", "storyboard-editor", "generation-workbench", "final-workbench"]) {
    await page.click(`[data-step-target="${target}"]`);
    assert.equal(await page.evaluate(id => document.activeElement?.id === id, target), true, `step navigation did not focus ${target}`);
    assert.equal(await page.locator(`[data-step-target="${target}"]`).evaluate(button => button.closest("li").classList.contains("active")), true, `step navigation did not activate ${target}`);
  }
  assert.equal(await page.locator('input[name="commercial-generation-mode"]:checked').inputValue(), "text_to_video", "commercial generation must default to text-to-video");
  assert.equal(await page.locator("#commercial-reference-controls").isHidden(), true, "reference safety fields must stay hidden in text-to-video mode");
  assert.equal(await page.locator("#commercial-quote").isEnabled(), true, "text-to-video cost review must not require an image");
  assert.doesNotMatch(await page.locator("#commercial-mode-help").textContent(), /[\u3400-\u9fff]/, "English text-to-video guidance contains Chinese");
  await page.check('input[name="commercial-generation-mode"][value="reference_consistency"]');
  assert.equal(await page.locator("#commercial-reference-controls").isVisible(), true, "reference safety fields must appear in consistency mode");
  assert.equal(await page.locator("#commercial-quote").isDisabled(), true, "reference mode must block cost review until an image is bound");
  await page.check('input[name="commercial-generation-mode"][value="text_to_video"]');
  assert.equal(await page.locator("#commercial-quote").isEnabled(), true, "switching back to text-to-video must restore cost review");
  if (viewport.width <= 760) {
    const layout = await page.locator("#storyboard-shots article:first-child").evaluate(element => ({ columns: getComputedStyle(element).gridTemplateColumns.split(" ").length, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
    assert.equal(layout.columns, 1, "mobile storyboard editor must stack to one column");
    assert.equal(layout.overflow, false, "mobile workbench has horizontal overflow");
  }
  await page.click("#workspace-menu summary");
  await page.click("#advanced-canvas");
  assert.ok(await page.locator("#creator-workbench").isHidden(), "advanced canvas toggle did not leave the workbench");
  assert.ok(await page.locator(".canvas-guide").isVisible(), "advanced canvas guidance is missing");
  const nodesBeforeDelete = await page.locator(".node").count();
  await page.locator("#node-tools button").first().click();
  await page.waitForFunction(count => document.querySelectorAll(".node").length === count + 1, nodesBeforeDelete);
  page.once("dialog", dialog => dialog.accept());
  await page.click("#delete-node");
  await page.waitForFunction(count => document.querySelectorAll(".node").length === count, nodesBeforeDelete);
  await page.click("#tutorials");
  await page.waitForSelector("#tutorials-page:not([hidden])");
  assert.equal(await page.locator("#tutorial-walkthrough li").count(), 6, "tutorial walkthrough does not expose six ordered steps");
  assert.doesNotMatch(await page.locator("#tutorial-walkthrough").innerText(), /[\u3400-\u9fff]/, "English tutorial walkthrough contains Chinese");
  await page.locator(".tutorial-card").first().click();
  const englishTutorial = await page.locator("#tutorials-page").innerText();
  assert.doesNotMatch(englishTutorial, /[\u3400-\u9fff]/, "English tutorial page still contains Chinese");
  assert.ok((await page.locator(".tutorial-shortcut option").allTextContents()).every(label => !/[\u3400-\u9fff]/u.test(label)), "English Reviewed Shortcut labels still contain Chinese");
  await page.locator("[data-language-selector]").last().selectOption("zh-CN");
  assert.ok(await languageAlignment() <= 1, "Chinese language selector is not vertically aligned");
  assert.match(await page.locator("#tutorial-walkthrough").innerText(), /用六个清晰步骤制作视频/, "Chinese tutorial walkthrough is missing");
  await page.locator(".tutorial-card").first().click();
  assert.match(await page.locator("#tutorials-page").innerText(), /[\u3400-\u9fff]/, "Simplified Chinese tutorial content is missing");
  await page.locator("[data-language-selector]").last().selectOption("en");
  assert.doesNotMatch(await page.locator("#tutorials-page").innerText(), /[\u3400-\u9fff]/, "switching tutorials back to English left Chinese behind");
  await page.locator(".tutorial-card").filter({ hasText: "15-second premium product ad" }).click();
  assert.match(await page.locator(".tutorial-explainer").innerText(), /wizard|向导/i);
  const tutorialNodesBefore = await page.locator(".node").count();
  await page.click(".tutorial-start");
  await page.waitForFunction(() => document.querySelector("#creator-workbench")?.hidden === true);
  assert.equal(await page.locator(".node").count(), tutorialNodesBefore + 5, "product tutorial did not add its five-node blueprint");
  await page.click("#tutorials");
  await page.locator(".tutorial-card").filter({ hasText: "15-second premium product ad" }).click();
  await page.click(".tutorial-start");
  assert.equal(await page.locator(".node").count(), tutorialNodesBefore + 5, "opening an existing tutorial created duplicate nodes");
  await page.click("#tutorials");
  await page.locator(".tutorial-card").filter({ hasText: "15-second premium product ad" }).click();
  await page.click(".tutorial-create");
  assert.equal(new URL(page.url()).hash, "#creator", "tutorial handoff did not open Create");
  assert.equal(await page.locator('input[name="creative-target"][value="current"]').isChecked(), true, "tutorial handoff did not preserve the current project");
  assert.equal(await page.locator('input[name="intake-source"][value="copy"]').isChecked(), true, "tutorial handoff did not choose existing copy");
  assert.equal(await page.locator("#short-video-type").inputValue(), "product");
  assert.equal(await page.locator("#short-video-duration").inputValue(), "15");
  await page.click("#creator-workspace");
  await page.locator("[data-language-selector]").last().selectOption("zh-CN");
  assert.match(await page.locator('label:has(input[name="intake-source"][value="copy"])').textContent(), /粘贴已有文案/);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#script-editor:not([hidden])");
  assert.equal(new URL(page.url()).hash, "#creator", "Creator Workspace route did not persist across reload");
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN", "locale preference did not persist across reload");
  assert.deepEqual(await page.locator("[data-language-selector]").evaluateAll(selects => selects.map(select => select.value)), ["zh-CN", "zh-CN"], "persisted locale did not synchronize selectors");
  assert.equal(await page.locator("#short-video-script").inputValue(), `${name} 可编辑脚本正文`);
  assert.equal(failures.length, 0, failures.join("\n"));
  await page.close();
  return { viewport: `${viewport.width}x${viewport.height}`, defaultEnglish: true, simplifiedChineseSwitch: true, localePersistenceReload: true, dedicatedRoutes: true, browserHistory: true, projectsBack: true, safeProjectDeletion: true, stepNavigation: true, textToVideoDefault: true, optionalReferenceMode: true, structuredHeader: true, languageAlignment: true, tutorialWalkthrough: true, distinctWorkDefault: true, explicitCurrentWorkConfirmation: true, editableScript: true, editableStoryboard: true, persistenceReload: true, advancedCanvasGuidance: true, nodeDeletion: true, englishTutorials: true, localizedShortcuts: true };
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
