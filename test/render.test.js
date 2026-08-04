import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, DomainError } from "../src/core.js";
import { renderTimelineVideo } from "../src/render.js";

function generated(store, session, kind) { const node = store.createNode(session.id, { type: kind }), job = store.createJob(session.id, { nodeId: node.id, prompt: kind }); store.tickJob(job.id); return store.tickJob(job.id).assetId; }

test("render composes deterministic playable MP4 with audio", () => {
  let next = 0; const store = createMemoryStore({ id: () => `id-${++next}`, now: () => "2026-08-04T00:00:00.000Z" });
  const project = store.createProject({ name: "Render" }), session = store.createSession(project.id, { name: "Main" });
  const video = generated(store, session, "video"), audio = generated(store, session, "audio");
  store.upsertTimeline(project.id, { version: 1, tracks: [{ kind: "video", clips: [{ assetId: video, inPoint: 0, outPoint: .5, start: 0 }] }, { kind: "audio", clips: [{ assetId: audio, inPoint: 0, outPoint: .5, start: 0 }] }] });
  const first = store.renderProject(project.id), second = store.renderProject(project.id);
  assert.equal(first.asset.mimeType, "video/mp4"); assert.equal(first.hasAudio, true); assert.equal(first.sha256, second.sha256); assert.equal(first.asset.metadata.sourceTimelineVersion, 2);
});

test("render rejects empty, audio-only, and unavailable-renderer paths", () => {
  const store = createMemoryStore(), project = store.createProject({ name: "Negative" }), session = store.createSession(project.id, { name: "Main" });
  assert.throws(() => store.renderProject(project.id), error => error instanceof DomainError && error.code === "EMPTY_TIMELINE");
  const audio = generated(store, session, "audio"); store.upsertTimeline(project.id, { version: 1, tracks: [{ kind: "audio", clips: [{ assetId: audio, inPoint: 0, outPoint: 1, start: 0 }] }] });
  assert.throws(() => store.renderProject(project.id), error => error.code === "VIDEO_TRACK_REQUIRED" && error.status === 409);
  assert.throws(() => renderTimelineVideo({ tracks: [{ kind: "video", clips: [{ assetId: "a", inPoint: 0, outPoint: 1, start: 0 }] }] }, 1, { ffmpeg: "openreel-missing-ffmpeg" }), error => error.code === "RENDERER_UNAVAILABLE" && error.status === 503);
});
