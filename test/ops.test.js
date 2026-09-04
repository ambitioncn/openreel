import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createDatabaseStore } from "../src/core.js";
import { createSqliteBackend } from "../src/durable.js";
import { correlationId, createLogger, createMetrics, redact, validateProductionConfig } from "../src/ops.js";
import { canonicalBackupManifestText, copyStableFile, createBackup, verifyBackup } from "../scripts/backup.mjs";
import { buildReleaseManifest, canonicalReleaseManifestBytes, releaseArtifactPaths, verifyReleaseManifest } from "../scripts/qualify-release-artifacts.mjs";
import { createOpenReelServer } from "../server.mjs";

const exec = promisify(execFile);
const fixture = Buffer.from("89504e470d0a1a0a00000000", "hex");
const platformFixture = () => ({ schemaVersion: 7, accounts: [], sessions: [], teams: [], invites: [], wallets: [], ledger: [], workflows: [], automations: [], objects: [], subscriptions: [], keyApplications: [], apiKeys: [], usageReservations: [], usageLedger: [], usageRefunds: [], collaborativeDocuments: [] });
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
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Backup" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), asset = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 });
  await createBackup({ database, assets, platform, destination }); backend.close(); const result = verifyBackup({ source: destination, destination: restored }); assert.equal(result.database, "ok"); assert.equal(result.assets, 1);
  const reopened = createSqliteBackend(join(restored, "openreel.sqlite"), { assetRoot: join(restored, "assets") }), recovered = createDatabaseStore(reopened); assert.deepEqual(recovered.assetContent(project.id, asset.id, undefined, "owner").bytes, fixture); reopened.close();
  writeFileSync(join(destination, "platform.json"), "tampered"); assert.throws(() => verifyBackup({ source: destination, destination: join(root, "bad-restore") }), /integrity failure/);
});

test("OPS-2 backup accepts revision-bound commercial production assets without canvas jobs", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-commercial-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup"), restored = join(root, "restore");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Commercial backup" }, "owner"), story = store.upsertStory(project.id, { scenes: [{ title: "Beach" }] }, "owner"), storyboard = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Dance", duration: 5 }] }, "owner"), current = store.snapshot(project.id, "owner");
  store.uploadCommercialProductionAsset(project.id, { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version, stage: "caption", shotId: storyboard.shots[0].id, captionText: "Dance", mimeType: "image/png", filename: "caption.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 });
  await createBackup({ database, assets, platform, destination }); backend.close(); const result = verifyBackup({ source: destination, destination: restored }); assert.equal(result.database, "ok"); assert.equal(result.assets, 1);
});

test("OPS-2 restore accepts normalized relative source and destination paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-relative-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), backup = join(root, "backup"), restored = join(root, "restore");
  const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" }); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); await createBackup({ database, assets, platform, destination: backup }); backend.close();
  const result = verifyBackup({ source: relative(process.cwd(), backup), destination: relative(process.cwd(), restored) });
  assert.equal(result.database, "ok");
  assert.equal(result.isolatedDestination, restored);
});

test("OPS-2 backup rejects symlink sources, hidden files, and manifest file-set drift", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-negative-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Backup" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), asset = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
  const assetPath = join(assets, asset.storageKey); unlinkSync(assetPath); symlinkSync("/etc/passwd", assetPath); await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "asset-link-backup") }), /must be a regular file/);
  unlinkSync(assetPath); writeFileSync(assetPath, fixture); unlinkSync(platform); symlinkSync("/etc/passwd", platform); await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "platform-link-backup") }), /must be a regular file/);
  unlinkSync(platform); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); const destination = join(root, "valid-backup"); await createBackup({ database, assets, platform, destination });
  writeFileSync(join(destination, "unlisted"), "hidden"); assert.throws(() => verifyBackup({ source: destination, destination: join(root, "hidden-restore") }), /file set differs/);
  unlinkSync(join(destination, "unlisted")); const manifestPath = join(destination, "manifest.json"), manifest = JSON.parse(readFileSync(manifestPath)); manifest.files = manifest.files.slice(1); writeFileSync(manifestPath, canonicalBackupManifestText(manifest)); assert.throws(() => verifyBackup({ source: destination, destination: join(root, "drift-restore") }), /file set differs/);
});

test("OPS-2 restore rejects malformed or incomplete manifests before creating a destination", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-schema-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), backup = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" }); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); await createBackup({ database, assets, platform, destination: backup }); backend.close();
  const manifestPath = join(backup, "manifest.json"), original = JSON.parse(readFileSync(manifestPath));
  writeFileSync(manifestPath, JSON.stringify(original));
  assert.throws(() => verifyBackup({ source: backup, destination: join(root, "restore-non-canonical-serialization") }), /serialization is non-canonical/);
  const cases = [
    { name: "extra-field", manifest: { ...original, unexpected: true }, error: /fields are invalid/ },
    { name: "invalid-created-at", manifest: { ...original, createdAt: "not-a-date" }, error: /schema invalid/ },
    { name: "offset-created-at", manifest: { ...original, createdAt: "2026-08-15T08:00:00.000+08:00" }, error: /schema invalid/ },
    { name: "imprecise-created-at", manifest: { ...original, createdAt: "2026-08-15" }, error: /schema invalid/ },
    { name: "extra-item-field", manifest: { ...original, files: original.files.map((item, index) => index ? item : { ...item, unexpected: true }) }, error: /fields are invalid/ },
    { name: "non-canonical-order", manifest: { ...original, files: [...original.files].reverse() }, error: /file list invalid/ },
    { name: "non-canonical-path", manifest: { ...original, files: original.files.map((item, index) => index ? item : { ...item, path: `./${item.path}` }) }, error: /file list invalid/ },
    { name: "control-character-path", manifest: { ...original, files: original.files.map((item, index) => index ? item : { ...item, path: `${item.path}\nforged-log-entry` }) }, error: /file list invalid/ },
    { name: "unrestored-top-level-file", extraFile: "metadata.json", manifest: { ...original, files: [...original.files, { path: "metadata.json", bytes: 2, sha256: createHash("sha256").update("{}").digest("hex") }].sort((left, right) => left.path.localeCompare(right.path)) }, error: /file namespace is invalid/ },
    { name: "missing-core", manifest: { ...original, files: original.files.filter(item => item.path !== "platform.json") }, error: /missing required core files/ }
  ];
  for (const entry of cases) {
    if (entry.extraFile) writeFileSync(join(backup, entry.extraFile), "{}");
    writeFileSync(manifestPath, canonicalBackupManifestText(entry.manifest));
    const destination = join(root, `restore-${entry.name}`);
    assert.throws(() => verifyBackup({ source: backup, destination }), entry.error);
    assert.equal(existsSync(destination), false);
    if (entry.extraFile) unlinkSync(join(backup, entry.extraFile));
  }
});

test("OPS-2 restore promotes atomically and cleans failed staging directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-atomic-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), backup = join(root, "backup"), destination = join(root, "restore");
  const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" }); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); await createBackup({ database, assets, platform, destination: backup }); backend.close();
  const manifestPath = join(backup, "manifest.json"), manifest = JSON.parse(readFileSync(manifestPath)), databaseEntry = manifest.files.find(item => item.path === "openreel.sqlite");
  writeFileSync(join(backup, "openreel.sqlite"), "not a sqlite database"); databaseEntry.bytes = readFileSync(join(backup, "openreel.sqlite")).length; databaseEntry.sha256 = createHash("sha256").update(readFileSync(join(backup, "openreel.sqlite"))).digest("hex"); writeFileSync(manifestPath, canonicalBackupManifestText(manifest));
  assert.throws(() => verifyBackup({ source: backup, destination }), /file is not a database|quick_check failed/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".restore.restore-")), []);
  assert.throws(() => verifyBackup({ source: backup, destination: join(backup, "nested") }), /outside the backup source/);
});

test("OPS-2 backup creation promotes atomically and cleans failed staging directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-create-atomic-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" });
  const project = store.createProject({ name: "Atomic backup" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner");
  const asset = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "missing.png", bytes: fixture }, "owner");
  unlinkSync(join(assets, asset.storageKey)); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination }), /ENOENT/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  backend.close();
});

test("OPS-2 backup creation normalizes private directory and file permissions", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-private-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" });
  const project = store.createProject({ name: "Private backup" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), asset = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "public-source.png", bytes: fixture }, "owner");
  chmodSync(join(assets, asset.storageKey), 0o644); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o644 });
  await createBackup({ database, assets, platform, destination }); backend.close();
  const mode = path => statSync(path).mode & 0o777;
  assert.equal(mode(destination), 0o700);
  assert.equal(mode(join(destination, "assets")), 0o700);
  for (const path of ["openreel.sqlite", "platform.json", "manifest.json", join("assets", asset.storageKey)]) assert.equal(mode(join(destination, path)), 0o600);
});

test("OPS-2 backup and restore reject invalid platform state before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-platform-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), backup = join(root, "backup"), restored = join(root, "restore");
  const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" });
  writeFileSync(platform, "not-json", { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: backup }), /valid JSON/);
  assert.equal(existsSync(backup), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  writeFileSync(platform, "[]", { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: backup }), /JSON object/);
  assert.equal(existsSync(backup), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  writeFileSync(platform, "{}", { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: backup }), /schema version is unsupported/);
  assert.equal(existsSync(backup), false);
  writeFileSync(platform, JSON.stringify({ ...platformFixture(), sessions: null }), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: backup }), /collection is invalid: sessions/);
  assert.equal(existsSync(backup), false);
  writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); await createBackup({ database, assets, platform, destination: backup }); backend.close();
  const platformPath = join(backup, "platform.json"), manifestPath = join(backup, "manifest.json"), manifest = JSON.parse(readFileSync(manifestPath)), platformEntry = manifest.files.find(item => item.path === "platform.json");
  writeFileSync(platformPath, "null"); platformEntry.bytes = readFileSync(platformPath).length; platformEntry.sha256 = createHash("sha256").update(readFileSync(platformPath)).digest("hex"); writeFileSync(manifestPath, canonicalBackupManifestText(manifest));
  assert.throws(() => verifyBackup({ source: backup, destination: restored }), /JSON object/);
  assert.equal(existsSync(restored), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".restore.restore-")), []);
});

test("OPS-2 backup rejects duplicate platform identities and dangling relationships", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-platform-relations-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json");
  const sessionHash = "a".repeat(64);
  const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" });
  const duplicate = platformFixture(); duplicate.accounts = [{ id: "account-1" }, { id: "account-1" }]; writeFileSync(platform, JSON.stringify(duplicate), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "duplicate-backup") }), /identity is invalid: accounts/);

  const duplicateSessionHash = platformFixture(); duplicateSessionHash.accounts = [{ id: "account-1" }]; duplicateSessionHash.sessions = [{ id: "session-1", accountId: "account-1", tokenHash: sessionHash, createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z", revokedAt: null }, { id: "session-2", accountId: "account-1", tokenHash: sessionHash, createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z", revokedAt: null }]; writeFileSync(platform, JSON.stringify(duplicateSessionHash), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "duplicate-session-hash-backup") }), /identity is invalid: sessions.tokenHash/);

  const malformedSessionHash = platformFixture(); malformedSessionHash.accounts = [{ id: "account-1" }]; malformedSessionHash.sessions = [{ id: "session-1", accountId: "account-1", tokenHash: "not-a-sha256-digest", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z", revokedAt: null }]; writeFileSync(platform, JSON.stringify(malformedSessionHash), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "malformed-session-hash-backup") }), /digest is invalid: sessions.tokenHash/);

  const expiredBeforeCreation = platformFixture(); expiredBeforeCreation.accounts = [{ id: "account-1" }]; expiredBeforeCreation.sessions = [{ id: "session-1", accountId: "account-1", tokenHash: sessionHash, createdAt: "2026-01-02T00:00:00.000Z", expiresAt: "2026-01-01T00:00:00.000Z", revokedAt: null }]; writeFileSync(platform, JSON.stringify(expiredBeforeCreation), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "invalid-session-lifecycle-backup") }), /lifecycle is invalid: sessions/);

  const revokedBeforeCreation = platformFixture(); revokedBeforeCreation.accounts = [{ id: "account-1" }]; revokedBeforeCreation.sessions = [{ id: "session-1", accountId: "account-1", tokenHash: sessionHash, createdAt: "2026-01-02T00:00:00.000Z", expiresAt: "2026-01-03T00:00:00.000Z", revokedAt: "2026-01-01T00:00:00.000Z" }]; writeFileSync(platform, JSON.stringify(revokedBeforeCreation), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "invalid-session-revocation-backup") }), /lifecycle is invalid: sessions.revokedAt/);

  const revokedAfterExpiry = platformFixture(); revokedAfterExpiry.accounts = [{ id: "account-1" }]; revokedAfterExpiry.sessions = [{ id: "session-1", accountId: "account-1", tokenHash: sessionHash, createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z", revokedAt: "2026-01-03T00:00:00.000Z" }]; writeFileSync(platform, JSON.stringify(revokedAfterExpiry), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "late-session-revocation-backup") }), /lifecycle is invalid: sessions.revokedAt/);

  const offsetSessionTimestamp = platformFixture(); offsetSessionTimestamp.accounts = [{ id: "account-1" }]; offsetSessionTimestamp.sessions = [{ id: "session-1", accountId: "account-1", tokenHash: sessionHash, createdAt: "2026-01-01T08:00:00.000+08:00", expiresAt: "2026-01-02T00:00:00.000Z", revokedAt: null }]; writeFileSync(platform, JSON.stringify(offsetSessionTimestamp), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "offset-session-timestamp-backup") }), /timestamp is invalid: sessions.createdAt/);

  const impreciseSessionTimestamp = platformFixture(); impreciseSessionTimestamp.accounts = [{ id: "account-1" }]; impreciseSessionTimestamp.sessions = [{ id: "session-1", accountId: "account-1", tokenHash: sessionHash, createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02", revokedAt: null }]; writeFileSync(platform, JSON.stringify(impreciseSessionTimestamp), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "imprecise-session-timestamp-backup") }), /timestamp is invalid: sessions.expiresAt/);
  const partialCredentialTuple = platformFixture(); partialCredentialTuple.accounts = [{ id: "account-1", email: "owner@example.com" }]; writeFileSync(platform, JSON.stringify(partialCredentialTuple), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "partial-account-credential-backup") }), /credential tuple is invalid: accounts/);

  const canonicalAccountCredential = { id: "account-1", email: "owner@example.com", salt: "a".repeat(32), passwordHash: "b".repeat(64), createdAt: "2026-01-01T00:00:00.000Z" };
  const validAccountCredential = platformFixture(); validAccountCredential.accounts = [{ ...canonicalAccountCredential }]; writeFileSync(platform, JSON.stringify(validAccountCredential), { mode: 0o600 });
  await createBackup({ database, assets, platform, destination: join(root, "valid-account-credential-backup") });

  const missingAccountCreatedAt = platformFixture(); missingAccountCreatedAt.accounts = [{ ...canonicalAccountCredential, createdAt: undefined }]; writeFileSync(platform, JSON.stringify(missingAccountCreatedAt), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "missing-account-created-at-backup") }), /credential tuple is invalid: accounts/);

  const offsetAccountCreatedAt = platformFixture(); offsetAccountCreatedAt.accounts = [{ ...canonicalAccountCredential, createdAt: "2026-01-01T08:00:00.000+08:00" }]; writeFileSync(platform, JSON.stringify(offsetAccountCreatedAt), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "offset-account-created-at-backup") }), /timestamp is invalid: accounts.createdAt/);

  const uppercaseAccountEmail = platformFixture(); uppercaseAccountEmail.accounts = [{ ...canonicalAccountCredential, email: "Owner@example.com" }]; writeFileSync(platform, JSON.stringify(uppercaseAccountEmail), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "uppercase-account-email-backup") }), /credential identity is invalid: accounts.email/);

  const duplicateAccountEmail = platformFixture(); duplicateAccountEmail.accounts = [{ ...canonicalAccountCredential }, { ...canonicalAccountCredential, id: "account-2", salt: "c".repeat(32), passwordHash: "d".repeat(64) }]; writeFileSync(platform, JSON.stringify(duplicateAccountEmail), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "duplicate-account-email-backup") }), /credential identity is invalid: accounts.email/);

  const cleartextPassword = platformFixture(); cleartextPassword.accounts = [{ ...canonicalAccountCredential, password: 1 }]; writeFileSync(platform, JSON.stringify(cleartextPassword), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "cleartext-account-password-backup") }), /forbidden account credential material/);

  for (const field of ["token", "sessionToken", "accessToken", "refreshToken", "authToken", "apiToken", "passwordResetToken", "otp", "otpCode", "secret", "AccessToken", "access_token", "refresh-token", "password reset token", "otp_code", "AUTH-TOKEN"]) {
    const cleartextCredential = platformFixture(); cleartextCredential.accounts = [{ ...canonicalAccountCredential, [field]: "must-not-enter-backups" }]; writeFileSync(platform, JSON.stringify(cleartextCredential), { mode: 0o600 });
    await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, `cleartext-account-${field}-backup`) }), /forbidden account credential material/);
  }

  for (const [label, nested] of [["object", { profile: { auth: { access_token: "blocked" } } }], ["array", { metadata: [{ otp_code: "blocked" }] }]]) {
    const nestedCredential = platformFixture(); nestedCredential.accounts = [{ ...canonicalAccountCredential, ...nested }]; writeFileSync(platform, JSON.stringify(nestedCredential), { mode: 0o600 });
    await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, `nested-account-${label}-credential-backup`) }), /forbidden account credential material/);
  }

  for (const [label, nested] of [["password-hash", { profile: { passwordHash: "b".repeat(64) } }], ["salt", { metadata: [{ salt: "a".repeat(32) }] }]]) {
    const nestedCredential = platformFixture(); nestedCredential.accounts = [{ ...canonicalAccountCredential, ...nested }]; writeFileSync(platform, JSON.stringify(nestedCredential), { mode: 0o600 });
    await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, `nested-account-${label}-backup`) }), /forbidden account credential material/);
  }

  for (const field of ["password_hash", "password-hash", "PasswordHash", "s_a_l_t", "SALT"]) {
    const aliasedCredential = platformFixture(); aliasedCredential.accounts = [{ ...canonicalAccountCredential, [field]: field.toLowerCase().includes("salt") || field === "s_a_l_t" ? "a".repeat(32) : "b".repeat(64) }]; writeFileSync(platform, JSON.stringify(aliasedCredential), { mode: 0o600 });
    await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, `aliased-account-${field}-backup`) }), /forbidden account credential material/);
  }
  for (const field of ["ｐａｓｓｗｏｒｄＨａｓｈ", "password＿hash", "ｓａｌｔ"]) {
    const unicodeAliasedCredential = platformFixture(); unicodeAliasedCredential.accounts = [{ ...canonicalAccountCredential, [field]: field.normalize("NFKC").toLowerCase().includes("salt") ? "a".repeat(32) : "b".repeat(64) }]; writeFileSync(platform, JSON.stringify(unicodeAliasedCredential), { mode: 0o600 });
    await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, `unicode-aliased-account-${Buffer.from(field).toString("hex")}-backup`) }), /forbidden account credential material/);
  }

  const malformedAccountSalt = platformFixture(); malformedAccountSalt.accounts = [{ ...canonicalAccountCredential, salt: "not-a-salt" }]; writeFileSync(platform, JSON.stringify(malformedAccountSalt), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "malformed-account-salt-backup") }), /credential salt is invalid: accounts.salt/);

  const malformedPasswordHash = platformFixture(); malformedPasswordHash.accounts = [{ ...canonicalAccountCredential, passwordHash: "not-a-password-digest" }]; writeFileSync(platform, JSON.stringify(malformedPasswordHash), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "malformed-account-password-hash-backup") }), /credential digest is invalid: accounts.passwordHash/);
  const dangling = platformFixture(); dangling.invites = [{ id: "invite-1", teamId: "missing-team" }]; writeFileSync(platform, JSON.stringify(dangling), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "dangling-backup") }), /reference is invalid: invites.teamId/);
  const inviteBase = { id: "invite-1", teamId: "team-1", tenantId: "tenant-1", email: "editor@example.com", role: "editor", status: "pending", createdAt: "2026-08-15T00:00:00.000Z" };
  const inviteState = platformFixture(); inviteState.accounts = [{ id: "owner-1" }]; inviteState.teams = [{ id: "team-1", name: "Studio", tenantId: "tenant-1", members: [{ accountId: "owner-1", role: "owner" }], version: 1, createdAt: "2026-08-15T00:00:00.000Z" }]; inviteState.invites = [inviteBase];
  for (const [label, mutate, error] of [
    ["non-canonical-email", invite => { invite.email = "Editor@example.com"; }, /identity is invalid: invites.email/],
    ["invalid-role", invite => { invite.role = "owner"; }, /role is invalid: invites.role/],
    ["invalid-status", invite => { invite.status = "expired"; }, /status is invalid: invites/],
    ["invalid-created-at", invite => { invite.createdAt = "2026-08-15"; }, /timestamp is invalid: invites.createdAt/],
    ["pending-revoked-at", invite => { invite.revokedAt = "2026-08-15T00:01:00.000Z"; }, /lifecycle is invalid: invites.revokedAt/],
    ["revoked-without-time", invite => { invite.status = "revoked"; }, /lifecycle is invalid: invites.revokedAt/],
    ["revoked-before-created", invite => { invite.status = "revoked"; invite.revokedAt = "2026-08-14T23:59:59.000Z"; }, /lifecycle is invalid: invites.revokedAt/]
  ]) {
    const candidate = structuredClone(inviteState); mutate(candidate.invites[0]); writeFileSync(platform, JSON.stringify(candidate), { mode: 0o600 });
    await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, `${label}-invite-backup`) }), error);
  }
  const duplicatePendingInvite = structuredClone(inviteState); duplicatePendingInvite.invites.push({ ...inviteBase, id: "invite-2" }); writeFileSync(platform, JSON.stringify(duplicatePendingInvite), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "duplicate-pending-invite-backup") }), /identity is invalid: invites.pending/);
  const validRevokedInvite = structuredClone(inviteState); validRevokedInvite.invites[0] = { ...inviteBase, status: "revoked", revokedAt: "2026-08-15T00:01:00.000Z" }; writeFileSync(platform, JSON.stringify(validRevokedInvite), { mode: 0o600 });
  await createBackup({ database, assets, platform, destination: join(root, "valid-revoked-invite-backup") });
  const missingIdentity = platformFixture(); missingIdentity.accounts = [{ name: "Missing identity" }]; writeFileSync(platform, JSON.stringify(missingIdentity), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "missing-identity-backup") }), /identity is invalid: accounts/);
  assert.equal(existsSync(join(root, "missing-identity-backup")), false);
  const danglingApiKey = platformFixture(); danglingApiKey.accounts = [{ id: "account-1" }]; danglingApiKey.subscriptions = [{ id: "subscription-1", accountId: "account-1" }]; danglingApiKey.usageReservations = [{ id: "reservation-1", accountId: "account-1", subscriptionId: "subscription-1", apiKeyId: "missing-key" }]; writeFileSync(platform, JSON.stringify(danglingApiKey), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "dangling-api-key-backup") }), /reference is invalid: usageReservations.apiKeyId/);

  const danglingApplication = platformFixture(); danglingApplication.accounts = [{ id: "account-1" }]; danglingApplication.keyApplications = [{ id: "application-1", accountId: "account-1", status: "approved", subscriptionId: "missing-subscription" }]; writeFileSync(platform, JSON.stringify(danglingApplication), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "dangling-application-backup") }), /reference is invalid: keyApplications.subscriptionId/);

  const missingApprovedSubscription = platformFixture(); missingApprovedSubscription.accounts = [{ id: "account-1" }]; missingApprovedSubscription.keyApplications = [{ id: "application-1", accountId: "account-1", status: "approved", subscriptionId: null }]; writeFileSync(platform, JSON.stringify(missingApprovedSubscription), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "missing-approved-subscription-backup") }), /relationship is invalid: keyApplications.subscriptionId/);

  const pendingWithSubscription = platformFixture(); pendingWithSubscription.accounts = [{ id: "account-1" }]; pendingWithSubscription.subscriptions = [{ id: "subscription-1", accountId: "account-1" }]; pendingWithSubscription.keyApplications = [{ id: "application-1", accountId: "account-1", status: "pending", subscriptionId: "subscription-1" }]; writeFileSync(platform, JSON.stringify(pendingWithSubscription), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "pending-with-subscription-backup") }), /relationship is invalid: keyApplications.subscriptionId/);

  const crossAccountApplication = platformFixture(); crossAccountApplication.accounts = [{ id: "account-1" }, { id: "account-2" }]; crossAccountApplication.subscriptions = [{ id: "subscription-1", accountId: "account-2" }]; crossAccountApplication.keyApplications = [{ id: "application-1", accountId: "account-1", status: "stopped", subscriptionId: "subscription-1" }]; writeFileSync(platform, JSON.stringify(crossAccountApplication), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "cross-account-application-backup") }), /ownership is invalid: keyApplications.subscriptionId/);
  const duplicateTenant = platformFixture(); duplicateTenant.accounts = [{ id: "account-1" }]; duplicateTenant.teams = [{ id: "team-1", tenantId: "tenant-1", members: [{ accountId: "account-1" }] }, { id: "team-2", tenantId: "tenant-1", members: [{ accountId: "account-1" }] }]; writeFileSync(platform, JSON.stringify(duplicateTenant), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "duplicate-tenant-backup") }), /identity is invalid: teams.tenantId/);
  const duplicateMember = platformFixture(); duplicateMember.accounts = [{ id: "account-1" }]; duplicateMember.teams = [{ id: "team-1", name: "Studio", tenantId: "tenant-1", members: [{ accountId: "account-1", role: "owner" }, { accountId: "account-1", role: "editor" }], version: 1, createdAt: "2026-01-01T00:00:00.000Z" }]; writeFileSync(platform, JSON.stringify(duplicateMember), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "duplicate-member-backup") }), /identity is invalid: teams.members.accountId/);
  const crossAccount = platformFixture(); crossAccount.accounts = [{ id: "account-1" }, { id: "account-2" }]; crossAccount.subscriptions = [{ id: "subscription-1", accountId: "account-1" }]; crossAccount.apiKeys = [{ id: "key-1", accountId: "account-2", subscriptionId: "subscription-1" }]; writeFileSync(platform, JSON.stringify(crossAccount), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "cross-account-backup") }), /ownership is invalid: apiKeys.subscriptionId/);
  const crossTenant = platformFixture(); crossTenant.accounts = [{ id: "account-1" }]; crossTenant.teams = [{ id: "team-1", name: "Studio", tenantId: "tenant-1", members: [{ accountId: "account-1", role: "owner" }], version: 1, createdAt: "2026-01-01T00:00:00.000Z" }]; crossTenant.invites = [{ id: "invite-1", teamId: "team-1", tenantId: "tenant-2", email: "editor@example.com", role: "editor", status: "pending", createdAt: "2026-01-01T00:00:00.000Z" }]; writeFileSync(platform, JSON.stringify(crossTenant), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "cross-tenant-backup") }), /ownership is invalid: invites.tenantId/);

  const canonicalTeam = { id: "team-1", name: "Studio", tenantId: "tenant-1", members: [{ accountId: "account-1", role: "owner" }], version: 1, createdAt: "2026-01-01T00:00:00.000Z" };
  for (const [name, mutate, error] of [
    ["empty-team-name", team => { team.name = " "; }, /team identity is invalid/],
    ["invalid-team-version", team => { team.version = 0; }, /team identity is invalid/],
    ["noncanonical-team-created-at", team => { team.createdAt = "2026-01-01"; }, /team identity is invalid/],
    ["empty-team-members", team => { team.members = []; }, /collection is invalid: teams.members/],
    ["invalid-team-role", team => { team.members[0].role = "superuser"; }, /role is invalid: teams.members.role/],
    ["ownerless-team", team => { team.members[0].role = "editor"; }, /lifecycle is invalid: teams.owner/],
    ["extra-team-member-field", team => { team.members[0].permissions = ["billing"]; }, /member fields are invalid: teams.members/],
    ["missing-team-member-field", team => { delete team.members[0].role; }, /member fields are invalid: teams.members/]
  ]) {
    const invalidTeam = platformFixture(); invalidTeam.accounts = [{ id: "account-1" }]; invalidTeam.teams = [{ ...structuredClone(canonicalTeam), members: structuredClone(canonicalTeam.members) }]; mutate(invalidTeam.teams[0]); writeFileSync(platform, JSON.stringify(invalidTeam), { mode: 0o600 });
    await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, `${name}-backup`) }), error);
  }
  backend.close();
});

test("OPS-2 backup rejects unreconciled platform billing aggregates", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-platform-reconciliation-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json");
  const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" });
  const base = platformFixture();
  base.accounts = [{ id: "account-1" }];
  base.subscriptions = [{ id: "subscription-1", accountId: "account-1", hardLimitMicros: 100, reservedMicros: 40, spentMicros: 0, currency: "CNY", unitScale: 1_000_000, status: "active" }];
  base.usageReservations = [{ id: "reservation-1", accountId: "account-1", subscriptionId: "subscription-1", apiKeyId: null, maxCostMicros: 40, currency: "CNY", unitScale: 1_000_000, status: "reserved" }];
  writeFileSync(platform, JSON.stringify(base), { mode: 0o600 });
  await createBackup({ database, assets, platform, destination: join(root, "valid-backup") });
  const mismatchedAggregate = structuredClone(base); mismatchedAggregate.subscriptions[0].reservedMicros = 39; writeFileSync(platform, JSON.stringify(mismatchedAggregate), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "aggregate-backup") }), /reconciliation is invalid: subscriptions/);
  const overLimit = structuredClone(base); overLimit.subscriptions[0].hardLimitMicros = 39; writeFileSync(platform, JSON.stringify(overLimit), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "limit-backup") }), /reconciliation is invalid: subscriptions/);
  const currencyDrift = structuredClone(base); currencyDrift.usageReservations[0].currency = "USD"; currencyDrift.usageReservations[0].unitScale = 10_000; writeFileSync(platform, JSON.stringify(currencyDrift), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "currency-backup") }), /money metadata is inconsistent: usageReservations/);
  const invalidStatus = structuredClone(base); invalidStatus.usageReservations[0].status = "pending"; writeFileSync(platform, JSON.stringify(invalidStatus), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "status-backup") }), /status is invalid: usageReservations/);
  const overRefunded = structuredClone(base); Object.assign(overRefunded.subscriptions[0], { reservedMicros: 0, spentMicros: 0 }); overRefunded.usageReservations[0].status = "settled"; overRefunded.usageLedger = [{ id: "usage-1", reservationId: "reservation-1", apiKeyId: null, accountId: "account-1", subscriptionId: "subscription-1", costMicros: 10, currency: "CNY", unitScale: 1_000_000, status: "settled" }]; overRefunded.usageRefunds = [{ id: "refund-1", usageId: "usage-1", reservationId: "reservation-1", accountId: "account-1", subscriptionId: "subscription-1", amountMicros: 11, currency: "CNY", unitScale: 1_000_000, status: "refunded" }]; writeFileSync(platform, JSON.stringify(overRefunded), { mode: 0o600 });
  await assert.rejects(() => createBackup({ database, assets, platform, destination: join(root, "refund-backup") }), /reconciliation is invalid: usageRefunds.amountMicros/);
  backend.close();
});

test("OPS-2 restore rejects a valid non-OpenReel SQLite database before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-database-schema-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), backup = join(root, "backup"), restored = join(root, "restore");
  const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" }); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); await createBackup({ database, assets, platform, destination: backup }); backend.close();
  const databasePath = join(backup, "openreel.sqlite"), forged = new DatabaseSync(databasePath); forged.exec("DROP TABLE entities; DROP TABLE metadata; DROP TABLE schema_migrations; VACUUM"); forged.close();
  const manifestPath = join(backup, "manifest.json"), manifest = JSON.parse(readFileSync(manifestPath)), databaseEntry = manifest.files.find(item => item.path === "openreel.sqlite"), bytes = readFileSync(databasePath);
  databaseEntry.bytes = bytes.length; databaseEntry.sha256 = createHash("sha256").update(bytes).digest("hex"); writeFileSync(manifestPath, canonicalBackupManifestText(manifest));
  assert.throws(() => verifyBackup({ source: backup, destination: restored }), /missing required OpenReel tables/);
  assert.equal(existsSync(restored), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".restore.restore-")), []);
});

test("OPS-2 restore rejects database and asset file-set relationship drift before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-asset-relationship-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), backup = join(root, "backup"), restored = join(root, "restore");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Asset relationship" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"); store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); await createBackup({ database, assets, platform, destination: backup }); backend.close();
  const databasePath = join(backup, "openreel.sqlite"), forged = new DatabaseSync(databasePath), row = forged.prepare("SELECT id,data FROM entities WHERE kind='assets'").get(), value = JSON.parse(row.data); value.storageKey = "assets/missing.png"; forged.prepare("UPDATE entities SET data=? WHERE kind='assets' AND id=?").run(JSON.stringify(value), row.id); forged.close();
  const manifestPath = join(backup, "manifest.json"), manifest = JSON.parse(readFileSync(manifestPath)), databaseEntry = manifest.files.find(item => item.path === "openreel.sqlite"), bytes = readFileSync(databasePath); databaseEntry.bytes = bytes.length; databaseEntry.sha256 = createHash("sha256").update(bytes).digest("hex"); writeFileSync(manifestPath, canonicalBackupManifestText(manifest));
  assert.throws(() => verifyBackup({ source: backup, destination: restored }), /asset storage key is invalid|asset references differ/);
  assert.equal(existsSync(restored), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".restore.restore-")), []);
});

test("OPS-2 backup creation rejects invalid asset relationships before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-create-asset-relationship-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Invalid asset relationship" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"); store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
  const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='assets'").get(), value = JSON.parse(row.data); value.storageKey = ""; forged.prepare("UPDATE entities SET data=? WHERE kind='assets' AND id=?").run(JSON.stringify(value), row.id); forged.close();
  await assert.rejects(() => createBackup({ database, assets, platform, destination }), /asset storage key is invalid/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
});

test("OPS-2 backup creation rejects non-canonical asset storage paths before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-create-asset-path-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Invalid asset path" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), asset = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
  const invalidKey = `${asset.storageKey}\nforged-log-entry`; renameSync(join(assets, asset.storageKey), join(assets, invalidKey));
  const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='assets'").get(), value = JSON.parse(row.data); value.storageKey = invalidKey; forged.prepare("UPDATE entities SET data=? WHERE kind='assets' AND id=?").run(JSON.stringify(value), row.id); forged.close();
  await assert.rejects(() => createBackup({ database, assets, platform, destination }), /asset storage key is invalid/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
});

test("OPS-2 backup creation rejects asset identity and storage path drift before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-create-asset-identity-path-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Drifted asset path" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), asset = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
  const driftedKey = `${"f".repeat(64)}/${"e".repeat(64)}.bin`; mkdirSync(join(assets, "f".repeat(64)), { recursive: true }); renameSync(join(assets, asset.storageKey), join(assets, driftedKey));
  const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='assets'").get(), value = JSON.parse(row.data); value.storageKey = driftedKey; forged.prepare("UPDATE entities SET data=? WHERE kind='assets' AND id=?").run(JSON.stringify(value), row.id); forged.close();
  await assert.rejects(() => createBackup({ database, assets, platform, destination }), /asset storage key is invalid/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
});

test("OPS-2 backup creation rejects asset ownership relationship drift before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-create-asset-ownership-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Drifted asset ownership" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), asset = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
  const missingProjectId = "missing-project", driftedKey = `${createHash("sha256").update(missingProjectId).digest("hex")}/${createHash("sha256").update(asset.id).digest("hex")}.bin`; mkdirSync(dirname(join(assets, driftedKey)), { recursive: true }); renameSync(join(assets, asset.storageKey), join(assets, driftedKey));
  const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='assets'").get(), value = JSON.parse(row.data); value.projectId = missingProjectId; value.storageKey = driftedKey; forged.prepare("UPDATE entities SET data=? WHERE kind='assets' AND id=?").run(JSON.stringify(value), row.id); forged.close();
  await assert.rejects(() => createBackup({ database, assets, platform, destination }), /asset ownership relationship is invalid/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
});

test("OPS-2 backup creation rejects dangling asset producer relationships before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-create-asset-producer-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Drifted asset producer" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"); store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
  const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='assets'").get(), value = JSON.parse(row.data); value.nodeId = "missing-node"; forged.prepare("UPDATE entities SET data=? WHERE kind='assets' AND id=?").run(JSON.stringify(value), row.id); forged.close();
  await assert.rejects(() => createBackup({ database, assets, platform, destination }), /asset producer relationship is invalid/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
});

test("OPS-2 backup creation rejects dangling job ownership relationships before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-create-job-ownership-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Drifted job ownership" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), node = store.createNode(session.id, { type: "image" }, "owner"); store.createJob(session.id, { nodeId: node.id, prompt: "synthetic local fixture" }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
  const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='jobs'").get(), value = JSON.parse(row.data); value.nodeId = "missing-node"; forged.prepare("UPDATE entities SET data=? WHERE kind='jobs' AND id=?").run(JSON.stringify(value), row.id); forged.close();
  await assert.rejects(() => createBackup({ database, assets, platform, destination }), /job ownership relationship is invalid/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
});

test("OPS-2 backup creation rejects job lifecycle index and result drift before atomic promotion", async () => {
  const cases = [
    ["node.runIds", (db, nodeId) => { const row = db.prepare("SELECT data FROM entities WHERE kind='nodes' AND id=?").get(nodeId), value = JSON.parse(row.data); value.runIds = []; db.prepare("UPDATE entities SET data=? WHERE kind='nodes' AND id=?").run(JSON.stringify(value), nodeId); }],
    ["job.assetId", db => { const row = db.prepare("SELECT id,data FROM entities WHERE kind='jobs'").get(), value = JSON.parse(row.data); value.assetId = null; db.prepare("UPDATE entities SET data=? WHERE kind='jobs' AND id=?").run(JSON.stringify(value), row.id); }]
  ];
  for (const [field, mutate] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-job-lifecycle-${field.replace(".", "-")}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Drifted job lifecycle" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), node = store.createNode(session.id, { type: "image" }, "owner"), job = store.createJob(session.id, { nodeId: node.id, prompt: "synthetic local fixture" }, "owner"); store.tickJob(job.id, "owner"); store.tickJob(job.id, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database); mutate(forged, node.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), new RegExp(`job lifecycle relationship is invalid: ${field.replace(".", "\\.")}`));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects canvas relationship drift before atomic promotion", async () => {
  const cases = [
    ["sessions", value => { value.projectId = "missing-project"; }],
    ["nodes", value => { value.sessionId = "missing-session"; }],
    ["edges", value => { value.fromNodeId = "missing-node"; }],
    ["groups", value => { value.nodeIds.push("missing-node"); }]
  ];
  for (const [kind, mutate] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-canvas-${kind}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Drifted canvas" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), first = store.createNode(session.id, { type: "image" }, "owner"), second = store.createNode(session.id, { type: "video" }, "owner"); store.createEdge(project.id, { fromNodeId: first.id, toNodeId: second.id }, "owner"); store.createGroup(project.id, { title: "Shot", nodeIds: [first.id, second.id] }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind=? LIMIT 1").get(kind), value = JSON.parse(row.data); mutate(value); forged.prepare("UPDATE entities SET data=? WHERE kind=? AND id=?").run(JSON.stringify(value), kind, row.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), new RegExp(`canvas relationship is invalid: ${kind}`));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects invalid edge lifecycle and graph state before atomic promotion", async () => {
  const cases = [
    ["empty-output", (db, edge) => { edge.output = " "; }],
    ["empty-input", (db, edge) => { edge.input = ""; }],
    ["invalid-title", (db, edge) => { edge.title = null; }],
    ["invalid-version", (db, edge) => { edge.version = 0; }],
    ["invalid-created-at", (db, edge) => { edge.createdAt = "2026-08-15"; }],
    ["updated-before-created", (db, edge) => { edge.updatedAt = "2000-01-01T00:00:00.000Z"; }],
    ["self-edge", (db, edge) => { edge.toNodeId = edge.fromNodeId; }],
    ["duplicate", (db, edge) => { db.prepare("INSERT INTO entities(kind,id,data) VALUES('edges',?,?)").run("duplicate-edge", JSON.stringify({ ...edge, id: "duplicate-edge" })); }],
    ["cycle", (db, edge) => { db.prepare("INSERT INTO entities(kind,id,data) VALUES('edges',?,?)").run("cycle-edge", JSON.stringify({ ...edge, id: "cycle-edge", fromNodeId: edge.toNodeId, toNodeId: edge.fromNodeId })); }]
  ];
  for (const [label, mutate] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-edge-${label}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Drifted edge" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), first = store.createNode(session.id, { type: "image" }, "owner"), second = store.createNode(session.id, { type: "video" }, "owner"); store.createEdge(project.id, { fromNodeId: first.id, toNodeId: second.id }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='edges'").get(), value = JSON.parse(row.data); mutate(forged, value); forged.prepare("UPDATE entities SET data=? WHERE kind='edges' AND id=?").run(JSON.stringify(value), row.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), /edge (lifecycle|graph) is invalid/);
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects project index drift before atomic promotion", async () => {
  const cases = ["sessionIds", "nodeIds", "edgeIds", "groupIds", "assetIds"];
  for (const field of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-project-index-${field}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Drifted project index" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"), first = store.createNode(session.id, { type: "image" }, "owner"), second = store.createNode(session.id, { type: "video" }, "owner"); store.createEdge(project.id, { fromNodeId: first.id, toNodeId: second.id }, "owner"); store.createGroup(project.id, { title: "Shot", nodeIds: [first.id, second.id] }, "owner"); store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='projects'").get(), value = JSON.parse(row.data); value[field] = []; forged.prepare("UPDATE entities SET data=? WHERE kind='projects' AND id=?").run(JSON.stringify(value), row.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), new RegExp(`project index is invalid: ${field}`));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects invalid project membership before atomic promotion", async () => {
  const cases = [
    ["dangling-user", members => { members[0].userId = "missing-user"; }],
    ["duplicate-user", members => { members.push({ ...members[0], role: "viewer" }); }],
    ["invalid-role", members => { members[0].role = "administrator"; }],
    ["missing-owner", members => { members[0].role = "editor"; }],
    ["extra-field", members => { members[0].permissions = ["admin"]; }],
    ["missing-field", members => { delete members[0].role; }]
  ];
  for (const [label, mutate] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-project-membership-${label}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); store.createProject({ name: "Drifted membership" }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='projects'").get(), value = JSON.parse(row.data); mutate(value.members); forged.prepare("UPDATE entities SET data=? WHERE kind='projects' AND id=?").run(JSON.stringify(value), row.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), /project membership relationship is invalid/);
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects invalid session lifecycle and node indexes before atomic promotion", async () => {
  const cases = [
    ["empty-name", value => { value.name = " "; }, /session lifecycle is invalid/],
    ["invalid-version", value => { value.version = 0; }, /session lifecycle is invalid/],
    ["invalid-status", value => { value.status = "paused"; }, /session lifecycle is invalid/],
    ["noncanonical-created-at", value => { value.createdAt = "2026-01-01"; }, /session lifecycle is invalid/],
    ["updated-before-created", value => { value.updatedAt = "2000-01-01T00:00:00.000Z"; }, /session lifecycle is invalid/],
    ["active-with-closed-at", value => { value.closedAt = value.updatedAt; }, /session lifecycle is invalid/],
    ["closed-without-closed-at", value => { value.status = "closed"; value.closedAt = null; }, /session lifecycle is invalid/],
    ["missing-node-index", value => { value.nodeIds = []; }, /session node index is invalid/],
    ["duplicate-node-index", value => { value.nodeIds.push(value.nodeIds[0]); }, /session node index is invalid/]
  ];
  for (const [label, mutate, error] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-session-lifecycle-${label}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Session lifecycle" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"); store.createNode(session.id, { type: "image" }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='sessions'").get(), value = JSON.parse(row.data); mutate(value); forged.prepare("UPDATE entities SET data=? WHERE kind='sessions' AND id=?").run(JSON.stringify(value), row.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), error);
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects invalid node lifecycle values before atomic promotion", async () => {
  const cases = [
    ["invalid-type", value => { value.type = "binary"; }],
    ["empty-title", value => { value.title = " "; }],
    ["nonstring-content", value => { value.content = {}; }],
    ["nonfinite-position", value => { value.position.x = null; }],
    ["invalid-status", value => { value.status = "paused"; }],
    ["negative-result-version", value => { value.resultVersion = -1; }],
    ["invalid-version", value => { value.version = 0; }],
    ["noncanonical-created-at", value => { value.createdAt = "2026-01-01"; }],
    ["updated-before-created", value => { value.updatedAt = "2000-01-01T00:00:00.000Z"; }]
  ];
  for (const [label, mutate] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-node-lifecycle-${label}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Node lifecycle" }, "owner"), session = store.createSession(project.id, { name: "Main" }, "owner"); store.createNode(session.id, { type: "image" }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='nodes'").get(), value = JSON.parse(row.data); mutate(value); forged.prepare("UPDATE entities SET data=? WHERE kind='nodes' AND id=?").run(JSON.stringify(value), row.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), /node lifecycle is invalid/);
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects invalid user identity before atomic promotion", async () => {
  const cases = [
    ["empty-name", value => { value.name = " "; }],
    ["invalid-created-at", value => { value.createdAt = "not-a-canonical-time"; }]
  ];
  for (const [label, mutate] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-user-identity-${label}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); store.createProject({ name: "User identity" }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='users'").get(), value = JSON.parse(row.data); mutate(value); forged.prepare("UPDATE entities SET data=? WHERE kind='users' AND id=?").run(JSON.stringify(value), row.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), /user identity is invalid/);
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects project snapshot semantic drift before atomic promotion", async () => {
  const cases = [
    ["continuity", value => { value.continuityEntities = [{ id: "continuity-1", kind: "character", attributes: { coat: "red" }, lockedAttributes: ["missing"], referenceAssetIds: [] }]; }],
    ["story", value => { value.story = { scenes: [{ id: "scene-1", order: 1 }] }; value.sceneIds = ["scene-1"]; }],
    ["storyboard", value => { value.story = { title: "Story", version: 1, scenes: [{ id: "scene-1", title: "Scene", version: 1, order: 0 }] }; value.sceneIds = ["scene-1"]; value.storyboard = { version: 1, shots: [{ id: "shot-1", sceneId: "missing-scene", order: 0, prompt: "Prompt", duration: 5, continuityEntityIds: [], continuityEntityUsages: [], referenceAssetIds: [], generatedAssetId: null }] }; value.shotIds = ["shot-1"]; }],
    ["timeline", value => { value.timeline = { version: 1, tracks: [{ id: "track-1", kind: "video", clips: [{ id: "clip-1", assetId: "missing-asset", order: 0 }] }] }; }]
  ];
  for (const [kind, mutate] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-project-snapshot-${kind}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); store.createProject({ name: "Drifted project snapshot" }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='projects'").get(), value = JSON.parse(row.data); mutate(value); forged.prepare("UPDATE entities SET data=? WHERE kind='projects' AND id=?").run(JSON.stringify(value), row.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), new RegExp(`project snapshot is invalid: ${kind}`));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects project snapshot value drift before atomic promotion", async () => {
  const cases = [
    ["continuity", value => { value.continuityEntities = [{ id: "continuity-1", kind: "character", name: " ", version: 1, attributes: {}, lockedAttributes: [], referenceAssetIds: [] }]; }],
    ["story", value => { value.story = { title: "Story", version: 1, scenes: [{ id: "scene-1", title: "", version: 1, order: 0 }] }; value.sceneIds = ["scene-1"]; }],
    ["storyboard", value => { value.story = { title: "Story", version: 1, scenes: [{ id: "scene-1", title: "Scene", version: 1, order: 0 }] }; value.sceneIds = ["scene-1"]; value.storyboard = { version: 1, shots: [{ id: "shot-1", sceneId: "scene-1", order: 0, prompt: "Prompt", duration: 0, continuityEntityIds: [], continuityEntityUsages: [], referenceAssetIds: [], generatedAssetId: null }] }; value.shotIds = ["shot-1"]; }],
    ["timeline", value => { value.timeline = { version: 0, tracks: [] }; }]
  ];
  for (const [kind, mutate] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-project-value-${kind}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); store.createProject({ name: "Drifted project values" }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
    const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='projects'").get(), value = JSON.parse(row.data); mutate(value); forged.prepare("UPDATE entities SET data=? WHERE kind='projects' AND id=?").run(JSON.stringify(value), row.id); forged.close();
    await assert.rejects(() => createBackup({ database, assets, platform, destination }), new RegExp(`project snapshot is invalid: ${kind}`));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
  }
});

test("OPS-2 backup creation rejects continuity usage provenance drift before atomic promotion", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-create-continuity-usage-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
  const backend = createSqliteBackend(database, { assetRoot: assets }), store = createDatabaseStore(backend); store.createUser({ id: "owner", name: "Owner" }); const project = store.createProject({ name: "Drifted continuity usage" }, "owner"), entity = store.createContinuityEntity(project.id, { kind: "character", name: "Hero", attributes: { coat: "red" } }, "owner"), story = store.upsertStory(project.id, { scenes: [{ title: "Scene" }] }, "owner"); store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Hero enters", duration: 5, continuityEntityIds: [entity.id] }] }, "owner"); writeFileSync(platform, JSON.stringify(platformFixture()), { mode: 0o600 }); backend.close();
  const forged = new DatabaseSync(database), row = forged.prepare("SELECT id,data FROM entities WHERE kind='projects'").get(), value = JSON.parse(row.data); value.storyboard.shots[0].continuityEntityUsages[0].version = 0; forged.prepare("UPDATE entities SET data=? WHERE kind='projects' AND id=?").run(JSON.stringify(value), row.id); forged.close();
  await assert.rejects(() => createBackup({ database, assets, platform, destination }), /project snapshot is invalid: storyboard/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
});

test("OPS-2 backup creation validates collaborative document lifecycle and authorization", async () => {
  const base = () => {
    const state = platformFixture();
    state.accounts = [{ id: "account-1" }];
    state.teams = [{ id: "team-1", tenantId: "tenant-1", name: "Creative", version: 1, createdAt: "2026-01-01T00:00:00.000Z", members: [{ accountId: "account-1", role: "owner" }] }];
    state.collaborativeDocuments = [{ teamId: "team-1", tenantId: "tenant-1", documentId: "canvas-1", version: 1, content: { nodes: [] }, updatedAt: "2026-01-01T00:00:01.000Z", updatedBy: "account-1" }];
    return state;
  };
  const cases = [
    ["empty-id", state => { state.collaborativeDocuments[0].documentId = " "; }, /identity is invalid: collaborativeDocuments.documentId/],
    ["duplicate-id", state => { state.collaborativeDocuments.push({ ...state.collaborativeDocuments[0] }); }, /identity is invalid: collaborativeDocuments.documentId/],
    ["zero-version", state => { state.collaborativeDocuments[0].version = 0; }, /lifecycle is invalid: collaborativeDocuments/],
    ["missing-content", state => { delete state.collaborativeDocuments[0].content; }, /lifecycle is invalid: collaborativeDocuments/],
    ["noncanonical-time", state => { state.collaborativeDocuments[0].updatedAt = "2026-01-01T08:00:01.000+08:00"; }, /lifecycle is invalid: collaborativeDocuments/],
    ["nonmember-writer", state => { state.accounts.push({ id: "account-2" }); state.collaborativeDocuments[0].updatedBy = "account-2"; }, /authorization is invalid: collaborativeDocuments.updatedBy/]
  ];
  for (const [label, mutate, error] of [["valid", () => {}, null], ...cases]) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-collaborative-document-${label}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" }); const state = base(); mutate(state); writeFileSync(platform, JSON.stringify(state), { mode: 0o600 }); backend.close();
    if (error) {
      await assert.rejects(() => createBackup({ database, assets, platform, destination }), error);
      assert.equal(existsSync(destination), false);
      assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
    } else await createBackup({ database, assets, platform, destination });
  }
});

test("OPS-2 backup creation validates imported workflow replay identity and provenance", async () => {
  const document = { schema: "openreel-workflow/v1", template: "story-to-video", version: 1, nodes: [{ id: "script", type: "script" }, { id: "video", type: "video" }] };
  const base = () => {
    const state = platformFixture();
    state.accounts = [{ id: "account-1" }];
    state.teams = [{ id: "team-1", tenantId: "tenant-1", name: "Creative", version: 1, createdAt: "2026-01-01T00:00:00.000Z", members: [{ accountId: "account-1", role: "owner" }] }];
    state.workflows = [{ id: "workflow-1", tenantId: "tenant-1", ...structuredClone(document), digest: createHash("sha256").update(JSON.stringify(document)).digest("hex"), provenance: { importedAt: "2026-01-01T00:00:01.000Z", source: "local-import" } }];
    return state;
  };
  const cases = [
    ["wrong-schema", state => { state.workflows[0].schema = "openreel-workflow/v2"; }, /workflow schema is invalid/],
    ["empty-template", state => { state.workflows[0].template = " "; }, /workflow schema is invalid/],
    ["duplicate-node", state => { state.workflows[0].nodes[1].id = "script"; }, /workflow node is invalid/],
    ["unsupported-node", state => { state.workflows[0].nodes[0].type = "executable"; }, /workflow node is invalid/],
    ["digest-drift", state => { state.workflows[0].nodes[0].label = "tampered"; }, /workflow digest is invalid/],
    ["noncanonical-import-time", state => { state.workflows[0].provenance.importedAt = "2026-01-01T08:00:01.000+08:00"; }, /workflow provenance is invalid/],
    ["external-source", state => { state.workflows[0].provenance.source = "unknown"; }, /workflow provenance is invalid/]
  ];
  for (const [label, mutate, error] of [["valid", () => {}, null], ...cases]) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-workflow-${label}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" }); const state = base(); mutate(state); writeFileSync(platform, JSON.stringify(state), { mode: 0o600 }); backend.close();
    if (error) {
      await assert.rejects(() => createBackup({ database, assets, platform, destination }), error);
      assert.equal(existsSync(destination), false);
      assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
    } else await createBackup({ database, assets, platform, destination });
  }
});

test("OPS-2 backup creation validates persisted automation replay and workflow binding", async () => {
  const document = { schema: "openreel-workflow/v1", template: "story-to-video", version: 1, nodes: [{ id: "script", type: "script" }, { id: "video", type: "video" }] };
  const base = () => {
    const state = platformFixture();
    state.accounts = [{ id: "owner" }];
    state.teams = [{ id: "team-1", tenantId: "tenant-1", name: "Team", version: 1, createdAt: "2026-01-01T00:00:00.000Z", members: [{ accountId: "owner", role: "owner" }] }];
    state.workflows = [{ id: "workflow-1", tenantId: "tenant-1", ...structuredClone(document), digest: createHash("sha256").update(JSON.stringify(document)).digest("hex"), provenance: { importedAt: "2026-01-01T00:00:01.000Z", source: "local-import" } }];
    state.automations = [{ id: "automation-1", tenantId: "tenant-1", idempotencyKey: "run-1", intent: "Render story", plan: { schema: "openreel-automation-plan/v1", tenantId: "tenant-1", intent: "Render story", workflowId: "workflow-1", nodes: document.nodes.map((node, order) => ({ ...node, order })), estimatedCost: 20 }, status: "succeeded", failure: null, cost: 20, reservationId: "reservation-1", createdAt: "2026-01-01T00:00:02.000Z" }];
    return state;
  };
  const cases = [
    ["valid", () => {}, null],
    ["cross-tenant", state => { state.automations[0].tenantId = "other"; }, /automation relationship is invalid|reference is invalid/],
    ["unknown-workflow", state => { state.automations[0].plan.workflowId = "missing"; }, /automation relationship is invalid/],
    ["node-order-drift", state => { state.automations[0].plan.nodes[0].order = 1; }, /automation plan is invalid/],
    ["intent-drift", state => { state.automations[0].plan.intent = "Changed"; }, /automation relationship is invalid/],
    ["failed-without-failure", state => { state.automations[0].status = "failed"; state.automations[0].cost = 0; }, /automation outcome is invalid/]
  ];
  for (const [label, mutate, error] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-automation-${label}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" }); const state = base(); mutate(state); writeFileSync(platform, JSON.stringify(state), { mode: 0o600 }); backend.close();
    if (error) await assert.rejects(() => createBackup({ database, assets, platform, destination }), error);
    else await createBackup({ database, assets, platform, destination });
  }
});

test("OPS-2 backup creation validates tenant-scoped object storage identity", async () => {
  const base = () => {
    const state = platformFixture();
    state.accounts = [{ id: "owner" }];
    state.teams = [{ id: "team-1", tenantId: "tenant-1", name: "Team", version: 1, createdAt: "2026-01-01T00:00:00.000Z", members: [{ accountId: "owner", role: "owner" }] }];
    state.objects = [{ tenantId: "tenant-1", key: "canvas/main", value: { nodes: [] } }];
    return state;
  };
  const cases = [
    ["valid", () => {}, null],
    ["empty-key", state => { state.objects[0].key = " "; }, /object shape is invalid/],
    ["missing-value", state => { delete state.objects[0].value; }, /object shape is invalid/],
    ["duplicate-key", state => { state.objects.push(structuredClone(state.objects[0])); }, /identity is invalid: objects.key/],
    ["unknown-tenant", state => { state.objects[0].tenantId = "missing"; }, /reference is invalid: objects.tenantId/]
  ];
  for (const [label, mutate, error] of cases) {
    const root = mkdtempSync(join(tmpdir(), `openreel-backup-create-object-${label}-`)), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platform = join(root, "source/platform.json"), destination = join(root, "backup");
    const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" }); const state = base(); mutate(state); writeFileSync(platform, JSON.stringify(state), { mode: 0o600 }); backend.close();
    if (error) {
      await assert.rejects(() => createBackup({ database, assets, platform, destination }), error);
      assert.equal(existsSync(destination), false);
      assert.deepEqual(readdirSync(root).filter(name => name.startsWith(".backup.backup-")), []);
    } else await createBackup({ database, assets, platform, destination });
  }
});

test("OPS-2 stable asset copy rejects source mutation during backup", () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-backup-source-race-")), source = join(root, "source.bin"), destination = join(root, "destination.bin");
  writeFileSync(source, fixture);
  assert.throws(() => copyStableFile(source, destination, (from, to) => {
    cpSync(from, to);
    writeFileSync(from, Buffer.concat([fixture, Buffer.from("changed")]));
  }), /source changed during copy/);
});

test("OPS-2 deployment artifacts enforce loopback binding, proxy headers, and hardening", () => {
  const service = readFileSync(new URL("../deploy/openreel.service", import.meta.url), "utf8"), backup = readFileSync(new URL("../deploy/openreel-backup.service", import.meta.url), "utf8"), timer = readFileSync(new URL("../deploy/openreel-backup.timer", import.meta.url), "utf8"), caddy = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8"), environment = readFileSync(new URL("../deploy/openreel.env.example", import.meta.url), "utf8");
  for (const expected of ["User=openreel", "NoNewPrivileges=true", "ProtectSystem=strict", "CapabilityBoundingSet=", "ReadWritePaths=/var/lib/openreel"]) assert.match(service, new RegExp(expected.replace(/[=.]/g, "\\$&")));
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:4173/); assert.match(caddy, /X-Forwarded-Proto/); assert.match(caddy, /X-Forwarded-For/); assert.match(caddy, /X-Request-ID/); assert.match(caddy, /respond @internal 404/);
  assert.match(backup, /Type=oneshot/); assert.match(backup, /ReadOnlyPaths=\/var\/lib\/openreel/); assert.match(timer, /OnCalendar=daily/); assert.match(timer, /Persistent=true/);
  assert.match(environment, /OPENREEL_AGENT_FILMS=\/var\/lib\/openreel\/agent-films\.json/);
});

test("OPS-2 release artifact manifest detects drift before rollback activation", () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-release-manifest-"));
  const manifest = buildReleaseManifest(fileURLToPath(new URL("..", import.meta.url)));
  assert.deepEqual(manifest.artifacts.map(item => item.path), releaseArtifactPaths);
  for (const artifact of manifest.artifacts) {
    const source = new URL(`../${artifact.path}`, import.meta.url);
    const target = join(root, artifact.path);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(fileURLToPath(source), target, { recursive: false });
  }
  assert.deepEqual(verifyReleaseManifest(root, manifest), { status: "verified", artifacts: releaseArtifactPaths.length });
  writeFileSync(join(root, releaseArtifactPaths[0]), "drift");
  assert.throws(() => verifyReleaseManifest(root, manifest), /integrity failure/);
});

test("OPS-2 release artifact manifest covers every production source module", () => {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const sourceModules = readdirSync(join(repository, "src"))
    .filter(name => name.endsWith(".js") || name.endsWith(".css"))
    .map(name => `src/${name}`)
    .sort();
  const manifestedModules = releaseArtifactPaths.filter(path => path.startsWith("src/")).sort();
  assert.deepEqual(manifestedModules, sourceModules);
});

test("OPS-2 release artifact manifest covers every runtime migration and its verifier", () => {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const migrations = readdirSync(join(repository, "migrations"))
    .filter(name => name.endsWith(".sql"))
    .map(name => `migrations/${name}`)
    .sort();
  const manifestedMigrations = releaseArtifactPaths.filter(path => path.startsWith("migrations/")).sort();
  assert.deepEqual(manifestedMigrations, migrations);
  assert.ok(releaseArtifactPaths.includes("scripts/qualify-release-artifacts.mjs"));
});

test("OPS-2 release artifact manifest rejects shape drift, path escape, and symlinks", () => {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const manifest = buildReleaseManifest(repository);
  assert.throws(() => verifyReleaseManifest(repository, { ...manifest, artifacts: manifest.artifacts.slice(1) }));
  assert.throws(() => verifyReleaseManifest(repository, { ...manifest, artifacts: [...manifest.artifacts].reverse() }));
  assert.throws(() => verifyReleaseManifest(repository, { ...manifest, artifacts: [{ ...manifest.artifacts[0], path: "../outside" }, ...manifest.artifacts.slice(1)] }));

  const root = mkdtempSync(join(tmpdir(), "openreel-release-symlink-"));
  for (const artifact of manifest.artifacts) {
    const target = join(root, artifact.path);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(join(repository, artifact.path), target, { recursive: false });
  }
  const linked = join(root, releaseArtifactPaths[0]);
  unlinkSync(linked);
  symlinkSync(join(repository, releaseArtifactPaths[0]), linked);
  assert.throws(() => verifyReleaseManifest(root, manifest), /must be a regular file/);

  const sourceLink = join(root, "source-link");
  mkdirSync(sourceLink);
  for (const artifact of releaseArtifactPaths) {
    const target = join(sourceLink, artifact);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(join(repository, artifact), target, { recursive: false });
  }
  unlinkSync(join(sourceLink, releaseArtifactPaths[0]));
  symlinkSync(join(repository, releaseArtifactPaths[0]), join(sourceLink, releaseArtifactPaths[0]));
  assert.throws(() => buildReleaseManifest(sourceLink), /must be a regular file/);
});

test("OPS-2 release manifest canonical payload is deterministic and schema-strict", () => {
  const manifest = buildReleaseManifest(fileURLToPath(new URL("..", import.meta.url)));
  const reorderedKeys = {
    artifacts: manifest.artifacts.map(({ path, bytes, sha256 }) => ({ sha256, path, bytes })),
    algorithm: manifest.algorithm,
    version: manifest.version
  };
  assert.deepEqual(canonicalReleaseManifestBytes(manifest), canonicalReleaseManifestBytes(reorderedKeys));
  assert.doesNotMatch(canonicalReleaseManifestBytes(manifest).toString("utf8"), /\n|\r|  /);
  assert.throws(() => canonicalReleaseManifestBytes({ ...manifest, unexpected: true }), /fields are invalid/);
  assert.throws(() => canonicalReleaseManifestBytes({ ...manifest, artifacts: manifest.artifacts.map((item, index) => index ? item : { ...item, unexpected: true }) }), /fields are invalid/);
  assert.throws(() => canonicalReleaseManifestBytes({ ...manifest, artifacts: manifest.artifacts.map((item, index) => index ? item : { ...item, bytes: -1 }) }), /bytes are invalid/);
  assert.throws(() => canonicalReleaseManifestBytes({ ...manifest, artifacts: manifest.artifacts.map((item, index) => index ? item : { ...item, sha256: "invalid" }) }), /digest is invalid/);
});

test("OPS-2 unprivileged rehearsal starts the real production service on loopback", { skip: process.getuid?.() === 0 }, async () => {
  const { stdout } = await exec(process.execPath, [new URL("../scripts/rehearse-deployment.mjs", import.meta.url).pathname], { timeout: 15_000 }); const result = JSON.parse(stdout); assert.equal(result.status, "passed"); assert.match(result.binding, /^127\.0\.0\.1:/);
});
