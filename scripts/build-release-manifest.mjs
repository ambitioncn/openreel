#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";

const root = realpathSync(new URL("../", import.meta.url));
const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value, all[index + 1]] : []).filter(Boolean));
const releaseId = args.get("--release-id");
const rollbackReleaseId = args.get("--rollback-release-id");
const stateBackupManifest = args.get("--state-backup-manifest");
const output = resolve(root, args.get("--output") || "release-manifest.json");
if (!releaseId || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(releaseId)) throw new Error("--release-id is required and must be a stable identifier");
if (!rollbackReleaseId || rollbackReleaseId === releaseId) throw new Error("--rollback-release-id must name a distinct prior release");
if (!stateBackupManifest) throw new Error("--state-backup-manifest is required");

const git = (...parts) => execFileSync("git", ["-C", root, ...parts], { encoding: "utf8" }).trim();
const dirty = git("status", "--porcelain=v1");
if (dirty) throw new Error("authoritative release manifests require a clean Git worktree");
const commit = git("rev-parse", "HEAD");
const tree = git("rev-parse", "HEAD^{tree}");
const files = git("ls-files", "-z").split("\0").filter(Boolean).sort().map(path => {
  const absolute = resolve(root, path), stat = lstatSync(absolute);
  if (!stat.isFile()) throw new Error(`tracked release input is not a regular file: ${path}`);
  const bytes = readFileSync(absolute);
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const backupPath = resolve(stateBackupManifest);
const backupBytes = readFileSync(backupPath);
const manifest = {
  schema: "openreel-release-manifest/v1",
  releaseId,
  source: { commit, tree, dirty: false },
  rollback: { releaseId: rollbackReleaseId, stateBackupManifest: relative(root, backupPath), stateBackupSha256: createHash("sha256").update(backupBytes).digest("hex") },
  files
};
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ status: "created", releaseId, commit, tree, files: files.length, output }));
