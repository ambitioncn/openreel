import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore } from "../src/core.js";
import { validateLocalExportEvidence } from "../src/export-evidence.js";

function generated(store, session, kind) {
  const node = store.createNode(session.id, { type: kind });
  const job = store.createJob(session.id, { nodeId: node.id, prompt: kind, ...(kind === "audio" && { reviewed: true, audioSpec: { intent: "music", sampleRate: 24000, format: "wav" } }) });
  store.tickJob(job.id);
  return store.tickJob(job.id).assetId;
}

function fixture() {
  let next = 0;
  const store = createMemoryStore({ id: () => `export-${++next}`, now: () => "2026-08-15T16:30:00.000Z" });
  const project = store.createProject({ name: "Export evidence" }), session = store.createSession(project.id, { name: "Main" });
  const videoA = generated(store, session, "video"), videoB = generated(store, session, "video"), audio = generated(store, session, "audio");
  store.upsertTimeline(project.id, { version: 1, tracks: [{ kind: "video", clips: [{ assetId: videoA, inPoint: 0, outPoint: .4, start: 0 }, { assetId: videoB, inPoint: 0, outPoint: .4, start: .4 }] }, { kind: "audio", clips: [{ assetId: audio, inPoint: 0, outPoint: .8, start: 0 }] }] });
  const rendered = store.renderProject(project.id), replay = store.renderProject(project.id), edl = store.exportManifest(project.id), bytes = store.assetContent(project.id, rendered.asset.id).bytes;
  return { rendered, replay, edl, bytes };
}

test("T-01 export evidence verifies MP4 bytes, EDL and deterministic replay", () => {
  const result = validateLocalExportEvidence(fixture());
  assert.equal(result.status, "verified");
  assert.equal(result.clipCount, 3);
  assert.equal(result.duration, .8);
  assert.equal(result.hasAudio, true);
  assert.equal(result.productionReady, false);
});

test("T-01 export evidence rejects byte, replay and production-claim drift", () => {
  const bytes = fixture(); bytes.bytes = Buffer.concat([bytes.bytes, Buffer.from("drift")]);
  assert.throws(() => validateLocalExportEvidence(bytes), /byte length drifted/);
  const replay = fixture(); replay.replay.replayed = false;
  assert.throws(() => validateLocalExportEvidence(replay), /must be a deterministic replay/);
  const production = fixture(); production.rendered.productionReady = true;
  assert.throws(() => validateLocalExportEvidence(production), /must not claim production readiness/);
});

test("T-01 export evidence rejects malformed containers and EDL ordering drift", () => {
  const container = fixture(); container.bytes.fill(0, 4, 8);
  assert.throws(() => validateLocalExportEvidence(container), /not an MP4 container/);
  const order = fixture(); order.edl.tracks[0].clips[1].start = -1;
  assert.throws(() => validateLocalExportEvidence(order), /not ordered by start time/);
  const format = fixture(); format.rendered.quality = "production-4k";
  assert.throws(() => validateLocalExportEvidence(format), /quality is invalid/);
});
