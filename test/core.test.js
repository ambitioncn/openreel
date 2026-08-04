import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, DomainError, JOB_STATES } from "../src/core.js";

function fixture() {
  let count = 0;
  const store = createMemoryStore({ id: () => `id-${++count}`, now: () => "2026-08-04T00:00:00.000Z" });
  const project = store.createProject({ name: "Demo" });
  const session = store.createSession(project.id, { name: "Main" });
  const node = store.createNode(session.id, { type: "image", title: "Hero" });
  return { store, project, session, node };
}

test("project and session lifecycle preserves isolation and closes once", () => {
  const { store, project, session } = fixture();
  const snapshot = store.snapshot(project.id);
  assert.deepEqual(snapshot.project.sessionIds, [session.id]);
  assert.equal(snapshot.nodes.length, 1);
  assert.equal(store.closeSession(session.id).status, "closed");
  assert.throws(() => store.createNode(session.id, { type: "text" }), (error) => error instanceof DomainError && error.code === "SESSION_CLOSED");
  assert.throws(() => store.closeSession(session.id), /already closed/);
});

test("job state machine exposes states, legal transitions, cancellation, and errors", () => {
  assert.deepEqual(JOB_STATES, ["queued", "running", "succeeded", "failed", "canceled"]);
  const { store, session, node } = fixture();
  const job = store.createJob(session.id, { nodeId: node.id, prompt: "frame" });
  assert.equal(store.transitionJob(job.id, "running").state, "running");
  assert.throws(() => store.transitionJob(job.id, "queued"), (error) => error.code === "INVALID_TRANSITION" && error.status === 409);
  assert.equal(store.transitionJob(job.id, "canceled").state, "canceled");
  assert.throws(() => store.transitionJob(job.id, "running"), /cannot transition canceled/);
});

test("after-seq polling returns only newer events with a stable cursor", () => {
  const { store, session, node } = fixture();
  const job = store.createJob(session.id, { nodeId: node.id, prompt: "frame" });
  assert.deepEqual(store.progress(job.id, 0).events.map(({ seq }) => seq), [1]);
  store.tickJob(job.id);
  assert.deepEqual(store.progress(job.id, 1).events.map(({ seq }) => seq), [2]);
  assert.deepEqual(store.progress(job.id, 2).events, []);
  assert.throws(() => store.progress(job.id, -1), (error) => error.code === "INVALID_CURSOR");
});

test("successful simulation creates an asset and links it back to the node", () => {
  const { store, project, session, node } = fixture();
  const job = store.createJob(session.id, { nodeId: node.id, prompt: "frame" });
  store.tickJob(job.id);
  const complete = store.tickJob(job.id);
  const snapshot = store.snapshot(project.id);
  assert.equal(complete.state, "succeeded");
  assert.equal(snapshot.assets[0].jobId, job.id);
  assert.equal(snapshot.nodes[0].assetId, snapshot.assets[0].id);
  assert.equal(snapshot.nodes[0].content, snapshot.assets[0].url);
});

test("failed simulation records a structured error and creates no asset", () => {
  const { store, project, session, node } = fixture();
  const job = store.createJob(session.id, { nodeId: node.id, prompt: "frame", outcome: "failed" });
  store.tickJob(job.id);
  const failed = store.tickJob(job.id);
  assert.deepEqual(failed.error, { code: "GENERATION_FAILED", message: "Local simulation failed" });
  assert.equal(store.snapshot(project.id).assets.length, 0);
});

test("reference assets enforce type, size, and session scope", () => {
  const { store, project, session, node } = fixture();
  const reference = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "hero.png", bytes: Buffer.from("png") });
  assert.equal(reference.role, "reference");
  assert.equal(reference.byteLength, 3);
  assert.equal(store.uploadReference(project.id, session.id, { mimeType: "audio/mpeg", bytes: Buffer.from("audio") }).kind, "audio");
  assert.throws(() => store.uploadReference(project.id, session.id, { mimeType: "image/png", bytes: Buffer.alloc(8 * 1024 * 1024 + 1) }), (error) => error.code === "ASSET_TOO_LARGE" && error.status === 413);
  const otherProject = store.createProject({ name: "Other" });
  const otherSession = store.createSession(otherProject.id, { name: "Other" });
  assert.throws(() => store.createJob(otherSession.id, { nodeId: node.id, prompt: "wrong scope", referenceAssetIds: [reference.id] }), (error) => error.code === "NOT_FOUND" || error.code === "SCOPE_MISMATCH");
  assert.throws(() => store.assetManifest(otherProject.id, otherSession.id, reference.id), (error) => error.code === "SCOPE_MISMATCH" && error.status === 404);
});

test("result manifest and bytes are stable deterministic fixtures", () => {
  const { store, project, session, node } = fixture();
  const job = store.createJob(session.id, { nodeId: node.id, prompt: "frame" });
  store.tickJob(job.id);
  const done = store.tickJob(job.id);
  const manifest = store.assetManifest(project.id, session.id, done.assetId);
  const content = store.assetContent(project.id, session.id, done.assetId);
  assert.equal(manifest.mimeType, "image/svg+xml");
  assert.equal(manifest.byteLength, content.bytes.length);
  assert.match(content.bytes.toString(), /OpenReel deterministic result/);
  assert.equal(manifest.downloadUrl, content.manifest.downloadUrl);
});
