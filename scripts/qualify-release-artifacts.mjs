#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const releaseArtifactPaths = [
  "package.json",
  "package-lock.json",
  "server.mjs",
  "deploy/Caddyfile",
  "deploy/openreel.service",
  "deploy/openreel-backup.service",
  "deploy/openreel-backup.timer",
  "scripts/backup.mjs",
  "scripts/production-e2e.mjs",
  "scripts/rehearse-deployment.mjs"
];

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const safePath = (root, relative) => {
  const path = resolve(root, relative);
  if (!path.startsWith(`${resolve(root)}/`)) throw new Error(`artifact path escaped root: ${relative}`);
  return path;
};

export function buildReleaseManifest(root = repository) {
  return {
    version: 1,
    algorithm: "sha256",
    artifacts: releaseArtifactPaths.map(path => {
      const absolute = safePath(root, path);
      const metadata = statSync(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`release artifact must be a regular file: ${path}`);
      const bytes = readFileSync(absolute);
      return { path, bytes: bytes.length, sha256: sha256(bytes) };
    })
  };
}

export function verifyReleaseManifest(root, manifest) {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.algorithm, "sha256");
  assert.deepEqual(manifest.artifacts.map(item => item.path), releaseArtifactPaths);
  for (const artifact of manifest.artifacts) {
    const absolute = safePath(root, artifact.path);
    const bytes = readFileSync(absolute);
    if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) throw new Error(`release artifact integrity failure: ${artifact.path}`);
  }
  return { status: "verified", artifacts: manifest.artifacts.length };
}

if (process.argv[1] && basename(process.argv[1]) === "qualify-release-artifacts.mjs") {
  const manifest = buildReleaseManifest();
  const root = mkdtempSync(join(tmpdir(), "openreel-release-qualification-"));
  try {
    for (const artifact of manifest.artifacts) {
      const target = safePath(root, artifact.path);
      mkdirSync(resolve(target, ".."), { recursive: true });
      cpSync(safePath(repository, artifact.path), target, { recursive: false });
    }
    const verified = verifyReleaseManifest(root, manifest);
    const tamperedPath = safePath(root, manifest.artifacts[0].path);
    writeFileSync(tamperedPath, Buffer.concat([readFileSync(tamperedPath), Buffer.from("\ntampered\n")]));
    assert.throws(() => verifyReleaseManifest(root, manifest), /integrity failure/);
    console.log(JSON.stringify({ status: "passed", mode: "local", ...verified, tamperRejected: true, externalCalls: false, deploymentActivated: false }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
