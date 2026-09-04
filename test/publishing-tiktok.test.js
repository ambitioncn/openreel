import assert from "node:assert/strict";
import test from "node:test";
import { createTikTokPublishingAdapter } from "../src/publishing-tiktok.js";

const job = { tenantId: "tenant-1", input: { assetId: "asset-1", metadata: { title: "Title", copy: "Caption #tag", privacy: "SELF_ONLY", allowComment: true } }, remote: {} };
const response = body => ({ status: 200, body: { data: body, error: { code: "ok" } } });

test("TikTok adapter discovers current creator constraints with minimum-scope bearer transport", async () => {
  const calls = [], adapter = createTikTokPublishingAdapter({ accessToken: "token", readAsset: async () => ({}), request: async (url, options) => { calls.push([url, options]); return response({ creator_nickname: "Creator", privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 60, duet_disabled: true }); } });
  const capability = await adapter.discoverCapabilities();
  assert.deepEqual(capability, { platform: "tiktok", displayName: "Creator", canPublish: true, privacyOptions: ["SELF_ONLY"], maxDurationSeconds: 60, interactions: { comment: true, duet: false, stitch: true } });
  assert.equal(calls[0][1].headers.Authorization, "Bearer token");
});

test("TikTok adapter initializes direct post, transfers exact bytes and reconciles completion", async () => {
  const calls = [], bytes = Buffer.from("video");
  const adapter = createTikTokPublishingAdapter({ accessToken: "token", readAsset: async (id, tenant) => { assert.deepEqual([id, tenant], ["asset-1", "tenant-1"]); return { bytes }; }, request: async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith("/video/init/")) return response({ publish_id: "pub-1", upload_url: "https://upload.example/video" });
    if (url.includes("upload.example")) return { status: 201, body: {} };
    return response({ status: "PUBLISH_COMPLETE", publicly_available_post_id: ["post-1"] });
  } });
  const remote = await adapter.upload(job);
  assert.deepEqual(remote, { publishId: "pub-1" });
  assert.equal(calls[1][1].headers["Content-Range"], "bytes 0-4/5");
  assert.equal(calls[1][1].body, bytes);
  assert.deepEqual(await adapter.reconcile({ ...job, remote }), { status: "published", publishId: "pub-1", remoteId: "post-1" });
});

test("TikTok adapter normalizes auth, quota, policy and ambiguous status failures", async () => {
  for (const [status, category] of [[401, "auth"], [429, "quota"]]) {
    const adapter = createTikTokPublishingAdapter({ accessToken: "token", readAsset: async () => ({}), request: async () => ({ status, body: { error: { code: "denied" } } }) });
    await assert.rejects(adapter.discoverCapabilities(), error => error.category === category);
  }
  const policy = createTikTokPublishingAdapter({ accessToken: "token", readAsset: async () => ({}), request: async () => response({ status: "FAILED", fail_reason: "moderation_rejected" }) });
  await assert.rejects(policy.reconcile({ ...job, remote: { publishId: "pub" } }), error => error.category === "policy");
  const unknown = createTikTokPublishingAdapter({ accessToken: "token", readAsset: async () => ({}), request: async () => response({ status: "NEW_STATE" }) });
  await assert.rejects(unknown.reconcile({ ...job, remote: { publishId: "pub" } }), error => error.remoteOutcomeUnknown === true);
});

test("TikTok upload transfer loss is ambiguous and never represented as safe retry", async () => {
  const adapter = createTikTokPublishingAdapter({ accessToken: "token", readAsset: async () => ({ bytes: Buffer.from("x") }), request: async url => url.endsWith("/video/init/") ? response({ publish_id: "pub", upload_url: "https://upload.example/video" }) : { status: 503, body: {} } });
  await assert.rejects(adapter.upload(job), error => error.remoteOutcomeUnknown === true);
});
