const DRAFT_VERSION = 1;

export function workbenchDraftKey(projectId) {
  if (typeof projectId !== "string" || !projectId) throw new TypeError("projectId is required");
  return `openreel:workbench-draft:${projectId}`;
}

export function saveWorkbenchDraft(storage, projectId, draft) {
  if (!storage?.setItem || !Number.isInteger(draft?.storyVersion) || !Number.isInteger(draft?.storyboardVersion)) throw new TypeError("valid storage and draft versions are required");
  storage.setItem(workbenchDraftKey(projectId), JSON.stringify({ version: DRAFT_VERSION, ...draft }));
}

export function recoverWorkbenchDraft(storage, projectId, versions) {
  try {
    const draft = JSON.parse(storage?.getItem?.(workbenchDraftKey(projectId)) || "null");
    if (draft?.version !== DRAFT_VERSION || draft.storyVersion !== versions.storyVersion || draft.storyboardVersion !== versions.storyboardVersion) return null;
    return draft;
  } catch { return null; }
}

export function clearWorkbenchDraft(storage, projectId) {
  storage?.removeItem?.(workbenchDraftKey(projectId));
}
