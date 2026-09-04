import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planPublishingReconciliation } from "../src/publishing-reconciler.js";

test("publishing recovery planner finds only recoverable work and performs no external action", () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-reconciler-")); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "youtube_shorts-jobs.json"), JSON.stringify({ schema: "openreel-publishing-job-store/v1", jobs: [{ id: "unknown", tenantId: "tenant-1", state: "unknown_remote" }, { id: "done", tenantId: "tenant-1", state: "published" }] }));
  assert.deepEqual(planPublishingReconciliation(root), { schema: "openreel-publishing-reconciliation-plan/v1", candidates: [{ store: "youtube_shorts-jobs.json", jobId: "unknown", tenantId: "tenant-1", state: "unknown_remote", action: "remote_reconcile_required" }], externalActions: 0 });
});
