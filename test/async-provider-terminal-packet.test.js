import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistTerminalPacket, terminalPacket } from "../scripts/async-provider-terminal-packet.mjs";
import { runStandardArkSeedanceCanvasProof } from "../scripts/standard-ark-seedance-canvas-proof.mjs";

test("terminal packet retains task, ledger and artifact facts while dropping unsafe fields", () => {
  const packet = terminalPacket({
    stage: "terminal",
    submissions: 1,
    retries: 0,
    model: "seedance-2",
    endpointId: "ep-20260907152021-jj8p7",
    route: "standard_api_v3",
    job: { id: "canvas-1", arkJobId: "ark-1", providerTaskId: "provider-1", state: "failed", error: { code: "ARK_TASK_FAILED", message: "Bearer private" } },
    usage: { subscription: { spentMicros: 123, reservedMicros: 0 }, reconciliation: { consistent: true } },
    artifact: { id: "asset-1", mimeType: "video/mp4", byteLength: 456, sha256: "a".repeat(64), private: "drop" },
  });
  assert.deepEqual(packet.job, { state: "failed", id: "canvas-1", arkJobId: "ark-1", providerTaskId: "provider-1", errorCode: "ARK_TASK_FAILED" });
  assert.deepEqual(packet.ledger, { spentUnits: 123, reservedUnits: 0, reconciliation: true });
  assert.deepEqual(packet.artifact, { id: "asset-1", mimeType: "video/mp4", byteLength: 456, sha256: "a".repeat(64) });
  assert.equal(JSON.stringify(packet).includes("private"), false);
});

test("terminal packet is durably written with private permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "openreel-terminal-packet-")), path = join(root, "evidence", "terminal.json");
  await persistTerminalPacket(path, terminalPacket({ submissions: 1, job: { state: "running", providerTaskId: "task-1" } }));
  const stored = JSON.parse(await readFile(path, "utf8"));
  assert.equal(stored.job.providerTaskId, "task-1");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("paid Seedance proof fails closed before any request without exact confirmation", async () => {
  let calls = 0;
  const result = await runStandardArkSeedanceCanvasProof({ env: {}, fetchImpl: async () => { calls += 1; } });
  assert.deepEqual(result, { status: "not_submitted", submissions: 0, retries: 0 });
  assert.equal(calls, 0);
});

test("paid Seedance proof accepts canonical byteLength and leaves a succeeded terminal packet", async () => {
  const root = await mkdtemp(join(tmpdir(), "openreel-seedance-proof-")), packetPath = join(root, "terminal.json"), mediaPath = join(root, "result.mp4");
  const json = (status, value, cookies = []) => ({ status, headers: { get: name => name === "content-type" ? "application/json" : null, getSetCookie: () => cookies }, json: async () => value });
  const bytes = Buffer.from("video-fixture");
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/auth/register") return json(201, {});
    if (path === "/api/v1/auth/login") return json(200, { csrfToken: "csrf" }, ["openreel_session=session; Path=/"]);
    if (path === "/api/v1/key-applications" && options.method === "POST") return json(201, { id: "application-1" });
    if (path.endsWith("/approve")) return json(201, {});
    if (path === "/api/v1/projects" && options.method === "POST") return json(201, { id: "project-1" });
    if (path === "/api/v1/projects/project-1/sessions") return json(201, { id: "session-1" });
    if (path === "/api/v1/sessions/session-1/nodes") return json(201, { id: "node-1" });
    if (path === "/api/v1/sessions/session-1/ark-jobs") return json(201, { id: "canvas-1", arkJobId: "ark-1", providerTaskId: "provider-1", state: "running" });
    if (path === "/api/v1/jobs/canvas-1/ark-poll") return json(201, { id: "canvas-1", arkJobId: "ark-1", providerTaskId: "provider-1", assetId: "asset-1", state: "succeeded" });
    if (path === "/api/v1/billing/usage") return json(200, { subscription: { spentMicros: 25, reservedMicros: 0 }, reconciliation: { consistent: true } });
    if (path === "/api/v1/projects/project-1") return json(200, { timeline: { tracks: [{ kind: "video", clips: [{ assetId: "asset-1" }] }] } });
    if (path === "/api/v1/projects/project-1/assets") return json(200, [{ id: "asset-1", mimeType: "video/mp4", byteLength: bytes.length }]);
    if (path === "/api/v1/projects/project-1/assets/asset-1/content") return { status: 200, headers: { get: name => name === "content-type" ? "video/mp4" : null }, arrayBuffer: async () => bytes };
    if (path.endsWith("/stop")) return json(201, {});
    throw new Error(`unexpected request ${options.method || "GET"} ${path}`);
  };
  const result = await runStandardArkSeedanceCanvasProof({
    fetchImpl,
    wait: async () => {},
    env: {
      OPENREEL_STANDARD_ARK_PAID_PROOF_CONFIRM: "SUBMIT_ONE_STANDARD_ARK_PAID_PROOF",
      OPENREEL_STANDARD_ARK_ENDPOINT_ID: "ep-test",
      OPENREEL_STANDARD_ARK_MAX_UNITS: "100",
      OPENREEL_STANDARD_ARK_TERMINAL_PACKET: packetPath,
      OPENREEL_STANDARD_ARK_RETAINED_MEDIA: mediaPath,
      OPENREEL_ADMIN_KEY: "not-logged",
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.byteLength, bytes.length);
  const packet = JSON.parse(await readFile(packetPath, "utf8"));
  assert.equal(packet.stage, "succeeded");
  assert.equal(packet.job.providerTaskId, "provider-1");
  assert.equal(packet.artifact.byteLength, bytes.length);
  assert.equal(packet.ledger.reconciliation, true);
});
