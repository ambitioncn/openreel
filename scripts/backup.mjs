#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const digest = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const files = root => readdirSync(root, { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => join(item.parentPath, item.name)).sort();
const inside = (root, value) => { const path = resolve(root, value); if (!path.startsWith(`${resolve(root)}/`)) throw new Error("backup path escaped asset root"); return path; };

export async function createBackup({ database, assets, platform, destination }) {
  for (const path of [database, assets, platform]) if (!existsSync(path)) throw new Error(`backup source missing: ${path}`);
  if (existsSync(destination)) throw new Error("backup destination must not already exist");
  mkdirSync(join(destination, "assets"), { recursive: true, mode: 0o700 });
  const source = new DatabaseSync(database, { readOnly: true });
  const referenced = source.prepare("SELECT data FROM entities WHERE kind='assets'").all().map(row => JSON.parse(row.data).storageKey).filter(Boolean);
  await backup(source, join(destination, "openreel.sqlite")); source.close();
  for (const key of referenced) { const from = inside(assets, key), to = inside(join(destination, "assets"), key); mkdirSync(dirname(to), { recursive: true, mode: 0o700 }); cpSync(from, to); }
  cpSync(platform, join(destination, "platform.json"));
  const manifest = { version: 1, createdAt: new Date().toISOString(), files: files(destination).map(path => ({ path: path.slice(destination.length + 1), bytes: statSync(path).size, sha256: digest(path) })) };
  writeFileSync(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

export function verifyBackup({ source, destination }) {
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
  for (const item of manifest.files) { const path = inside(source, item.path); if (!existsSync(path) || statSync(path).size !== item.bytes || digest(path) !== item.sha256) throw new Error(`backup integrity failure: ${item.path}`); }
  if (existsSync(destination)) throw new Error("restore destination must not already exist");
  mkdirSync(destination, { recursive: true, mode: 0o700 }); cpSync(join(source, "openreel.sqlite"), join(destination, "openreel.sqlite")); cpSync(join(source, "assets"), join(destination, "assets"), { recursive: true }); cpSync(join(source, "platform.json"), join(destination, "platform.json"));
  const db = new DatabaseSync(join(destination, "openreel.sqlite")); const check = db.prepare("PRAGMA quick_check").get().quick_check; db.close(); if (check !== "ok") throw new Error("restored database quick_check failed");
  return { database: "ok", assets: manifest.files.filter(item => item.path.startsWith("assets/")).length, isolatedDestination: resolve(destination) };
}

if (process.argv[1] && basename(process.argv[1]) === "backup.mjs") {
  const [command, source, assets, platform, destination] = process.argv.slice(2);
  if (command === "create") console.log(JSON.stringify(await createBackup({ database: source, assets, platform, destination })));
  else if (command === "verify") console.log(JSON.stringify(verifyBackup({ source, destination: assets })));
  else { console.error("usage: backup.mjs create <database> <assets> <platform> <destination> | verify <backup> <isolated-restore>"); process.exitCode = 2; }
}
