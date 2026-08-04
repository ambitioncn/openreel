#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createBackup, verifyBackup } from "./backup.mjs";

const root = mkdtempSync(join(tmpdir(), "openreel-production-e2e-"));
const paths = { database: join(root, "data/openreel.sqlite"), assets: join(root, "data/assets"), platform: join(root, "data/platform.json") };
const port = String(20000 + Math.floor(Math.random() * 20000)), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: port, OPENREEL_DATABASE: paths.database, OPENREEL_ASSETS: paths.assets, OPENREEL_PLATFORM: paths.platform, OPENREEL_SESSION_SECRET: randomBytes(32).toString("hex"), OPENREEL_ADMIN_KEY: randomBytes(32).toString("hex") };
let child;
async function start() {
  child = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env, stdio: ["ignore", "ignore", "pipe"] });
  let error = ""; child.stderr.on("data", chunk => { error += chunk; });
  for (let i = 0; i < 100; i++) { try { const response = await fetch(`${base}/health/ready`); if (response.ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(`production server did not become ready: ${error}`);
}
async function stop() { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
async function raw(path, options = {}) { return fetch(`${base}${path}`, options); }
async function json(path, options = {}, expected = 200) { const response = await raw(path, { ...options, headers: { ...(options.body !== undefined && { "content-type": "application/json" }), ...options.headers } }); const value = await response.json(); assert.equal(response.status, expected, `${path}: ${response.status} ${JSON.stringify(value)}`); return { response, value }; }
async function login(email) {
  await json("/api/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password: "secure-pass-123" }) }, 201);
  const { response, value } = await json("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password: "secure-pass-123" }) });
  const set = response.headers.getSetCookie(); assert.ok(set.every(x => /HttpOnly/.test(x) && /Secure/.test(x) && /SameSite=Lax/.test(x)));
  return { cookie: set.map(x => x.split(";", 1)[0]).join("; "), csrf: value.csrfToken, account: value.account };
}
const call = (auth, path, method = "GET", body) => json(path, { method, headers: { cookie: auth.cookie, ...(method === "GET" ? {} : { "x-csrf-token": auth.csrf }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, method === "POST" ? 201 : 200);
try {
  await start();
  assert.equal((await json("/health/live")).value.status, "ok"); assert.equal((await json("/health/ready")).value.status, "ready");
  const metrics = await raw("/metrics"); assert.match(await metrics.text(), /openreel_ready 1/);
  const owner = await login("owner-e2e@example.test"), attacker = await login("attacker-e2e@example.test");
  assert.equal((await call(owner, "/api/v1/auth/me")).value.id, owner.account.id);
  const project = (await call(owner, "/api/v1/projects", "POST", { name: "Production E2E" })).value;
  const session = (await call(owner, `/api/v1/projects/${project.id}/sessions`, "POST", { name: "Main" })).value;
  const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
  const upload = await raw(`/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "image/png", "x-filename": "reference.png" }, body: png }); assert.equal(upload.status, 201); const reference = await upload.json();
  const story = (await call(owner, `/api/v1/projects/${project.id}/story`, "PUT", { title: "Proof", synopsis: "Durable local proof", scenes: [{ title: "Scene", summary: "Reveal" }] })).value;
  await call(owner, `/api/v1/projects/${project.id}/storyboard`, "PUT", { shots: [{ sceneId: story.scenes[0].id, prompt: "Reveal", duration: 1, referenceAssetIds: [reference.id] }] });
  const node = (await call(owner, `/api/v1/sessions/${session.id}/nodes`, "POST", { type: "video" })).value;
  let job = (await call(owner, `/api/v1/sessions/${session.id}/jobs`, "POST", { nodeId: node.id, prompt: "local video", referenceAssetIds: [reference.id] })).value;
  while (job.state !== "succeeded") job = (await call(owner, `/api/v1/jobs/${job.id}/tick`, "POST", {})).value;
  await call(owner, `/api/v1/projects/${project.id}/timeline`, "PUT", { version: 1, tracks: [{ kind: "video", clips: [{ assetId: job.assetId, inPoint: 0, outPoint: 1, start: 0 }] }] });
  const rendered = (await call(owner, `/api/v1/projects/${project.id}/exports/render`, "POST", {})).value;
  const video = await raw(rendered.asset.downloadUrl, { headers: { cookie: owner.cookie } }); const bytes = Buffer.from(await video.arrayBuffer()); assert.equal(video.status, 200); assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
  for (const path of [`/api/v1/projects/${project.id}`, `/api/v1/jobs/${job.id}/progress`, rendered.asset.downloadUrl]) assert.ok([403, 404].includes((await raw(path, { headers: { cookie: attacker.cookie } })).status));
  const current = (await call(owner, `/api/v1/projects/${project.id}`)).value.project;
  await call(owner, `/api/v1/projects/${project.id}`, "PATCH", { name: "Winner", version: current.version });
  assert.equal((await json(`/api/v1/projects/${project.id}`, { method: "PATCH", headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf }, body: JSON.stringify({ name: "Loser", version: current.version }) }, 409)).value.error.code, "VERSION_CONFLICT");
  await stop(); await start();
  assert.equal((await call(owner, `/api/v1/projects/${project.id}`)).value.project.name, "Winner");
  const recovered = await raw(rendered.asset.downloadUrl, { headers: { cookie: owner.cookie } }); assert.equal(Buffer.from(await recovered.arrayBuffer()).subarray(4, 8).toString(), "ftyp");
  const backup = join(root, "backup"), restore = join(root, "restore"); const manifest = await createBackup({ ...paths, destination: backup }); const restored = verifyBackup({ source: backup, destination: restore }); assert.equal(restored.database, "ok"); assert.ok(manifest.files.some(x => x.path.startsWith("assets/")));
  const html = await (await raw("/", { headers: { cookie: owner.cookie } })).text(), css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8"); assert.match(html, /app-shell/); assert.match(css, /@media \(max-width: 760px\)/);
  await json("/api/v1/auth/logout", { method: "POST", headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf }, body: "{}" }); assert.equal((await raw("/api/v1/auth/me", { headers: { cookie: owner.cookie } })).status, 401);
  await stop(); await start();
  let limited; for (let i = 0; i < 61; i++) limited = await raw("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert.equal(limited.status, 429); assert.ok(limited.headers.get("retry-after"));
  console.log(JSON.stringify({ status: "passed", mode: "production", binding: `127.0.0.1:${port}`, durableRestart: true, registrationLoginIdentity: true, secureCookieCsrf: true, projectSessionUploadStoryboardGeneration: true, idorAttemptsRejected: 3, concurrentConflict: 409, playableMp4Bytes: bytes.length, backupFiles: manifest.files.length, restoreQuickCheck: restored.database, logoutReuse: 401, rateLimit: 429, healthReadinessMetrics: true, responsiveStaticState: true, liveActivation: false }));
} finally { if (child && child.exitCode === null) await stop(); }
