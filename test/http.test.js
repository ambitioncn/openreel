import test from "node:test";
import assert from "node:assert/strict";
import { createOpenReelServer } from "../server.mjs";
import { createPersistentStore } from "../src/core.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function request(base, path, options) {
  const response = await fetch(`${base}${path}`, options && { headers: { "content-type": "application/json" }, ...options });
  return { status: response.status, body: await response.json() };
}

test("HTTP smoke covers lifecycle, incremental progress, and result backfill", async (t) => {
  const server = createOpenReelServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/projects", { method: "POST", body: JSON.stringify({ name: "Smoke" }) })).body;
  const session = (await request(base, `/api/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Main" }) })).body;
  const node = (await request(base, `/api/sessions/${session.id}/nodes`, { method: "POST", body: JSON.stringify({ type: "video" }) })).body;
  const job = (await request(base, `/api/sessions/${session.id}/jobs`, { method: "POST", body: JSON.stringify({ nodeId: node.id, prompt: "smoke" }) })).body;
  await request(base, `/api/jobs/${job.id}/tick`, { method: "POST" });
  const running = await request(base, `/api/jobs/${job.id}/progress?afterSeq=1`);
  assert.equal(running.body.events[0].state, "running");
  await request(base, `/api/jobs/${job.id}/tick`, { method: "POST" });
  const done = await request(base, `/api/jobs/${job.id}/progress?afterSeq=${running.body.nextSeq}`);
  assert.equal(done.body.terminal, true);
  assert.equal(done.body.events[0].state, "succeeded");
  const snapshot = await request(base, `/api/projects/${project.id}`);
  assert.equal(snapshot.body.nodes[0].assetId, snapshot.body.assets[0].id);
});

test("HTTP errors have stable codes", async (t) => {
  const server = createOpenReelServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const missing = await request(base, "/api/projects/missing");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "NOT_FOUND");
});

test("HTTP render errors and MP4 download are stable", async (t) => {
  const store = createPersistentStore(join(mkdtempSync(join(tmpdir(), "openreel-render-http-")), "state.json"));
  const server = createOpenReelServer(store); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Render HTTP" }) })).body;
  const empty = await request(base, `/api/v1/projects/${project.id}/exports/render`, { method: "POST", body: "{}" }); assert.equal(empty.status, 409); assert.equal(empty.body.error.code, "EMPTY_TIMELINE");
  const session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Main" }) })).body;
  const node = store.createNode(session.id, { type: "video" }); const job = store.createJob(session.id, { nodeId: node.id, prompt: "video" }); store.tickJob(job.id); const done = store.tickJob(job.id);
  store.upsertTimeline(project.id, { version: 1, tracks: [{ kind: "video", clips: [{ assetId: done.assetId, inPoint: 0, outPoint: .5, start: 0 }] }] });
  const rendered = (await request(base, `/api/v1/projects/${project.id}/exports/render`, { method: "POST", body: "{}" })).body, manifest = (await request(base, rendered.asset.manifestUrl)).body;
  const download = await fetch(`${base}${manifest.downloadUrl}`), bytes = Buffer.from(await download.arrayBuffer()); assert.equal(download.status, 200); assert.equal(download.headers.get("content-type"), "video/mp4"); assert.equal(bytes.length, manifest.byteLength); assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
});

test("versioned agent API uploads a reference, polls, inspects manifest, and downloads bytes", async (t) => {
  const server = createOpenReelServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Agent" }) })).body;
  const session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Run" }) })).body;
  const uploadResponse = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "image/png", "x-filename": "reference.png" }, body: Buffer.from("fixture-png") });
  const reference = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201);
  const node = (await request(base, `/api/v1/sessions/${session.id}/nodes`, { method: "POST", body: JSON.stringify({ type: "image" }) })).body;
  let job = (await request(base, `/api/v1/sessions/${session.id}/jobs`, { method: "POST", body: JSON.stringify({ nodeId: node.id, prompt: "agent smoke", referenceAssetIds: [reference.id] }) })).body;
  let cursor = 0;
  while (!["succeeded", "failed", "canceled"].includes(job.state)) {
    job = (await request(base, `/api/v1/jobs/${job.id}/tick`, { method: "POST" })).body;
    const progress = (await request(base, `/api/v1/jobs/${job.id}/progress?afterSeq=${cursor}`)).body;
    assert.ok(progress.events.every((event) => event.seq > cursor));
    cursor = progress.nextSeq;
  }
  const snapshot = (await request(base, `/api/v1/projects/${project.id}`)).body;
  const result = snapshot.assets.find((asset) => asset.id === job.assetId);
  const manifest = (await request(base, result.manifestUrl)).body;
  const download = await fetch(`${base}${manifest.downloadUrl}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), manifest.mimeType);
  assert.equal(bytes.length, manifest.byteLength);
  assert.match(bytes.toString(), /OpenReel deterministic result/);
});

test("upload API rejects unsafe boundaries with structured errors", async (t) => {
  const server = createOpenReelServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Boundaries" }) })).body;
  const session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Main" }) })).body;
  const unsupported = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "application/pdf" }, body: "pdf" });
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).error.code, "UNSUPPORTED_MEDIA_TYPE");
  const empty = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "image/png" }, body: "" });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error.code, "EMPTY_ASSET");
  const missingScope = await fetch(`${base}/api/v1/projects/missing/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "image/png" }, body: "png" });
  assert.equal(missingScope.status, 404);
  assert.equal((await missingScope.json()).error.code, "NOT_FOUND");
});

test("HTTP role enforcement denies viewer writes and stale versions", async (t) => {
  const server = createOpenReelServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Roles" }) })).body;
  await request(base, "/api/v1/users", { method: "POST", body: JSON.stringify({ id: "viewer", name: "Viewer" }) });
  await request(base, `/api/v1/projects/${project.id}/members`, { method: "POST", body: JSON.stringify({ userId: "viewer", role: "viewer" }) });
  const denied = await request(base, `/api/v1/projects/${project.id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-openreel-user": "viewer" }, body: JSON.stringify({ name: "Denied" }) });
  assert.equal(denied.status, 403); assert.equal(denied.body.error.code, "FORBIDDEN");
  const current = await request(base, `/api/v1/projects/${project.id}`);
  const updated = await request(base, `/api/v1/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ name: "Updated", version: current.body.project.version }) });
  assert.equal(updated.status, 200);
  const stale = await request(base, `/api/v1/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ name: "Stale", version: current.body.project.version }) });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, "VERSION_CONFLICT");
});

test("HTTP state and asset bytes recover after server restart", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-http-")), "state.json");
  let server = createOpenReelServer(createPersistentStore(file));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Restart" }) })).body;
  const session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Main" }) })).body;
  const uploaded = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "audio/wav", "x-filename": "recover.wav" }, body: "recoverable-bytes" });
  const asset = await uploaded.json();
  await new Promise(resolve => server.close(resolve));
  server = createOpenReelServer(createPersistentStore(file));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  try { const snapshot = await request(base, `/api/v1/projects/${project.id}`); assert.equal(snapshot.body.assets[0].id, asset.id); const content = await fetch(`${base}${asset.downloadUrl}`); assert.equal(await content.text(), "recoverable-bytes"); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
