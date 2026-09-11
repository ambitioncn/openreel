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
  const job = store.createJob(session.id, { nodeId: node.id, prompt: "tone", reviewed: true, audioSpec: { intent: "music", sampleRate: 24000, format: "wav" } });
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

test("project deletion requires owner role, current version, and exact-name confirmation", () => {
  const { store, project, session } = base();
  const editor = store.createUser({ id: "delete-editor", name: "Editor" });
  const viewer = store.createUser({ id: "delete-viewer", name: "Viewer" });
  store.addMember(project.id, { userId: editor.id, role: "editor" });
  store.addMember(project.id, { userId: viewer.id, role: "viewer" });
  const current = store.snapshot(project.id).project;
  assert.throws(() => store.deleteProject(project.id, { version: current.version, confirmName: current.name }, editor.id), error => error.code === "FORBIDDEN");
  assert.throws(() => store.deleteProject(project.id, { version: current.version, confirmName: current.name }, viewer.id), error => error.code === "FORBIDDEN");
  assert.throws(() => store.deleteProject(project.id, { version: current.version - 1, confirmName: current.name }), error => error.code === "VERSION_CONFLICT");
  assert.throws(() => store.deleteProject(project.id, { version: current.version, confirmName: "wrong" }), error => error.code === "CONFIRMATION_REQUIRED");
  const deleted = store.deleteProject(project.id, { version: current.version, confirmName: current.name });
  assert.deepEqual(deleted.counts, { sessions: 1, nodes: 0, edges: 0, groups: 0, jobs: 0, assets: 0 });
  assert.equal(deleted.deleted, true);
  assert.throws(() => store.snapshot(project.id), error => error.code === "NOT_FOUND");
  assert.throws(() => store.closeSession(session.id), error => error.code === "NOT_FOUND");
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
  for (const kind of ["image", "video", "audio"]) { const node = store.createNode(session.id, { type: kind }); const job = store.createJob(session.id, { nodeId: node.id, prompt: `${kind} result`, ...(kind === "audio" && { reviewed: true, audioSpec: { intent: "music", sampleRate: 24000, format: "wav" } }) }); store.tickJob(job.id); results.push(store.tickJob(job.id).assetId); }
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

test("continuity entities lock identity attributes and retain copied reference provenance after restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-continuity-")), "state.json"); let store = createPersistentStore(file);
  const source = store.createProject({ name: "Source" }), sourceSession = store.createSession(source.id, { name: "Source" });
  const target = store.createProject({ name: "Target" });
  const uploaded = store.uploadReference(source.id, sourceSession.id, { mimeType: "image/png", filename: "hero.png", bytes: Buffer.from("hero") });
  const copied = store.copyAsset(source.id, uploaded.id, target.id);
  const entity = store.createContinuityEntity(target.id, { kind: "character", name: "Hero", attributes: { face: "oval", jacket: "red" }, lockedAttributes: ["face"], referenceAssetIds: [copied.id] });
  assert.throws(() => store.updateContinuityEntity(target.id, entity.id, { version: entity.version, attributes: { face: "round", jacket: "red" } }), error => error.code === "CONTINUITY_LOCKED");
  const updated = store.updateContinuityEntity(target.id, entity.id, { version: entity.version, attributes: { face: "oval", jacket: "blue" } });
  store = createPersistentStore(file);
  const recovered = store.listContinuityEntities(target.id)[0];
  assert.equal(recovered.attributes.jacket, "blue"); assert.deepEqual(recovered.lockedAttributes, ["face"]);
  assert.equal(recovered.referenceProvenance[0].source.operation, "copy"); assert.equal(recovered.referenceProvenance[0].source.sourceAssetId, uploaded.id);
  assert.equal(store.snapshot(target.id).continuityEntities[0].version, updated.version);
});

test("storyboard shots apply ordered continuity entity references and preserve reviewed snapshots", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-continuity-board-")), "state.json"); let store = createPersistentStore(file);
  const project = store.createProject({ name: "Continuity board" }), session = store.createSession(project.id, { name: "Main" });
  const refs = ["hero-a", "hero-b", "scene", "manual"].map(name => store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: `${name}.png`, bytes: Buffer.from(name) }));
  const hero = store.createContinuityEntity(project.id, { kind: "character", name: "Hero", attributes: { face: "oval" }, lockedAttributes: ["face"], referenceAssetIds: [refs[0].id, refs[1].id] });
  const scene = store.createContinuityEntity(project.id, { kind: "scene", name: "Stage", attributes: { lighting: "blue" }, lockedAttributes: ["lighting"], referenceAssetIds: [refs[2].id, refs[0].id] });
  const story = store.upsertStory(project.id, { scenes: [{ title: "Opening" }] });
  const board = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Hero enters", duration: 2, continuityEntityIds: [scene.id, hero.id, scene.id], referenceAssetIds: [refs[3].id, refs[1].id] }] });
  assert.deepEqual(board.shots[0].continuityEntityIds, [scene.id, hero.id]);
  assert.deepEqual(board.shots[0].referenceAssetIds, [refs[2].id, refs[0].id, refs[1].id, refs[3].id]);
  assert.deepEqual(board.shots[0].continuityEntityUsages.map(usage => [usage.name, usage.version]), [["Stage", 1], ["Hero", 1]]);
  const batch = store.createStoryboardBatch(project.id, { sessionId: session.id, idempotencyKey: "continuity-board" });
  store.updateContinuityEntity(project.id, hero.id, { version: hero.version, attributes: { face: "oval", jacket: "red" } });
  store = createPersistentStore(file);
  const recovered = store.storyboardBatch(project.id, batch.id).jobs[0];
  assert.deepEqual(recovered.referenceAssetIds, [refs[2].id, refs[0].id, refs[1].id, refs[3].id]);
  assert.equal(recovered.continuityEntityUsages[1].version, 1);
  assert.deepEqual(recovered.continuityEntityUsages[1].attributes, { face: "oval" });
  const other = store.createProject({ name: "Other" }), otherEntity = store.createContinuityEntity(other.id, { kind: "product", name: "Bottle", attributes: { color: "green" } });
  assert.throws(() => store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Invalid", duration: 1, continuityEntityIds: [otherEntity.id] }] }), error => error.code === "SCOPE_MISMATCH");
});

test("ordered storyboard batch is idempotent, stops on failure, and resumes through retry", () => {
  const store = createMemoryStore(), project = store.createProject({ name: "Batch" }), session = store.createSession(project.id, { name: "Main" });
  const story = store.upsertStory(project.id, { scenes: [{ title: "Sequence" }] });
  store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "first", duration: 1 }, { sceneId: story.scenes[0].id, prompt: "second", duration: 1 }] });
  const first = store.createStoryboardBatch(project.id, { sessionId: session.id, idempotencyKey: "board-1" }), duplicate = store.createStoryboardBatch(project.id, { sessionId: session.id, idempotencyKey: "board-1" });
  assert.equal(first.id, duplicate.id); assert.equal(first.jobs.length, 2); assert.deepEqual(first.jobs.map(job => job.storyboardOrder), [0, 1]);
  let batch = store.tickStoryboardBatch(project.id, first.id); assert.equal(batch.jobs[0].state, "running"); assert.equal(batch.jobs[1].state, "queued");
  batch = store.tickStoryboardBatch(project.id, first.id); assert.equal(batch.jobs[0].state, "succeeded"); assert.equal(batch.jobs[1].state, "queued");
  store.transitionJob(batch.jobs[1].id, "canceled"); batch = store.tickStoryboardBatch(project.id, first.id); assert.equal(batch.state, "failed");
  const retry = store.retryJob(batch.jobs[1].id, { idempotencyKey: "board-1-shot-2" }); assert.equal(retry.storyboardOrder, 1);
  store.tickStoryboardBatch(project.id, first.id); batch = store.tickStoryboardBatch(project.id, first.id); assert.equal(batch.state, "succeeded"); assert.deepEqual(batch.jobs.map(job => job.prompt), ["first", "second"]);
});

test("storyboard batch creation is atomic and survives restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-batch-")), "state.json"); let store = createPersistentStore(file);
  const project = store.createProject({ name: "Atomic batch" }), session = store.createSession(project.id, { name: "Main" }), story = store.upsertStory(project.id, { scenes: [{ title: "Scene" }] });
  const refs = Array.from({ length: 5 }, (_, index) => store.uploadReference(project.id, session.id, { mimeType: "image/png", filename: `${index}.png`, bytes: Buffer.from(`ref-${index}`) }));
  store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "valid first", duration: 1 }, { sceneId: story.scenes[0].id, prompt: "invalid second", duration: 1, referenceAssetIds: refs.map(ref => ref.id) }] });
  const before = store.snapshot(project.id);
  assert.throws(() => store.createStoryboardBatch(project.id, { sessionId: session.id, idempotencyKey: "atomic-fail" }), (error) => error.code === "INCOMPATIBLE_PARAMETERS");
  const rolledBack = store.snapshot(project.id); assert.equal(rolledBack.nodes.length, before.nodes.length); assert.equal(rolledBack.jobs.length, before.jobs.length);
  store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "first", duration: 1 }, { sceneId: story.scenes[0].id, prompt: "second", duration: 1 }] });
  const created = store.createStoryboardBatch(project.id, { sessionId: session.id, idempotencyKey: "atomic-pass" }); store = createPersistentStore(file);
  const recovered = store.storyboardBatch(project.id, created.id); assert.equal(recovered.jobs.length, 2); assert.deepEqual(recovered.jobs.map(job => job.prompt), ["first", "second"]);
  assert.equal(store.listStoryboardBatches(project.id)[0].id, created.id); assert.deepEqual(recovered.cost, { amount: 0, currency: "CNY", unitScale: 1_000_000, basis: "local deterministic adapter; no paid provider call" });
});
