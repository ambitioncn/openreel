#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createOpenReelServer } from "../server.mjs";
import { createMemoryStore } from "../src/core.js";

const playwrightModule = process.env.OPENREEL_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.OPENREEL_PLAYWRIGHT_MODULE).href
  : "playwright";
const { chromium } = await import(playwrightModule);

let providerCalls = 0;
const qwenTtsService = {
  models: () => [],
  synthesize: async () => {
    providerCalls += 1;
    throw new Error("negative E2E must never synthesize");
  },
};
const server = createOpenReelServer(createMemoryStore(), undefined, {
  qwenTtsService,
  authorizeQwenTts: async () => false,
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
page.on("pageerror", error => failures.push(`pageerror:${error.message}`));
page.on("response", response => {
  if (response.status() >= 500) failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`);
});

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.click("#show-register");
  await page.fill("#register-email", `qwen-negative-${Date.now()}@openreel.invalid`);
  await page.fill("#register-password", "bounded-browser-pass-123");
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#workspace-shell:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#workflow-state")?.textContent?.startsWith("Ready:"));

  await page.click('#node-tools button:has-text("audio")');
  await page.waitForSelector(".node-audio.selected");
  await page.selectOption("#generation-model", "qwen-tts-tailnet");
  assert.equal(await page.locator("#qwen-fields").isVisible(), true);
  assert.equal(await page.locator("#generate").textContent(), "Prepare Qwen voice job");
  assert.match(await page.locator("#generation-safety").textContent(), /cannot call Qwen TTS/);
  await page.fill("#generation-prompt", "浏览器门控验证");
  await page.fill("#audio-voice", "Narrator");
  await page.fill("#audio-language", "Chinese");
  await page.fill("#audio-instruct", "warm");
  await page.check("#audio-reviewed");
  await page.click("#generate");
  await page.waitForFunction(() => document.querySelector("#generation-state")?.textContent?.includes("No voice was generated"));

  const observed = await page.evaluate(async () => {
    const projects = await (await fetch("/api/v1/projects")).json();
    const project = projects.find(item => item.status === "active");
    const snapshot = await (await fetch(`/api/v1/projects/${project.id}`)).json();
    const jobs = snapshot.nodes.flatMap(node => node.runs || []);
    return {
      assets: snapshot.assets.length,
      jobs: jobs.map(job => ({ state: job.state, provider: job.provider, parameters: job.parameters })),
    };
  });
  assert.equal(observed.assets, 0);
  assert.equal(observed.jobs.length, 1);
  assert.equal(observed.jobs[0].state, "queued");
  assert.equal(observed.jobs[0].provider, "qwen-tts-tailnet");
  assert.equal("authorized" in observed.jobs[0].parameters, false);
  assert.equal("execute" in observed.jobs[0].parameters, false);
  assert.equal(providerCalls, 0);
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(JSON.stringify({ status: "passed", graphicalBrowser: "chromium", isolatedLoopback: true, qwenModelVisible: true, queuedJobs: 1, retainedAudioAssets: 0, providerCalls }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
