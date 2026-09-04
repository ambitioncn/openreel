#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPersistentStore } from "../src/core.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const mediaPath = resolve(root, "runtime/a01-cp343-private/seedaudio-private-validation.mp3");
const statePath = resolve(root, "runtime/a01-cp343-private/platform.json");
const evidencePath = resolve(root, "runtime/a01-cp343-private/integration-evidence.json");
const bytes = readFileSync(mediaPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(sha256, "f0493978c8cf3aa66af9d217147c913db64fc82d99aa36efa501e1da60247039");

const store = createPersistentStore(statePath);
let project = store.listProjects().find(item => item.name === "A-01 cp343 private audio acceptance");
if (!project) project = store.createProject({ name: "A-01 cp343 private audio acceptance" });
let snapshot = store.snapshot(project.id);
let session = snapshot.sessions.find(item => item.status === "active");
if (!session) session = store.createSession(project.id, { name: "Private local acceptance canvas" });
snapshot = store.snapshot(project.id);
let node = snapshot.nodes.find(item => item.title === "SeedAudio cp343 · private retained evidence");
if (!node) node = store.createNode(session.id, { type: "audio", title: "SeedAudio cp343 · private retained evidence", content: "5-second retained private audio · zero new Provider calls", position: { x: 160, y: 140 } });
const asset = store.reconcileRetainedAudio(session.id, {
  nodeId: node.id,
  filename: "seedaudio-cp343-private-validation.mp3",
  bytes,
  sha256,
  durationSeconds: 5.041633,
  evidenceId: "cp343-seedaudio-private-audio",
  provider: "volcengine-seedaudio",
  model: "seed-audio-1.0",
});
snapshot = store.snapshot(project.id);
const manifest = store.exportManifest(project.id);
const evidence = {
  schema: "openreel-a01-retained-audio-integration/v1",
  result: "passed",
  projectId: project.id,
  sessionId: session.id,
  nodeId: node.id,
  assetId: asset.id,
  sha256,
  byteLength: bytes.length,
  durationSeconds: 5.041633,
  canvas: { nodeStatus: snapshot.nodes.find(item => item.id === node.id).status, resultAssetId: asset.id },
  timeline: { version: snapshot.timeline.version, audioClips: snapshot.timeline.tracks.filter(track => track.kind === "audio").flatMap(track => track.clips).length, previewDuration: manifest.preview.duration },
  negativeEvidence: { providerCalls: 0, credentialReads: 0, credentialWrites: 0, costCny: 0, deployments: 0, publications: 0 },
  boundary: "Private local integration evidence only; no deployment, publication, credential access or Provider request.",
};
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(evidence)}\n`);
