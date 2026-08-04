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
  for (const hook of ["build-story", "export-edl", "workflow-state", "rename-project", "archive-project"]) assert.match(html, new RegExp(`id="${hook}"`));
  assert.match(css, /@media \(max-width: 760px\)/);
  for (const state of ["Empty:", "Loading:", "Error:", "Success:"]) assert.match(`${html}\n${app}`, new RegExp(state));
});

test("graph UI renders persisted edges/groups/history and guards invalid selections", async () => {
  const [html, app] = await Promise.all([readFile(new URL("../index.html", import.meta.url), "utf8"), readFile(new URL("../src/app.js", import.meta.url), "utf8")]);
  for (const hook of ["create-edge", "create-group", "graph-form", "node-history"]) assert.match(html, new RegExp(`id="${hook}"`));
  for (const behavior of ["snapshot.edges", "snapshot.groups", "node.runs", "node.resultVersions", "Select exactly two nodes", "Select one or more nodes", "graph.kind"] ) assert.match(app, new RegExp(behavior));
});
