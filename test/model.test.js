import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NODE_TYPES, createNode, updateNode } from "../src/model.js";

test("the model exposes exactly the milestone node types", () => {
  assert.deepEqual(NODE_TYPES, ["text", "image", "video", "audio", "script"]);
  for (const type of NODE_TYPES) assert.equal(createNode(type, { x: 1, y: 2 }, type).type, type);
});

test("createNode rejects unknown types and invalid positions", () => {
  assert.throws(() => createNode("document"), /Unsupported node type/);
  assert.throws(() => createNode("text", { x: Infinity, y: 0 }), /finite/);
});

test("updateNode is immutable and preserves identity and type", () => {
  const original = createNode("image", { x: 1, y: 2 }, "fixed");
  const updated = updateNode([original], "fixed", { id: "changed", type: "video", title: "Reference", position: { x: 5 } });
  assert.notEqual(updated[0], original);
  assert.deepEqual(original.position, { x: 1, y: 2 });
  assert.deepEqual(updated[0], { ...original, title: "Reference", position: { x: 5, y: 2 } });
});

test("the interface wires toolbox, canvas, inspector, pan and zoom", async () => {
  const [html, app] = await Promise.all([readFile(new URL("../index.html", import.meta.url), "utf8"), readFile(new URL("../src/app.js", import.meta.url), "utf8")]);
  for (const hook of ["node-tools", "viewport", "canvas", "inspector", "node-form"]) assert.match(html, new RegExp(`id="${hook}"`));
  assert.match(app, /pointermove/);
  assert.match(app, /wheel/);
  assert.match(app, /NODE_TYPES\.map/);
  for (const state of ["Loading:", "Error:", "Success:"]) assert.match(app, new RegExp(state));
});

test("responsive workflow exposes empty, loading, error, and success states", async () => {
  const [html, css, app] = await Promise.all([readFile(new URL("../index.html", import.meta.url), "utf8"), readFile(new URL("../src/styles.css", import.meta.url), "utf8"), readFile(new URL("../src/app.js", import.meta.url), "utf8")]);
  for (const hook of ["build-story", "export-edl", "render-export", "render-reviewed", "render-download", "workflow-state", "rename-project", "archive-project"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const hook of ["creator-workbench", "workbench-home", "advanced-canvas", "start-short-video", "short-video-flow", "short-video-brief-form"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const hook of ["script-editor", "hook-options", "short-video-script", "storyboard-editor", "storyboard-shots", "save-script-storyboard"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const hook of ["project-shelf-title", "toggle-new-project", "new-project-form", "workbench-projects", "project-shelf-state"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const hook of ["product-url-field", "short-video-url", "intake-asset-field", "short-video-asset"]) assert.match(html, new RegExp(`id="${hook}"`));
  assert.match(app, /\/api\/v1\/product-url\/understand/);
  assert.match(app, /verifiedProductContext/);
  for (const hook of ["asset-manager", "workbench-asset-kind", "workbench-asset-upload", "asset-shot-target", "bind-workbench-asset", "workbench-assets", "workbench-asset-state"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const hook of ["workbench-model-router", "workbench-route-state"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const hook of ["production-controls", "workbench-voice", "workbench-music", "workbench-caption-upload", "workbench-caption-shot", "workbench-caption-text", "workbench-music-upload", "workbench-music-source", "workbench-production-asset-state", "workbench-music-asset", "workbench-caption-assets", "workbench-safe-zone", "workbench-captions"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const hook of ["commercial-redo-quote", "commercial-redo-confirmed", "commercial-redo-start", "commercial-redo-state"]) assert.match(html, new RegExp(`id="${hook}"`));
  assert.match(app, /\/redo\/quote/); assert.match(app, /\/redo\/jobs/); assert.doesNotMatch(app, /redo\/jobs[^\n]+\/execute/);
  for (const hook of ["final-workbench", "workbench-final-video", "publishing-title", "publishing-copy", "workbench-export", "workbench-download"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const hook of ["publishing-accounts", "tiktok-publishing-account-state", "tiktok-publishing-account-action", "youtube-publishing-account-state", "youtube-publishing-account-action", "publishing-account-progress"]) assert.match(html, new RegExp(`id="${hook}"`));
  assert.ok(html.indexOf('id="publishing-accounts"') < html.indexOf('id="short-video-flow"'), "publishing account entry must remain outside the story-dependent flow");
  assert.match(app, /publishingAccountView\.get\("youtube_shorts"\)/);
  assert.match(app, /publishingAccountView\.get\("tiktok"\)/);
  for (const preference of ["fast", "quality"]) assert.match(html, new RegExp(`name="workbench-quality" value="${preference}"`));
  for (const behavior of ["refreshWorkbenchAssets", "refreshAssetShotTargets", "uploadReference"]) assert.match(app, new RegExp(`function ${behavior}`));
  assert.match(app, /素材已绑定到指定分镜/); assert.match(app, /\.download = asset\.filename/);
  for (const source of ["idea", "copy", "url", "asset"]) assert.match(html, new RegExp(`name="intake-source" value="${source}"`));
  assert.match(app, /workbench-plan/); assert.doesNotMatch(app, /SHORT_VIDEO_TEMPLATES|shortVideoDraft/);
  assert.match(app, /const referenceAssetIds = \[\.\.\.new Set\(\[reference\?\.id, selectedWorkbenchAsset\]\.filter\(Boolean\)\)\]/); assert.doesNotMatch(app, /未抓取网页/);
  for (const behavior of ["refreshProjectShelf", "openProject", "renameWorkbenchProject", "setProjectStatus"]) assert.match(app, new RegExp(`function ${behavior}`));
  assert.match(app, /Your \$\{duration\}-second plan is ready/); assert.match(app, /renderScriptStoryboard\(story, storyboard\)/);
  assert.match(app, /#generation-workbench"\)\.hidden = false/);
  assert.match(app, /shot-broll/); assert.match(app, /production, scenes:/);
  for (const behavior of ["renderFinalWorkbench", "publishingDraft", "finalPreview"]) assert.match(app, new RegExp(behavior));
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.inspector \{[^}]*overflow-x: hidden/);
  assert.match(css, /\.access-dialog \{[^}]*max-height:/);
  assert.match(css, /\.admin-auth,\.application-action \{ grid-template-columns:/);
  assert.match(css, /#node-form > section,#node-meta \{ grid-column:1\/-1 \}/);
  assert.doesNotMatch(css, /\.project-actions button \{ display: none/);
  for (const state of ["Empty:", "Loading:", "Error:", "Success:"]) assert.match(`${html}\n${app}`, new RegExp(state));
  assert.match(app, /reviewedExportSelection/);
});

test("graph UI renders persisted edges/groups/history and guards invalid selections", async () => {
  const [html, app] = await Promise.all([readFile(new URL("../index.html", import.meta.url), "utf8"), readFile(new URL("../src/app.js", import.meta.url), "utf8")]);
  for (const hook of ["create-edge", "create-group", "graph-form", "node-history"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const behavior of ["snapshot.edges", "snapshot.groups", "node.runs", "node.resultVersions", "Select exactly two nodes", "Select one or more nodes", "graph.kind"] ) assert.match(app, new RegExp(behavior));
});
