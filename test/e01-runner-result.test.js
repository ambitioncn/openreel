import test from "node:test";
import assert from "node:assert/strict";
import { safeAcceptanceStage, terminalJobError } from "../scripts/e01-runner-result.mjs";

test("E-01 runner preserves only a bounded terminal state, safe error code and local billing facts", () => {
  const error = terminalJobError(
    { state: "failed", error: { code: "ARK_TASK_FAILED", message: "provider-private detail" } },
    { subscription: { spentMicros: 0, reservedMicros: 0 }, reconciliation: { consistent: true } }
  );
  assert.deepEqual(
    { code: error.code, terminalState: error.terminalState, spentUnits: error.spentUnits, reservedUnits: error.reservedUnits, reconciliation: error.reconciliation },
    { code: "ARK_TASK_FAILED", terminalState: "failed", spentUnits: 0, reservedUnits: 0, reconciliation: true }
  );
  assert.equal(JSON.stringify(error).includes("provider-private"), false);
});

test("E-01 runner rejects untrusted terminal error fields", () => {
  const error = terminalJobError({ state: "private-state", error: { code: "private code https://secret.invalid" } }, {});
  assert.equal(error.code, "ARK_TASK_FAILED");
  assert.equal(error.terminalState, "failed");
  assert.equal(error.spentUnits, null);
  assert.equal(error.reservedUnits, null);
  assert.equal(error.reconciliation, null);
});

test("E-01 runner retains only allowlisted acceptance stages", () => {
  assert.equal(safeAcceptanceStage("asset_download"), "asset_download");
  assert.equal(safeAcceptanceStage("private-stage https://secret.invalid"), "unknown");
  assert.equal(safeAcceptanceStage(null), "unknown");
});
