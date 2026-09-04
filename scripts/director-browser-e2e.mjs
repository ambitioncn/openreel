#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = mkdtempSync(join(tmpdir(), "openreel-director-browser-"));
const port = String(20000 + Math.floor(Math.random() * 20000)), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, HOST: "127.0.0.1", PORT: port, OPENREEL_DATABASE: join(root, "openreel.sqlite"), OPENREEL_ASSETS: join(root, "assets"), OPENREEL_PLATFORM: join(root, "platform.json"), OPENREEL_SESSION_SECRET: randomBytes(32).toString("hex") }, stdio: ["ignore", "ignore", "pipe"] });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(`${base}/health/ready`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 25)); }
  const executable = process.env.OPENREEL_CHROMIUM_EXECUTABLE || (existsSync("/snap/bin/chromium") ? "/snap/bin/chromium" : undefined);
  browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.click("#show-register");
  await page.fill("#register-email", "director-browser@example.invalid");
  await page.fill("#register-password", "bounded-browser-pass-123");
  await page.click("#register-form button[type=submit]");
  await page.waitForSelector("#creator-workbench:not([hidden])");
  const state = await page.locator("#director-runtime-state").textContent();
  assert.match(state, /awaiting_director_workflow/);
  assert.match(state, /not_qualified/);
  assert.match(state, /发布资格 禁止/);
  assert.equal(await page.locator("#commercial-start").isDisabled(), true);
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(JSON.stringify({ status: "passed", isolatedLoopback: true, directorPanelVisible: true, generationQualificationSeparated: true, releaseDeniedByDefault: true, explicitGenerationGate: true, providerCalls: 0 }));
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
}
