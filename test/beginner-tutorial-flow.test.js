import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

test("beginner tutorial stays in the guided Create path", () => {
  assert.match(html, /The beginner tutorial stays in Create/);
  assert.match(html, /Advanced Canvas is optional and never required/);
  assert.match(app, /Use the guided Create wizard/);
  assert.match(app, /Canvas is never required/);
});

test("tutorial provides a same-project Create handoff and duplicate-safe blueprint import", () => {
  assert.match(app, /continueTutorialInCreate/);
  assert.match(app, /creative-target.*current/);
  assert.match(app, /short-video-duration/);
  assert.match(app, /Opened the existing tutorial blueprint\. No duplicate nodes were created/);
});

test("beginner workflow exposes 15 seconds, shot controls, all-shot reference binding, and text cards", () => {
  assert.match(html, /option value="15">约 15 秒/);
  for (const id of ["add-storyboard-shot", "bind-workbench-asset-all", "create-text-cards"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const label of ["Move up", "Move down", "Duplicate", "Delete"]) assert.match(app, new RegExp(label));
  assert.match(app, /Asset bound to all/);
  assert.match(app, /Created and selected.*safe-area text cards/);
});

test("beginner workflow is a real five-step wizard with optional advanced controls", () => {
  for (const id of ["wizard-back", "wizard-next", "wizard-position"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /const WIZARD_STEPS = \["brief-panel", "script-editor", "storyboard-editor", "generation-workbench", "final-workbench"\]/);
  assert.match(app, /function activateCreatorStep/);
  assert.match(html, /高级音频、文字卡与授权/);
  assert.match(html, /高级质量细节（可选）/);
  assert.match(html, /下载 MP4 就已经完成/);
  assert.doesNotMatch(html, /value="douyin"/);
  assert.doesNotMatch(html, /value="instagram_reels"/);
});

test("friendly recovery and one-action reference binding are explicit", () => {
  assert.match(app, /function friendlyError/);
  assert.match(app, /window\.addEventListener\("unhandledrejection"/);
  assert.match(app, /async function bindAssetToAllShots/);
  assert.match(app, /Uploaded, selected, and bound/);
  assert.doesNotMatch(app, /name: "Local demo"/);
  assert.doesNotMatch(app, /Ark models available/);
});

test("Canvas prompt sync and final MP4 reuse are explicit", () => {
  assert.match(app, /generationPromptOverridden/);
  assert.match(app, /generation-prompt.*node-content/);
  assert.match(app, /qualified MP4 is ready/);
  assert.match(app, /workbench-export.*hidden = Boolean\(preview\.asset\)/);
});
