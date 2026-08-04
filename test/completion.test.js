import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore, createPersistentStore, DomainError, SCHEMA_VERSION } from "../src/core.js";

function base(store = createMemoryStore()) {
  const project = store.createProject({ name: "Film" });
  const session = store.createSession(project.id, { name: "Principal" });
  return { store, project, session };
}

test("durable store recovers projects, jobs, bytes, and migrates schema v1", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-")), "state.json");
  let store = createPersistentStore(file);
  const { project, session } = base(store);
  const node = store.createNode(session.id, { type: "audio" });
  const job = store.createJob(session.id, { nodeId: node.id, prompt: "tone" });
  store.tickJob(job.id); const done = store.tickJob(job.id);
  store = createPersistentStore(file);
  const recovered = store.snapshot(project.id);
  assert.equal(recovered.nodes[0].assetId, done.assetId);
  assert.equal(store.assetContent(project.id, session.id, done.assetId).bytes.length > 0, true);
  const raw = JSON.parse(readFileSync(file)); raw.schemaVersion = 1; writeFileSync(file, JSON.stringify(raw));
  assert.equal(createPersistentStore(file).snapshot(project.id).project.id, project.id);
  assert.equal(JSON.parse(readFileSync(file)).schemaVersion, 1, "migration is persisted on next mutation");
  createPersistentStore(file).updateProject(project.id, { name: "Film 2" });
  assert.equal(JSON.parse(readFileSync(file)).schemaVersion, SCHEMA_VERSION);
});

test("project management, isolation, roles, and optimistic conflict are enforced", () => {
  const { store, project } = base();
  const editor = store.createUser({ id: "editor", name: "Editor" });
  const viewer = store.createUser({ id: "viewer", name: "Viewer" });
  store.addMember(project.id, { userId: editor.id, role: "editor" });
  store.addMember(project.id, { userId: viewer.id, role: "viewer" });
  assert.equal(store.listProjects("viewer").length, 1);
  assert.throws(() => store.updateProject(project.id, { name: "No" }, "viewer"), (e) => e.code === "FORBIDDEN" && e.status === 403);
  const current = store.snapshot(project.id).project;
  store.updateProject(project.id, { name: "Renamed", version: current.version }, "editor");
  assert.throws(() => store.updateProject(project.id, { name: "Stale", version: current.version }, "editor"), (e) => e.code === "VERSION_CONFLICT" && e.status === 409);
  store.updateProject(project.id, { status: "archived" });
  assert.equal(store.listProjects("local-owner", { status: "archived" })[0].name, "Renamed");
  const hidden = store.createUser({ id: "hidden", name: "Hidden" });
  assert.throws(() => store.snapshot(project.id, hidden.id), (e) => e instanceof DomainError && e.code === "FORBIDDEN");
});

test("story, storyboard, multimodal routing, timeline, and export form one workflow", () => {
  const { store, project, session } = base();
  const story = store.upsertStory(project.id, { title: "Launch", synopsis: "A reveal", scenes: [{ title: "Opening", summary: "Dark stage" }, { title: "Reveal" }] });
  const refs = [
    store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "look.png", bytes: Buffer.from("image") }),
    store.uploadReference(project.id, session.id, { mimeType: "video/mp4", filename: "move.mp4", bytes: Buffer.from("video") }),
    store.uploadReference(project.id, session.id, { mimeType: "audio/wav", filename: "tone.wav", bytes: Buffer.from("audio") })
  ];
  assert.equal(store.listAssets(project.id, { kind: "audio", search: "tone" })[0].id, refs[2].id);
  const board = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Wide reveal", duration: 4, referenceAssetIds: refs.map(x => x.id) }] });
  assert.equal(board.shots[0].referenceAssetIds.length, 3);
  const results = [];
  for (const kind of ["image", "video", "audio"]) { const node = store.createNode(session.id, { type: kind }); const job = store.createJob(session.id, { nodeId: node.id, prompt: `${kind} result` }); store.tickJob(job.id); results.push(store.tickJob(job.id).assetId); }
  assert.deepEqual(store.listModels().map(x => x.kind), ["image", "video", "audio"]);
  assert.throws(() => store.routeModel("audio", "text-to-video"), (e) => e.code === "UNSUPPORTED_CAPABILITY");
  const timeline = store.upsertTimeline(project.id, { version: 1, tracks: [{ kind: "video", clips: [{ assetId: results[1], inPoint: 0, outPoint: 4, start: 0 }] }, { kind: "audio", clips: [{ assetId: results[2], inPoint: 0, outPoint: 4, start: 0 }] }] });
  assert.equal(timeline.tracks.length, 2);
  const exported = store.exportManifest(project.id);
  assert.equal(exported.schema, "openreel-edl/v1");
  assert.deepEqual(exported.preview, { duration: 4, clipCount: 2 });
});

test("provider failures are structured and do not create result assets", () => {
  const { store, project, session } = base();
  const node = store.createNode(session.id, { type: "video" });
  const job = store.createJob(session.id, { nodeId: node.id, prompt: "fail", outcome: "failed" });
  store.tickJob(job.id); const failed = store.tickJob(job.id);
  assert.equal(failed.error.code, "GENERATION_FAILED");
  assert.equal(store.snapshot(project.id).assets.length, 0);
});

test("script-storyboard-image-video chain preserves reference continuity and provenance", () => {
  const { store, project, session } = base();
  const reference = store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: "identity.png", bytes: Buffer.from("identity") });
  const script = store.createNode(session.id, { type: "script", content: "A consistent hero crosses two shots" });
  const story = store.upsertStory(project.id, { title: "Continuity", scenes: [{ title: "Scene one" }] });
  store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: script.content, duration: 1, referenceAssetIds: [reference.id] }] });
  const results = [];
  for (const kind of ["image", "video"]) { const node = store.createNode(session.id, { type: kind }); store.createEdge(project.id, { fromNodeId: script.id, toNodeId: node.id }); const job = store.createJob(session.id, { nodeId: node.id, prompt: script.content, referenceAssetIds: [reference.id] }); store.tickJob(job.id); results.push(store.tickJob(job.id).assetId); }
  assert.deepEqual(results.map(assetId => store.assetManifest(project.id, assetId).metadata.referenceAssetIds), [[reference.id], [reference.id]]);
  assert.deepEqual(store.snapshot(project.id).edges.map(edge => edge.fromNodeId), [script.id, script.id]);
});
