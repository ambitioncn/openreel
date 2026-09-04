import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "./core.js";
import { createFilePublishingJobStore, createPublishingLifecycle } from "./publishing-lifecycle.js";
import { createFilePublishingBatchStore, createPublishingOrchestrator, PUBLISHING_PLATFORMS } from "./publishing-orchestration.js";
import { createYouTubePublishingAdapter } from "./publishing-youtube.js";
import { createTikTokPublishingAdapter } from "./publishing-tiktok.js";
import { requireCommercialRelease } from "./commercial-release-gate.js";

const unavailable = () => { throw Object.assign(new Error("publishing platform is unavailable"), { category: "permanent", code: "PUBLISHING_PLATFORM_UNAVAILABLE", status: 503 }); };
const initialize = (path, value) => { try { writeFileSync(path, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o640 }); } catch (error) { if (error.code !== "EEXIST") throw error; } };
const sameRevisionIdentity = (actual, expected) => ["schema", "projectId", "projectVersion", "storyVersion", "storyboardVersion", "shotId", "origin"].every(field => actual?.[field] === expected?.[field]);

export function createProductionPublishingRuntime({ stateRoot, store, oauth, commercialJobs, request = fetch } = {}) {
  if (typeof stateRoot !== "string" || !stateRoot.startsWith("/") || !store?.assetContent || !oauth?.accessToken || !commercialJobs?.listOwned) throw new DomainError("PUBLISHING_RUNTIME_CONFIG_INVALID", "publishing runtime dependencies are unavailable", 503);
  mkdirSync(stateRoot, { recursive: true, mode: 0o750 });
  const requestJson = async (url, options) => { const response = await request(url, options); let body = {}; try { body = await response.json(); } catch {} return { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) }; };
  const asset = (job) => {
    if (!job.input.projectId) throw new DomainError("PUBLISHING_PROJECT_REQUIRED", "publishing project is required", 422);
    const value = store.assetContent(job.input.projectId, job.input.assetId, undefined, job.tenantId), digest = createHash("sha256").update(value.bytes).digest("hex");
    const identity = value.manifest.metadata?.identity;
    if (value.manifest.role !== "render" || value.manifest.mimeType !== "video/mp4" || value.manifest.byteLength !== value.bytes.length || digest !== job.input.assetSha256 || identity?.schema !== "openreel-revision-identity/v1" || identity.projectId !== job.input.projectId || identity.shotId !== null || !sameRevisionIdentity(identity, job.input.revisionIdentity)) throw new DomainError("PUBLISHING_ASSET_INVALID", "tenant-owned revision-bound rendered MP4 verification failed", 422);
    return value;
  };
  const commercialRelease = job => requireCommercialRelease({ commercialJobs, ownerId: job.tenantId, projectId: job.input.projectId, assetId: job.input.assetId, assetSha256: job.input.assetSha256, revisionIdentity: job.input.revisionIdentity });
  const youtube = async job => createYouTubePublishingAdapter({ request: requestJson, accessToken: await oauth.accessToken(job.tenantId, job.input.accountId), readAsset: async () => asset(job) });
  const tiktok = async job => createTikTokPublishingAdapter({ request: requestJson, accessToken: await oauth.accessToken(job.tenantId, job.input.accountId), readAsset: async () => asset(job) });
  const adapters = Object.fromEntries(PUBLISHING_PLATFORMS.map(platform => [platform, platform === "youtube_shorts" ? {
    async upload(job, options) { return (await youtube(job)).upload(job, options); },
    async reconcile(job) { return (await youtube(job)).reconcile(job); },
    async publish(job, options) { return (await youtube(job)).publish(job, options); }
  } : platform === "tiktok" ? { async upload(job, options) { return (await tiktok(job)).upload(job, options); }, async reconcile(job) { return (await tiktok(job)).reconcile(job); }, async publish(job, options) { return (await tiktok(job)).publish(job, options); } } : { upload: unavailable, reconcile: unavailable, publish: unavailable }]));
  const lifecycles = {};
  for (const platform of PUBLISHING_PLATFORMS) {
    const path = join(stateRoot, `${platform}-jobs.json`); initialize(path, { schema: "openreel-publishing-job-store/v1", jobs: [] });
    lifecycles[platform] = createPublishingLifecycle({ store: createFilePublishingJobStore(path), adapter: adapters[platform], validate: async input => {
      if (!["tiktok", "youtube_shorts"].includes(platform)) return { accepted: false };
      const binding = oauth.accounts({ tenantId: input.tenantId }).find(item => item.accountId === input.accountId && item.canPublish);
      if (!binding || binding.platform !== platform) throw new DomainError("PUBLISHING_ACCOUNT_NOT_FOUND", `active ${platform} publishing account not found`, 404);
      asset({ tenantId: input.tenantId, input });
      commercialRelease({ tenantId: input.tenantId, input });
      const metadata = input.metadata || {};
      if (platform === "tiktok") { const capabilities = await (await tiktok({ tenantId: input.tenantId, input })).discoverCapabilities(); if (!capabilities.canPublish || !capabilities.privacyOptions.includes(metadata.privacy)) throw new DomainError("TIKTOK_PUBLISH_INVALID", "TikTok privacy or creator capability is unavailable", 422); return { accepted: true, platform, accountId: input.accountId, assetSha256: input.assetSha256 }; }
      if (typeof metadata.title !== "string" || !metadata.title.trim() || [...metadata.title.trim()].length > 100 || typeof metadata.copy !== "string" || [...metadata.copy].length > 5_000 || !["private", "unlisted", "public"].includes(metadata.privacy) || typeof metadata.madeForKids !== "boolean") throw new DomainError("YOUTUBE_PUBLISH_INVALID", "YouTube metadata is invalid", 422);
      return { accepted: true, platform, accountId: input.accountId, assetSha256: input.assetSha256 };
    } });
  }
  const batchPath = join(stateRoot, "batches.json"); initialize(batchPath, { schema: "openreel-publishing-batch-store/v1", batches: [] });
  return createPublishingOrchestrator({ lifecycles, store: createFilePublishingBatchStore(batchPath) });
}
