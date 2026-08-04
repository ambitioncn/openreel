import assert from "node:assert/strict";
import { createOpenReelServer } from "../server.mjs";

const server = createOpenReelServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function json(path, options = {}) { const response = await fetch(`${base}${path}`, { ...options, headers: { "content-type": "application/json", ...options.headers } }); const value = await response.json(); assert.equal(response.ok, true, `${response.status} ${JSON.stringify(value)}`); return value; }
async function generate(sessionId, kind, referenceAssetIds = []) { const node = await json(`/api/v1/sessions/${sessionId}/nodes`, { method: "POST", body: JSON.stringify({ type: kind, title: `${kind} result` }) }); let job = await json(`/api/v1/sessions/${sessionId}/jobs`, { method: "POST", body: JSON.stringify({ nodeId: node.id, prompt: `deterministic ${kind}`, referenceAssetIds }) }); let cursor = 0; while (!new Set(["succeeded", "failed", "canceled"]).has(job.state)) { job = await json(`/api/v1/jobs/${job.id}/tick`, { method: "POST" }); const progress = await json(`/api/v1/jobs/${job.id}/progress?afterSeq=${cursor}`); assert.ok(progress.events.every(e => e.seq > cursor)); cursor = progress.nextSeq; } return { job, cursor }; }
try {
  const project = await json("/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Agent creation-to-export" }) });
  const session = await json(`/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Principal" }) });
  const story = await json(`/api/v1/projects/${project.id}/story`, { method: "PUT", body: JSON.stringify({ title: "Demo", synopsis: "Local workflow", scenes: [{ title: "Reveal", summary: "Product enters frame" }] }) });
  const upload = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "image/png", "x-filename": "look.png" }, body: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("deterministic-reference")]) }); assert.equal(upload.status, 201); const reference = await upload.json();
  const storyboard = await json(`/api/v1/projects/${project.id}/storyboard`, { method: "PUT", body: JSON.stringify({ shots: [{ sceneId: story.scenes[0].id, prompt: "Hero reveal", duration: 4, referenceAssetIds: [reference.id] }] }) });
  const video = await generate(session.id, "video", [reference.id]);
  const audio = await generate(session.id, "audio");
  const timeline = await json(`/api/v1/projects/${project.id}/timeline`, { method: "PUT", body: JSON.stringify({ version: 1, tracks: [{ kind: "video", clips: [{ assetId: video.job.assetId, inPoint: 0, outPoint: 4, start: 0 }] }, { kind: "audio", clips: [{ assetId: audio.job.assetId, inPoint: 0, outPoint: 4, start: 0 }] }] }) });
  const exported = await json(`/api/v1/projects/${project.id}/exports/manifest`);
  const rendered = await json(`/api/v1/projects/${project.id}/exports/render`, { method: "POST", body: "{}" });
  const renderManifest = await json(rendered.asset.manifestUrl);
  const renderDownload = await fetch(`${base}${renderManifest.downloadUrl}`);
  const download = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/${video.job.assetId}/content`);
  assert.equal(download.ok, true); assert.equal(renderDownload.ok, true); assert.equal(renderDownload.headers.get("content-type"), "video/mp4"); assert.equal(exported.preview.duration, 4);
  console.log(JSON.stringify({ status: "passed", api: "v1", projectId: project.id, sessionId: session.id, scenes: story.scenes.length, shots: storyboard.shots.length, generatedKinds: [video.job.kind, audio.job.kind], timelineTracks: timeline.tracks.length, exportSchema: exported.schema, downloadedBytes: (await download.arrayBuffer()).byteLength, renderBytes: (await renderDownload.arrayBuffer()).byteLength, renderSha256: rendered.sha256 }));
} finally { await new Promise(resolve => server.close(resolve)); }
