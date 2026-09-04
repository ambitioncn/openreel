import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramPublishingAdapter } from "../src/publishing-instagram.js";

const job = { tenantId: "tenant-1", input: { assetId: "asset-1", metadata: { title: "Title", copy: "Caption #tag", shareToFeed: true } }, remote: {} };
const ok = body => ({ status: 200, body });
const media = () => ({ url: "https://media.example/video.mp4?sig=one-use", publiclyReachable: true, expiresAt: Date.now() + 300_000 });

test("Instagram adapter qualifies an eligible professional account", async () => {
  const calls = [], adapter = createInstagramPublishingAdapter({ accessToken: "token", instagramUserId: "ig-1", prepareMediaUrl: media, request: async (url, options) => { calls.push([url, options]); return ok({ id: "ig-1", username: "creator", account_type: "BUSINESS" }); } });
  const capability = await adapter.discoverCapabilities();
  assert.deepEqual([capability.platform, capability.displayName, capability.canPublish], ["instagram_reels", "creator", true]);
  assert.match(calls[0][0], /^https:\/\/graph\.facebook\.com\/v23\.0\/ig-1\?/);
  assert.equal(calls[0][1].headers.Authorization, "Bearer token");
});

test("Instagram adapter creates a Reels container from tenant-scoped HTTPS media and reconciles processing", async () => {
  const calls = [], adapter = createInstagramPublishingAdapter({ accessToken: "token", instagramUserId: "ig-1", prepareMediaUrl: async (id, tenant) => { assert.deepEqual([id, tenant], ["asset-1", "tenant-1"]); return media(); }, request: async (url, options) => { calls.push([url, options]); return url.includes("/media") ? ok({ id: "container-1" }) : ok({ id: "container-1", status_code: "IN_PROGRESS" }); } });
  const remote = await adapter.upload(job);
  const form = new URLSearchParams(calls[0][1].body);
  assert.deepEqual([form.get("media_type"), form.get("caption"), form.get("share_to_feed")], ["REELS", "Caption #tag", "true"]);
  assert.equal(remote.containerId, "container-1");
  assert.deepEqual(await adapter.reconcile({ ...job, remote }), { status: "processing", containerId: "container-1", remoteId: null });
});

test("Instagram adapter publishes a finished container exactly once", async () => {
  const calls = [], adapter = createInstagramPublishingAdapter({ accessToken: "token", instagramUserId: "ig-1", prepareMediaUrl: media, request: async (url, options) => { calls.push([url, options]); return url.includes("media_publish") ? ok({ id: "reel-1" }) : ok({ id: "container-1", status_code: "FINISHED" }); } });
  const result = await adapter.publish({ ...job, remote: { containerId: "container-1" } });
  assert.deepEqual(result, { status: "published", containerId: "container-1", remoteId: "reel-1" });
  assert.equal(new URLSearchParams(calls[1][1].body).get("creation_id"), "container-1");
});

test("Instagram adapter rejects ineligible accounts and unsafe transfer URLs", async () => {
  const ineligible = createInstagramPublishingAdapter({ accessToken: "token", instagramUserId: "ig", prepareMediaUrl: media, request: async () => ok({ id: "ig", username: "personal", account_type: "PERSONAL" }) });
  await assert.rejects(ineligible.discoverCapabilities(), error => error.code === "INSTAGRAM_ACCOUNT_INELIGIBLE");
  for (const value of [{ url: "http://media/video.mp4", publiclyReachable: true, expiresAt: Date.now() + 1_000 }, { url: "https://media/video.mp4", publiclyReachable: false, expiresAt: Date.now() + 1_000 }, { url: "https://media/video.mp4", publiclyReachable: true, expiresAt: Date.now() - 1 }]) {
    const adapter = createInstagramPublishingAdapter({ accessToken: "token", instagramUserId: "ig", prepareMediaUrl: async () => value, request: async () => ok({}) });
    await assert.rejects(adapter.upload(job), error => error.code === "INSTAGRAM_MEDIA_URL_UNSAFE");
  }
});

test("Instagram adapter normalizes permission, quota, policy and ambiguous failures", async () => {
  for (const [reply, category] of [[{ status: 403, body: { error: { code: 200 } } }, "auth"], [{ status: 429, body: { error: { code: 4 } } }, "quota"], [{ status: 422, body: { error: { message: "copyright policy blocked" } } }, "policy"]]) {
    const adapter = createInstagramPublishingAdapter({ accessToken: "token", instagramUserId: "ig", prepareMediaUrl: media, request: async () => reply });
    await assert.rejects(adapter.discoverCapabilities(), error => error.category === category);
  }
  const unknown = createInstagramPublishingAdapter({ accessToken: "token", instagramUserId: "ig", prepareMediaUrl: media, request: async () => ok({ status_code: "ALIEN" }) });
  await assert.rejects(unknown.reconcile({ ...job, remote: { containerId: "container" } }), error => error.remoteOutcomeUnknown === true);
  const transientPublish = createInstagramPublishingAdapter({ accessToken: "token", instagramUserId: "ig", prepareMediaUrl: media, request: async url => url.includes("media_publish") ? { status: 503, body: {} } : ok({ status_code: "FINISHED" }) });
  await assert.rejects(transientPublish.publish({ ...job, remote: { containerId: "container" } }), error => error.category === "transient" && error.remoteOutcomeUnknown === true);
});
