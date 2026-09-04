import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabaseStore } from "../src/core.js";
import { createSqliteBackend } from "../src/durable.js";
import { createBackup, verifyBackup } from "../scripts/backup.mjs";

const platform = { schemaVersion:7, accounts:[], sessions:[], teams:[], invites:[], wallets:[], ledger:[], workflows:[], automations:[], objects:[], subscriptions:[], keyApplications:[], apiKeys:[], usageReservations:[], usageLedger:[], usageRefunds:[], collaborativeDocuments:[] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "openreel-publishing-backup-")), database = join(root, "source/openreel.sqlite"), assets = join(root, "source/assets"), platformFile = join(root, "source/platform.json"), publishing = join(root, "source/publishing");
  const backend = createSqliteBackend(database, { assetRoot: assets }); createDatabaseStore(backend).createUser({ id:"owner", name:"Owner" });
  writeFileSync(platformFile, JSON.stringify(platform)); mkdirSync(publishing, { recursive:true });
  writeFileSync(join(publishing, "oauth.json"), JSON.stringify({ schema:"openreel-publishing-oauth/v1", pending:[], bindings:[] }));
  writeFileSync(join(publishing, "batches.json"), JSON.stringify({ schema:"openreel-publishing-batch-store/v1", batches:[] }));
  for (const name of ["tiktok", "douyin", "instagram_reels", "youtube_shorts"]) writeFileSync(join(publishing, `${name}-jobs.json`), JSON.stringify({ schema:"openreel-publishing-job-store/v1", jobs:[] }));
  return { root, database, assets, platform:platformFile, publishing, backend };
}

test("strict backup manifests and restores the complete publishing recovery bundle", async () => {
  const value = fixture(), backup = join(value.root, "backup"), restored = join(value.root, "restored");
  const manifest = await createBackup({ ...value, destination:backup }); value.backend.close();
  assert.equal(manifest.files.filter(item => item.path.startsWith("publishing/")).length, 6);
  const result = verifyBackup({ source:backup, destination:restored }); assert.equal(result.publishing, "ok");
  assert.equal(JSON.parse(readFileSync(join(restored, "publishing/oauth.json"))).schema, "openreel-publishing-oauth/v1");
});

test("publishing backup rejects incomplete source and incomplete manifest before restore", async () => {
  const value = fixture(); unlinkSync(join(value.publishing, "douyin-jobs.json"));
  await assert.rejects(createBackup({ ...value, destination:join(value.root, "backup") }), /incomplete or unexpected/); value.backend.close();
  assert.equal(existsSync(join(value.root, "backup")), false);
});
