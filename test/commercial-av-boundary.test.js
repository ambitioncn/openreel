import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { renderTimelineVideo } from "../src/render.js";
import { composeReviewedCommercialMedia } from "../src/commercial-av-boundary.js";

const run = args => { const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args, "pipe:1"], { encoding: null }); assert.equal(result.status, 0, result.stderr?.toString()); return result.stdout; };
const wav = frequency => run(["-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=1`, "-f", "wav"]);
const png = () => run(["-f", "lavfi", "-i", "color=c=white@0.85:s=320x48", "-frames:v", "1", "-c:v", "png", "-threads", "1", "-f", "image2"]);
const video = () => renderTimelineVideo({ tracks: [{ kind: "video", clips: [{ assetId: "v", inPoint: 0, outPoint: 1, start: 0 }] }] }, 1).bytes;
const binding = { projectId: "p", projectVersion: 2, storyVersion: 3, storyboardVersion: 4 }, identity = { ...binding, shotId: "s1" };
const plan = { schema: "openreel-commercial-composition/v1", duration: 1, timeline: [{ shotId: "s1", start: 0, end: 1, caption: "Reviewed caption" }], audio: { musicGainDb: -18 } };

test("reviewed byte-backed captions and licensed music are burned and mixed into MP4", () => {
  const result = composeReviewedCommercialMedia({ videos: [{ bytes: video(), mimeType: "video/mp4", duration: 1 }], voice: { bytes: wav(440), mimeType: "audio/wav" }, captionArtifacts: [{ shotId: "s1", captionText: "Reviewed caption", reviewed: true, identity, bytes: png(), mimeType: "image/png" }], reviewedMusicArtifact: { identity: { ...binding, shotId: null }, bytes: wav(220), mimeType: "audio/wav", review: { status: "reviewed", sourceDeclaration: "user upload" } }, musicRightsConfirmation: { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: "2026-08-22T00:00:00.000Z" }, plan, binding });
  assert.ok(result.bytes.length > 1_000); assert.equal(result.bytes.subarray(4, 8).toString("ascii"), "ftyp"); assert.equal(result.hasCaptions, true); assert.equal(result.hasMusic, true);
});

test("caption and music boundaries reject stale, mismatched or unreviewed assets", () => {
  const common = { videos: [{ bytes: video(), mimeType: "video/mp4", duration: 1 }], voice: { bytes: wav(440), mimeType: "audio/wav" }, plan, binding };
  assert.throws(() => composeReviewedCommercialMedia({ ...common, captionArtifacts: [] }), error => error.code === "COMMERCIAL_CAPTION_INVALID");
  assert.throws(() => composeReviewedCommercialMedia({ ...common, captionArtifacts: [{ shotId: "s1", captionText: "wrong", reviewed: true, identity, bytes: png(), mimeType: "image/png" }] }), error => error.code === "COMMERCIAL_CAPTION_INVALID");
  assert.throws(() => composeReviewedCommercialMedia({ ...common, captionArtifacts: [{ shotId: "s1", captionText: "Reviewed caption", reviewed: true, identity, bytes: png(), mimeType: "image/png" }], reviewedMusicArtifact: { identity, bytes: wav(220), mimeType: "audio/wav", review: { status: "draft", commercialUsePermitted: true, evidenceRef: "x" } } }), error => error.code === "COMMERCIAL_MUSIC_INVALID");
});

test("corrupt caption media fails closed with a safe renderer diagnostic", () => {
  const corruptPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X6QZ4wAAAABJRU5ErkJggg==", "base64");
  assert.throws(() => composeReviewedCommercialMedia({ videos: [{ bytes: video(), mimeType: "video/mp4", duration: 1 }], voice: { bytes: wav(440), mimeType: "audio/wav" }, captionArtifacts: [{ shotId: "s1", captionText: "Reviewed caption", reviewed: true, identity, bytes: corruptPng, mimeType: "image/png" }], reviewedMusicArtifact: { identity: { ...binding, shotId: null }, bytes: wav(220), mimeType: "audio/wav", review: { status: "reviewed", sourceDeclaration: "user upload" } }, musicRightsConfirmation: { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: "2026-08-22T00:00:00.000Z" }, plan, binding }), error => error.code === "RENDER_FAILED" && error.details.rendererDiagnostic === "RENDER_INPUT_DECODE_FAILED" && /^[a-f0-9]{64}$/.test(error.details.stderrSha256) && error.details.stderr === undefined);
});
