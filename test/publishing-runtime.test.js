import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductionPublishingRuntime } from "../src/publishing-runtime.js";

const principal = { tenantId: "owner-1", accountId: "owner-1" }, bytes = Buffer.from("tenant-rendered-mp4"), sha256 = createHash("sha256").update(bytes).digest("hex"), revisionIdentity = { schema: "openreel-revision-identity/v1", projectId: "project-1", projectVersion: 3, storyVersion: 1, storyboardVersion: 2, shotId: null, origin: "fresh" };
function fixture() {
  const stateRoot = mkdtempSync(join(tmpdir(), "openreel-publishing-runtime-")), oauth = { accessToken: async () => { throw new Error("token access is forbidden during preflight"); }, accounts: ({ tenantId }) => tenantId === principal.tenantId ? [{ platform: "youtube_shorts", status: "connected", accountId: "binding-1", canPublish: true }] : [] }, store = { assetContent(projectId, assetId, _session, actorId) { if (projectId !== "project-1" || assetId !== "asset-1" || actorId !== principal.tenantId) throw new Error("scope escaped"); return { manifest: { role: "render", mimeType: "video/mp4", byteLength: bytes.length, metadata: { identity: revisionIdentity } }, bytes }; } };
  const policies = { shot: { threshold: 0.8, dimensions: ["intent", "beat", "composition", "visual_identity_consistency", "performance_naturalness"] }, final: { threshold: 0.8, dimensions: ["story", "pacing", "continuity"] } };
  const qualified = { status: "succeeded", ownerId: principal.accountId, input: { projectId: "project-1", projectVersion: 3, storyVersion: 1, storyboardVersion: 2 }, result: { status: "qualified", qualificationStatus: "approved", releaseEligible: true, quality: { schema: "openreel-commercial-quality-result/v2", accepted: true, releaseEligible: true, shots: [{ accepted: true, creativePolicy: policies.shot }], final: { accepted: true, releaseEligible: true, directorPolicy: policies.final, evidence: { assetId: "asset-1", sha256 } } } } };
  const commercialJobs = { listOwned: ownerId => ownerId === principal.accountId ? [structuredClone(qualified)] : [] };
  return { stateRoot, store, oauth, qualified, commercialJobs, runtime: createProductionPublishingRuntime({ stateRoot, store, oauth, commercialJobs, request: async () => { throw new Error("provider call is forbidden during preflight"); } }) };
}

test("production publishing runtime durably preflights only a tenant-owned reviewed YouTube MP4", async () => {
  const { stateRoot, runtime } = fixture(), batch = runtime.create(principal, { projectId: "project-1", assetId: "asset-1", assetSha256: sha256, revisionIdentity, intentKey: "reviewed-v1", title: "Short", copy: "Description", destinations: [{ platform: "youtube_shorts", accountId: "binding-1", metadata: { privacy: "private", madeForKids: false } }] }), checked = await runtime.validate(principal, batch.id);
  assert.equal(checked.summary.counts.awaiting_confirmation, 1); assert.deepEqual(readdirSync(stateRoot).sort(), ["batches.json", "douyin-jobs.json", "instagram_reels-jobs.json", "tiktok-jobs.json", "youtube_shorts-jobs.json"]);
});

test("production publishing runtime fails closed on missing project, foreign account and disabled platform", async () => {
  const { runtime } = fixture();
  for (const [index, change] of [{ projectId: null }, { accountId: "foreign" }, { platform: "tiktok", accountId: "binding-1" }].entries()) {
    const destination = { platform: "youtube_shorts", accountId: "binding-1", metadata: { privacy: "private", madeForKids: false }, ...change }, batch = runtime.create(principal, { projectId: change.projectId === null ? undefined : "project-1", assetId: "asset-1", assetSha256: sha256, revisionIdentity, intentKey: `negative-${index}`, title: "Short", copy: "Description", destinations: [destination] }), checked = await runtime.validate(principal, batch.id);
    assert.equal(checked.summary.counts.failed, 1);
  }
});

test("production publishing runtime preflights TikTok against live creator capabilities", async () => {
  const base = fixture(), stateRoot = mkdtempSync(join(tmpdir(), "openreel-tiktok-runtime-")), oauth = { accessToken: async () => "token", accounts: () => [{ platform: "tiktok", status: "connected", accountId: "tiktok-1", canPublish: true }] }, runtime = createProductionPublishingRuntime({ stateRoot, store: base.store, oauth, commercialJobs: base.commercialJobs, request: async url => { assert.match(url, /open\.tiktokapis\.com/); return new Response(JSON.stringify({ data: { creator_nickname: "Creator", privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 60 }, error: { code: "ok" } }), { status: 200, headers: { "content-type": "application/json" } }); } });
  const batch = runtime.create(principal, { projectId: "project-1", assetId: "asset-1", assetSha256: sha256, revisionIdentity, intentKey: "tiktok-reviewed-v1", title: "Short", copy: "Description", destinations: [{ platform: "tiktok", accountId: "tiktok-1", metadata: { privacy: "SELF_ONLY", allowComment: true, allowDuet: false, allowStitch: false } }] }), checked = await runtime.validate(principal, batch.id);
  assert.equal(checked.summary.counts.awaiting_confirmation, 1, JSON.stringify(checked));
});

test("production publishing runtime fails closed on missing, rejected, stale or ambiguous commercial quality evidence without provider calls", async () => {
  const mutations = [
    () => [],
    job => [{ ...job, status: "failed", result: { ...job.result, status: "quality_failed", qualificationStatus: "rejected", releaseEligible: false } }],
    job => [{ ...job, input: { ...job.input, storyboardVersion: 1 } }],
    job => [job, structuredClone(job)]
  ];
  for (const [index, mutate] of mutations.entries()) {
    const value = fixture(); value.commercialJobs.listOwned = () => mutate(value.qualified);
    const runtime = createProductionPublishingRuntime({ stateRoot: mkdtempSync(join(tmpdir(), "openreel-quality-gate-")), store: value.store, oauth: value.oauth, commercialJobs: value.commercialJobs, request: async () => { throw new Error("provider call is forbidden during rejected quality preflight"); } });
    const batch = runtime.create(principal, { projectId: "project-1", assetId: "asset-1", assetSha256: sha256, revisionIdentity, intentKey: `quality-negative-${index}`, title: "Short", copy: "Description", destinations: [{ platform: "youtube_shorts", accountId: "binding-1", metadata: { privacy: "private", madeForKids: false } }] });
    const checked = await runtime.validate(principal, batch.id); assert.equal(checked.summary.counts.failed, 1);
  }
});

test("production publishing preflight rejects stale or foreign render identity", async () => {
  for (const [index, identity] of [{ ...revisionIdentity, storyboardVersion: 1 }, { ...revisionIdentity, projectId: "project-2" }].entries()) {
    const { runtime } = fixture(), batch = runtime.create(principal, { projectId: "project-1", assetId: "asset-1", assetSha256: sha256, revisionIdentity: identity, intentKey: `identity-negative-${index}`, title: "Short", copy: "Description", destinations: [{ platform: "youtube_shorts", accountId: "binding-1", metadata: { privacy: "private", madeForKids: false } }] }), checked = await runtime.validate(principal, batch.id);
    assert.equal(checked.summary.counts.failed, 1);
  }
});
