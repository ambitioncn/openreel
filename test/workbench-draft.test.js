import test from "node:test";
import assert from "node:assert/strict";
import { clearWorkbenchDraft, recoverWorkbenchDraft, saveWorkbenchDraft, workbenchDraftKey } from "../src/workbench-draft.js";

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test("workbench recovery draft is isolated by project and server versions", () => {
  const local = storage(), draft = { storyVersion: 2, storyboardVersion: 4, selectedHook: 1, synopsis: "Recovered", shots: [] };
  saveWorkbenchDraft(local, "project-a", draft);
  assert.equal(workbenchDraftKey("project-a"), "openreel:workbench-draft:project-a");
  assert.equal(recoverWorkbenchDraft(local, "project-b", { storyVersion: 2, storyboardVersion: 4 }), null);
  assert.equal(recoverWorkbenchDraft(local, "project-a", { storyVersion: 3, storyboardVersion: 4 }), null);
  assert.equal(recoverWorkbenchDraft(local, "project-a", { storyVersion: 2, storyboardVersion: 4 }).synopsis, "Recovered");
  clearWorkbenchDraft(local, "project-a");
  assert.equal(recoverWorkbenchDraft(local, "project-a", { storyVersion: 2, storyboardVersion: 4 }), null);
});

test("invalid recovery data fails closed", () => {
  const local = storage(); local.setItem(workbenchDraftKey("project-a"), "not-json");
  assert.equal(recoverWorkbenchDraft(local, "project-a", { storyVersion: 1, storyboardVersion: 1 }), null);
  assert.throws(() => saveWorkbenchDraft(local, "project-a", {}), /draft versions/);
});
