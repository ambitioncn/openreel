import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseManifest, canonicalReleaseManifestBytes, verifyReleaseManifest } from "./qualify-release-artifacts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "docs", "evidence", "cdqs-14-production-candidate.json");
const checks = [
  ["fixed_set", "scripts/qualify-director-fixed-set.mjs"],
  ["reliability", "scripts/qualify-reliability.mjs"],
  ["production_e2e_backup_restore_security_tenant", "scripts/production-e2e.mjs"],
  ["deployment_rollback_rehearsal", "scripts/rehearse-deployment.mjs"],
  ["browser_workflow", "scripts/director-browser-e2e.mjs"]
].map(([id, script]) => {
  const lines = execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n");
  const result = JSON.parse(lines.at(-1));
  assert.ok(["passed", "qualified"].includes(result.status), `${id} did not pass`);
  return { id, status: result.status };
});
execFileSync(process.execPath, ["--test", "test/ops.test.js", "test/durable.test.js", "test/billing-evidence.test.js", "test/http.test.js", "test/director-fixed-set-qualification.test.js"], { cwd: root, stdio: "pipe" });
const manifest = buildReleaseManifest(root);
verifyReleaseManifest(root, manifest);
const candidateFingerprint = createHash("sha256").update(canonicalReleaseManifestBytes(manifest)).digest("hex");
const record = { schema: "openreel-cdqs-14-production-candidate/v1", candidateFingerprint, artifactCount: manifest.artifacts.length, checks: [...checks, { id: "security_tenant_billing_regression", status: "passed" }], candidateFrozen: true, immutableManifest: manifest, externalCalls: false, paidCalls: false, deploymentActivated: false };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(`${output}.tmp`, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
renameSync(`${output}.tmp`, output);
console.log(JSON.stringify({ status: "qualified", candidateFingerprint, artifacts: manifest.artifacts.length, checks: record.checks.length, output }));
