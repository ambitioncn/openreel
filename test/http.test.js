import test from "node:test";
import assert from "node:assert/strict";
import { createOpenReelServer } from "../server.mjs";
import { createMemoryStore, createPersistentStore } from "../src/core.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";

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

test("HTTP retry is idempotent and preserves a traceable failed-job chain", async (t) => {
  const server = createOpenReelServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Retry" }) })).body;
  const session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Main" }) })).body;
  const node = (await request(base, `/api/v1/sessions/${session.id}/nodes`, { method: "POST", body: JSON.stringify({ type: "image" }) })).body;
  const failed = (await request(base, `/api/v1/sessions/${session.id}/jobs`, { method: "POST", body: JSON.stringify({ nodeId: node.id, prompt: "retry", outcome: "failed" }) })).body;
  await request(base, `/api/v1/jobs/${failed.id}/tick`, { method: "POST" }); await request(base, `/api/v1/jobs/${failed.id}/tick`, { method: "POST" });
  const options = { method: "POST", body: JSON.stringify({ idempotencyKey: "retry-http-1" }) }, first = await request(base, `/api/v1/jobs/${failed.id}/retry`, options), duplicate = await request(base, `/api/v1/jobs/${failed.id}/retry`, options);
  assert.equal(first.status, 201); assert.equal(first.body.id, duplicate.body.id); assert.equal(first.body.retryOf, failed.id); assert.equal(first.body.retryAttempt, 1);
});

test("HTTP storyboard batch advances shots strictly in order", async (t) => {
  const server = createOpenReelServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Batch" }) })).body, session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Main" }) })).body;
  const story = (await request(base, `/api/v1/projects/${project.id}/story`, { method: "PUT", body: JSON.stringify({ scenes: [{ title: "Scene" }] }) })).body;
  await request(base, `/api/v1/projects/${project.id}/storyboard`, { method: "PUT", body: JSON.stringify({ shots: [{ sceneId: story.scenes[0].id, prompt: "one", duration: 1 }, { sceneId: story.scenes[0].id, prompt: "two", duration: 1 }] }) });
  const options = { method: "POST", body: JSON.stringify({ sessionId: session.id, idempotencyKey: "http-board" }) }, created = await request(base, `/api/v1/projects/${project.id}/storyboard-batches`, options), duplicate = await request(base, `/api/v1/projects/${project.id}/storyboard-batches`, options);
  assert.equal(created.body.id, duplicate.body.id); assert.deepEqual(created.body.jobs.map(job => job.state), ["queued", "queued"]);
  const discovered = await request(base, `/api/v1/projects/${project.id}/storyboard-batches`); assert.equal(discovered.body[0].id, created.body.id); assert.equal(discovered.body[0].cost.amount, 0);
  const ticked = await request(base, `/api/v1/projects/${project.id}/storyboard-batches/${created.body.id}/tick`, { method: "POST", body: "{}" });
  assert.deepEqual(ticked.body.jobs.map(job => job.state), ["running", "queued"]);
});

test("versioned model catalog exposes a stable drift fingerprint without breaking the model list", async (t) => {
  const server = createOpenReelServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const models = await request(base, "/api/v1/models"), first = await request(base, "/api/v1/model-catalog"), second = await request(base, "/api/v1/model-catalog");
  assert.equal(models.status, 200); assert.ok(Array.isArray(models.body));
  assert.equal(first.status, 200); assert.equal(first.body.schemaVersion, 1); assert.equal(first.body.modelCount, models.body.length);
  assert.equal(first.body.fingerprint, second.body.fingerprint); assert.match(first.body.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.body.models.map(model => model.id), [...first.body.models.map(model => model.id)].sort());
});

test("model catalog coverage exposes authenticated target gaps without claiming configured models", async (t) => {
  const server = createOpenReelServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const catalog = await request(base, "/api/v1/model-catalog"), coverage = await request(base, "/api/v1/model-catalog/coverage");
  assert.equal(coverage.status, 200);
  assert.equal(coverage.body.localCatalogFingerprint, catalog.body.fingerprint);
  assert.equal(coverage.body.status, "gaps_detected");
  assert.ok(coverage.body.countGaps.video > 0);
  assert.ok(!coverage.body.missingControls.includes("voice"));
  assert.ok(coverage.body.missingControls.includes("camera"));
});

test("reference model catalog is complete but explicitly non-executable", async (t) => {
  const server = createOpenReelServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const reference = await request(base, "/api/v1/model-catalog/reference");
  assert.equal(reference.status, 200);
  assert.equal(reference.body.executable, false);
  assert.ok(reference.body.counts.video > 0);
  assert.ok(reference.body.modes.includes("audio-to-video"));
  assert.ok(reference.body.controls.includes("voice"));
  assert.equal(reference.body.models, undefined);
  assert.equal(reference.body.adapterId, undefined);
});

test("provider mapping audit is read-only and linked to the catalog fingerprint", async (t) => {
  const server = createOpenReelServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const catalog = await request(base, "/api/v1/model-catalog"), audit = await request(base, "/api/v1/model-catalog/mapping-validation");
  assert.equal(audit.status, 200);
  assert.equal(audit.body.status, "valid");
  assert.equal(audit.body.executedProviderCalls, false);
  assert.equal(audit.body.catalogFingerprint, catalog.body.fingerprint);
});

test("workflow shortcut catalog exposes observed templates without paid auto-run", async (t) => {
  const server = createOpenReelServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await request(base, "/api/v1/workflow-shortcuts");
  assert.equal(response.status, 200);
  assert.equal(response.body.templates.length, 16);
  assert.ok(response.body.templates.every(item => item.autoRun === false));
  assert.equal(response.body.execution, "manual-review-required");
});

test("reviewed workflow shortcut application creates only a draft node with scoped image provenance", async (t) => {
  const store = createMemoryStore(), server = createOpenReelServer(store);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Shortcut" }) })).body;
  const session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Main" }) })).body;
  const other = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Other" }) })).body;
  const png = Buffer.from("89504e470d0a1a0a", "hex"), upload = async sessionId => request(base, `/api/v1/projects/${project.id}/sessions/${sessionId}/assets/references`, { method: "POST", headers: { "content-type": "image/png", "x-filename": "reference.png" }, body: png });
  const reference = (await upload(session.id)).body, foreign = (await upload(other.id)).body;
  const applyPath = `/api/v1/projects/${project.id}/sessions/${session.id}/workflow-shortcuts/character_setting_sheet/apply`;
  const applied = await request(base, applyPath, { method: "POST", body: JSON.stringify({ prompt: "Keep identity", referenceAssetIds: [reference.id] }) });
  assert.equal(applied.status, 201); assert.equal(applied.body.status, "draft"); assert.equal(applied.body.runIds.length, 0);
  assert.deepEqual(JSON.parse(applied.body.content).referenceAssetIds, [reference.id]);
  assert.equal((await request(base, applyPath, { method: "POST", body: JSON.stringify({ prompt: "x", referenceAssetIds: [] }) })).status, 400);
  assert.equal((await request(base, applyPath, { method: "POST", body: JSON.stringify({ prompt: "x", referenceAssetIds: [foreign.id] }) })).status, 404);
  assert.equal((await request(base, applyPath.replace("character_setting_sheet", "unknown"), { method: "POST", body: JSON.stringify({ prompt: "x", referenceAssetIds: [reference.id] }) })).status, 404);
  const snapshot = (await request(base, `/api/v1/projects/${project.id}`)).body;
  assert.equal(snapshot.nodes.length, 1); assert.equal(snapshot.jobs.length, 0);
});

test("tutorial progress is durable, versioned, validated, and creates no jobs", async (t) => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-tutorial-http-")), "state.json"), store = createPersistentStore(file), server = createOpenReelServer(store);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Tutorial progress" }) })).body;
  const path = `/api/v1/projects/${project.id}/tutorials/noir-trailer/progress`;
  assert.deepEqual((await request(base, path)).body.completedSteps, []);
  const updated = await request(base, path, { method: "PUT", body: JSON.stringify({ completedSteps: [2, 0, 2] }) });
  assert.equal(updated.status, 200); assert.deepEqual(updated.body.completedSteps, [0, 2]); assert.equal(updated.body.autoRun, false);
  assert.equal((await request(base, path, { method: "PUT", body: JSON.stringify({ completedSteps: [99] }) })).status, 400);
  assert.equal((await request(base, path.replace("noir-trailer", "unknown"))).status, 404);
  assert.equal((await request(base, `/api/v1/projects/${project.id}`)).body.jobs.length, 0);
  await new Promise(resolve => server.close(resolve));
  const reopened = createPersistentStore(file);
  assert.deepEqual(reopened.getTutorialProgress(project.id, "noir-trailer", 1).completedSteps, [0, 2]);
  t.after(() => {});
});

test("tutorial workflow endpoint returns the shared validated import document without running jobs", async (t) => {
  const server = createOpenReelServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, workflow = await request(base, "/api/v1/tutorials/mini-documentary/workflow"), missing = await request(base, "/api/v1/tutorials/missing/workflow");
  assert.equal(workflow.status, 200);
  assert.equal(workflow.body.schema, "openreel-workflow/v1");
  assert.equal(workflow.body.autoRun, false);
  assert.ok(workflow.body.nodes.some(node => node.type === "text"));
  assert.equal(missing.status, 404);
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "No auto run" }) })).body;
  assert.equal((await request(base, `/api/v1/projects/${project.id}`)).body.jobs.length, 0);
});

test("HTTP render errors and MP4 download are stable", async (t) => {
  const store = createPersistentStore(join(mkdtempSync(join(tmpdir(), "openreel-render-http-")), "state.json"));
  const server = createOpenReelServer(store); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Render HTTP" }) })).body;
  const empty = await request(base, `/api/v1/projects/${project.id}/exports/render`, { method: "POST", body: "{}" }); assert.equal(empty.status, 409); assert.equal(empty.body.error.code, "EMPTY_TIMELINE");
  const session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Main" }) })).body;
  const node = store.createNode(session.id, { type: "video" }); const job = store.createJob(session.id, { nodeId: node.id, prompt: "video" }); store.tickJob(job.id); const done = store.tickJob(job.id);
  store.upsertTimeline(project.id, { version: 1, tracks: [{ kind: "video", clips: [{ assetId: done.assetId, inPoint: 0, outPoint: .5, start: 0 }] }] });
  const rendered = (await request(base, `/api/v1/projects/${project.id}/exports/render`, { method: "POST", body: JSON.stringify({ format: "mp4", quality: "preview-360p" }) })).body, replay = (await request(base, `/api/v1/projects/${project.id}/exports/render`, { method: "POST", body: "{}" })).body, manifest = (await request(base, rendered.asset.manifestUrl)).body;
  assert.equal(replay.asset.id, rendered.asset.id); assert.equal(replay.replayed, true); assert.equal(rendered.format, "mp4"); assert.equal(rendered.quality, "preview-360p");
  const download = await fetch(`${base}${manifest.downloadUrl}`), bytes = Buffer.from(await download.arrayBuffer()); assert.equal(download.status, 200); assert.equal(download.headers.get("content-type"), "video/mp4"); assert.equal(bytes.length, manifest.byteLength); assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
});

test("versioned agent API uploads a reference, polls, inspects manifest, and downloads bytes", async (t) => {
  const server = createOpenReelServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Agent" }) })).body;
  const session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Run" }) })).body;
  const uploadResponse = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "image/png", "x-filename": "reference.png" }, body: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("fixture-png")]) });
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
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const mismatch = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "image/png", "x-filename": "fake.png" }, body: "not-png" });
  assert.equal(mismatch.status, 415); assert.equal((await mismatch.json()).error.code, "MEDIA_SIGNATURE_MISMATCH");
  const unsafeName = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "image/png", "x-filename": "../escape.png" }, body: signature });
  assert.equal(unsafeName.status, 400); assert.equal((await unsafeName.json()).error.code, "INVALID_FILENAME");
  const missingScope = await fetch(`${base}/api/v1/projects/missing/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "image/png", "x-filename": "safe.png" }, body: signature });
  assert.equal(missingScope.status, 404);
  assert.equal((await missingScope.json()).error.code, "NOT_FOUND");
});

test("HTTP ignores spoofable identity headers and rejects stale versions", async (t) => {
  const server = createOpenReelServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Roles" }) })).body;
  await request(base, "/api/v1/users", { method: "POST", body: JSON.stringify({ id: "viewer", name: "Viewer" }) });
  await request(base, `/api/v1/projects/${project.id}/members`, { method: "POST", body: JSON.stringify({ userId: "viewer", role: "viewer" }) });
  const spoofed = await request(base, `/api/v1/projects/${project.id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-openreel-user": "viewer" }, body: JSON.stringify({ name: "Header ignored" }) });
  assert.equal(spoofed.status, 200); assert.equal(spoofed.body.name, "Header ignored");
  const current = await request(base, `/api/v1/projects/${project.id}`);
  const updated = await request(base, `/api/v1/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ name: "Updated", version: current.body.project.version }) });
  assert.equal(updated.status, 200);
  const stale = await request(base, `/api/v1/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ name: "Stale", version: current.body.project.version }) });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, "VERSION_CONFLICT"); assert.equal(stale.body.error.details.expected, updated.body.version);
});

test("CO-01 account recovery stays disconnected without external identity or email", async (t) => {
  const server = createOpenReelServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const recovery = await request(base, "/api/v1/auth/recover", { method: "POST", body: JSON.stringify({ email: "owner@example.test" }) });
  assert.equal(recovery.status, 404);
  const boundary = await request(base, "/api/v1/security-boundary");
  assert.equal(boundary.status, 200);
  assert.match(boundary.body.boundary, /account recovery.*not yet connected/i);
});

test("HTTP state and asset bytes recover after server restart", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-http-")), "state.json");
  let server = createOpenReelServer(createPersistentStore(file));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Restart" }) })).body;
  const session = (await request(base, `/api/v1/projects/${project.id}/sessions`, { method: "POST", body: JSON.stringify({ name: "Main" }) })).body;
  const wav = Buffer.concat([Buffer.from("RIFF0000WAVE"), Buffer.from("recoverable-bytes")]);
  const uploaded = await fetch(`${base}/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { "content-type": "audio/wav", "x-filename": "recover.wav" }, body: wav });
  const asset = await uploaded.json();
  await new Promise(resolve => server.close(resolve));
  server = createOpenReelServer(createPersistentStore(file));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  try { const snapshot = await request(base, `/api/v1/projects/${project.id}`); assert.equal(snapshot.body.assets[0].id, asset.id); const content = await fetch(`${base}${asset.downloadUrl}`); assert.deepEqual(Buffer.from(await content.arrayBuffer()), wav); }
  finally { await new Promise(resolve => server.close(resolve)); }
});

test("production HTTP binds project identity to session cookie and enforces CSRF", async (t) => {
  const server = createOpenReelServer(undefined, undefined, { production: true, secureCookies: false });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const anonymous = await request(base, "/api/v1/projects");
  assert.equal(anonymous.status, 401);
  await request(base, "/api/v1/auth/register", { method: "POST", body: JSON.stringify({ email: "secure@example.test", password: "secure-pass-123" }) });
  const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "secure@example.test", password: "secure-pass-123" }) });
  const loginBody = await login.json(), sessionCookie = login.headers.getSetCookie().find(x => x.startsWith("openreel_session=")), csrfCookie = login.headers.getSetCookie().find(x => x.startsWith("openreel_csrf="));
  const cookieHeader = `${sessionCookie.split(";", 1)[0]}; ${csrfCookie.split(";", 1)[0]}`;
  assert.match(sessionCookie, /HttpOnly/); assert.match(sessionCookie, /SameSite=Lax/);
  const rejected = await fetch(`${base}/api/v1/projects`, { method: "POST", headers: { "content-type": "application/json", cookie: cookieHeader }, body: JSON.stringify({ name: "Rejected" }) });
  assert.equal(rejected.status, 403); assert.equal((await rejected.json()).error.code, "CSRF_REJECTED");
  const created = await fetch(`${base}/api/v1/projects`, { method: "POST", headers: { "content-type": "application/json", cookie: cookieHeader, "x-csrf-token": loginBody.csrfToken, "x-openreel-user": "spoofed" }, body: JSON.stringify({ name: "Bound" }) });
  assert.equal(created.status, 201);
  const project = await created.json();
  assert.equal(project.members[0].userId, loginBody.account.id);
});

test("API key applications require user submission and administrator approval or stop", async (t) => {
  const adminKey = "administrator-secret-key-for-tests", server = createOpenReelServer(undefined, undefined, { production: true, secureCookies: false, adminToken: adminKey, rateLimit: { max: 1000 } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, email = "applicant@example.test", password = "applicant-pass-123";
  await fetch(`${base}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), loginBody = await login.json();
  const cookieHeader = login.headers.getSetCookie().map(x => x.split(";", 1)[0]).join("; "), userHeaders = { "content-type": "application/json", cookie: cookieHeader, "x-csrf-token": loginBody.csrfToken };
  const submitted = await fetch(`${base}/api/v1/key-applications`, { method: "POST", headers: userHeaders, body: JSON.stringify({ reason: "Render customer videos", requestedLimitMicros: 1200 }) }), application = await submitted.json();
  assert.equal(submitted.status, 201); assert.equal(application.status, "pending");
  const forbidden = await fetch(`${base}/api/v1/admin/key-applications`); assert.equal(forbidden.status, 403);
  const listed = await fetch(`${base}/api/v1/admin/key-applications?status=pending`, { headers: { "x-openreel-admin-key": adminKey } }); assert.equal((await listed.json())[0].id, application.id);
  const approved = await fetch(`${base}/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", headers: { "content-type": "application/json", "x-openreel-admin-key": adminKey }, body: JSON.stringify({ hardLimitMicros: 1200, periodEndsAt: "2099-01-01T00:00:00.000Z", reviewNote: "Approved" }) }); assert.equal(approved.status, 201);
  const keyResponse = await fetch(`${base}/api/v1/api-keys`, { method: "POST", headers: userHeaders, body: JSON.stringify({ name: "primary" }) }), issued = await keyResponse.json(); assert.equal(keyResponse.status, 201); assert.match(issued.key, /^or_live_/);
  const stopped = await fetch(`${base}/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", headers: { "content-type": "application/json", "x-openreel-admin-key": adminKey }, body: JSON.stringify({ reviewNote: "Operator stop" }) }); assert.equal(stopped.status, 201);
  const keyStatus = await fetch(`${base}/api/v1/key/status`, { headers: { "x-openreel-api-key": issued.key } }); assert.equal(keyStatus.status, 401);
  const adminPage = await fetch(`${base}/admin.html`); assert.equal(adminPage.status, 200); assert.match(await adminPage.text(), /API access administration/);
  for (const path of ["/admin", "/admin/"]) { const alias = await fetch(`${base}${path}`); assert.equal(alias.status, 200); const html = await alias.text(); assert.match(html, /API access administration/); assert.match(html, /src="\/src\/admin\.js"/); assert.match(html, /href="\/src\/styles\.css"/); }
  for (const path of ["/favicon.ico", "/definitely-missing"]) { const missing = await fetch(`${base}${path}`); assert.equal(missing.status, 404); assert.equal((await missing.json()).error.code, "NOT_FOUND"); }
  const aliveAfterMissingStatic = await fetch(`${base}/health/live`); assert.equal(aliveAfterMissingStatic.status, 200);
});

test("administrator password creates a CSRF-protected browser session while the operations key remains supported", async (t) => {
  const credential = ["correct", "horse", "battery", "staple"].join(" "), salt = randomBytes(16), adminPasswordHash = `scrypt$${salt.toString("base64url")}$${scryptSync(credential, salt, 64).toString("base64url")}`;
  const operationsCredential = ["administrator", "operations", "credential", "fixture"].join("-"), server = createOpenReelServer(undefined, undefined, { production: true, secureCookies: false, adminToken: operationsCredential, adminPasswordHash, rateLimit: { max: 1000 } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const bad = await fetch(`${base}/api/v1/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) }); assert.equal(bad.status, 401);
  const login = await fetch(`${base}/api/v1/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: credential }) }), loginBody = await login.json(); assert.equal(login.status, 200);
  const adminCookie = login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); assert.doesNotMatch(adminCookie, new RegExp(credential));
  const session = await fetch(`${base}/api/v1/admin/session`, { headers: { cookie: adminCookie } }); assert.equal(session.status, 200);
  const missingCsrf = await fetch(`${base}/api/v1/admin/logout`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: "{}" }); assert.equal(missingCsrf.status, 403);
  const logout = await fetch(`${base}/api/v1/admin/logout`, { method: "POST", headers: { cookie: adminCookie, "x-csrf-token": loginBody.csrfToken, "content-type": "application/json" }, body: "{}" }); assert.equal(logout.status, 200);
  const expired = await fetch(`${base}/api/v1/admin/session`, { headers: { cookie: adminCookie } }); assert.equal(expired.status, 403);
  const operationsKey = await fetch(`${base}/api/v1/admin/key-applications`, { headers: { "x-openreel-admin-key": operationsCredential } }); assert.equal(operationsKey.status, 200);
});

test("production protected-route matrix rejects anonymous, bad cookie, bad bearer, and spoofed identity", async (t) => {
  const server = createOpenReelServer(undefined, undefined, { production: true, rateLimit: { max: 1000 } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const routes = [
    ["POST", "/api/v1/users"], ["GET", "/api/v1/models"], ["GET", "/api/v1/workflow-shortcuts"], ["POST", "/api/v1/auth/logout"], ["POST", "/api/v1/auth/rotate"], ["GET", "/api/v1/auth/me"],
    ["POST", "/api/v1/teams"], ["POST", "/api/v1/teams/x/invites"], ["POST", "/api/v1/invites/x/accept"], ["PUT", "/api/v1/teams/x/presence"], ["GET", "/api/v1/teams/x/presence?documentId=canvas"], ["GET", "/api/v1/teams/x/documents/canvas"], ["PUT", "/api/v1/teams/x/documents/canvas"], ["POST", "/api/v1/teams/x/budget/quote"], ["POST", "/api/v1/teams/x/budget/reserve"], ["POST", "/api/v1/teams/x/budget/settle"], ["GET", "/api/v1/teams/x/budget"], ["POST", "/api/v1/teams/x/workflows/import"], ["POST", "/api/v1/teams/x/automations/plan"], ["POST", "/api/v1/teams/x/automations/run"], ["GET", "/api/v1/security-boundary"],
    ["GET", "/api/v1/projects"], ["POST", "/api/v1/projects"], ["GET", "/api/v1/projects/x"], ["PATCH", "/api/v1/projects/x"], ["POST", "/api/v1/projects/x/members"], ["POST", "/api/v1/projects/x/edges"], ["PATCH", "/api/v1/edges/x"], ["POST", "/api/v1/projects/x/groups"], ["PATCH", "/api/v1/groups/x"], ["POST", "/api/v1/projects/x/sessions"], ["GET", "/api/v1/projects/x/assets"], ["GET", "/api/v1/projects/x/history"], ["POST", "/api/v1/projects/x/assets/y/copy"], ["GET", "/api/v1/projects/x/continuity"], ["POST", "/api/v1/projects/x/continuity"], ["PATCH", "/api/v1/projects/x/continuity/y"], ["PUT", "/api/v1/projects/x/story"], ["PUT", "/api/v1/projects/x/storyboard"], ["GET", "/api/v1/projects/x/storyboard-batches"], ["POST", "/api/v1/projects/x/storyboard-batches"], ["GET", "/api/v1/projects/x/storyboard-batches/y"], ["POST", "/api/v1/projects/x/storyboard-batches/y/tick"], ["PUT", "/api/v1/projects/x/timeline"], ["GET", "/api/v1/projects/x/exports/manifest"], ["POST", "/api/v1/projects/x/exports/render"], ["POST", "/api/v1/sessions/x/close"], ["POST", "/api/v1/sessions/x/nodes"], ["PATCH", "/api/v1/nodes/x"], ["POST", "/api/v1/sessions/x/jobs"], ["POST", "/api/v1/jobs/x/tick"], ["POST", "/api/v1/jobs/x/cancel"], ["POST", "/api/v1/jobs/x/retry"], ["GET", "/api/v1/jobs/x/progress"], ["POST", "/api/v1/projects/x/sessions/y/assets/references"], ["GET", "/api/v1/projects/x/assets/y/manifest"], ["GET", "/api/v1/projects/x/assets/y/content"]
  ];
  for (const [method, path] of routes) {
    for (const headers of [{ "x-openreel-user": "spoof" }, { cookie: "openreel_session=bad; openreel_csrf=x", "x-csrf-token": "x" }, { authorization: "Bearer bad", "x-openreel-user": "spoof" }]) {
      const response = await fetch(`${base}${path}`, { method, headers });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).error.code, "UNAUTHENTICATED");
    }
  }
});

test("production session rotation, bearer CSRF exemption, cookies, limits, and security headers are enforced", async (t) => {
  let clock = 0;
  const server = createOpenReelServer(undefined, undefined, { production: true, jsonLimit: 64, rateLimit: { max: 20, windowMs: 1000, now: () => clock, key: () => "test" } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const register = await fetch(`${base}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "matrix@example.test", password: "secure-pass-123" }) });
  assert.equal(register.headers.get("x-content-type-options"), "nosniff"); assert.match(register.headers.get("content-security-policy"), /default-src 'self'/);
  const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "matrix@example.test", password: "secure-pass-123" }) });
  const loginBody = await login.json(), setCookies = login.headers.getSetCookie();
  assert.ok(setCookies.every(value => /Secure/.test(value) && /HttpOnly/.test(value) && /SameSite=Lax/.test(value) && /Max-Age=604800/.test(value) && /Expires=/.test(value)));
  const session = setCookies.find(value => value.startsWith("openreel_session=")).split(";", 1)[0];
  const csrf = setCookies.find(value => value.startsWith("openreel_csrf=")).split(";", 1)[0];
  const bearer = decodeURIComponent(session.split("=")[1]);
  const created = await fetch(`${base}/api/v1/projects`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Bearer" }) });
  assert.equal(created.status, 201);
  const rotated = await fetch(`${base}/api/v1/auth/rotate`, { method: "POST", headers: { cookie: `${session}; ${csrf}`, "x-csrf-token": loginBody.csrfToken } });
  assert.equal(rotated.status, 200);
  assert.equal((await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${bearer}` } })).status, 401);
  const scalar = await fetch(`${base}/api/v1/projects`, { method: "POST", headers: { authorization: `Bearer ${decodeURIComponent(rotated.headers.getSetCookie()[0].split(";", 1)[0].split("=")[1])}`, "content-type": "application/json" }, body: "[]" });
  assert.equal(scalar.status, 400); assert.equal((await scalar.json()).error.code, "INVALID_INPUT");
  const wrongType = await fetch(`${base}/api/v1/projects`, { method: "POST", headers: { authorization: "Bearer bad", "content-type": "text/plain" }, body: "{}" });
  assert.equal(wrongType.status, 401);
  const oversized = await fetch(`${base}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x".repeat(100) }) });
  assert.equal(oversized.status, 413); assert.equal((await oversized.json()).error.code, "BODY_TOO_LARGE");
  clock = 1001;
  for (let i = 0; i < 20; i++) await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const limited = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(limited.status, 429); assert.equal((await limited.json()).error.code, "RATE_LIMITED");
});

test("production job routes enforce project authorization for bearer identities", async (t) => {
  const server = createOpenReelServer(undefined, undefined, { production: true, rateLimit: { max: 100 } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenFor = async (email) => {
    await fetch(`${base}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "secure-pass-123" }) });
    const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "secure-pass-123" }) });
    return decodeURIComponent(login.headers.getSetCookie().find(value => value.startsWith("openreel_session=")).split(";", 1)[0].split("=")[1]);
  };
  const owner = await tokenFor("owner@example.test"), outsider = await tokenFor("outsider@example.test");
  const call = (path, token, method = "GET", value) => fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(value && { "content-type": "application/json" }) }, ...(value && { body: JSON.stringify(value) }) });
  const project = await (await call("/api/v1/projects", owner, "POST", { name: "Private" })).json();
  const session = await (await call(`/api/v1/projects/${project.id}/sessions`, owner, "POST", { name: "Main" })).json();
  const node = await (await call(`/api/v1/sessions/${session.id}/nodes`, owner, "POST", { type: "image" })).json();
  const job = await (await call(`/api/v1/sessions/${session.id}/jobs`, owner, "POST", { nodeId: node.id, prompt: "private" })).json();
  for (const [method, path] of [["GET", `/api/v1/jobs/${job.id}/progress`], ["POST", `/api/v1/jobs/${job.id}/tick`], ["POST", `/api/v1/jobs/${job.id}/cancel`]]) {
    const denied = await call(path, outsider, method);
    assert.equal(denied.status, 403, `${method} ${path}`); assert.equal((await denied.json()).error.code, "FORBIDDEN");
  }
});
