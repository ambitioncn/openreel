import { createHash } from "node:crypto";
import { DomainError } from "./core.js";

export const PUBLISHING_DESTINATIONS = Object.freeze(["tiktok", "douyin", "instagram_reels", "youtube_shorts"]);
const DESTINATIONS = new Set(PUBLISHING_DESTINATIONS);
const clone = value => structuredClone(value);
const characters = value => [...value].length;

function invalid(message) { throw new DomainError("PUBLISHING_PREFLIGHT_INVALID", message, 422); }
function text(value, field, max = 10_000) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || characters(normalized) > max) invalid(`${field} is required and bounded`);
  return normalized;
}
function number(value, field, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) invalid(`${field} is outside the supported range`);
  return value;
}
function stringArray(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.some(item => typeof item !== "string" || !item.trim())) invalid(`${field} must be a string array`);
  return [...new Set(value.map(item => item.trim().toLowerCase()))];
}

function inspectMp4(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16) return false;
  let offset = 0, boxes = 0, hasFtyp = false, hasMedia = false;
  while (offset + 8 <= bytes.length && boxes++ < 10_000) {
    let size = bytes.readUInt32BE(offset), header = 8;
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (!/^[\x20-\x7e]{4}$/.test(type)) return false;
    if (size === 1) { if (offset + 16 > bytes.length) return false; const wide = bytes.readBigUInt64BE(offset + 8); if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return false; size = Number(wide); header = 16; }
    else if (size === 0) size = bytes.length - offset;
    if (size < header || offset + size > bytes.length) return false;
    if (type === "ftyp" && offset === 0 && size >= 16) hasFtyp = true;
    if (type === "moov" || type === "mdat") hasMedia = true;
    offset += size;
  }
  return offset === bytes.length && hasFtyp && hasMedia;
}

function validateAsset(input) {
  const tenantId = text(input.tenantId, "tenantId", 300), asset = input.asset;
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) invalid("asset is required");
  if (text(asset.tenantId, "asset.tenantId", 300) !== tenantId) throw new DomainError("PUBLISHING_ASSET_NOT_FOUND", "publishable asset not found", 404);
  if (asset.role !== "render" || asset.mimeType !== "video/mp4") invalid("asset must be a rendered MP4");
  if (!Buffer.isBuffer(input.bytes) || !input.bytes.length || !inspectMp4(input.bytes)) invalid("asset bytes are not a structurally bounded MP4");
  if (number(asset.byteLength, "asset.byteLength", 1, Number.MAX_SAFE_INTEGER) !== input.bytes.length) invalid("asset byte length does not match stored bytes");
  const expectedDigest = text(asset.sha256, "asset.sha256", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || createHash("sha256").update(input.bytes).digest("hex") !== expectedDigest) invalid("asset digest does not match stored bytes");
  return { id: text(asset.id, "asset.id", 300), tenantId, byteLength: asset.byteLength, sha256: expectedDigest };
}

function validateProbe(probe, byteLength) {
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) invalid("probe is required");
  const result = {
    container: text(probe.container, "probe.container", 20).toLowerCase(),
    videoCodec: text(probe.videoCodec, "probe.videoCodec", 40).toLowerCase(),
    audioCodec: probe.audioCodec === null ? null : text(probe.audioCodec, "probe.audioCodec", 40).toLowerCase(),
    width: number(probe.width, "probe.width", 1, 16_384),
    height: number(probe.height, "probe.height", 1, 16_384),
    durationSeconds: number(probe.durationSeconds, "probe.durationSeconds", 0.01, 86_400),
    frameRate: number(probe.frameRate, "probe.frameRate", 1, 240),
    byteLength: number(probe.byteLength, "probe.byteLength", 1, Number.MAX_SAFE_INTEGER)
  };
  if (result.container !== "mp4" || result.byteLength !== byteLength) invalid("probe does not describe the verified MP4 bytes");
  if (result.audioCodec !== null) result.audioSampleRate = number(probe.audioSampleRate, "probe.audioSampleRate", 8_000, 384_000);
  return result;
}

function validateCapability(platform, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.platform !== platform) invalid(`${platform} capability is missing or mismatched`);
  const observedAt = text(raw.observedAt, `${platform}.observedAt`);
  if (!Number.isFinite(Date.parse(observedAt))) invalid(`${platform}.observedAt is invalid`);
  return {
    platform,
    observedAt,
    canPublish: raw.canPublish === true,
    privacyOptions: stringArray(raw.privacyOptions, `${platform}.privacyOptions`),
    maxDurationSeconds: number(raw.maxDurationSeconds, `${platform}.maxDurationSeconds`, 1, 86_400),
    maxBytes: number(raw.maxBytes, `${platform}.maxBytes`, 1, Number.MAX_SAFE_INTEGER),
    acceptedVideoCodecs: stringArray(raw.acceptedVideoCodecs, `${platform}.acceptedVideoCodecs`),
    acceptedAudioCodecs: stringArray(raw.acceptedAudioCodecs || [], `${platform}.acceptedAudioCodecs`, { allowEmpty: true }),
    minWidth: number(raw.minWidth, `${platform}.minWidth`, 1, 16_384),
    minHeight: number(raw.minHeight, `${platform}.minHeight`, 1, 16_384),
    aspectRatios: (raw.aspectRatios || []).map((ratio, index) => number(ratio, `${platform}.aspectRatios[${index}]`, 0.1, 10)),
    maxFrameRate: number(raw.maxFrameRate, `${platform}.maxFrameRate`, 1, 240),
    titleMaxChars: number(raw.titleMaxChars, `${platform}.titleMaxChars`, 1, 10_000),
    copyMaxChars: number(raw.copyMaxChars, `${platform}.copyMaxChars`, 1, 100_000),
    maxHashtags: number(raw.maxHashtags, `${platform}.maxHashtags`, 0, 1_000)
  };
}

function hashtags(copy) {
  return [...copy.matchAll(/(^|\s)#([^#\s]+)/gu)].map(match => match[2]);
}

export function publishingPreflight(input = {}) {
  const asset = validateAsset(input), probe = validateProbe(input.probe, asset.byteLength), metadata = { title: text(input.metadata?.title, "metadata.title"), copy: text(input.metadata?.copy, "metadata.copy", 100_000), privacy: text(input.metadata?.privacy, "metadata.privacy", 100) };
  if (!Array.isArray(input.destinations) || !input.destinations.length) invalid("destinations are required");
  const destinations = [...new Set(input.destinations)];
  if (destinations.some(platform => !DESTINATIONS.has(platform))) invalid("destination is unsupported");
  const results = destinations.map(platform => {
    const capability = validateCapability(platform, input.capabilities?.[platform]), blockers = [], adaptations = [], ratio = probe.width / probe.height;
    if (!capability.canPublish) blockers.push({ code: "account_cannot_publish" });
    if (asset.byteLength > capability.maxBytes) blockers.push({ code: "video_too_large", actual: asset.byteLength, maximum: capability.maxBytes });
    if (probe.durationSeconds > capability.maxDurationSeconds) blockers.push({ code: "video_too_long", actual: probe.durationSeconds, maximum: capability.maxDurationSeconds });
    if (!capability.acceptedVideoCodecs.includes(probe.videoCodec)) blockers.push({ code: "video_codec_unsupported", actual: probe.videoCodec });
    if (probe.audioCodec !== null && !capability.acceptedAudioCodecs.includes(probe.audioCodec)) blockers.push({ code: "audio_codec_unsupported", actual: probe.audioCodec });
    if (probe.width < capability.minWidth || probe.height < capability.minHeight) blockers.push({ code: "video_resolution_too_small", actual: `${probe.width}x${probe.height}` });
    if (probe.frameRate > capability.maxFrameRate) blockers.push({ code: "frame_rate_too_high", actual: probe.frameRate, maximum: capability.maxFrameRate });
    if (capability.aspectRatios.length && !capability.aspectRatios.some(allowed => Math.abs(allowed - ratio) <= 0.02)) blockers.push({ code: "aspect_ratio_unsupported", actual: ratio });
    if (!capability.privacyOptions.includes(metadata.privacy.toLowerCase())) blockers.push({ code: "privacy_unavailable", actual: metadata.privacy });
    const proposed = clone(metadata), counts = { title: characters(metadata.title), copy: characters(metadata.copy), hashtags: hashtags(metadata.copy).length };
    if (counts.title > capability.titleMaxChars) adaptations.push({ field: "title", code: "title_truncation", fromChars: counts.title, toChars: capability.titleMaxChars, proposed: [...metadata.title].slice(0, capability.titleMaxChars).join("") });
    if (counts.copy > capability.copyMaxChars) adaptations.push({ field: "copy", code: "copy_truncation", fromChars: counts.copy, toChars: capability.copyMaxChars, proposed: [...metadata.copy].slice(0, capability.copyMaxChars).join("") });
    if (counts.hashtags > capability.maxHashtags) blockers.push({ code: "too_many_hashtags", actual: counts.hashtags, maximum: capability.maxHashtags });
    for (const adaptation of adaptations) proposed[adaptation.field] = adaptation.proposed;
    const status = blockers.length ? "blocked" : adaptations.length ? "adaptation_required" : "passed";
    return Object.freeze({ platform, status, blockers: Object.freeze(blockers), adaptations: Object.freeze(adaptations), proposedMetadata: status === "adaptation_required" ? Object.freeze(proposed) : null, capabilityObservedAt: capability.observedAt });
  });
  return Object.freeze({ schema: "openreel-publishing-preflight/v1", asset: Object.freeze(asset), probe: Object.freeze(probe), metadata: Object.freeze(metadata), accepted: results.every(result => result.status === "passed"), results: Object.freeze(results) });
}
