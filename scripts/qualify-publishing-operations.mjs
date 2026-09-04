#!/usr/bin/env node
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublishingOAuth } from "../src/publishing-oauth.js";
import { createFilePublishingJobStore, createPublishingLifecycle } from "../src/publishing-lifecycle.js";
import { createFilePublishingBatchStore, createPublishingOrchestrator, PUBLISHING_PLATFORMS } from "../src/publishing-orchestration.js";

const root = mkdtempSync(join(tmpdir(), "openreel-publishing-ops-")), live = join(root, "live"), backup = join(root, "backup"), restored = join(root, "restored");
mkdirSync(live, { recursive: true, mode: 0o700 });
const principal = { tenantId: "ops-tenant", accountId: "ops-owner" }, masterKey = Buffer.alloc(32, 9);
const oauth = createPublishingOAuth({ masterKey, allowedRedirectUris: { tiktok: ["https://openreel.invalid/oauth/tiktok"] }, bytes: size => Buffer.alloc(size, 5), now: () => "2026-08-21T00:00:00.000Z" });
oauth.begin({ ...principal, actorId: principal.accountId, platform: "tiktok", redirectUri: "https://openreel.invalid/oauth/tiktok", returnPath: "/publish" });
writeFileSync(join(live, "oauth.json"), `${JSON.stringify(oauth.snapshot())}\n`, { mode: 0o600 });

function build(directory) {
  let id = 0;
  const lifecycles = Object.fromEntries(PUBLISHING_PLATFORMS.map(platform => [platform, createPublishingLifecycle({
    store: createFilePublishingJobStore(join(directory, `${platform}-jobs.json`)), id: () => `${platform}-job-${++id}`,
    validate: async () => ({ accepted: true }), adapter: { upload: async () => ({}), reconcile: async () => ({ status: "ready" }), publish: async () => ({}) }
  })]));
  return createPublishingOrchestrator({ lifecycles, store: createFilePublishingBatchStore(join(directory, "batches.json")), id: () => "ops-batch" });
}

const input = { assetId: "rendered-mp4", assetSha256: "a".repeat(64), intentKey: "ops-drill", title: "Operations drill", copy: "Local-only publishing recovery qualification", destinations: PUBLISHING_PLATFORMS.map(platform => ({ platform, accountId: `${platform}-account` })) };
const created = build(live).create(principal, input);
cpSync(live, backup, { recursive: true, errorOnExist: true });
cpSync(backup, restored, { recursive: true, errorOnExist: true });
const recovered = build(restored), replay = recovered.create(principal, input);
assert.equal(replay.id, created.id); assert.equal(replay.destinations.length, 4);
const oauthSnapshot = JSON.parse(readFileSync(join(restored, "oauth.json"), "utf8"));
assert.equal(oauthSnapshot.schema, "openreel-publishing-oauth/v1");
assert.doesNotMatch(JSON.stringify(oauthSnapshot), /accessToken|refreshToken/);
assert.match(readFileSync(new URL("../deploy/openreel.env.example", import.meta.url), "utf8"), /OPENREEL_PUBLISHING_STATE=\/var\/lib\/openreel\/publishing/);
const reconcilerService = readFileSync(new URL("../deploy/openreel-publishing-reconciler.service", import.meta.url), "utf8"), reconcilerTimer = readFileSync(new URL("../deploy/openreel-publishing-reconciler.timer", import.meta.url), "utf8");
assert.match(reconcilerService, /publishing-reconciler\.mjs/); assert.match(reconcilerService, /ReadWritePaths=\/var\/lib\/openreel\/publishing/); assert.match(reconcilerTimer, /OnUnitInactiveSec=1min/);
console.log(JSON.stringify({ status: "passed", isolated: true, destinations: replay.destinations.length, idempotentRecovery: true, encryptedOAuthSnapshot: true, workerTopology: "systemd-timer-plan-only", externalActions: 0 }));
