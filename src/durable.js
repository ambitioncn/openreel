import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DomainError, SCHEMA_VERSION } from "./core.js";

const KINDS = Object.freeze(["projects", "sessions", "nodes", "edges", "groups", "jobs", "assets", "users"]);
const MIGRATIONS = Object.freeze([
  { version: 1, sql: readFileSync(new URL("../migrations/001-initial.sql", import.meta.url), "utf8") },
  { version: 2, sql: readFileSync(new URL("../migrations/002-ark-jobs.sql", import.meta.url), "utf8") }
]);
const digest = value => createHash("sha256").update(value).digest("hex");
const blank = () => Object.fromEntries([...[ ["schemaVersion", SCHEMA_VERSION] ], ...KINDS.map(k => [k, []])]);

function safeDirectory(path) {
  const absolute = resolve(path);
  mkdirSync(absolute, { recursive: true, mode: 0o750 });
  let cursor = absolute;
  while (cursor !== dirname(cursor)) { if (lstatSync(cursor).isSymbolicLink()) throw new DomainError("UNSAFE_STORAGE", "asset storage must not contain symbolic links", 500); cursor = dirname(cursor); }
  return absolute;
}

export function createAssetStorage(root) {
  const base = safeDirectory(root);
  const pathFor = (projectId, assetId) => join(base, digest(String(projectId)), `${digest(String(assetId))}.bin`);
  const assertInside = path => { const absolute = resolve(path); if (!absolute.startsWith(`${base}${sep}`)) throw new DomainError("UNSAFE_STORAGE", "asset path escaped storage root", 500); return absolute; };
  return {
    put(projectId, assetId, bytes) {
      const target = assertInside(pathFor(projectId, assetId)), dir = dirname(target);
      mkdirSync(dir, { recursive: true, mode: 0o750 });
      if (lstatSync(dir).isSymbolicLink()) throw new DomainError("UNSAFE_STORAGE", "asset tenant directory is a symbolic link", 500);
      const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try { writeFileSync(temp, bytes, { mode: 0o640, flag: "wx" }); const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, target); const dirFd = openSync(dir, "r"); try { fsyncSync(dirFd); } finally { closeSync(dirFd); } }
      finally { rmSync(temp, { force: true }); }
      return { storageKey: target.slice(base.length + 1), sha256: digest(bytes), byteLength: bytes.length };
    },
    read(asset) {
      if (!asset.storageKey || asset.storageKey.includes("..") || resolve(base, asset.storageKey) !== pathFor(asset.projectId, asset.id)) throw new DomainError("ASSET_CORRUPT", "asset storage key is invalid", 500);
      const path = assertInside(resolve(base, asset.storageKey));
      let info; try { info = lstatSync(path); } catch (error) { if (error.code === "ENOENT") throw new DomainError("ASSET_MISSING", "asset bytes are missing", 500); throw error; }
      if (!info.isFile() || info.isSymbolicLink()) throw new DomainError("UNSAFE_STORAGE", "asset is not a regular file", 500);
      const bytes = readFileSync(path); if (bytes.length !== asset.byteLength || digest(bytes) !== asset.sha256) throw new DomainError("ASSET_CORRUPT", "asset content integrity check failed", 500); return bytes;
    },
    remove(asset) { if (asset?.storageKey) rmSync(assertInside(resolve(base, asset.storageKey)), { force: true }); },
    root: base
  };
}

export function createSqliteBackend(databaseFile, { legacyJson = null, assetRoot = `${databaseFile}.assets` } = {}) {
  mkdirSync(dirname(databaseFile), { recursive: true });
  const database = new DatabaseSync(databaseFile);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const migration of MIGRATIONS) if (!database.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(migration.version)) { database.exec("BEGIN IMMEDIATE"); try { database.exec(migration.sql); database.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(migration.version, new Date().toISOString()); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; } }
  const assets = createAssetStorage(assetRoot);
  const read = () => { const state = blank(); for (const row of database.prepare("SELECT kind,data FROM entities").all()) { if (!KINDS.includes(row.kind)) throw new DomainError("DATABASE_CORRUPT", `unknown entity kind ${row.kind}`, 500); let value; try { value = JSON.parse(row.data); } catch { throw new DomainError("DATABASE_CORRUPT", "entity JSON is invalid", 500); } if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string" || !value.id) throw new DomainError("DATABASE_CORRUPT", "entity shape is invalid", 500); state[row.kind].push(value); } const revision = Number(database.prepare("SELECT value FROM metadata WHERE key='revision'").get()?.value); if (!Number.isSafeInteger(revision) || revision < 0) throw new DomainError("DATABASE_CORRUPT", "database revision is invalid", 500); return { state, revision }; };
  const commit = (state, expectedRevision) => { database.exec("BEGIN IMMEDIATE"); try { const current = Number(database.prepare("SELECT value FROM metadata WHERE key='revision'").get().value); if (current !== expectedRevision) throw new DomainError("CONCURRENT_UPDATE", "database changed during transaction; retry operation", 409, { expectedRevision, currentRevision: current }); database.exec("DELETE FROM entities"); const insert = database.prepare("INSERT INTO entities(kind,id,data) VALUES(?,?,?)"); for (const kind of KINDS) for (const entity of state[kind]) insert.run(kind, entity.id, JSON.stringify(entity)); database.prepare("UPDATE metadata SET value=? WHERE key='revision'").run(String(current + 1)); database.exec("COMMIT"); return current + 1; } catch (error) { database.exec("ROLLBACK"); throw error; } };
  const importLegacy = source => { const current = read(); if (current.revision || KINDS.some(k => current.state[k].length)) return false; const raw = JSON.parse(readFileSync(source, "utf8")); if (![1,2,3].includes(raw.schemaVersion)) throw new DomainError("UNSUPPORTED_SCHEMA", `unsupported legacy schema ${raw.schemaVersion}`, 500); const state = blank(); for (const kind of KINDS) state[kind] = raw[kind] || []; for (const asset of state.assets) if (asset.bytes) { const stored = assets.put(asset.projectId, asset.id, Buffer.from(asset.bytes, "base64")); delete asset.bytes; Object.assign(asset, stored); } commit(state, current.revision); return true; };
  if (legacyJson && existsSync(legacyJson)) importLegacy(legacyJson);
  const health = () => {
    const result = database.prepare("PRAGMA quick_check").get();
    if (result.quick_check !== "ok") throw new DomainError("DATABASE_UNHEALTHY", "database integrity check failed", 503);
    accessSync(safeDirectory(assetRoot), constants.R_OK | constants.W_OK);
    return { database: "ok", assets: "ok" };
  };
  const arkJobs = {
    get(id) { const row = database.prepare("SELECT data,version FROM ark_jobs WHERE id=?").get(id); return row ? { job: JSON.parse(row.data), version: row.version } : null; },
    getByIdempotency(ownerHash, idempotencyKey) { const row = database.prepare("SELECT data,version FROM ark_jobs WHERE owner_hash=? AND idempotency_key=?").get(ownerHash, idempotencyKey); return row ? { job: JSON.parse(row.data), version: row.version } : null; },
    create(job) { try { database.prepare("INSERT INTO ark_jobs(id,owner_hash,idempotency_key,data) VALUES(?,?,?,?)").run(job.id, job.ownerHash, job.idempotencyKey, JSON.stringify(job)); return { job: structuredClone(job), version: 1 }; } catch (error) { if (error.code === "ERR_SQLITE_ERROR" && String(error.message).includes("UNIQUE constraint failed")) return this.getByIdempotency(job.ownerHash, job.idempotencyKey); throw error; } },
    update(job, expectedVersion) { const result = database.prepare("UPDATE ark_jobs SET data=?,version=version+1 WHERE id=? AND version=?").run(JSON.stringify(job), job.id, expectedVersion); if (result.changes !== 1) throw new DomainError("CONCURRENT_UPDATE", "Ark job changed during transaction; retry operation", 409); return { job: structuredClone(job), version: expectedVersion + 1 }; }
  };
  return { read, commit, assets, arkJobs, importLegacy, health, close: () => database.close(), databaseFile };
}
