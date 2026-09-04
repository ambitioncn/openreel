import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDirectorReworkState, recordDirectorReworkAttempt, restoreDirectorReworkState } from "../src/director-rework.js";
import { createDirectorReworkStore } from "../src/director-rework-store.js";

const quality = (overrides = {}) => ({ schema: "openreel-director-final-quality-result/v1", projectId: "p-1", workflowId: "wf-1", revision: 3, fingerprint: "a".repeat(64), qualificationStatus: "rejected", failedShots: ["s-2"], technicalFailures: [], directorFailures: ["pacing"], ...overrides });

test("chooses shot scope before composition scope", () => {
  const state = createDirectorReworkState(quality(), { maxAttempts: 3, budgetCny: 12 });
  assert.deepEqual(state.directives.map(item => [item.scope, item.shotId]), [["shot", "s-2"], ["composition", null]]);
});

test("persists retry and CNY ceilings across store reconstruction", () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-rework-"));
  try {
    const path = join(root, "nested", "state.json");
    const state = recordDirectorReworkAttempt(createDirectorReworkState(quality({ directorFailures: [] }), { maxAttempts: 2, budgetCny: 5 }), { directiveId: "shot:s-2", estimatedCostCny: 2, actualCostCny: 1.25, outcome: "failed", evidenceId: "attempt-1" });
    createDirectorReworkStore(path).save(state);
    const restored = createDirectorReworkStore(path).load();
    assert.equal(restored.attemptsUsed, 1); assert.equal(restored.spentCny, 1.25); assert.equal(restored.policy.budgetCny, 5);
    const exhausted = recordDirectorReworkAttempt(restored, { directiveId: "shot:s-2", estimatedCostCny: 2, actualCostCny: 2, outcome: "failed", evidenceId: "attempt-2" });
    assert.equal(exhausted.status, "exhausted"); assert.equal(exhausted.stopReason, "retry_limit");
    assert.throws(() => recordDirectorReworkAttempt(exhausted, { directiveId: "shot:s-2", estimatedCostCny: 0, actualCostCny: 0, outcome: "failed", evidenceId: "attempt-3" }), /not actionable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects blind, unapproved, over-budget, and tampered attempts", () => {
  const state = createDirectorReworkState(quality({ directorFailures: [] }), { maxAttempts: 2, budgetCny: 1 });
  assert.throws(() => recordDirectorReworkAttempt(state, { directiveId: "shot:s-2", estimatedCostCny: 1.01, actualCostCny: 1, outcome: "failed", evidenceId: "e-1" }), /budget/);
  assert.throws(() => recordDirectorReworkAttempt(state, { directiveId: "shot:s-2", estimatedCostCny: 1, actualCostCny: 1.01, outcome: "failed", evidenceId: "e-1" }), /approved estimate/);
  assert.throws(() => recordDirectorReworkAttempt(state, { directiveId: "shot:s-2", estimatedCostCny: 1, actualCostCny: 1, outcome: "failed" }), /blind retry/);
  const tampered = JSON.parse(JSON.stringify(state)); tampered.policy.maxAttempts = 99;
  assert.throws(() => restoreDirectorReworkState(tampered), /fingerprint/);
});

test("severe technical failure never auto-retries", () => {
  const state = createDirectorReworkState(quality({ qualificationStatus: "hard_failed" }), { maxAttempts: 3, budgetCny: 10 });
  assert.equal(state.status, "hard_failed"); assert.equal(state.stopReason, "severe_technical_failure"); assert.deepEqual(state.directives, []);
  assert.throws(() => recordDirectorReworkAttempt(state, {}), /not actionable/);
});
