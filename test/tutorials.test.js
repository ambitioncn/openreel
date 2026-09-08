import test from "node:test";
import assert from "node:assert/strict";
import { TUTORIALS, tutorialById, tutorialProgress, tutorialWorkflow, validateTutorial } from "../src/tutorials.js";
import { tutorialForLocale, tutorialsForLocale } from "../src/tutorial-locales.js";
import { createPlatform } from "../src/platform.js";

test("tutorial catalog contains distinct, actionable classic workflows", () => {
  assert.equal(TUTORIALS.length, 8);
  assert.equal(new Set(TUTORIALS.map(item => item.id)).size, TUTORIALS.length);
  assert.ok(TUTORIALS.every(validateTutorial));
  assert.deepEqual(new Set(TUTORIALS.map(item => item.category)), new Set(["电影预告", "商业广告", "艺术短片", "纪录片", "角色短剧", "分镜预演", "音乐视觉", "社媒改编"]));
});

test("tutorial blueprints contain generation nodes without paid auto-run instructions", () => {
  for (const tutorial of TUTORIALS) {
    assert.ok(tutorial.nodes.some(node => node.type === "image"));
    assert.ok(tutorial.nodes.some(node => node.type === "video"));
  }
  assert.equal(tutorialById("missing"), null);
  assert.equal(tutorialById("noir-trailer")?.title, "30 秒黑色电影预告片");
});

test("tutorial catalog has complete English and Simplified Chinese variants", () => {
  const english = tutorialsForLocale("en"), chinese = tutorialsForLocale("zh-CN");
  assert.equal(english.length, 8);
  assert.equal(chinese, TUTORIALS);
  for (const tutorial of english) {
    assert.ok(validateTutorial(tutorial));
    assert.doesNotMatch(JSON.stringify(tutorial), /[\u3400-\u9fff]/);
  }
  assert.match(tutorialForLocale("noir-trailer", "zh-CN").title, /黑色电影/);
  assert.equal(tutorialForLocale("noir-trailer", "en").title, "30-second film noir trailer");
});

test("tutorial blueprints replay through the validated workflow import path", () => {
  const platform = createPlatform(), account = platform.register({ email: "tutorial@example.test", password: "tutorial-password" }), token = platform.login({ email: account.email, password: "tutorial-password" }).token, team = platform.createTeam(token, { name: "Tutorials" });
  for (const tutorial of TUTORIALS) {
    const workflow = tutorialWorkflow(tutorial.id), first = platform.importWorkflow(token, team.id, workflow), replay = platform.importWorkflow(token, team.id, workflow);
    assert.equal(workflow.schema, "openreel-workflow/v1");
    assert.equal(workflow.autoRun, false);
    assert.equal(first.id, replay.id);
    assert.equal(first.digest, replay.digest);
  }
  assert.throws(() => tutorialWorkflow("missing"), /valid tutorial/);
});

test("guided progress is versioned, replayable, and never auto-runs generation", () => {
  const first = tutorialProgress("noir-trailer", [2, 0, 2]), replay = tutorialProgress("noir-trailer", [0, 2]);
  assert.deepEqual(first, replay);
  assert.equal(first.schema, "openreel-tutorial-progress/v1");
  assert.equal(first.tutorialVersion, 1);
  assert.equal(first.autoRun, false);
  assert.equal(first.status, "in_progress");
  assert.equal(first.nextStep, 1);
  assert.equal(tutorialProgress("noir-trailer", [0, 1, 2, 3, 4]).status, "completed");
  assert.throws(() => tutorialProgress("missing", []), /valid tutorial/);
  assert.throws(() => tutorialProgress("noir-trailer", [-1]), /valid tutorial/);
});
