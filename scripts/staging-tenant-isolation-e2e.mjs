#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const appRoot = process.env.OPENREEL_APP_ROOT || new URL("..", import.meta.url).pathname;
const dataRoot = mkdtempSync(join(process.env.OPENREEL_TEST_TMPDIR || tmpdir(), "OC_TENANT_ISOLATION_"));
const port = String(30000 + Math.floor(Math.random() * 10000));
const base = `http://127.0.0.1:${port}`;
const marker = `OC_TENANT_ISOLATION_${Date.now()}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: port,
  OPENREEL_DATABASE: join(dataRoot, "openreel.sqlite"),
  OPENREEL_ASSETS: join(dataRoot, "assets"),
  OPENREEL_PLATFORM: join(dataRoot, "platform.json"),
  OPENREEL_SESSION_SECRET: randomBytes(32).toString("hex"),
  OPENREEL_ADMIN_KEY: randomBytes(32).toString("hex"),
  OPENREEL_ARK_ENABLED: "false",
  OPENREEL_QWEN_TTS_ENABLED: "false"
};
let child;
let result;

async function request(path, options = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, options);
  let value = null;
  try { value = await response.json(); } catch {}
  assert.equal(response.status, expected, `${path}: ${response.status} ${JSON.stringify(value)}`);
  return { response, value };
}
async function start() {
  child = spawn(process.execPath, [join(appRoot, "server.mjs")], { cwd: appRoot, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${base}/health/ready`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`isolated staging server did not become ready: ${stderr.slice(-1000)}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => child.once("exit", resolve));
}
async function login(label) {
  const email = `${marker.toLowerCase()}-${label}@example.test`;
  const password = `safe-${randomBytes(12).toString("hex")}`;
  await request("/api/v1/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }, 201);
  const { response, value } = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  return { cookie: response.headers.getSetCookie().map(item => item.split(";", 1)[0]).join("; "), csrf: value.csrfToken };
}
function options(auth, method = "GET", body) {
  return { method, headers: { cookie: auth.cookie, ...(method === "GET" ? {} : { "x-csrf-token": auth.csrf }), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
async function denied(auth, path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, options(auth, method, body));
  assert.ok([403, 404].includes(response.status), `${method} ${path} unexpectedly returned ${response.status}`);
  return response.status;
}

try {
  await start();
  const tenantA = await login("a"), tenantB = await login("b");
  const projectA = (await request("/api/v1/projects", options(tenantA, "POST", { name: `${marker}_A` }), 201)).value;
  const projectB = (await request("/api/v1/projects", options(tenantB, "POST", { name: `${marker}_B` }), 201)).value;
  const teamA = (await request("/api/v1/teams", options(tenantA, "POST", { name: `${marker}_TEAM_A` }), 201)).value;
  const teamB = (await request("/api/v1/teams", options(tenantB, "POST", { name: `${marker}_TEAM_B` }), 201)).value;
  await request(`/api/v1/teams/${teamA.id}/documents/canvas`, options(tenantA, "PUT", { version: 0, content: { owner: "A" } }));
  const projectRead = await denied(tenantB, `/api/v1/projects/${projectA.id}`);
  const projectWrite = await denied(tenantB, `/api/v1/projects/${projectA.id}`, "PATCH", { name: "cross-tenant-write", version: projectA.version });
  const documentRead = await denied(tenantB, `/api/v1/teams/${teamA.id}/documents/canvas`);
  const documentWrite = await denied(tenantB, `/api/v1/teams/${teamA.id}/documents/canvas`, "PUT", { version: 2, content: { owner: "B" } });
  assert.equal((await request(`/api/v1/projects/${projectA.id}`, options(tenantA))).value.project.name, `${marker}_A`);
  assert.deepEqual((await request(`/api/v1/teams/${teamA.id}/documents/canvas`, options(tenantA))).value.content, { owner: "A" });
  assert.equal((await request(`/api/v1/projects/${projectB.id}`, options(tenantB))).value.project.name, `${marker}_B`);
  assert.equal((await request(`/api/v1/teams/${teamB.id}/documents/canvas`, options(tenantB))).value.version, 0);
  result = { status: "passed", markerPrefix: "OC_TENANT_ISOLATION_", isolatedLoopback: true, providerCalls: 0, tenantsCreated: 2, crossTenantProjectRead: projectRead, crossTenantProjectWrite: projectWrite, crossTenantDocumentRead: documentRead, crossTenantDocumentWrite: documentWrite, ownerDataUnchanged: true };
} finally {
  await stop();
  rmSync(dataRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ ...result, cleanup: "completed" }));
