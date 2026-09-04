import { DomainError } from "./core.js";

export const DIRECTOR_WORKFLOW_STAGES = Object.freeze(["creative", "script", "visual_bible", "dynamic_storyboard", "formal_generation", "post_production", "automatic_qc"]);
const invalid = message => { throw new DomainError("DIRECTOR_WORKFLOW_INVALID", message, 422); };
const id = (value, name) => {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > 100) invalid(`${name} is required and must be at most 100 characters`);
  return result;
};
const freeze = workflow => {
  workflow.stages.forEach(stage => { if (stage.evidence) Object.freeze(stage.evidence); Object.freeze(stage); });
  Object.freeze(workflow.stages);
  return Object.freeze(workflow);
};

export function createDirectorWorkflow(input = {}) {
  const revision = input.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) invalid("revision must be a positive integer");
  return freeze({ schema: "openreel-director-workflow/v1", workflowId: id(input.workflowId, "workflowId"), revision, currentStage: DIRECTOR_WORKFLOW_STAGES[0], status: "in_progress", stages: DIRECTOR_WORKFLOW_STAGES.map((stageId, index) => ({ id: stageId, status: index ? "pending" : "awaiting_evidence", evidence: null })) });
}

export function advanceDirectorWorkflow(workflow, evidence) {
  validateDirectorWorkflow(workflow);
  if (workflow.status !== "in_progress") invalid("completed workflow cannot advance");
  const index = DIRECTOR_WORKFLOW_STAGES.indexOf(workflow.currentStage);
  if (evidence?.schema !== "openreel-stage-evidence/v1" || evidence.workflowId !== workflow.workflowId || evidence.revision !== workflow.revision || evidence.stage !== workflow.currentStage || evidence.status !== "accepted") invalid("accepted evidence for the current workflow revision and stage is required");
  const stages = workflow.stages.map((stage, stageIndex) => stageIndex === index ? { id: stage.id, status: "accepted", evidence: { ...evidence } } : stageIndex === index + 1 ? { id: stage.id, status: "awaiting_evidence", evidence: null } : { id: stage.id, status: stage.status, evidence: stage.evidence });
  const complete = index === DIRECTOR_WORKFLOW_STAGES.length - 1;
  return freeze({ schema: workflow.schema, workflowId: workflow.workflowId, revision: workflow.revision, currentStage: complete ? null : DIRECTOR_WORKFLOW_STAGES[index + 1], status: complete ? "qualified" : "in_progress", stages });
}

export function validateDirectorWorkflow(workflow) {
  if (!workflow || workflow.schema !== "openreel-director-workflow/v1" || !Array.isArray(workflow.stages) || workflow.stages.length !== DIRECTOR_WORKFLOW_STAGES.length) invalid("workflow schema is invalid");
  id(workflow.workflowId, "workflowId");
  if (!Number.isSafeInteger(workflow.revision) || workflow.revision < 1) invalid("revision must be a positive integer");
  const acceptedCount = workflow.stages.filter(stage => stage?.status === "accepted").length;
  workflow.stages.forEach((stage, index) => {
    if (stage?.id !== DIRECTOR_WORKFLOW_STAGES[index]) invalid("workflow stages must use canonical order");
    const expected = index < acceptedCount ? "accepted" : index === acceptedCount && acceptedCount < DIRECTOR_WORKFLOW_STAGES.length ? "awaiting_evidence" : "pending";
    if (stage.status !== expected) invalid("workflow stage statuses are inconsistent");
    if (expected === "accepted" && (stage.evidence?.schema !== "openreel-stage-evidence/v1" || stage.evidence.workflowId !== workflow.workflowId || stage.evidence.revision !== workflow.revision || stage.evidence.stage !== stage.id || stage.evidence.status !== "accepted")) invalid("accepted stage evidence is invalid");
    if (expected !== "accepted" && stage.evidence !== null) invalid("unaccepted stages cannot contain evidence");
  });
  const complete = acceptedCount === DIRECTOR_WORKFLOW_STAGES.length;
  if (workflow.status !== (complete ? "qualified" : "in_progress") || workflow.currentStage !== (complete ? null : DIRECTOR_WORKFLOW_STAGES[acceptedCount])) invalid("workflow progress is inconsistent");
  return workflow;
}

export function restoreDirectorWorkflow(snapshot) {
  validateDirectorWorkflow(snapshot);
  return freeze({ ...snapshot, stages: snapshot.stages.map(stage => ({ ...stage, evidence: stage.evidence ? { ...stage.evidence } : null })) });
}
