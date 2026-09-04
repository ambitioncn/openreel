import assert from "node:assert/strict";
import test from "node:test";
import { createDouyinPublishingAdapter } from "../src/publishing-douyin.js";

const job = { tenantId: "tenant-1", input: { assetId: "asset-1", metadata: { title: "标题", copy: "发布文案 #标签" } }, remote: {} };
const response = data => ({ status: 200, body: { data: { error_code: 0, ...data } } });

test("Douyin adapter discovers the official account and documented upload constraints", async () => {
  const calls = [], adapter = createDouyinPublishingAdapter({ accessToken: "secret-token", openId: "open-1", readAsset: async () => ({}), request: async (url, options) => { calls.push([url, options]); return response({ nickname: "Creator" }); } });
  const capability = await adapter.discoverCapabilities();
  assert.equal(capability.platform, "douyin");
  assert.equal(capability.displayName, "Creator");
  assert.equal(capability.media.singleUploadMaxBytes, 128 * 1024 * 1024);
  assert.match(calls[0][0], /^https:\/\/open\.douyin\.com\/oauth\/userinfo\/\?/);
  assert.equal(new URL(calls[0][0]).searchParams.get("open_id"), "open-1");
});

test("Douyin adapter uploads tenant-owned bytes, creates once, then reconciles publication", async () => {
  const bytes = Buffer.from("video"), calls = [];
  const adapter = createDouyinPublishingAdapter({ accessToken: "secret-token", openId: "open-1", readAsset: async (id, tenant) => { assert.deepEqual([id, tenant], ["asset-1", "tenant-1"]); return { bytes }; }, request: async (url, options) => {
    calls.push([new URL(url).pathname, options]);
    if (url.includes("/video/upload/")) return response({ video: { video_id: "video-1" } });
    if (url.includes("/video/create/")) return response({ item_id: "item-1" });
    return response({ list: [{ item_id: "item-1", review_status: 3, share_url: "https://douyin.example/item-1" }] });
  } });
  const remote = await adapter.upload(job);
  assert.deepEqual(remote, { videoId: "video-1", itemId: "item-1" });
  assert.equal(calls[0][1].body, bytes);
  assert.deepEqual(JSON.parse(calls[1][1].body), { video_id: "video-1", text: "发布文案 #标签" });
  assert.deepEqual(await adapter.reconcile({ ...job, remote }), { status: "published", itemId: "item-1", videoId: "video-1", remoteId: "item-1", remoteUrl: "https://douyin.example/item-1" });
});

test("Douyin adapter normalizes auth, quota, moderation and ambiguous outcomes", async () => {
  for (const [reply, category] of [[{ status: 401, body: {} }, "auth"], [{ status: 429, body: {} }, "quota"]]) {
    const adapter = createDouyinPublishingAdapter({ accessToken: "token", openId: "open", readAsset: async () => ({}), request: async () => reply });
    await assert.rejects(adapter.discoverCapabilities(), error => error.category === category);
  }
  const rejected = createDouyinPublishingAdapter({ accessToken: "token", openId: "open", readAsset: async () => ({}), request: async () => response({ list: [{ item_id: "item", review_status: 4, review_failure_reason: "audit rejected" }] }) });
  await assert.rejects(rejected.reconcile({ ...job, remote: { itemId: "item" } }), error => error.category === "policy");
  const unknown = createDouyinPublishingAdapter({ accessToken: "token", openId: "open", readAsset: async () => ({}), request: async () => response({ list: [{ item_id: "item", review_status: 99 }] }) });
  await assert.rejects(unknown.reconcile({ ...job, remote: { itemId: "item" } }), error => error.remoteOutcomeUnknown === true);
});

test("Douyin adapter refuses unsafe implicit multipart and reports missing remote records", async () => {
  const tooLarge = createDouyinPublishingAdapter({ accessToken: "token", openId: "open", readAsset: async () => ({ bytes: Buffer.alloc(128 * 1024 * 1024 + 1) }), request: async () => response({}) });
  await assert.rejects(tooLarge.upload(job), error => error.code === "DOUYIN_MULTIPART_REQUIRED");
  const missing = createDouyinPublishingAdapter({ accessToken: "token", openId: "open", readAsset: async () => ({}), request: async () => response({ list: [] }) });
  assert.deepEqual(await missing.reconcile({ ...job, remote: { itemId: "item" } }), { status: "not_found", itemId: "item" });
});
