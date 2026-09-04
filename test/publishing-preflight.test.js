import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { publishingPreflight, PUBLISHING_DESTINATIONS } from "../src/publishing-preflight.js";

function box(type, payload) { const bytes = Buffer.alloc(8 + payload.length); bytes.writeUInt32BE(bytes.length); bytes.write(type, 4, 4, "ascii"); payload.copy(bytes, 8); return bytes; }
const bytes = Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov", Buffer.alloc(4)), box("mdat", Buffer.from("video"))]);
const asset = { id: "render-1", tenantId: "tenant-a", role: "render", mimeType: "video/mp4", byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const probe = { container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, durationSeconds: 45, frameRate: 30, audioSampleRate: 48_000, byteLength: bytes.length };
const metadata = { title: "Launch", copy: "A short launch film #openreel", privacy: "public" };
const capability = platform => ({ platform, observedAt: "2026-08-20T23:00:00.000Z", canPublish: true, privacyOptions: ["public", "private"], maxDurationSeconds: 180, maxBytes: 1024 * 1024, acceptedVideoCodecs: ["h264"], acceptedAudioCodecs: ["aac"], minWidth: 720, minHeight: 1280, aspectRatios: [9 / 16], maxFrameRate: 60, titleMaxChars: 100, copyMaxChars: 2200, maxHashtags: 30 });
const base = () => ({ tenantId: "tenant-a", asset, bytes, probe, metadata, destinations: [...PUBLISHING_DESTINATIONS], capabilities: Object.fromEntries(PUBLISHING_DESTINATIONS.map(platform => [platform, capability(platform)])) });

test("all four platform profiles accept a byte-verified vertical MP4", () => {
  const result = publishingPreflight(base());
  assert.equal(result.accepted, true); assert.deepEqual(result.results.map(item => [item.platform, item.status]), PUBLISHING_DESTINATIONS.map(platform => [platform, "passed"]));
  assert.equal(result.asset.sha256, asset.sha256); assert.equal(result.probe.audioSampleRate, 48_000);
});

test("tenant, role, MIME, signature, length and digest fail closed", () => {
  for (const mutate of [
    value => { value.tenantId = "tenant-b"; }, value => { value.asset.role = "reference"; }, value => { value.asset.mimeType = "video/webm"; },
    value => { value.bytes = Buffer.from("not mp4"); value.asset.byteLength = value.bytes.length; value.asset.sha256 = createHash("sha256").update(value.bytes).digest("hex"); },
    value => { value.asset.byteLength += 1; }, value => { value.asset.sha256 = "0".repeat(64); }
  ]) {
    const input = base(); input.asset = { ...input.asset }; mutate(input);
    assert.throws(() => publishingPreflight(input), error => ["PUBLISHING_PREFLIGHT_INVALID", "PUBLISHING_ASSET_NOT_FOUND"].includes(error.code));
  }
});

test("probe must describe the verified bytes and canonical media fields", () => {
  for (const mutate of [value => { value.probe.byteLength += 1; }, value => { value.probe.container = "webm"; }, value => { value.probe.durationSeconds = NaN; }, value => { delete value.probe.audioSampleRate; }]) {
    const input = base(); input.probe = { ...input.probe }; mutate(input); assert.throws(() => publishingPreflight(input), error => error.code === "PUBLISHING_PREFLIGHT_INVALID");
  }
});

test("platform media, account and privacy limits return actionable blockers", () => {
  const input = base(), cap = input.capabilities.tiktok;
  Object.assign(cap, { canPublish: false, maxBytes: 1, maxDurationSeconds: 10, acceptedVideoCodecs: ["hevc"], acceptedAudioCodecs: ["mp3"], minWidth: 2000, maxFrameRate: 24, aspectRatios: [16 / 9], privacyOptions: ["private"] });
  const result = publishingPreflight({ ...input, destinations: ["tiktok"] }).results[0];
  assert.equal(result.status, "blocked"); assert.deepEqual(result.blockers.map(item => item.code), ["account_cannot_publish", "video_too_large", "video_too_long", "video_codec_unsupported", "audio_codec_unsupported", "video_resolution_too_small", "frame_rate_too_high", "aspect_ratio_unsupported", "privacy_unavailable"]);
});

test("text overflow is an explicit adaptation preview and never mutates input", () => {
  const input = base(); input.destinations = ["youtube_shorts"]; input.metadata = { ...metadata, title: "123456", copy: "abcdef" }; Object.assign(input.capabilities.youtube_shorts, { titleMaxChars: 5, copyMaxChars: 4 });
  const result = publishingPreflight(input), destination = result.results[0];
  assert.equal(result.accepted, false); assert.equal(destination.status, "adaptation_required"); assert.deepEqual(destination.proposedMetadata, { title: "12345", copy: "abcd", privacy: "public" }); assert.deepEqual(input.metadata, { ...metadata, title: "123456", copy: "abcdef" });
});

test("hashtag excess blocks instead of deleting user copy", () => {
  const input = base(); input.destinations = ["instagram_reels"]; input.metadata = { ...metadata, copy: "#one #two" }; input.capabilities.instagram_reels.maxHashtags = 1;
  const result = publishingPreflight(input).results[0]; assert.equal(result.status, "blocked"); assert.equal(result.blockers[0].code, "too_many_hashtags"); assert.equal(result.proposedMetadata, null);
});

test("missing and contradictory dynamic capabilities fail before upload", () => {
  const missing = base(); delete missing.capabilities.douyin; assert.throws(() => publishingPreflight(missing), error => error.code === "PUBLISHING_PREFLIGHT_INVALID");
  const staleShape = base(); staleShape.capabilities.tiktok.platform = "douyin"; assert.throws(() => publishingPreflight(staleShape), error => error.code === "PUBLISHING_PREFLIGHT_INVALID");
  assert.throws(() => publishingPreflight({ ...base(), destinations: ["unknown"] }), error => error.code === "PUBLISHING_PREFLIGHT_INVALID");
});
