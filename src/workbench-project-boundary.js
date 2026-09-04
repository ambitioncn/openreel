export function planCreativeTarget({ mode, currentProject, confirmedCurrent = false, brief } = {}) {
  const normalizedBrief = typeof brief === "string" ? brief.trim() : "";
  if (!normalizedBrief) throw new TypeError("brief is required");
  if (!currentProject?.id || !Number.isInteger(currentProject.version)) throw new TypeError("current project identity and version are required");
  if (mode === "new") return Object.freeze({ mode, sourceProjectId: currentProject.id, sourceProjectVersion: currentProject.version, name: normalizedBrief.slice(0, 80), requiresCreate: true });
  if (mode !== "current") throw new TypeError("creative target must be new or current");
  if (!confirmedCurrent) throw new TypeError("continuing in the current work requires explicit confirmation");
  return Object.freeze({ mode, projectId: currentProject.id, projectVersion: currentProject.version, requiresCreate: false });
}

export function assertCreativeTargetCurrent(plan, currentProject) {
  if (!plan || !currentProject || plan.projectId !== currentProject.id || plan.projectVersion !== currentProject.version) throw new TypeError("selected work changed before creative creation");
  return plan;
}
