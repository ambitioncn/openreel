import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

test("website explains that tutorial completion is guidance, not execution", () => {
  assert.match(html, /checklist records your progress; it does not perform or verify the work/i);
  assert.match(app, /Complete \(records progress only\)/);
  assert.match(app, /does not perform, verify, or unlock the step/);
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

test("Canvas prompt sync and final MP4 reuse are explicit", () => {
  assert.match(app, /generationPromptOverridden/);
  assert.match(app, /generation-prompt.*node-content/);
  assert.match(app, /Download reuses this qualified render/);
  assert.match(app, /workbench-export.*hidden = Boolean\(preview\.asset\)/);
});
