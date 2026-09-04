import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RECOVERABLE = new Set(["validating", "uploading", "processing", "publishing", "unknown_remote"]);

export function planPublishingReconciliation(stateRoot) {
  const candidates = [];
  for (const name of readdirSync(stateRoot).filter(value => value.endsWith("-jobs.json")).sort()) {
    const value = JSON.parse(readFileSync(join(stateRoot, name), "utf8"));
    if (value.schema !== "openreel-publishing-job-store/v1" || !Array.isArray(value.jobs)) throw new Error(`invalid publishing job store: ${name}`);
    for (const job of value.jobs) if (RECOVERABLE.has(job.state)) candidates.push({ store: name, jobId: job.id, tenantId: job.tenantId, state: job.state, action: job.state === "unknown_remote" ? "remote_reconcile_required" : "resume_required" });
  }
  return { schema: "openreel-publishing-reconciliation-plan/v1", candidates, externalActions: 0 };
}
