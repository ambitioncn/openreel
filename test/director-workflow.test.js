import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advanceDirectorWorkflow, createDirectorWorkflow, DIRECTOR_WORKFLOW_STAGES, restoreDirectorWorkflow } from "../src/director-workflow.js";
import { createDirectorWorkflowStore } from "../src/director-workflow-store.js";

const evidence = (workflow, stage = workflow.currentStage) => ({ schema: "openreel-stage-evidence/v1", workflowId: workflow.workflowId, revision: workflow.revision, stage, status: "accepted", artifactId: `${stage}-artifact` });

test("advances all seven stages only with bound accepted evidence", () => {
  let workflow = createDirectorWorkflow({ workflowId: "wf-1", revision: 2 });
  assert.deepEqual(workflow.stages.map(stage => stage.id), DIRECTOR_WORKFLOW_STAGES);
  for (const stage of DIRECTOR_WORKFLOW_STAGES) {
    assert.equal(workflow.currentStage, stage);
    workflow = advanceDirectorWorkflow(workflow, evidence(workflow));
  }
  assert.equal(workflow.status, "qualified");
  assert.equal(workflow.currentStage, null);
  assert.ok(workflow.stages.every(stage => stage.status === "accepted"));
  assert.throws(() => advanceDirectorWorkflow(workflow, evidence({ ...workflow, currentStage: "automatic_qc" })), /cannot advance/);
});

test("fails closed on skipped, stale, rejected, and cross-workflow evidence", () => {
  const workflow = createDirectorWorkflow({ workflowId: "wf-1", revision: 2 });
  for (const drift of [{ stage: "script" }, { revision: 1 }, { status: "rejected" }, { workflowId: "wf-other" }]) {
    assert.throws(() => advanceDirectorWorkflow(workflow, { ...evidence(workflow), ...drift }), /accepted evidence/);
  }
});

test("restores an exact immutable state and rejects tampered snapshots", () => {
  const initial = createDirectorWorkflow({ workflowId: "wf-1", revision: 1 });
  const advanced = advanceDirectorWorkflow(initial, evidence(initial));
  const restored = restoreDirectorWorkflow(JSON.parse(JSON.stringify(advanced)));
  assert.deepEqual(restored, advanced);
  assert.ok(Object.isFrozen(restored.stages[0].evidence));
  const tampered = JSON.parse(JSON.stringify(advanced));
  tampered.stages[1].status = "accepted";
  assert.throws(() => restoreDirectorWorkflow(tampered), /inconsistent|evidence/);
});

test("persists exact workflow state across store reconstruction", () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-director-workflow-"));
  try {
    const path = join(root, "nested", "workflow.json");
    const initial = createDirectorWorkflow({ workflowId: "wf-restart", revision: 3 });
    const advanced = advanceDirectorWorkflow(initial, evidence(initial));
    createDirectorWorkflowStore(path).save(advanced);
    assert.deepEqual(createDirectorWorkflowStore(path).load(), advanced);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
