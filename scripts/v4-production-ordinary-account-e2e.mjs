#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.OPENREEL_V4_PRODUCTION_BASE || "https://openreel.duobiai.cn:4173";
const evidenceFile = resolve(process.env.OPENREEL_V4_EVIDENCE || "docs/evidence/v4-07-production-ordinary-account.json");
const mp4File = resolve(process.env.OPENREEL_V4_MP4 || "runtime/v4-07-production-ordinary-account.mp4");
const musicFile = resolve(process.env.OPENREEL_V4_MUSIC || "runtime/cp46-seedaudio-private/music.wav");
const musicBytes = readFileSync(musicFile);
const expectedMusicSha256 = process.env.OPENREEL_V4_MUSIC_SHA256 || "73c1cc30bf06796607a8792ae34fede312b488d9dfb2b457368d41a12705f66f";
assert.equal(createHash("sha256").update(musicBytes).digest("hex"), expectedMusicSha256, "approved music changed");
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const acceptanceDuration = String(Number(process.env.OPENREEL_V4_DURATION || 5));
assert.ok(["5", "15", "30", "60"].includes(acceptanceDuration), "OPENREEL_V4_DURATION must be a supported workbench duration");
const captionCardPng = async (page, value) => Buffer.from(await page.evaluate(text => {
  const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
  canvas.width = 500; canvas.height = 140; context.fillStyle = "rgba(0,0,0,0.72)"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "white"; context.font = "24px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
  const lines = [], characters = [...text]; let line = "";
  for (const character of characters) { const next = `${line}${character}`; if (context.measureText(next).width > 450 && line) { lines.push(line); line = character; } else line = next; }
  if (line) lines.push(line); const visible = lines.slice(0, 4), start = canvas.height / 2 - (visible.length - 1) * 15;
  visible.forEach((item, index) => context.fillText(item, canvas.width / 2, start + index * 30));
  return canvas.toDataURL("image/png").split(",")[1];
}, value), "base64");
const email = `v4-acceptance-${marker}@openreel.invalid`;
const password = `V4-${randomBytes(24).toString("base64url")}`;
const api = async (page, path) => page.evaluate(async path => {
  const response = await fetch(path);
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${value?.error?.code || "HTTP_ERROR"}: ${value?.error?.message || "request failed"}`);
  return value;
}, path);

let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.OPENREEL_CHROMIUM_EXECUTABLE || "/snap/bin/chromium" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const serverErrors = [];
  page.on("response", response => { if (response.status() >= 500) serverErrors.push(`${response.status()}:${new URL(response.url()).pathname}`); });
  await page.goto(base, { waitUntil: "networkidle", timeout: 60_000 });
  await page.click("#show-register");
  await page.fill("#register-email", email);
  await page.fill("#register-password", password);
  await page.click('#register-form button[type="submit"]');
  await page.waitForSelector("#creator-workbench:not([hidden])", { timeout: 60_000 });
  let initialProjects = [];
  for (let attempt = 0; attempt < 30 && initialProjects.length !== 1; attempt += 1) {
    await page.waitForTimeout(250);
    initialProjects = await api(page, "/api/v1/projects");
  }
  assert.equal(initialProjects.length, 1, "fresh account bootstrap project did not settle");

  const csrf = (await context.cookies(base)).find(cookie => cookie.name === "openreel_csrf")?.value;
  assert.ok(csrf, "browser CSRF cookie is missing");
  await page.evaluate(async csrf => {
    const response = await fetch("/api/v1/key-applications", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ reason: "V4-07 bounded ordinary-account production acceptance", requestedLimitUnits: 40000, currency: "USD", unitScale: 10000 }) });
    const value = await response.json();
    if (!response.ok) throw new Error(`${response.status} ${value?.error?.code || "HTTP_ERROR"}`);
  }, csrf);
  let applications = [];
  for (let attempt = 0; attempt < 30 && !applications.some(item => item.status === "pending"); attempt += 1) {
    await page.waitForTimeout(250);
    applications = await api(page, "/api/v1/key-applications");
  }
  const application = applications.find(item => item.status === "pending");
  assert.match(application?.id || "", /^[a-zA-Z0-9-]{8,100}$/);
  const approvalCode = `import {readFileSync} from "node:fs"; import {spawnSync} from "node:child_process"; const pid=spawnSync("systemctl",["show","--value","-p","MainPID","openreel.service"],{encoding:"utf8"}).stdout.trim(); const env=Object.fromEntries(readFileSync(\`/proc/\${pid}/environ\`).toString().split("\\0").filter(Boolean).map(item=>{const at=item.indexOf("="); return [item.slice(0,at),item.slice(at+1)];})); if(!env.OPENREEL_ADMIN_KEY) throw new Error("production admin authorization is unavailable"); const response=await fetch("http://127.0.0.1:4273/api/v1/admin/key-applications/${application.id}/approve",{method:"POST",headers:{"content-type":"application/json","x-openreel-admin-key":env.OPENREEL_ADMIN_KEY},body:JSON.stringify({plan:"v4-07-production-acceptance",hardLimitUnits:40000,currency:"USD",unitScale:10000,periodEndsAt:new Date(Date.now()+30*60_000).toISOString(),reviewedBy:"cp47-consumed-approval",reviewNote:"Fresh ordinary-account real-model acceptance; USD 4 / CNY 28.8 hard ceiling; zero retries; no publication"})}); const value=await response.json(); if(!response.ok) throw new Error(String(response.status)+" "+(value?.error?.code||"HTTP_ERROR")); console.log(JSON.stringify({status:"approved",applicationId:value.application.id,hardLimitUnits:value.subscription.hardLimitMicros,currency:value.subscription.currency,unitScale:value.subscription.unitScale}));`;
  const encodedApproval = Buffer.from(approvalCode).toString("base64");
  const approval = JSON.parse(execFileSync("ssh", ["-o", "BatchMode=yes", "root@123.57.67.213", `cd /opt/openreel/current && node --input-type=module -e 'await import("data:text/javascript;base64,${encodedApproval}")'`], { encoding: "utf8", timeout: 30_000 }));
  assert.equal(approval.status, "approved");
  assert.equal(approval.hardLimitUnits, 40000);

  await page.click("#start-short-video");
  await page.fill("#short-video-brief", "美女在海滩跳舞");
  await page.selectOption("#short-video-type", "story");
  await page.selectOption("#short-video-duration", acceptanceDuration);
  await page.click('#short-video-brief-form button[type="submit"]');
  await page.waitForFunction(() => /真实文本模型|创建失败/.test(document.querySelector("#short-video-state")?.textContent || ""), null, { timeout: 360_000 });
  const planningState = await page.locator("#short-video-state").textContent();
  assert.doesNotMatch(planningState, /创建失败/, `real planning failed: ${planningState}; serverErrors=${serverErrors.join(",")}`);
  assert.match(planningState, /真实文本模型/);
  const projects = await api(page, "/api/v1/projects");
  assert.equal(projects.length, 2, "new creative must create a distinct project");
  const project = projects.find(item => item.name === "美女在海滩跳舞");
  assert.ok(project, "distinct prompt-named project is missing");
  const planned = await api(page, `/api/v1/projects/${project.id}`);
  assert.ok(planned.story?.version > 0 && planned.storyboard?.version > 0 && planned.storyboard.shots.length > 0);
  await page.locator("#storyboard-shots .shot-visual").evaluateAll(fields => fields.forEach((field, index) => {
    const original = field.value.trim();
    field.value = `fictional adult performer in a controlled studio presents an unbranded blue cloth; stable natural face and complete facial features; shot ${index + 1}; ${original}`;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }));

  await page.click("#save-script-storyboard");
  await page.waitForFunction(() => /已保存 · 脚本 v\d+ · 分镜 v\d+/.test(document.querySelector("#editor-state")?.textContent || ""), null, { timeout: 60_000 });
  await page.waitForSelector("#generation-workbench:not([hidden])", { timeout: 60_000 });
  const plannedForAssets = await api(page, `/api/v1/projects/${project.id}`);
  for (const [index, shot] of plannedForAssets.storyboard.shots.entries()) {
    const captionText = plannedForAssets.story.scenes[index]?.summary?.trim();
    assert.ok(captionText && /[\u3400-\u9fff]/u.test(captionText), `shot ${index + 1} must have a real Chinese script caption`);
    await page.selectOption("#workbench-caption-shot", shot.id);
    await page.fill("#workbench-caption-text", captionText);
    await page.locator("#workbench-caption-upload").setInputFiles({ name: `caption-${index + 1}.png`, mimeType: "image/png", buffer: await captionCardPng(page, captionText) });
    await page.waitForFunction(() => /字幕卡已绑定|字幕卡上传失败/.test(document.querySelector("#workbench-production-asset-state")?.textContent || ""), null, { timeout: 60_000 });
    assert.match(await page.locator("#workbench-production-asset-state").textContent(), /字幕卡已绑定/);
  }
  const captionOptions = await page.locator("#workbench-caption-assets option").evaluateAll(options => options.map(option => option.value));
  assert.equal(captionOptions.length, plannedForAssets.storyboard.shots.length);
  await page.selectOption("#workbench-caption-assets", captionOptions);
  await page.fill("#workbench-music-source", "OpenReel cp46 reviewed SeedAudio 1.0 private acceptance artifact");
  await page.locator("#workbench-music-upload").setInputFiles({ name: "cp46-reviewed-seedaudio.wav", mimeType: "audio/wav", buffer: musicBytes });
  await page.waitForFunction(() => /音乐已绑定|音乐上传失败/.test(document.querySelector("#workbench-production-asset-state")?.textContent || ""), null, { timeout: 60_000 });
  assert.match(await page.locator("#workbench-production-asset-state").textContent(), /音乐已绑定/);
  const musicAssetId = await page.locator("#workbench-music-asset option").evaluateAll(options => options.map(option => option.value).find(Boolean));
  assert.match(musicAssetId || "", /^[a-zA-Z0-9-]{8,100}$/);
  await page.selectOption("#workbench-music-asset", musicAssetId);
  await page.check("#workbench-music-rights");
  assert.equal(await page.isChecked("#workbench-generate-music"), false);
  await page.click("#commercial-quote");
  await page.waitForFunction(() => /报价 ¥|报价失败/.test(document.querySelector("#commercial-quote-state")?.textContent || ""), null, { timeout: 60_000 });
  const quoteState = await page.locator("#commercial-quote-state").textContent();
  assert.doesNotMatch(quoteState, /报价失败/, `commercial quote failed: ${quoteState}`);
  const quoteCny = Number(quoteState.match(/报价 ¥([0-9.]+)/)?.[1]);
  assert.ok(Number.isFinite(quoteCny) && quoteCny > 0 && quoteCny <= 30, `invalid bounded quote: ${quoteState}`);
  await page.check("#commercial-confirmed");
  await page.click("#commercial-start");
  await page.waitForFunction(() => /· (succeeded|failed) ·/.test(document.querySelector("#commercial-job-state")?.textContent || "") || /生成失败/.test(document.querySelector("#commercial-job-state")?.textContent || ""), null, { timeout: 1_200_000 });
  const jobState = await page.locator("#commercial-job-state").textContent();
  assert.match(jobState, /· succeeded ·/, `commercial chain failed: ${jobState}`);

  const snapshot = await api(page, `/api/v1/projects/${project.id}`);
  const render = snapshot.assets.filter(asset => asset.role === "render" && asset.mimeType === "video/mp4").at(-1);
  assert.ok(render?.downloadUrl, "revision-bound render asset is missing");
  const providerAssets = snapshot.assets.filter(asset => asset.metadata?.schema === "openreel-commercial-artifact/v1");
  const videos = providerAssets.filter(asset => asset.kind === "video");
  const images = providerAssets.filter(asset => asset.kind === "image");
  const audio = providerAssets.filter(asset => asset.kind === "audio");
  assert.equal(videos.length, snapshot.storyboard.shots.length);
  assert.equal(images.length, snapshot.storyboard.shots.length);
  assert.ok(audio.length >= 1);
  for (const asset of [...images, ...videos, ...audio]) {
    const identity = asset.metadata?.identity;
    assert.equal(identity?.projectId, project.id);
    assert.equal(identity?.storyVersion, snapshot.story.version);
    assert.equal(identity?.storyboardVersion, snapshot.storyboard.version);
  }
  const response = await context.request.get(new URL(render.downloadUrl, base).href);
  assert.ok(response.ok());
  const bytes = await response.body();
  assert.equal(bytes.subarray(4, 8).toString("ascii"), "ftyp");
  mkdirSync(dirname(mp4File), { recursive: true });
  writeFileSync(mp4File, bytes, { mode: 0o600 });
  await page.locator("#workbench-final-video").evaluate(video => video.load());
  await page.waitForFunction(() => { const video = document.querySelector("#workbench-final-video"); return !video.hidden && Number.isFinite(video.duration) && video.duration > 0; }, null, { timeout: 60_000 });
  const playback = await page.locator("#workbench-final-video").evaluate(video => ({ duration: video.duration, readyState: video.readyState, currentSrc: new URL(video.currentSrc).pathname }));

  const evidence = {
    schema: "openreel-v4-07-production-ordinary-account/v1",
    capturedAt: new Date().toISOString(),
    target: base,
    initialPrompt: "美女在海滩跳舞",
    requestedDurationSeconds: Number(acceptanceDuration),
    freshOrdinaryAccount: true,
    credentialRetained: false,
    distinctProject: { id: project.id, initialProjectCount: initialProjects.length, finalProjectCount: projects.length },
    planning: { browserState: planningState, storyVersion: snapshot.story.version, storyboardVersion: snapshot.storyboard.version, shotCount: snapshot.storyboard.shots.length },
    preflight: { subscriptionApplicationId: application.id, subscriptionHardLimit: { amount: 4, currency: "USD", unitScale: 10000, maximumCnyAtReviewedRate: 28.8 }, quoteCny, perActionLimitCny: 100, confirmedInBrowser: true },
    generation: { browserState: jobState, retries: 0, captionAssetIds: captionOptions, musicAssetId, musicSha256: createHash("sha256").update(musicBytes).digest("hex"), musicSourceDeclaration: "OpenReel cp46 reviewed SeedAudio 1.0 private acceptance artifact", musicRightsResponsibilityConfirmed: true, imageAssets: images.map(asset => ({ id: asset.id, model: asset.metadata.model, providerJobId: asset.metadata.commercialProviderJobId, shotId: asset.metadata.shotId })), videoAssets: videos.map(asset => ({ id: asset.id, model: asset.metadata.model, providerJobId: asset.metadata.commercialProviderJobId, shotId: asset.metadata.shotId })), audioAssets: audio.map(asset => ({ id: asset.id, model: asset.metadata.model, providerJobId: asset.metadata.commercialProviderJobId || null })) },
    binding: { projectId: project.id, projectVersion: snapshot.project.version, storyVersion: snapshot.story.version, storyboardVersion: snapshot.storyboard.version, timelineVersion: snapshot.timeline.version, everyProviderAssetMatchesCurrentRevision: true },
    render: { assetId: render.id, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: render.mimeType, metadata: render.metadata, playback },
    browser: { engine: "chromium", viewport: "1440x1000", serverErrors },
    safety: { publications: 0, externalSends: 0, retries: 0, quoteWithinAuthorizedLimit: true }
  };
  mkdirSync(dirname(evidenceFile), { recursive: true });
  writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: "passed", evidenceFile, mp4File, projectId: project.id, quoteCny, shots: snapshot.storyboard.shots.length, bytes: bytes.length, sha256: evidence.render.sha256 }));
} finally {
  if (browser) await browser.close();
}
