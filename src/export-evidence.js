import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const exactKeys = (value, expected, label) => {
  assert.equal(value && typeof value, "object", `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields are invalid`);
};

export function validateLocalExportEvidence(packet) {
  exactKeys(packet, ["rendered", "replay", "edl", "bytes"], "export evidence packet");
  const { rendered, replay, edl } = packet;
  assert.ok(Buffer.isBuffer(packet.bytes) && packet.bytes.length > 12, "export bytes must be a non-empty Buffer");
  assert.equal(packet.bytes.subarray(4, 8).toString("ascii"), "ftyp", "export bytes are not an MP4 container");
  for (const [label, result] of [["rendered", rendered], ["replay", replay]]) {
    assert.equal(result.schema, "openreel-render/v1", `${label} schema is invalid`);
    assert.equal(result.format, "mp4", `${label} format is invalid`);
    assert.equal(result.quality, "preview-360p", `${label} quality is invalid`);
    assert.equal(result.playable, true, `${label} must be playable`);
    assert.equal(result.productionReady, false, `${label} must not claim production readiness`);
    assert.deepEqual(result.limits, { maxClips: 100, maxDuration: 600 }, `${label} limits are invalid`);
    assert.ok(result.duration > 0 && result.duration <= result.limits.maxDuration, `${label} duration is outside limits`);
    assert.match(result.sha256, /^[a-f0-9]{64}$/, `${label} digest is invalid`);
    assert.match(result.inputDigest, /^[a-f0-9]{64}$/, `${label} input digest is invalid`);
    assert.match(result.boundary, /local preview/i, `${label} boundary must remain local-preview only`);
  }
  assert.equal(rendered.replayed, false, "initial export must not be marked as replayed");
  assert.equal(replay.replayed, true, "second export must be a deterministic replay");
  assert.equal(replay.asset.id, rendered.asset.id, "replay asset identity drifted");
  assert.equal(replay.sha256, rendered.sha256, "replay output digest drifted");
  assert.equal(replay.inputDigest, rendered.inputDigest, "replay input digest drifted");
  assert.equal(replay.duration, rendered.duration, "replay duration drifted");
  assert.equal(rendered.asset.mimeType, "video/mp4", "rendered asset MIME is invalid");
  assert.equal(rendered.asset.byteLength, packet.bytes.length, "rendered asset byte length drifted");
  assert.equal(createHash("sha256").update(packet.bytes).digest("hex"), rendered.sha256, "rendered asset digest drifted");
  assert.equal(edl.schema, "openreel-edl/v1", "EDL schema is invalid");
  assert.ok(edl.preview.clipCount > 0 && edl.preview.clipCount <= rendered.limits.maxClips, "EDL clip count is outside limits");
  assert.equal(edl.preview.duration, rendered.duration, "EDL duration drifted from render");
  const clips = edl.tracks.flatMap(track => track.clips.map(clip => ({ ...clip, trackKind: track.kind })));
  assert.equal(clips.length, edl.preview.clipCount, "EDL clip count does not match tracks");
  assert.ok(clips.some(clip => clip.trackKind === "video"), "EDL lacks a video clip");
  for (const track of edl.tracks) {
    for (let index = 1; index < track.clips.length; index++) assert.ok(track.clips[index].start >= track.clips[index - 1].start, "EDL clips are not ordered by start time");
  }
  return Object.freeze({ status: "verified", assetId: rendered.asset.id, sha256: rendered.sha256, inputDigest: rendered.inputDigest, clipCount: clips.length, duration: rendered.duration, hasAudio: rendered.hasAudio, productionReady: false });
}
