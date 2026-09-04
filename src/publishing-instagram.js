import { DomainError } from "./core.js";

const API = "https://graph.facebook.com/v23.0";

const required = (value, field, max = 2_000) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new DomainError("INSTAGRAM_PUBLISH_INVALID", `${field} is required`, 422);
  return normalized;
};

function failure(response, fallback = "INSTAGRAM_API_FAILED") {
  const status = Number(response?.status) || 502;
  const platform = response?.body?.error || {};
  const code = String(platform.code || platform.error_subcode || fallback);
  const error = new DomainError(code, "Instagram publishing request failed", status);
  if (status === 401 || status === 403 || [10, 190, 200].includes(Number(platform.code))) error.category = "auth";
  else if (status === 429 || [4, 17, 32, 613].includes(Number(platform.code))) { error.category = "quota"; error.retryAfterMs = Number(response?.retryAfterMs) || undefined; }
  else if (status >= 500 || platform.is_transient === true) error.category = "transient";
  else if (/policy|copyright|permission|rejected|blocked/i.test(`${platform.type || ""} ${platform.message || ""}`)) error.category = "policy";
  else error.category = "permanent";
  return error;
}

export function createInstagramPublishingAdapter({ request, accessToken, instagramUserId, prepareMediaUrl } = {}) {
  if (typeof request !== "function" || typeof prepareMediaUrl !== "function") throw new DomainError("INSTAGRAM_PUBLISH_CONFIG_INVALID", "Instagram transport and media URL provider are required", 503);
  const token = required(accessToken, "accessToken", 16_000), account = required(instagramUserId, "instagramUserId", 1_000);
  const call = async (path, options = {}) => {
    const response = await request(`${API}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    if (!response || response.status < 200 || response.status >= 300 || response.body?.error) throw failure(response);
    return response.body || {};
  };

  return Object.freeze({
    async discoverCapabilities() {
      const data = await call(`/${encodeURIComponent(account)}?fields=id,username,account_type,media_count`, { method: "GET" });
      const accountType = required(data.account_type, "account_type").toUpperCase();
      if (!['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(accountType)) throw new DomainError("INSTAGRAM_ACCOUNT_INELIGIBLE", "Instagram publishing requires an eligible professional account", 422);
      return {
        platform: "instagram_reels", instagramUserId: required(data.id, "id"), displayName: required(data.username, "username"),
        accountType, canPublish: true, media: { containers: ["mp4", "mov"], maxDurationSeconds: 900 }, privacyOptions: ["account_default"]
      };
    },

    async upload(job) {
      const media = await prepareMediaUrl(job.input.assetId, job.tenantId);
      const videoUrl = required(media?.url, "video_url", 8_000);
      let parsed;
      try { parsed = new URL(videoUrl); } catch { throw new DomainError("INSTAGRAM_MEDIA_URL_INVALID", "Instagram media URL is invalid", 422); }
      if (parsed.protocol !== "https:" || media?.publiclyReachable !== true || media?.expiresAt <= Date.now()) throw new DomainError("INSTAGRAM_MEDIA_URL_UNSAFE", "Instagram requires a currently reachable HTTPS media URL", 422);
      const metadata = job.input.metadata || {};
      const body = new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption: required(metadata.copy || metadata.title, "caption") });
      if (metadata.shareToFeed != null) body.set("share_to_feed", String(metadata.shareToFeed === true));
      const created = await call(`/${encodeURIComponent(account)}/media`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      return { containerId: required(created.id, "container id"), mediaUrlExpiresAt: media.expiresAt };
    },

    async reconcile(job) {
      const containerId = required(job.remote?.containerId, "containerId");
      const data = await call(`/${encodeURIComponent(containerId)}?fields=id,status_code,status`, { method: "GET" });
      const status = String(data.status_code || "").toUpperCase();
      if (["IN_PROGRESS", "PUBLISHED"].includes(status)) return { status: status === "PUBLISHED" ? "published" : "processing", containerId, remoteId: status === "PUBLISHED" ? containerId : null };
      if (status === "FINISHED") return { status: "ready_to_publish", containerId };
      if (["ERROR", "EXPIRED"].includes(status)) throw failure({ status: 422, body: { error: { code: `INSTAGRAM_CONTAINER_${status}`, message: data.status || status } } });
      throw Object.assign(new Error("unrecognized Instagram container status"), { remoteOutcomeUnknown: true, code: "INSTAGRAM_STATUS_UNKNOWN" });
    },

    async publish(job) {
      const containerId = required(job.remote?.containerId, "containerId");
      const state = await this.reconcile(job);
      if (state.status === "published") return state;
      if (state.status !== "ready_to_publish") throw Object.assign(new Error("Instagram container is not ready"), { remoteOutcomeUnknown: true, code: "INSTAGRAM_PUBLISH_PENDING" });
      let data;
      try {
        data = await call(`/${encodeURIComponent(account)}/media_publish`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: containerId }).toString() });
      } catch (error) {
        if (error.category === "transient") error.remoteOutcomeUnknown = true;
        throw error;
      }
      return { status: "published", containerId, remoteId: required(data.id, "published media id") };
    }
  });
}
