import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertCreativeTargetCurrent, planCreativeTarget } from "../src/workbench-project-boundary.js";

const current = { id: "project-current", version: 4 };

test("new creative defaults to a distinct project plan without mutating current work", () => {
  const plan = planCreativeTarget({ mode: "new", currentProject: current, brief: " 美女在海滩跳舞 " });
  assert.deepEqual(plan, { mode: "new", sourceProjectId: "project-current", sourceProjectVersion: 4, name: "美女在海滩跳舞", requiresCreate: true });
  assert.equal(Object.isFrozen(plan), true);
});

test("current work requires an explicit contemporaneous selection", () => {
  assert.throws(() => planCreativeTarget({ mode: "current", currentProject: current, brief: "idea" }), /explicit confirmation/);
  const plan = planCreativeTarget({ mode: "current", currentProject: current, confirmedCurrent: true, brief: "idea" });
  assert.equal(assertCreativeTargetCurrent(plan, current), plan);
});

test("stale or switched current work fails closed", () => {
  const plan = planCreativeTarget({ mode: "current", currentProject: current, confirmedCurrent: true, brief: "idea" });
  assert.throws(() => assertCreativeTargetCurrent(plan, { id: current.id, version: 5 }), /changed/);
  assert.throws(() => assertCreativeTargetCurrent(plan, { id: "other", version: 4 }), /changed/);
  assert.throws(() => planCreativeTarget({ mode: "unknown", currentProject: current, brief: "idea" }), /new or current/);
});

test("opening a new project refreshes its version after creating the initial canvas session", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /if \(!session\) \{[\s\S]*Main canvas[\s\S]*snapshot = await api\(`\/api\/v1\/projects\/\$\{projectId\}`\);[\s\S]*\}/);
});
