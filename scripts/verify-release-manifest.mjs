#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = realpathSync(new URL("../", import.meta.url));
const manifestPath = resolve(process.argv[2] || "release-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.schema, "openreel-release-manifest/v1");
assert.match(manifest.releaseId, /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/);
assert.notEqual(manifest.releaseId, manifest.rollback.releaseId);
const git = (...parts) => execFileSync("git", ["-C", root, ...parts], { encoding: "utf8" }).trim();
assert.equal(git("status", "--porcelain=v1"), "", "worktree must be clean");
assert.equal(git("rev-parse", "HEAD"), manifest.source.commit, "Git commit drift");
assert.equal(git("rev-parse", "HEAD^{tree}"), manifest.source.tree, "Git tree drift");
const tracked = git("ls-files", "-z").split("\0").filter(Boolean).sort();
assert.deepEqual(manifest.files.map(item => item.path), tracked, "tracked file set drift");
for (const item of manifest.files) {
  const absolute = resolve(root, item.path), stat = lstatSync(absolute);
  assert.ok(stat.isFile(), `not a regular file: ${item.path}`);
  const bytes = readFileSync(absolute);
  assert.equal(bytes.length, item.bytes, `byte count drift: ${item.path}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, `digest drift: ${item.path}`);
}
const backup = readFileSync(resolve(root, manifest.rollback.stateBackupManifest));
assert.equal(createHash("sha256").update(backup).digest("hex"), manifest.rollback.stateBackupSha256, "rollback state manifest drift");
console.log(JSON.stringify({ status: "verified", releaseId: manifest.releaseId, commit: manifest.source.commit, files: tracked.length, rollbackReleaseId: manifest.rollback.releaseId }));
