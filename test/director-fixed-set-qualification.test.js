import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const artifact = new URL("../docs/evidence/cdqs-13-fixed-set-qualification.json", import.meta.url);

test("fixed-set qualification is replayable and every severe-error injection hard-fails", () => {
  execFileSync(process.execPath, ["scripts/qualify-director-fixed-set.mjs"], { cwd: root, stdio: "pipe" });
  const first = readFileSync(artifact, "utf8");
  execFileSync(process.execPath, ["scripts/qualify-director-fixed-set.mjs"], { cwd: root, stdio: "pipe" });
  assert.equal(readFileSync(artifact, "utf8"), first);
  const result = JSON.parse(first);
  assert.equal(result.positive.status, "qualified");
  assert.equal(result.positive.releaseEligible, true);
  assert.equal(result.severeErrorCases.length, result.caseCount);
  assert.ok(result.severeErrorCases.every(item => item.status === "rejected" && item.releaseEligible === false && item.failure === "severe:decode_failure"));
  assert.equal(result.externalCalls, false);
  assert.equal(result.paidCalls, false);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});
