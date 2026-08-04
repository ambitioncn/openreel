import assert from "node:assert/strict";
import { createMemoryStore } from "../src/core.js";
import { renderTimelineVideo } from "../src/render.js";

const store = createMemoryStore(), project = store.createProject({ name: "Render negatives" }), session = store.createSession(project.id, { name: "Main" });
assert.throws(() => store.renderProject(project.id), error => error.code === "EMPTY_TIMELINE");
const node = store.createNode(session.id, { type: "audio" }), job = store.createJob(session.id, { nodeId: node.id, prompt: "audio" }); store.tickJob(job.id); const audio = store.tickJob(job.id);
store.upsertTimeline(project.id, { version: 1, tracks: [{ kind: "audio", clips: [{ assetId: audio.assetId, inPoint: 0, outPoint: 1, start: 0 }] }] });
assert.throws(() => store.renderProject(project.id), error => error.code === "VIDEO_TRACK_REQUIRED");
assert.throws(() => renderTimelineVideo({ tracks: [{ kind: "video", clips: [{ assetId: "x", inPoint: 0, outPoint: 1, start: 0 }] }] }, 1, { ffmpeg: "openreel-missing-ffmpeg" }), error => error.code === "RENDERER_UNAVAILABLE");
console.log(JSON.stringify({ status: "passed", negativeCases: ["EMPTY_TIMELINE", "VIDEO_TRACK_REQUIRED", "RENDERER_UNAVAILABLE"] }));
