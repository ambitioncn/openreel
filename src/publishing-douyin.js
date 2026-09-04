import { DomainError } from "./core.js";

const API = "https://open.douyin.com";

const required = (value, field, max = 2_000) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new DomainError("DOUYIN_PUBLISH_INVALID", `${field} is required`, 422);
  return normalized;
};

function failure(response, fallback = "DOUYIN_API_FAILED") {
  const status = Number(response?.status) || 502;
  const platform = response?.body?.data || response?.body || {};
  const code = String(platform.error_code || platform.error?.code || fallback);
  const error = new DomainError(code, "Douyin publishing request failed", status);
  if (status === 401 || status === 403 || /access_token|unauthorized/i.test(code)) error.category = "auth";
  else if (status === 429 || /rate|quota|limit/i.test(code)) { error.category = "quota"; error.retryAfterMs = Number(response?.retryAfterMs) || undefined; }
  else if (status >= 500) error.category = "transient";
  else if (/audit|review|policy|ban|forbid|watermark/i.test(`${code} ${platform.description || ""}`)) error.category = "policy";
  else error.category = "permanent";
  return error;
}

export function createDouyinPublishingAdapter({ request, accessToken, openId, readAsset } = {}) {
  if (typeof request !== "function" || typeof readAsset !== "function") throw new DomainError("DOUYIN_PUBLISH_CONFIG_INVALID", "Douyin transport and asset reader are required", 503);
  const token = required(accessToken, "accessToken", 16_000), account = required(openId, "openId", 1_000);
  const url = (path, extra = {}) => {
    const query = new URLSearchParams({ open_id: account, access_token: token, ...extra });
    return `${API}${path}?${query}`;
  };
  const call = async (path, options = {}, extra = {}) => {
    const response = await request(url(path, extra), options);
    const data = response?.body?.data;
    if (!response || response.status < 200 || response.status >= 300 || Number(data?.error_code || 0) !== 0) throw failure(response);
    return data || {};
  };

  return Object.freeze({
    async discoverCapabilities() {
      const data = await call("/oauth/userinfo/", { method: "GET" });
      return {
        platform: "douyin",
        openId: account,
        displayName: required(data.nickname, "nickname"),
        canPublish: true,
        media: { containers: ["mp4", "webm"], maxDurationSeconds: 900, singleUploadMaxBytes: 128 * 1024 * 1024, multipartMaxBytes: 4 * 1024 * 1024 * 1024 },
        privacyOptions: ["account_default"]
      };
    },

    async upload(job) {
      const asset = await readAsset(job.input.assetId, job.tenantId);
      if (!Buffer.isBuffer(asset?.bytes) || asset.bytes.length === 0) throw new DomainError("DOUYIN_ASSET_INVALID", "Douyin asset bytes are unavailable", 422);
      if (asset.bytes.length > 128 * 1024 * 1024) throw new DomainError("DOUYIN_MULTIPART_REQUIRED", "Douyin assets above 128 MB require the multipart upload flow", 422);
      const uploaded = await call("/video/upload/", { method: "POST", headers: { "Content-Type": "video/mp4", "Content-Length": String(asset.bytes.length) }, body: asset.bytes });
      const videoId = required(uploaded.video?.video_id || uploaded.video_id, "video_id");
      const metadata = job.input.metadata || {};
      const created = await call("/video/create/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_id: videoId, text: required(metadata.copy || metadata.title, "publish copy") }) });
      return { videoId, itemId: required(created.item_id, "item_id") };
    },

    async reconcile(job) {
      const itemId = required(job.remote?.itemId, "itemId");
      const data = await call("/video/data/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_ids: [itemId] }) });
      const item = Array.isArray(data.list) ? data.list.find(candidate => String(candidate.item_id) === itemId) : null;
      if (!item) return { status: "not_found", itemId };
      const status = Number(item.review_status);
      if ([1, 2].includes(status)) return { status: "processing", itemId, videoId: job.remote?.videoId };
      if (status === 3 || item.is_reviewed === true) return { status: "published", itemId, videoId: job.remote?.videoId, remoteId: itemId, remoteUrl: item.share_url || null };
      if ([4, 5].includes(status)) throw failure({ status: 422, body: { data: { error_code: item.review_failure_code || "DOUYIN_REVIEW_REJECTED", description: item.review_failure_reason || "audit rejected" } } });
      throw Object.assign(new Error("unrecognized Douyin publication status"), { remoteOutcomeUnknown: true, code: "DOUYIN_STATUS_UNKNOWN" });
    },

    async publish(job) {
      const result = await this.reconcile(job);
      if (result.status !== "published") throw Object.assign(new Error("Douyin publication is not complete"), { remoteOutcomeUnknown: true, code: "DOUYIN_PUBLISH_PENDING" });
      return result;
    }
  });
}
