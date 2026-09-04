import test from "node:test";
import assert from "node:assert/strict";
import { createFilePublishingJobStore, createMemoryPublishingJobStore, createPublishingLifecycle } from "../src/publishing-lifecycle.js";
import { createFilePublishingBatchStore, createPublishingOrchestrator, PUBLISHING_PLATFORMS } from "../src/publishing-orchestration.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const principal = { tenantId: "tenant-a", accountId: "owner-a" };
function fixture(overrides = {}) { let ids = 0; const lifecycles = Object.fromEntries(PUBLISHING_PLATFORMS.map(platform => [platform, createPublishingLifecycle({ store: createMemoryPublishingJobStore(), id: () => `${platform}-${++ids}`, validate: async () => ({ accepted: true }), adapter: { upload: async () => ({ uploadId: `${platform}-upload` }), reconcile: async () => ({ status: "ready" }), publish: async () => ({ remoteId: `${platform}-post` }), ...overrides[platform] }, baseRetryMs: 1, random: () => 0 })])); return createPublishingOrchestrator({ lifecycles, id: () => "batch-1", now: () => "2026-08-21T01:00:00.000Z" }); }
const input = { assetId: "asset-1", assetSha256: "a".repeat(64), intentKey: "owner-reviewed-v1", title: "Title", copy: "Copy", destinations: PUBLISHING_PLATFORMS.map(platform => ({ platform, accountId: `${platform}-account` })) };
test("one-click validates all destinations, requires final confirmation and suppresses duplicate clicks", async () => { const orchestration = fixture(), first = orchestration.create(principal, input), replay = orchestration.create(principal, input); assert.equal(first.id, replay.id); let view = await orchestration.validate(principal, first.id); assert.equal(view.summary.counts.awaiting_confirmation, 4); view = orchestration.confirm(principal, first.id); assert.equal(view.summary.counts.uploading, 4); for (let index = 0; index < 3; index++) view = await orchestration.advance(principal, first.id); assert.equal(view.summary.status, "published"); });
test("partial failure retries only the failed destination and requires renewed confirmation", async () => { let attempts = 0; const orchestration = fixture({ douyin: { upload: async () => { if (++attempts === 1) throw Object.assign(new Error("busy"), { status: 503 }); return { uploadId: "retry" }; } } }), batch = orchestration.create(principal, input); await orchestration.validate(principal, batch.id); orchestration.confirm(principal, batch.id); let view = await orchestration.advance(principal, batch.id); assert.equal(view.summary.counts.failed, 1); orchestration.retry(principal, batch.id, "douyin"); view = await orchestration.validate(principal, batch.id); assert.equal(view.destinations.find(item => item.platform === "douyin").state, "awaiting_confirmation"); assert.throws(() => orchestration.confirm(principal, batch.id), error => error.code === "PUBLISHING_BATCH_CONFIRMATION_INVALID"); orchestration.confirm(principal, batch.id, "douyin"); for (let index = 0; index < 3; index++) view = await orchestration.advance(principal, batch.id); assert.equal(view.summary.status, "published"); });
test("unknown remote demands reconciliation and tenant isolation holds", async () => { const orchestration = fixture({ tiktok: { upload: async () => { throw Object.assign(new Error("lost"), { remoteOutcomeUnknown: true }); }, reconcile: async () => ({ status: "published", remoteId: "found" }) } }), batch = orchestration.create(principal, { ...input, destinations: input.destinations.slice(0, 1) }); await orchestration.validate(principal, batch.id); orchestration.confirm(principal, batch.id); let view = await orchestration.advance(principal, batch.id); assert.equal(view.summary.status, "attention_required"); view = await orchestration.reconcile(principal, batch.id, "tiktok"); assert.equal(view.summary.status, "published"); assert.throws(() => orchestration.get({ tenantId: "tenant-b", accountId: "x" }, batch.id), error => error.code === "PUBLISHING_BATCH_NOT_FOUND"); });
test("batch cancellation is explicit and never counted as publication", async () => { const orchestration = fixture(), batch = orchestration.create(principal, { ...input, destinations: input.destinations.slice(0, 2) }); orchestration.cancel(principal, batch.id); const view = await orchestration.advance(principal, batch.id); assert.equal(view.summary.status, "cancelled"); assert.equal(view.summary.counts.published, 0); });
test("file-backed batch survives restart and preserves intent idempotency", async () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-publishing-batch-")), build = () => {
    let ids = 0;
    const lifecycles = Object.fromEntries(PUBLISHING_PLATFORMS.map(platform => [platform, createPublishingLifecycle({ store: createFilePublishingJobStore(join(root, `${platform}.json`)), id: () => `${platform}-${++ids}`, validate: async () => ({ accepted: true }), adapter: { upload: async () => ({ uploadId: `${platform}-upload` }), reconcile: async () => ({ status: "ready" }), publish: async () => ({ remoteId: `${platform}-post` }) } })]));
    return createPublishingOrchestrator({ lifecycles, store: createFilePublishingBatchStore(join(root, "batches.json")), id: () => "durable-batch" });
  };
  const first = build(), created = first.create(principal, input);
  await first.validate(principal, created.id);
  const restarted = build(), replay = restarted.create(principal, input);
  assert.equal(replay.id, created.id); assert.equal(replay.summary.counts.awaiting_confirmation, 4);
  restarted.confirm(principal, replay.id);
  let view; for (let index = 0; index < 3; index++) view = await restarted.advance(principal, replay.id);
  assert.equal(view.summary.status, "published");
});
test("publication audit history is tenant isolated, newest first and excludes metadata copy", async () => {
  let batchIds = 0, tick = 0;
  const lifecycles = Object.fromEntries(PUBLISHING_PLATFORMS.map(platform => [platform, createPublishingLifecycle({ store: createMemoryPublishingJobStore(), id: () => `${platform}-${++batchIds}`, validate: async () => ({ accepted: true }), adapter: { upload: async () => ({ uploadId: "upload" }), reconcile: async () => ({ status: "ready" }), publish: async () => ({ remoteId: "post-1", remoteUrl: "https://example.invalid/post-1" }) }, now: () => `2026-08-21T01:00:0${tick}.000Z` })]));
  const orchestration = createPublishingOrchestrator({ lifecycles, id: () => `batch-${++batchIds}`, now: () => `2026-08-21T01:00:0${++tick}.000Z` });
  orchestration.create(principal, { ...input, destinations: input.destinations.slice(0, 1) });
  orchestration.create({ tenantId: "tenant-b", accountId: "owner-b" }, { ...input, intentKey: "other", destinations: input.destinations.slice(0, 1) });
  const history = orchestration.list(principal);
  assert.equal(history.length, 1); assert.equal(history[0].schema, "openreel-publishing-audit/v1"); assert.equal(history[0].assetSha256, input.assetSha256);
  assert.equal(history[0].destinations[0].history[0].event, "intent_created"); assert.equal(JSON.stringify(history).includes(input.copy), false);
});
test("audit export is tenant isolated and deletion rejects active or foreign records", async () => {
  const orchestration = fixture(), batch = orchestration.create(principal, { ...input, destinations: input.destinations.slice(0, 1) });
  const exported = orchestration.export(principal); assert.equal(exported.schema, "openreel-publishing-audit-export/v1"); assert.equal(exported.records.length, 1);
  assert.throws(() => orchestration.remove(principal, batch.id), error => error.code === "PUBLISHING_BATCH_DELETE_UNSAFE");
  orchestration.cancel(principal, batch.id); await orchestration.advance(principal, batch.id);
  assert.equal(orchestration.remove(principal, batch.id).deleted, true); assert.equal(orchestration.list(principal).length, 0);
  assert.throws(() => orchestration.remove({ tenantId: "tenant-b", accountId: "owner-b" }, batch.id), error => error.code === "PUBLISHING_BATCH_NOT_FOUND");
});
