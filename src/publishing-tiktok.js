import { DomainError } from "./core.js";

const API = "https://open.tiktokapis.com";
const required = (value, field, max = 2_000) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new DomainError("TIKTOK_PUBLISH_INVALID", `${field} is required`, 422);
  return normalized;
};

function failure(response, fallback = "TIKTOK_API_FAILED") {
  const status = Number(response?.status) || 502;
  const code = response?.body?.error?.code || fallback;
  const error = new DomainError(code, "TikTok publishing request failed", status);
  if (status === 401 || status === 403) error.category = "auth";
  else if (status === 429) { error.category = "quota"; error.retryAfterMs = Number(response?.retryAfterMs) || undefined; }
  else if (status >= 500) error.category = "transient";
  else if (/spam|policy|moderation|audit/i.test(code)) error.category = "policy";
  else error.category = "permanent";
  return error;
}

export function createTikTokPublishingAdapter({ request, accessToken, readAsset } = {}) {
  if (typeof request !== "function" || typeof readAsset !== "function") throw new DomainError("TIKTOK_PUBLISH_CONFIG_INVALID", "TikTok transport and asset reader are required", 503);
  required(accessToken, "accessToken", 16_000);
  const call = async (path, options = {}) => {
    const response = await request(`${API}${path}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8", ...(options.headers || {}) } });
    if (!response || response.status < 200 || response.status >= 300 || response.body?.error?.code && response.body.error.code !== "ok") throw failure(response);
    return response.body?.data || {};
  };

  return Object.freeze({
    async discoverCapabilities() {
      const data = await call("/v2/post/publish/creator_info/query/", { method: "POST", body: "{}" });
      return {
        platform: "tiktok", displayName: required(data.creator_nickname, "creator_nickname"),
        canPublish: Array.isArray(data.privacy_level_options) && data.privacy_level_options.length > 0,
        privacyOptions: [...(data.privacy_level_options || [])], maxDurationSeconds: Number(data.max_video_post_duration_sec) || 0,
        interactions: { comment: data.comment_disabled !== true, duet: data.duet_disabled !== true, stitch: data.stitch_disabled !== true }
      };
    },
    async upload(job) {
      const asset = await readAsset(job.input.assetId, job.tenantId);
      if (!Buffer.isBuffer(asset?.bytes) || asset.bytes.length === 0) throw new DomainError("TIKTOK_ASSET_INVALID", "TikTok asset bytes are unavailable", 422);
      const metadata = job.input.metadata || {};
      const init = await call("/v2/post/publish/video/init/", { method: "POST", body: JSON.stringify({
        post_info: { title: required(metadata.copy || metadata.title, "publish copy"), privacy_level: required(metadata.privacy, "privacy"), disable_comment: metadata.allowComment === false, disable_duet: metadata.allowDuet === false, disable_stitch: metadata.allowStitch === false },
        source_info: { source: "FILE_UPLOAD", video_size: asset.bytes.length, chunk_size: asset.bytes.length, total_chunk_count: 1 }
      }) });
      const publishId = required(init.publish_id, "publish_id"), uploadUrl = required(init.upload_url, "upload_url");
      const transfer = await request(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(asset.bytes.length), "Content-Range": `bytes 0-${asset.bytes.length - 1}/${asset.bytes.length}` }, body: asset.bytes });
      if (!transfer || transfer.status < 200 || transfer.status >= 300) { const error = failure(transfer, "TIKTOK_UPLOAD_FAILED"); error.remoteOutcomeUnknown = transfer == null || transfer.status >= 500; throw error; }
      return { publishId };
    },
    async reconcile(job) {
      const publishId = required(job.remote?.publishId, "publishId");
      const data = await call("/v2/post/publish/status/fetch/", { method: "POST", body: JSON.stringify({ publish_id: publishId }) });
      const status = String(data.status || "").toUpperCase();
      if (["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD", "SEND_TO_USER_INBOX"].includes(status)) return { status: "processing", publishId };
      if (status === "PUBLISH_COMPLETE") return { status: "published", publishId, remoteId: data.publicly_available_post_id?.[0] || data.publicaly_available_post_id?.[0] || null };
      if (status === "FAILED") throw failure({ status: 422, body: { error: { code: data.fail_reason || "TIKTOK_PUBLISH_FAILED" } } });
      throw Object.assign(new Error("unrecognized TikTok publish status"), { remoteOutcomeUnknown: true, code: "TIKTOK_STATUS_UNKNOWN" });
    },
    async publish(job) {
      const result = await this.reconcile(job);
      if (result.status !== "published") throw Object.assign(new Error("TikTok publication is not complete"), { remoteOutcomeUnknown: true, code: "TIKTOK_PUBLISH_PENDING" });
      return result;
    }
  });
}
