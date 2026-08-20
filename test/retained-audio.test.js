import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPersistentStore } from "../src/core.js";

function fixture() {
  const store = createPersistentStore(join(mkdtempSync(join(tmpdir(), "openreel-retained-audio-")), "state.json"));
  const project = store.createProject({ name: "Retained audio" });
  const session = store.createSession(project.id, { name: "Canvas" });
  const node = store.createNode(session.id, { type: "audio", title: "SeedAudio evidence" });
  return { store, project, session, node };
}

function input(nodeId, overrides = {}) {
  const bytes = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64, 7)]);
  return {
    nodeId,
    filename: "private-validation.mp3",
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    durationSeconds: 5.041633,
    evidenceId: "cp343-seedaudio-private-audio",
    provider: "volcengine-seedaudio",
    model: "seed-audio-1.0",
    ...overrides,
  };
}

test("retained private MP3 becomes a durable canvas result and audio timeline clip without a provider job", () => {
  const { store, project, session, node } = fixture();
  const asset = store.reconcileRetainedAudio(session.id, input(node.id));
  const replay = store.reconcileRetainedAudio(session.id, input(node.id));
  const snapshot = store.snapshot(project.id), manifest = store.exportManifest(project.id);
  assert.equal(replay.id, asset.id);
  assert.equal(snapshot.jobs.length, 0);
  assert.equal(snapshot.assets.length, 1);
  assert.equal(snapshot.assets[0].role, "result");
  assert.equal(snapshot.assets[0].metadata.provenance.providerCalls, 0);
  assert.equal(snapshot.nodes[0].status, "succeeded");
  assert.equal(snapshot.nodes[0].assetId, asset.id);
  assert.equal(snapshot.timeline.tracks[0].kind, "audio");
  assert.equal(snapshot.timeline.tracks[0].clips[0].outPoint, 5.041633);
  assert.equal(manifest.preview.duration, 5.041633);
  assert.deepEqual(store.assetContent(project.id, asset.id).bytes, input(node.id).bytes);
});

test("retained audio admission rejects malformed, digest-drifted and conflicting evidence", () => {
  const { store, session, node } = fixture();
  assert.throws(() => store.reconcileRetainedAudio(session.id, input(node.id, { bytes: Buffer.from("not mp3") })), error => error.code === "RETAINED_AUDIO_INVALID");
  assert.throws(() => store.reconcileRetainedAudio(session.id, input(node.id, { sha256: "0".repeat(64) })), error => error.code === "RETAINED_AUDIO_INVALID");
  store.reconcileRetainedAudio(session.id, input(node.id));
  const other = store.createNode(session.id, { type: "audio" });
  assert.throws(() => store.reconcileRetainedAudio(session.id, input(other.id)), error => error.code === "IDEMPOTENCY_CONFLICT");
});
