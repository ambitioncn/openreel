#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const releaseArtifactPaths = [
  "package.json",
  "package-lock.json",
  "server.mjs",
  "index.html",
  "migrations/001-initial.sql",
  "migrations/002-ark-jobs.sql",
  "src/adapters.js",
  "src/admin.js",
  "src/agent-film-store.js",
  "src/app.js",
  "src/ark-commercial-perceptual-evaluator.js",
  "src/ark.js",
  "src/audio-candidate-review.js",
  "src/audio-provider-admission.js",
  "src/audio-spec.js",
  "src/billing-evidence.js",
  "src/capability-baseline.js",
  "src/cli.js",
  "src/collaboration-evidence.js",
  "src/collaboration-ui.js",
  "src/comfyui.js",
  "src/commercial-av-boundary.js",
  "src/commercial-composition-quality.js",
  "src/commercial-job-lifecycle.js",
  "src/commercial-job-ux.js",
  "src/commercial-policy-ui.js",
  "src/commercial-master-image-inspector.js",
  "src/commercial-provider-orchestrator.js",
  "src/commercial-quality-inspector.js",
  "src/commercial-release-gate.js",
  "src/commercial-shot-quality.js",
  "src/commercial-storyboard-preflight.js",
  "src/continuity-evaluation.js",
  "src/core.js",
  "src/creative-director.js",
  "src/director-evaluation-set.js",
  "src/director-feedback-learning.js",
  "src/director-system-store.js",
  "src/director-runtime-ui.js",
  "src/director-strategy-evaluation.js",
  "src/creative-strategies.js",
  "src/director-workflow.js",
  "src/director-workflow-store.js",
  "src/director-continuity.js",
  "src/director-final-quality.js",
  "src/director-rework.js",
  "src/director-rework-store.js",
  "src/director-shot-quality.js",
  "src/credit-ledger.js",
  "src/credit-products.js",
  "src/durable.js",
  "src/export-evidence.js",
  "src/export-ui.js",
  "src/h3-qualification-batch-guard.js",
  "src/i18n.js",
  "src/model-catalog.js",
  "src/model-controls.js",
  "src/model.js",
  "src/ops.js",
  "src/platform.js",
  "src/product-analytics.js",
  "src/product-understanding.js",
  "src/product-url.js",
  "src/prompt-director-v2.js",
  "src/provider-fallback.js",
  "src/styles.css",
  "src/publishing-douyin.js",
  "src/publishing-oauth.js",
  "src/publishing-google-oauth.js",
  "src/publishing-instagram.js",
  "src/publishing-preflight.js",
  "src/publishing-lifecycle.js",
  "src/publishing-oauth-router.js",
  "src/publishing-orchestration.js",
  "src/publishing-proxy.js",
  "src/publishing-reconciler.js",
  "src/publishing-runtime.js",
  "src/publishing-tiktok-oauth.js",
  "src/publishing-tiktok.js",
  "src/publishing-webhook.js",
  "src/publishing-youtube.js",
  "src/qwen-tts-ui.js",
  "src/qwen-tts.js",
  "src/release-review.js",
  "src/render.js",
  "src/seedaudio.js",
  "src/seedaudio-music-service.js",
  "src/storyboard-batch-ui.js",
  "src/tutorials.css",
  "src/tutorials.js",
  "src/volcengine-pricing.js",
  "src/wav.js",
  "src/workbench-commercial.js",
  "src/workbench-draft.js",
  "src/workbench-final.js",
  "src/workbench-model-router.js",
  "src/workbench-planning.js",
  "src/workbench-project-boundary.js",
  "src/workbench-timeline.js",
  "src/workflow-shortcuts.js",
  "deploy/Caddyfile",
  "deploy/nginx-openreel.conf",
  "deploy/nginx-openreel-beijing.conf",
  "deploy/openreel.service",
  "deploy/openreel.env.example",
  "deploy/openreel-backup.service",
  "deploy/openreel-backup.timer",
  "deploy/openreel-publishing-reconciler.service",
  "deploy/openreel-publishing-reconciler.timer",
  "deploy/run-backup",
  "scripts/backup.mjs",
  "scripts/build-release-manifest.mjs",
  "scripts/qualify-release-artifacts.mjs",
  "scripts/qualify-director-fixed-set.mjs",
  "scripts/qualify-director-production-candidate.mjs",
  "scripts/director-browser-e2e.mjs",
  "scripts/production-e2e.mjs",
  "scripts/rehearse-deployment.mjs",
  "scripts/qualify-publishing-operations.mjs",
  "scripts/publishing-reconciler.mjs",
  "scripts/rehearse-publishing-rollback.mjs",
  "scripts/verify-release-manifest.mjs"
];

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const exactKeys = (value, expected, label) => {
  assert.equal(value && typeof value, "object", `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields are invalid`);
};
const safePath = (root, relative) => {
  const path = resolve(root, relative);
  if (!path.startsWith(`${resolve(root)}/`)) throw new Error(`artifact path escaped root: ${relative}`);
  return path;
};

export function validateReleaseManifest(manifest) {
  exactKeys(manifest, ["version", "algorithm", "artifacts"], "release manifest");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.algorithm, "sha256");
  assert.ok(Array.isArray(manifest.artifacts), "release manifest artifacts must be an array");
  assert.deepEqual(manifest.artifacts.map(item => item.path), releaseArtifactPaths);
  for (const artifact of manifest.artifacts) {
    exactKeys(artifact, ["path", "bytes", "sha256"], `release artifact ${artifact?.path ?? "unknown"}`);
    assert.ok(Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0, `release artifact bytes are invalid: ${artifact.path}`);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/, `release artifact digest is invalid: ${artifact.path}`);
  }
  return manifest;
}

const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export function canonicalReleaseManifestBytes(manifest) {
  validateReleaseManifest(manifest);
  return Buffer.from(canonicalJson(manifest), "utf8");
}

export function buildReleaseManifest(root = repository) {
  return {
    version: 1,
    algorithm: "sha256",
    artifacts: releaseArtifactPaths.map(path => {
      const absolute = safePath(root, path);
      const metadata = lstatSync(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`release artifact must be a regular file: ${path}`);
      const bytes = readFileSync(absolute);
      return { path, bytes: bytes.length, sha256: sha256(bytes) };
    })
  };
}

export function verifyReleaseManifest(root, manifest) {
  validateReleaseManifest(manifest);
  for (const artifact of manifest.artifacts) {
    const absolute = safePath(root, artifact.path);
    const metadata = lstatSync(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`release artifact must be a regular file: ${artifact.path}`);
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
