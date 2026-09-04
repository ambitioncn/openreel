import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyPublishingFailure, createFilePublishingJobStore, createMemoryPublishingJobStore, createPublishingLifecycle } from "../src/publishing-lifecycle.js";

const principal = { tenantId: "tenant-1", accountId: "owner-1" };
const input = { platform: "tiktok", accountId: "acct-1", assetSha256: "a".repeat(64), intentKey: "final-title-copy-v1", assetId: "render-1" };
const accepted = { accepted: true, schema: "openreel-publishing-preflight/v1" };

function fixture(adapter = {}) {
  let next = 0;
  return createPublishingLifecycle({
    adapter: { upload: async () => ({ uploadId: "up-1" }), publish: async () => ({ remoteId: "post-1" }), reconcile: async () => ({ status: "ready" }), ...adapter },
    validate: async () => accepted, id: () => `job-${++next}`, now: (() => { let tick = 0; return () => new Date(1_800_000_000_000 + tick++ * 1_000).toISOString(); })(), random: () => 0
  });
}

test("stable tenant-platform-account-asset-intent identity suppresses duplicate clicks", () => {
  const lifecycle = fixture(), first = lifecycle.create(principal, input);
  assert.equal(lifecycle.create(principal, input).id, first.id);
  assert.notEqual(lifecycle.create(principal, { ...input, accountId: "acct-2" }).id, first.id);
  assert.throws(() => lifecycle.get({ tenantId: "other", accountId: "owner-1" }, first.id), error => error.code === "PUBLISHING_JOB_NOT_FOUND");
});

test("complete state contract follows validation, confirmation, upload, processing and publish", async () => {
  const keys = [], lifecycle = fixture({ upload: async (_job, options) => (keys.push(options.idempotencyKey), { uploadId: "up-1" }), publish: async (_job, options) => (keys.push(options.idempotencyKey), { remoteId: "post-1" }) });
  let job = lifecycle.create(principal, input);
  job = await lifecycle.advance(principal, job.id); assert.equal(job.state, "awaiting_confirmation");
  job = lifecycle.confirm(principal, job.id); assert.equal(job.state, "uploading");
  job = await lifecycle.advance(principal, job.id); assert.equal(job.state, "processing");
  job = await lifecycle.advance(principal, job.id); assert.equal(job.state, "publishing");
  job = await lifecycle.advance(principal, job.id); assert.equal(job.state, "published");
  assert.deepEqual(keys, [`${job.intentIdentity}:upload`, `${job.intentIdentity}:publish`]);
  assert.deepEqual(job.history.map(item => item.to), ["queued", "validating", "awaiting_confirmation", "uploading", "processing", "publishing", "published"]);
});

test("processing polls do not consume bounded remote action attempts", async () => {
  let polls = 0;
  const lifecycle = fixture({ reconcile: async () => (++polls < 8 ? { status: "processing" } : { status: "published", remoteId: "video-1" }) });
  let job = lifecycle.create(principal, input);
  job = await lifecycle.advance(principal, job.id);
  job = lifecycle.confirm(principal, job.id);
  job = await lifecycle.advance(principal, job.id);
  assert.equal(job.state, "processing");
  for (let i = 0; i < 8; i++) job = await lifecycle.advance(principal, job.id);
  assert.equal(job.state, "published");
  assert.equal(job.attempts, 1);
  assert.equal(polls, 8);
});

test("optimistic concurrency permits only one worker at a persisted boundary", async () => {
  const store = createMemoryPublishingJobStore(), lifecycle = createPublishingLifecycle({ adapter: { upload: async () => ({ uploadId: "up" }), publish: async () => ({}), reconcile: async () => ({ status: "ready" }) }, validate: async () => accepted, store, id: () => "job" });
  const created = lifecycle.create(principal, input);
  const first = store.get(created.id), second = store.get(created.id);
  store.compareAndSwap({ ...first, version: 2 }, 1);
  assert.throws(() => store.compareAndSwap({ ...second, version: 2 }, 1), error => error.code === "PUBLISHING_JOB_CONFLICT");
});

test("crash after upload request becomes unknown and reconciliation prevents blind duplicate publish", async () => {
  let uploads = 0;
  const lifecycle = fixture({ upload: async () => { uploads += 1; throw Object.assign(new Error("socket lost"), { remoteOutcomeUnknown: true }); }, reconcile: async () => ({ status: "processing", uploadId: "remote-up" }) });
  let job = lifecycle.create(principal, input); job = await lifecycle.advance(principal, job.id); job = lifecycle.confirm(principal, job.id);
  job = await lifecycle.advance(principal, job.id); assert.equal(job.state, "unknown_remote"); assert.equal(job.retryable, false);
  assert.equal((await lifecycle.advance(principal, job.id)).state, "unknown_remote"); assert.equal(uploads, 1);
  job = await lifecycle.reconcile(principal, job.id); assert.equal(job.state, "processing"); assert.equal(uploads, 1);
});

test("ambiguous publish is reconciled to published without invoking publish twice", async () => {
  let publishes = 0;
  const lifecycle = fixture({ publish: async () => { publishes += 1; throw Object.assign(new Error("timeout"), { remoteOutcomeUnknown: true }); }, reconcile: async job => job.state === "processing" ? { status: "ready" } : { status: "published", remoteId: "found-post" } });
  let job = lifecycle.create(principal, input); job = await lifecycle.advance(principal, job.id); job = lifecycle.confirm(principal, job.id);
  job = await lifecycle.advance(principal, job.id); job = await lifecycle.advance(principal, job.id); job = await lifecycle.advance(principal, job.id);
  assert.equal(job.state, "unknown_remote");
  job = await lifecycle.reconcile(principal, job.id); assert.equal(job.state, "published"); assert.equal(publishes, 1);
});

test("classified transient failures use bounded retry while auth and policy failures do not", async () => {
  let calls = 0;
  const lifecycle = fixture({ upload: async () => { calls += 1; if (calls === 1) throw Object.assign(new Error("busy"), { status: 503, retryAfterMs: 8_000, code: "BUSY" }); return { uploadId: "up" }; } });
  let job = lifecycle.create(principal, input); job = await lifecycle.advance(principal, job.id); job = lifecycle.confirm(principal, job.id); job = await lifecycle.advance(principal, job.id);
  assert.equal(job.state, "failed"); assert.equal(job.retryable, true); assert.equal(job.error.category, "transient");
  job = lifecycle.retry(principal, job.id); assert.equal(job.state, "queued");
  assert.deepEqual(classifyPublishingFailure({ status: 401 }), { category: "auth", retryable: false, ambiguous: false });
  assert.deepEqual(classifyPublishingFailure({ category: "policy" }), { category: "policy", retryable: false, ambiguous: false });
  assert.deepEqual(classifyPublishingFailure({ status: 429 }), { category: "quota", retryable: true, ambiguous: false });
});

test("cancellation is persisted and adapter failure leaves an explicit unknown remote state", async () => {
  const clean = fixture(), queued = clean.create(principal, input);
  let job = clean.cancel(principal, queued.id); assert.equal(job.state, "cancelling");
  job = await clean.advance(principal, queued.id); assert.equal(job.state, "cancelled");

  const uncertain = fixture({ cancel: async () => { throw new Error("lost response"); } });
  const other = uncertain.create(principal, input); uncertain.cancel(principal, other.id);
  assert.equal((await uncertain.advance(principal, other.id)).state, "unknown_remote");
});

test("restart recovery lists active and ambiguous work without silently changing state", async () => {
  const store = createMemoryPublishingJobStore(), first = createPublishingLifecycle({ adapter: { upload: async () => { throw Object.assign(new Error("lost"), { remoteOutcomeUnknown: true }); }, publish: async () => ({}), reconcile: async () => ({ status: "processing" }) }, validate: async () => accepted, store, id: () => "durable" });
  let job = first.create(principal, input); job = await first.advance(principal, job.id); job = first.confirm(principal, job.id); await first.advance(principal, job.id);
  const second = createPublishingLifecycle({ adapter: { upload: async () => ({}), publish: async () => ({}), reconcile: async () => ({ status: "processing" }) }, validate: async () => accepted, store });
  assert.deepEqual(second.recover().map(item => [item.id, item.state]), [["durable", "unknown_remote"]]);
  assert.equal((await second.reconcile(principal, "durable")).state, "processing");
});

test("atomic file store survives reconstruction with intent and version intact", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-publishing-")), "jobs.json");
  const adapter = { upload: async () => ({ uploadId: "up" }), publish: async () => ({}), reconcile: async () => ({ status: "ready" }) };
  const first = createPublishingLifecycle({ adapter, validate: async () => accepted, store: createFilePublishingJobStore(file), id: () => "file-job" });
  const created = first.create(principal, input); await first.advance(principal, created.id);
  const second = createPublishingLifecycle({ adapter, validate: async () => accepted, store: createFilePublishingJobStore(file) });
  assert.equal(second.create(principal, input).id, "file-job");
  assert.equal(second.get(principal, "file-job").state, "awaiting_confirmation");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).schema, "openreel-publishing-job-store/v1");
});
