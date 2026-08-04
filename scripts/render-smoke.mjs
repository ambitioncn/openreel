import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createMemoryStore } from "../src/core.js";
const store = createMemoryStore(), project = store.createProject({ name: "Render" }), session = store.createSession(project.id, { name: "Main" });
const assets = {};
for (const kind of ["video", "audio"]) { const node = store.createNode(session.id, { type: kind }), job = store.createJob(session.id, { nodeId: node.id, prompt: `${kind} master` }); store.tickJob(job.id); assets[kind] = store.tickJob(job.id).assetId; }
store.upsertTimeline(project.id, { version: 1, tracks: [{ kind: "video", clips: [{ assetId: assets.video, inPoint: 0, outPoint: 1, start: 0 }] }, { kind: "audio", clips: [{ assetId: assets.audio, inPoint: 0, outPoint: 1, start: 0 }] }] });
const first = store.renderProject(project.id), second = store.renderProject(project.id), bytes = store.assetContent(project.id, first.asset.id).bytes;
assert.equal(bytes.subarray(4, 8).toString(), "ftyp"); assert.equal(first.playable, true); assert.equal(first.productionReady, false); assert.equal(first.hasAudio, true); assert.equal(first.sha256, second.sha256);
const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name", "-of", "json", "pipe:0"], { input: bytes, encoding: "utf8" });
assert.equal(probe.status, 0, probe.stderr); const format = JSON.parse(probe.stdout); assert.match(format.format.format_name, /mp4/); assert.deepEqual(format.streams.map(stream => stream.codec_type).sort(), ["audio", "video"]);
console.log(JSON.stringify({ status: "passed", schema: first.schema, mimeType: first.asset.mimeType, byteLength: bytes.length, sha256: first.sha256, streams: format.streams, format: format.format, deterministicReplay: true, boundary: first.boundary }));
