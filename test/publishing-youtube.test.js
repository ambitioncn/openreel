import assert from "node:assert/strict";
import test from "node:test";
import { createYouTubePublishingAdapter } from "../src/publishing-youtube.js";

const job = { tenantId: "tenant-1", input: { assetId: "asset-1", metadata: { title: "Short title", copy: "Description #shorts", privacy: "private", madeForKids: false } }, remote: {} };
const ok = (body, headers = {}) => ({ status: 200, body, headers });

test("YouTube adapter discovers the OAuth channel and official constraints", async () => {
  const calls = [], adapter = createYouTubePublishingAdapter({ accessToken: "token", readAsset: async () => ({}), request: async (url, options) => { calls.push([url, options]); return ok({ items: [{ id: "channel-1", snippet: { title: "Creator" }, status: {} }] }); } });
  const capability = await adapter.discoverCapabilities();
  assert.deepEqual([capability.platform, capability.channelId, capability.displayName, capability.canPublish], ["youtube_shorts", "channel-1", "Creator", true]);
  assert.match(calls[0][0], /channels\?part=id,snippet,status&mine=true$/);
  assert.equal(calls[0][1].headers.Authorization, "Bearer token");
});

test("YouTube adapter creates a resumable upload and transfers exact tenant bytes", async () => {
  const bytes = Buffer.from("video"), calls = [];
  const adapter = createYouTubePublishingAdapter({ accessToken: "token", readAsset: async (id, tenant) => { assert.deepEqual([id, tenant], ["asset-1", "tenant-1"]); return { bytes }; }, request: async (url, options) => { calls.push([url, options]); return url.includes("uploadType=resumable") ? ok({}, { location: "https://www.googleapis.com/upload/session-1" }) : ok({ id: "video-1" }); } });
  assert.deepEqual(await adapter.upload(job), { videoId: "video-1", uploadUrl: "https://www.googleapis.com/upload/session-1" });
  const metadata = JSON.parse(calls[0][1].body);
  assert.deepEqual(metadata, { snippet: { title: "Short title", description: "Description #shorts" }, status: { privacyStatus: "private", selfDeclaredMadeForKids: false } });
  assert.equal(calls[1][1].body, bytes);
  assert.equal(calls[1][1].headers["Content-Length"], String(bytes.length));
});

test("YouTube adapter reconciles processing and completed uploads", async () => {
  const replies = [ok({ items: [{ id: "video-1", status: { uploadStatus: "uploaded" }, processingDetails: { processingStatus: "processing" } }] }), ok({ items: [{ id: "video-1", status: { uploadStatus: "processed", privacyStatus: "private" }, processingDetails: { processingStatus: "succeeded" } }] })];
  const adapter = createYouTubePublishingAdapter({ accessToken: "token", readAsset: async () => ({}), request: async () => replies.shift() });
  assert.deepEqual(await adapter.reconcile({ ...job, remote: { videoId: "video-1" } }), { status: "processing", videoId: "video-1" });
  assert.deepEqual(await adapter.publish({ ...job, remote: { videoId: "video-1" } }), { status: "published", videoId: "video-1", remoteId: "video-1", privacy: "private" });
});

test("YouTube adapter enforces metadata, audience and upload URL boundaries", async () => {
  const make = (inputJob, location = "https://evil.example/upload") => createYouTubePublishingAdapter({ accessToken: "token", readAsset: async () => ({ bytes: Buffer.from("x") }), request: async () => ok({}, { location }) }).upload(inputJob);
  await assert.rejects(make({ ...job, input: { ...job.input, metadata: { ...job.input.metadata, title: "x".repeat(101) } } }), error => error.code === "YOUTUBE_PUBLISH_INVALID");
  await assert.rejects(make({ ...job, input: { ...job.input, metadata: { ...job.input.metadata, madeForKids: null } } }), error => error.code === "YOUTUBE_AUDIENCE_REQUIRED");
  await assert.rejects(make(job), error => error.code === "YOUTUBE_UPLOAD_URL_UNSAFE");
});

test("YouTube adapter normalizes auth, quota, policy and ambiguous outcomes", async () => {
  for (const [reply, category] of [[{ status: 401, body: { error: { status: "UNAUTHENTICATED" } } }, "auth"], [{ status: 403, body: { error: { errors: [{ reason: "quotaExceeded" }] } } }, "quota"], [{ status: 422, body: { error: { errors: [{ reason: "copyrightViolation" }] } } }, "policy"]]) {
    const adapter = createYouTubePublishingAdapter({ accessToken: "token", readAsset: async () => ({}), request: async () => reply });
    await assert.rejects(adapter.discoverCapabilities(), error => error.category === category);
  }
  const unknown = createYouTubePublishingAdapter({ accessToken: "token", readAsset: async () => ({}), request: async () => ok({ items: [{ id: "video", status: { uploadStatus: "uploaded" }, processingDetails: { processingStatus: "alien" } }] }) });
  await assert.rejects(unknown.reconcile({ ...job, remote: { videoId: "video" } }), error => error.remoteOutcomeUnknown === true);
  const lost = createYouTubePublishingAdapter({ accessToken: "token", readAsset: async () => ({ bytes: Buffer.from("x") }), request: async url => url.includes("uploadType=resumable") ? ok({}, { location: "https://www.googleapis.com/upload/session" }) : { status: 503, body: {} } });
  await assert.rejects(lost.upload(job), error => error.category === "transient" && error.remoteOutcomeUnknown === true);
});
