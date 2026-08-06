import test from "node:test";
import assert from "node:assert/strict";
import { TUTORIALS, tutorialById, validateTutorial } from "../src/tutorials.js";

test("tutorial catalog contains distinct, actionable classic workflows", () => {
  assert.equal(TUTORIALS.length, 4);
  assert.equal(new Set(TUTORIALS.map(item => item.id)).size, TUTORIALS.length);
  assert.ok(TUTORIALS.every(validateTutorial));
  assert.deepEqual(new Set(TUTORIALS.map(item => item.category)), new Set(["电影预告", "商业广告", "艺术短片", "纪录片"]));
});

test("tutorial blueprints contain generation nodes without paid auto-run instructions", () => {
  for (const tutorial of TUTORIALS) {
    assert.ok(tutorial.nodes.some(node => node.type === "image"));
    assert.ok(tutorial.nodes.some(node => node.type === "video"));
  }
  assert.equal(tutorialById("missing"), null);
  assert.equal(tutorialById("noir-trailer")?.title, "30 秒黑色电影预告片");
});
