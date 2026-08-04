import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createDatabaseStore } from "../src/core.js";
import { createSqliteBackend } from "../src/durable.js";
import { correlationId, createLogger, createMetrics, redact, validateProductionConfig } from "../src/ops.js";
import { createBackup, verifyBackup } from "../scripts/backup.mjs";
import { createOpenReelServer } from "../server.mjs";

const exec = promisify(execFile);
const fixture = Buffer.from("89504e470d0a1a0a00000000", "hex");
const baseEnv = root => ({ NODE_ENV: "production", HOST: "127.0.0.1", PORT: "4173", OPENREEL_DATABASE: join(root, "openreel.sqlite"), OPENREEL_ASSETS: join(root, "assets"), OPENREEL_PLATFORM: join(root, "platform.json"), OPENREEL_SESSION_SECRET: "x".repeat(40), OPENREEL_ADMIN_KEY: "a".repeat(40) });

test("OPS-1 production configuration fails fast on secrets, binding, ports, and paths", () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-config-")), valid = baseEnv(root);
  assert.deepEqual(validateProductionConfig(valid), { port: 4173, host: "127.0.0.1", databaseFile: valid.OPENREEL_DATABASE, assetRoot: valid.OPENREEL_ASSETS, platformFile: valid.OPENREEL_PLATFORM });
  for (const mutation of [env => delete env.OPENREEL_SESSION_SECRET, env => { env.HOST = "0.0.0.0"; }, env => { env.PORT = "x"; }, env => { env.OPENREEL_DATABASE = "relative.sqlite"; }]) { const env = { ...valid }; mutation(env); assert.throws(() => validateProductionConfig(env)); }
});

test("OPS-1 logs preserve correlation while recursively redacting credentials", () => {
  const lines = [], logger = createLogger(line => lines.push(line), () => "2026-08-04T00:00:00.000Z");
  logger("audit", { requestId: correlationId("request-123"), authorization: "Bearer top-secret-token", nested: { password: "hunter2", note: "Bearer another-token" } });
  assert.equal(lines.length, 1); assert.match(lines[0], /request-123/); assert.doesNotMatch(lines[0], /top-secret|another-token|hunter2/); assert.deepEqual(redact({ cookie: "x", safe: "yes" }), { cookie: "[REDACTED]", safe: "yes" }); assert.doesNotMatch(redact("database password=do-not-log"), /do-not-log/);
});

test("OPS-1 liveness stays live, readiness fails closed, and metrics remain bounded", async (t) => {
  const logs = [], server = createOpenReelServer(undefined, undefined, { readiness: () => { throw new Error("database password=do-not-log"); }, logger: (event, fields) => logs.push({ event, fields }), metrics: createMetrics() });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve))); const base = `http://127.0.0.1:${server.address().port}`;
  const live = await fetch(`${base}/health/live`, { headers: { "x-request-id": "request-live-1", authorization: "Bearer invisible" } }), ready = await fetch(`${base}/health/ready`), metrics = await fetch(`${base}/metrics`);
  assert.equal(live.status, 200); assert.equal(live.headers.get("x-request-id"), "request-live-1"); assert.equal(ready.status, 503); assert.equal((await ready.json()).status, "not_ready");
  const body = await metrics.text(); assert.match(body, /openreel_ready 0/); assert.equal((body.match(/status_class=/g) || []).length, 4); assert.doesNotMatch(JSON.stringify(logs), /invisible|do-not-log/);
});

test("OPS-2 backup includes a consistent database/asset snapshot and restores in isolation", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup"), restored = join(root, "restore");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Backup" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), asset = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, "{}", { mode: 0o600 });
  await createBackup({ database, assets, platform, destination }); backend.close(); const result = verifyBackup({ source: destination, destination: restored }); assert.equal(result.database, "ok"); assert.equal(result.assets, 1);
  const reopened = createSqliteBackend(join(restored, "openreel.sqlite"), { assetRoot: join(restored, "assets") }), recovered = createDatabaseStore(reopened); assert.deepEqual(recovered.assetContent(project.id, asset.id, undefined, "owner").bytes, fixture); reopened.close();
  writeFileSync(join(destination, "platform.json"), "tampered"); assert.throws(() => verifyBackup({ source: destination, destination: join(root, "bad-restore") }), /integrity failure/);
});

test("OPS-2 deployment artifacts enforce loopback binding, proxy headers, and hardening", () => {
  const service = readFileSync(new URL("../deploy/openreel.service", import.meta.url), "utf8"), backup = readFileSync(new URL("../deploy/openreel-backup.service", import.meta.url), "utf8"), timer = readFileSync(new URL("../deploy/openreel-backup.timer", import.meta.url), "utf8"), caddy = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
  for (const expected of ["User=openreel", "NoNewPrivileges=true", "ProtectSystem=strict", "CapabilityBoundingSet=", "ReadWritePaths=/var/lib/openreel"]) assert.match(service, new RegExp(expected.replace(/[=.]/g, "\\$&")));
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:4173/); assert.match(caddy, /X-Forwarded-Proto/); assert.match(caddy, /X-Forwarded-For/); assert.match(caddy, /X-Request-ID/); assert.match(caddy, /respond @internal 404/);
  assert.match(backup, /Type=oneshot/); assert.match(backup, /ReadOnlyPaths=\/var\/lib\/openreel/); assert.match(timer, /OnCalendar=daily/); assert.match(timer, /Persistent=true/);
});

test("OPS-2 unprivileged rehearsal starts the real production service on loopback", { skip: process.getuid?.() === 0 }, async () => {
  const { stdout } = await exec(process.execPath, [new URL("../scripts/rehearse-deployment.mjs", import.meta.url).pathname], { timeout: 15_000 }); const result = JSON.parse(stdout); assert.equal(result.status, "passed"); assert.match(result.binding, /^127\.0\.0\.1:/);
});
