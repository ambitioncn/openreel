import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/core.js";
import { createAdapterRegistry, localAdapter, optionalProviderAdapter } from "../src/adapters.js";

test("durable graph validates edges/groups and exposes per-node history", () => {
  const store = createMemoryStore();
  const project = store.createProject({ name: "Graph" });
  const session = store.createSession(project.id, { name: "Canvas" });
  const image = store.createNode(session.id, { type: "image", position: { x: -1000000, y: 2000000 } });
  const video = store.createNode(session.id, { type: "video", position: { x: 50, y: 80 } });
  store.createEdge(project.id, { fromNodeId: image.id, toNodeId: video.id });
  store.createGroup(project.id, { title: "Shot", nodeIds: [image.id, video.id] });
  assert.throws(() => store.createEdge(project.id, { fromNodeId: video.id, toNodeId: image.id }), e => e.code === "INVALID_GRAPH");
  const job = store.createJob(session.id, { nodeId: video.id, prompt: "render" }); store.tickJob(job.id); store.tickJob(job.id);
  const snapshot = store.snapshot(project.id);
  assert.deepEqual(snapshot.nodes[0].position, { x: -1000000, y: 2000000 });
  assert.equal(snapshot.edges.length, 1); assert.equal(snapshot.groups.length, 1);
  assert.equal(snapshot.nodes.find(n => n.id === video.id).runs[0].state, "succeeded");
  assert.equal(snapshot.nodes.find(n => n.id === video.id).resultVersions.length, 1);
});

test("adapter registry executes locally and gates credentialed costed providers", () => {
  const paid = optionalProviderAdapter({ id: "real-video", provider: "optional" });
  const registry = createAdapterRegistry([localAdapter, paid]);
  assert.equal(registry.execute("local-deterministic", { kind: "video", prompt: "local" }).deterministic, true);
  assert.throws(() => registry.execute("real-video", { kind: "video", prompt: "paid" }), e => e.code === "CREDENTIAL_REQUIRED");
  assert.throws(() => registry.execute("real-video", { kind: "video", prompt: "paid" }, { credential: "opaque" }), e => e.code === "COST_APPROVAL_REQUIRED");
  const invalid = optionalProviderAdapter({ id: "invalid", provider: "optional", execute: () => ({}) });
  assert.throws(() => createAdapterRegistry([invalid]).execute("invalid", { kind: "video", prompt: "x" }, { credential: "opaque", approvedBudgetCents: 1 }), e => e.code === "INVALID_ADAPTER_RESULT");
});

test("graph edits and history recover from disk with stale and scope negatives", async () => {
  const { mkdtempSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path"), { createPersistentStore } = await import("../src/core.js");
  const file = join(mkdtempSync(join(tmpdir(), "openreel-graph-")), "state.json"); let store = createPersistentStore(file);
  const project = store.createProject({ name: "Persisted canvas" }), session = store.createSession(project.id, { name: "Main" });
  const source = store.createNode(session.id, { type: "image" }), target = store.createNode(session.id, { type: "video" });
  const edge = store.createEdge(project.id, { fromNodeId: source.id, toNodeId: target.id }), group = store.createGroup(project.id, { title: "Shot", nodeIds: [source.id, target.id] });
  store.updateEdge(edge.id, { title: "reference", version: 1 }); store.updateGroup(group.id, { title: "Opening", version: 1 }); store.updateNode(source.id, { position: { x: -1234567, y: 7654321 }, version: source.version });
  store = createPersistentStore(file); const recovered = store.snapshot(project.id);
  assert.equal(recovered.edges[0].title, "reference"); assert.equal(recovered.groups[0].title, "Opening"); assert.deepEqual(recovered.nodes[0].position, { x: -1234567, y: 7654321 });
  assert.throws(() => store.updateGroup(group.id, { title: "stale", version: 1 }), e => e.code === "VERSION_CONFLICT");
  assert.throws(() => store.updateNode(source.id, { position: { x: NaN, y: 0 } }), e => e.code === "INVALID_INPUT");
});

test("generation jobs execute registry adapters and enforce provider gates", () => {
  const store = createMemoryStore(), project = store.createProject({ name: "Adapters" }), session = store.createSession(project.id, { name: "Main" }), node = store.createNode(session.id, { type: "video" });
  const job = store.createJob(session.id, { nodeId: node.id, prompt: "local" }); assert.equal(job.adapterResult.deterministic, true); assert.equal(job.adapterId, "local-deterministic");
  assert.throws(() => store.createJob(session.id, { nodeId: node.id, prompt: "paid", adapterId: "optional-video" }), e => e.code === "CREDENTIAL_REQUIRED");
  assert.throws(() => store.createJob(session.id, { nodeId: node.id, prompt: "paid", adapterId: "optional-video", credential: "opaque" }), e => e.code === "COST_APPROVAL_REQUIRED");
});
