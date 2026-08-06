import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDatabaseStore } from "../src/core.js";
import { createAssetStorage, createSqliteBackend } from "../src/durable.js";

const fixture = Buffer.from("89504e470d0a1a0a00000000", "hex");
function location(name) { const root = mkdtempSync(join(tmpdir(), `openreel-data1-${name}-`)); return { root, database: join(root, "openreel.sqlite"), assets: join(root, "assets") }; }
function open(paths, options = {}) { const backend = createSqliteBackend(paths.database, { assetRoot: paths.assets, ...options }); return { backend, store: createDatabaseStore(backend) }; }
function seeded(store, owner = "owner-a") { store.createUser({ id: owner, name: owner }); const project = store.createProject({ name: "Durable" }, owner), session = store.createSession(project.id, { name: "Main" }, owner); const asset = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "safe.png", bytes: fixture }, owner); return { project, session, asset }; }

test("DATA-1 SQLite migrations are versioned and legacy JSON import is replay-safe", () => {
  const paths = location("migration"), legacy = join(paths.root, "legacy.json");
  writeFileSync(legacy, JSON.stringify({ schemaVersion: 3, projects: [{ id: "p", name: "Legacy", members: [{ userId: "u", role: "owner" }], sessionIds: [], nodeIds: [], edgeIds: [], groupIds: [], assetIds: ["a"], sceneIds: [], shotIds: [], timeline: { version: 1, tracks: [] } }], sessions: [], nodes: [], edges: [], groups: [], jobs: [], users: [{ id: "u", name: "User" }], assets: [{ id: "a", projectId: "p", sessionId: null, kind: "image", role: "reference", mimeType: "image/png", filename: "old.png", byteLength: fixture.length, bytes: fixture.toString("base64"), metadata: {}, createdAt: "2026-01-01T00:00:00.000Z" }] }));
  let opened = open(paths, { legacyJson: legacy }); assert.equal(opened.store.snapshot("p", "u").assets.length, 1); assert.deepEqual(opened.store.assetContent("p", "a", undefined, "u").bytes, fixture); opened.backend.close();
  opened = open(paths, { legacyJson: legacy }); assert.equal(opened.store.snapshot("p", "u").assets.length, 1); opened.backend.close();
  const db = new DatabaseSync(paths.database, { readOnly: true }); assert.deepEqual(db.prepare("SELECT version FROM schema_migrations").all().map(x => x.version), [1, 2]); assert.equal(db.prepare("SELECT instr(data, ?) AS found FROM entities WHERE kind='assets'").get(fixture.toString("base64")).found, 0); db.close();
});

test("DATA-1 transaction CAS prevents lost updates, rolls back, and recovers on retry", () => {
  const paths = location("concurrency"), first = open(paths), second = open(paths); seeded(first.store); assert.throws(() => second.store.createUser({ id: "stale", name: "Stale" }), error => error.code === "CONCURRENT_UPDATE" && error.status === 409); second.store.createUser({ id: "fresh", name: "Fresh" }); second.backend.close(); first.backend.close();
  const recovered = open(paths); recovered.store.createProject({ name: "After crash boundary" }, "fresh"); assert.equal(recovered.store.listProjects("fresh").length, 1); recovered.backend.close();
});

test("DATA-1 asset writes are isolated, restart-safe, integrity checked, and reject symlinks", () => {
  const paths = location("assets"), opened = open(paths), { project, asset } = seeded(opened.store); const inspection = new DatabaseSync(paths.database, { readOnly: true }), row = inspection.prepare("SELECT data FROM entities WHERE kind='assets' AND id=?").get(asset.id); inspection.close(); const metadata = JSON.parse(row.data), path = join(paths.assets, metadata.storageKey); assert.equal(existsSync(path), true); assert.equal(dirname(path).startsWith(paths.assets), true); assert.throws(() => createAssetStorage(paths.assets).read({ projectId: project.id, id: asset.id, storageKey: "../../etc/passwd", byteLength: 0, sha256: "" }), error => error.code === "ASSET_CORRUPT"); opened.backend.close();
  let restarted = open(paths); assert.deepEqual(restarted.store.assetContent(project.id, asset.id, undefined, "owner-a").bytes, fixture); restarted.backend.close();
  writeFileSync(path, Buffer.from("tampered")); restarted = open(paths); assert.throws(() => restarted.store.assetContent(project.id, asset.id, undefined, "owner-a"), error => error.code === "ASSET_CORRUPT"); restarted.backend.close();
  unlinkSync(path); symlinkSync("/etc/passwd", path); restarted = open(paths); assert.throws(() => restarted.store.assetContent(project.id, asset.id, undefined, "owner-a"), error => error.code === "UNSAFE_STORAGE"); restarted.backend.close();
});

test("DATA-1 tenant/object authorization denies cross-tenant project, session, node, job and asset IDOR", () => {
  const paths = location("idor"), opened = open(paths), a = seeded(opened.store, "tenant-a"); opened.store.createUser({ id: "tenant-b", name: "Tenant B" }); const b = opened.store.createProject({ name: "B" }, "tenant-b"), bs = opened.store.createSession(b.id, { name: "B" }, "tenant-b"), bn = opened.store.createNode(bs.id, { type: "image" }, "tenant-b"), bj = opened.store.createJob(bs.id, { nodeId: bn.id, prompt: "private" }, "tenant-b");
  const denied = [() => opened.store.snapshot(b.id, "tenant-a"), () => opened.store.createSession(b.id, { name: "x" }, "tenant-a"), () => opened.store.updateNode(bn.id, { title: "x" }, "tenant-a"), () => opened.store.tickJob(bj.id, "tenant-a"), () => opened.store.progress(bj.id, 0, "tenant-a"), () => opened.store.assetManifest(a.project.id, opened.store.uploadReference(b.id, bs.id, { mimeType: "image/png", filename: "b.png", bytes: fixture }, "tenant-b").id, undefined, "tenant-a")];
  for (const operation of denied) assert.throws(operation, error => ["FORBIDDEN", "SCOPE_MISMATCH"].includes(error.code)); opened.backend.close();
});

test("DATA-1 malformed database entity data fails closed", () => {
  const paths = location("corruption"), opened = open(paths); seeded(opened.store); opened.backend.close(); const db = new DatabaseSync(paths.database); db.prepare("UPDATE entities SET data='null' WHERE kind='projects'").run(); db.close(); assert.throws(() => open(paths), error => error.code === "DATABASE_CORRUPT");
});
