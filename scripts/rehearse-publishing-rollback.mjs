#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabaseStore } from "../src/core.js";
import { createSqliteBackend } from "../src/durable.js";
import { createPublishingOAuth } from "../src/publishing-oauth.js";
import { createFilePublishingJobStore, createPublishingLifecycle } from "../src/publishing-lifecycle.js";
import { createFilePublishingBatchStore, createPublishingOrchestrator, PUBLISHING_PLATFORMS } from "../src/publishing-orchestration.js";
import { createBackup, verifyBackup } from "./backup.mjs";

const root = mkdtempSync(join(tmpdir(), "openreel-publishing-rollback-"));
const releases = join(root, "releases"), releaseOne = join(releases, "release-1"), releaseTwo = join(releases, "release-2"), current = join(root, "current");
const live = join(root, "live"), publishing = join(live, "publishing"), backup = join(root, "backup"), rejected = join(root, "rejected"), restored = join(root, "restored");
mkdirSync(releaseOne, { recursive: true }); mkdirSync(releaseTwo); mkdirSync(publishing, { recursive: true, mode: 0o700 });
writeFileSync(join(releaseOne, "release.json"), JSON.stringify({ version: "release-1", compatiblePublishingSchema: 1 }));
writeFileSync(join(releaseTwo, "release.json"), JSON.stringify({ version: "release-2", compatiblePublishingSchema: 2 }));
symlinkSync(releaseOne, current, "dir");

const database = join(live, "openreel.sqlite"), assets = join(live, "assets"), platform = join(live, "platform.json");
const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id: "owner", name: "Owner" }); backend.close();
writeFileSync(platform, JSON.stringify({ schemaVersion:7, accounts:[], sessions:[], teams:[], invites:[], wallets:[], ledger:[], workflows:[], automations:[], objects:[], subscriptions:[], keyApplications:[], apiKeys:[], usageReservations:[], usageLedger:[], usageRefunds:[], collaborativeDocuments:[] }));
const principal = { tenantId: "rollback-tenant", accountId: "rollback-owner" };
const oauth = createPublishingOAuth({ masterKey: Buffer.alloc(32, 7), allowedRedirectUris: { tiktok: ["https://openreel.invalid/oauth/tiktok"] }, bytes: size => Buffer.alloc(size, 3), now: () => "2026-08-21T00:00:00.000Z" });
oauth.begin({ ...principal, actorId: principal.accountId, platform: "tiktok", redirectUri: "https://openreel.invalid/oauth/tiktok", returnPath: "/publish" });
writeFileSync(join(publishing, "oauth.json"), `${JSON.stringify(oauth.snapshot())}\n`, { mode: 0o600 });

let providerCalls = 0;
function orchestrator(directory) {
  const lifecycles = Object.fromEntries(PUBLISHING_PLATFORMS.map(platformName => [platformName, createPublishingLifecycle({
    store: createFilePublishingJobStore(join(directory, `${platformName}-jobs.json`)), id: () => `${platformName}-rollback-job`, validate: async () => ({ accepted: true }),
    adapter: { upload: async () => { providerCalls += 1; throw new Error("provider calls forbidden in rollback rehearsal"); }, reconcile: async () => ({ status: "processing" }), publish: async () => { providerCalls += 1; throw new Error("provider calls forbidden in rollback rehearsal"); } }
  })]));
  return createPublishingOrchestrator({ lifecycles, store: createFilePublishingBatchStore(join(directory, "batches.json")), id: () => "rollback-batch" });
}
const input = { assetId:"rendered-mp4", assetSha256:"b".repeat(64), intentKey:"rollback-drill", title:"Rollback drill", copy:"Local only", destinations:PUBLISHING_PLATFORMS.map(platformName => ({ platform:platformName, accountId:`${platformName}-account` })) };
const created = orchestrator(publishing).create(principal, input);
await createBackup({ database, assets, platform, publishing, destination: backup });

// Simulate a bad release and damaged live publishing state. A tampered backup must fail closed.
unlinkCurrent(); symlinkSync(releaseTwo, current, "dir");
writeFileSync(join(publishing, "batches.json"), "{damaged");
mkdirSync(rejected); for (const name of ["manifest.json", "openreel.sqlite", "platform.json"]) writeFileSync(join(rejected, name), readFileSync(join(backup, name)));
assert.throws(() => verifyBackup({ source: rejected, destination: join(root, "must-not-exist") }), /file set differs|missing|required core|namespace/);
assert.equal(existsSync(join(root, "must-not-exist")), false);

verifyBackup({ source: backup, destination: restored });
unlinkCurrent(); symlinkSync(releaseOne, current, "dir");
assert.equal(JSON.parse(readFileSync(join(current, "release.json"))).version, "release-1");
const recovered = orchestrator(join(restored, "publishing")), replay = recovered.create(principal, input);
assert.equal(replay.id, created.id); assert.equal(replay.destinations.length, 4); assert.equal(providerCalls, 0);
assert.equal(JSON.parse(readFileSync(join(restored, "publishing/oauth.json"))).schema, "openreel-publishing-oauth/v1");
console.log(JSON.stringify({ status:"passed", isolated:true, releaseRollback:"release-2->release-1", restoredPublishingFiles:6, destinations:4, idempotentRecovery:true, rejectedBackupPromotions:1, providerCalls, externalActions:0 }));

function unlinkCurrent() { const old = `${current}.old`; renameSync(current, old); rmSync(old); }
