import { DomainError } from "./core.js";

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";

const required = (value, field, max = 2_000) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new DomainError("YOUTUBE_PUBLISH_INVALID", `${field} is required`, 422);
  return normalized;
};

function failure(response, fallback = "YOUTUBE_API_FAILED") {
  const status = Number(response?.status) || 502;
  const platform = response?.body?.error || {};
  const reason = platform.errors?.[0]?.reason || platform.status || fallback;
  const error = new DomainError(String(reason), "YouTube publishing request failed", status);
  if (status === 401 || status === 403 && /auth|credential|permission|scope/i.test(`${reason} ${platform.message || ""}`)) error.category = "auth";
  else if (status === 429 || /quota|rateLimit/i.test(reason)) { error.category = "quota"; error.retryAfterMs = Number(response?.retryAfterMs) || undefined; }
  else if (status >= 500) error.category = "transient";
  else if (/copyright|policy|rejected|forbidden|madeForKids/i.test(`${reason} ${platform.message || ""}`)) error.category = "policy";
  else error.category = "permanent";
  return error;
}

export function createYouTubePublishingAdapter({ request, accessToken, readAsset } = {}) {
  if (typeof request !== "function" || typeof readAsset !== "function") throw new DomainError("YOUTUBE_PUBLISH_CONFIG_INVALID", "YouTube transport and asset reader are required", 503);
  const token = required(accessToken, "accessToken", 16_000);
  const call = async (url, options = {}) => {
    const response = await request(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    if (!response || response.status < 200 || response.status >= 300 || response.body?.error) throw failure(response);
    return response;
  };

  return Object.freeze({
    async discoverCapabilities() {
      const response = await call(`${API}/channels?part=id,snippet,status&mine=true`, { method: "GET" });
      const channels = response.body?.items;
      if (!Array.isArray(channels) || channels.length !== 1) throw new DomainError("YOUTUBE_CHANNEL_INELIGIBLE", "YouTube OAuth identity must resolve to one channel", 422);
      const channel = channels[0];
      return {
        platform: "youtube_shorts", channelId: required(channel.id, "channel id"), displayName: required(channel.snippet?.title, "channel title"),
        canPublish: true, privacyOptions: ["private", "unlisted", "public"], titleMaxChars: 100, copyMaxChars: 5_000,
        audienceRequired: true, media: { containers: ["mp4"], classification: "YouTube determines Shorts eligibility after upload" }
      };
    },

    async upload(job) {
      const asset = await readAsset(job.input.assetId, job.tenantId);
      if (!Buffer.isBuffer(asset?.bytes) || asset.bytes.length === 0) throw new DomainError("YOUTUBE_ASSET_INVALID", "YouTube asset bytes are unavailable", 422);
      const metadata = job.input.metadata || {};
      const title = required(metadata.title, "title", 100), description = typeof metadata.copy === "string" ? metadata.copy.trim() : "";
      if (description.length > 5_000) throw new DomainError("YOUTUBE_PUBLISH_INVALID", "description exceeds YouTube limit", 422);
      const privacy = required(metadata.privacy, "privacy", 20);
      if (!["private", "unlisted", "public"].includes(privacy)) throw new DomainError("YOUTUBE_PRIVACY_INVALID", "YouTube privacy is invalid", 422);
      if (typeof metadata.madeForKids !== "boolean") throw new DomainError("YOUTUBE_AUDIENCE_REQUIRED", "YouTube audience selection is required", 422);
      const init = await call(`${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`, {
        method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(asset.bytes.length) },
        body: JSON.stringify({ snippet: { title, description }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: metadata.madeForKids } })
      });
      const uploadUrl = required(init.headers?.location || init.headers?.Location, "resumable upload URL", 8_000);
      let parsed;
      try { parsed = new URL(uploadUrl); } catch { throw new DomainError("YOUTUBE_UPLOAD_URL_INVALID", "YouTube resumable upload URL is invalid", 502); }
      if (parsed.protocol !== "https:" || !/(^|\.)googleapis\.com$/.test(parsed.hostname)) throw new DomainError("YOUTUBE_UPLOAD_URL_UNSAFE", "YouTube resumable upload URL is outside the official HTTPS boundary", 502);
      const transfer = await request(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(asset.bytes.length) }, body: asset.bytes });
      if (!transfer || transfer.status < 200 || transfer.status >= 300 || transfer.body?.error) { const error = failure(transfer, "YOUTUBE_UPLOAD_FAILED"); error.remoteOutcomeUnknown = transfer == null || transfer.status >= 500; throw error; }
      return { videoId: required(transfer.body?.id, "video id"), uploadUrl };
    },

    async reconcile(job) {
      const videoId = required(job.remote?.videoId, "videoId");
      const response = await call(`${API}/videos?part=id,status,processingDetails&id=${encodeURIComponent(videoId)}`, { method: "GET" });
      const items = response.body?.items;
      if (!Array.isArray(items) || items.length === 0) return { status: "not_found", videoId };
      const video = items[0], processing = String(video.processingDetails?.processingStatus || "").toLowerCase();
      if (["processing", "terminating"].includes(processing)) return { status: "processing", videoId };
      if (processing === "failed" || video.status?.uploadStatus === "rejected" || video.status?.failureReason || video.status?.rejectionReason) throw failure({ status: 422, body: { error: { errors: [{ reason: video.status?.rejectionReason || video.status?.failureReason || "YOUTUBE_PROCESSING_FAILED" }] } } });
      if (processing === "succeeded" && video.status?.uploadStatus === "processed") return { status: "published", videoId, remoteId: videoId, privacy: video.status?.privacyStatus || null };
      throw Object.assign(new Error("unrecognized YouTube processing status"), { remoteOutcomeUnknown: true, code: "YOUTUBE_STATUS_UNKNOWN" });
    },

    async publish(job) {
      const result = await this.reconcile(job);
      if (result.status !== "published") throw Object.assign(new Error("YouTube publication is not complete"), { remoteOutcomeUnknown: true, code: "YOUTUBE_PUBLISH_PENDING" });
      return result;
    }
  });
}
