import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenReelServer } from "../server.mjs";
import { createDirectorSystemStore } from "../src/director-system-store.js";

const body = { workflowId: "workflow-1", revisionId: "revision-2", recordId: "evidence-3", idempotencyKey: "write-4", kind: "stage_evidence", value: { stage: "script", status: "accepted" } };
async function request(base, path, options) {
  const response = await fetch(`${base}${path}`, options && { headers: { "content-type": "application/json" }, ...options });
  return { status: response.status, body: await response.json() };
}
async function listen(directorSystemStore) {
  const server = createOpenReelServer(undefined, undefined, { directorSystemStore });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("director HTTP records survive restart and idempotent writes reject drift", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "openreel-director-http-")), "records.json");
  let running = await listen(createDirectorSystemStore(path));
  const endpoint = "/api/v1/projects/project-1/director/records";
  const first = await request(running.base, endpoint, { method: "POST", body: JSON.stringify(body) });
  const duplicate = await request(running.base, endpoint, { method: "POST", body: JSON.stringify(body) });
  const drift = await request(running.base, endpoint, { method: "POST", body: JSON.stringify({ ...body, value: { stage: "script", status: "rejected" } }) });
  assert.equal(first.status, 201);
  assert.equal(duplicate.body.fingerprint, first.body.fingerprint);
  assert.equal(drift.status, 409);
  assert.equal(drift.body.error.code, "IDEMPOTENCY_CONFLICT");
  await new Promise(resolve => running.server.close(resolve));
  running = await listen(createDirectorSystemStore(path));
  try {
    const restored = await request(running.base, `${endpoint}/${body.workflowId}/${body.revisionId}/${body.idempotencyKey}`);
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.body.value, body.value);
    assert.equal(restored.body.fingerprint, first.body.fingerprint);
  } finally { await new Promise(resolve => running.server.close(resolve)); }
});

test("director HTTP records enforce revision and tenant boundaries", () => {
  const store = createDirectorSystemStore();
  store.put({ tenantId: "tenant-a", actorId: "actor-a" }, "project-1", body);
  assert.throws(() => store.get({ tenantId: "tenant-a" }, "project-1", body.workflowId, "revision-other", body.idempotencyKey), /not found/);
  assert.throws(() => store.get({ tenantId: "tenant-b" }, "project-1", body.workflowId, body.revisionId, body.idempotencyKey), /not found/);
});
