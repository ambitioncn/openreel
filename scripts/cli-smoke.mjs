import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenReelServer } from "../server.mjs";
import { runCli } from "../src/cli.js";

const server = createOpenReelServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const baseArgs = ["--base", `http://127.0.0.1:${server.address().port}`], call = (...args) => runCli([...args, ...baseArgs], { out: () => {} });
try {
  const project = await call("project", "create", "--name", "CLI smoke");
  const session = await call("project", "create-session", project.id, "--name", "Canvas");
  const image = await call("node", "create", "--session", session.id, "--type", "image", "--x", "-900000");
  const video = await call("node", "create", "--session", session.id, "--type", "video");
  const edge = await call("edge", "create", "--project", project.id, "--from", image.id, "--to", video.id);
  await call("edge", "update", edge.id, "--title", "reference", "--version", "1");
  await call("canvas", "group", "--project", project.id, "--title", "Shot", "--nodes", `${image.id},${video.id}`);
  await call("node", "update", image.id, "--title", "Source", "--version", String(image.version));
  let run = await call("run", "create", "--session", session.id, "--node", video.id, "--prompt", "CLI local video");
  run = await call("run", "tick", run.id); run = await call("run", "tick", run.id); assert.equal(run.state, "succeeded");
  const canvas = await call("canvas", "get", project.id); assert.equal(canvas.edges.length, 1); assert.equal(canvas.nodes.find(n => n.id === video.id).runs.length, 1);
  assert.equal((await call("model-schema", "list")).length, 3);
  const dir = mkdtempSync(join(tmpdir(), "openreel-cli-")), input = join(dir, "ref.png"), output = join(dir, "result.bin"); writeFileSync(input, "png");
  await call("upload", "--project", project.id, "--session", session.id, "--file", input, "--mime", "image/png");
  const asset = canvas.assets.find(a => a.id === run.assetId); await call("download", "--url", asset.downloadUrl, "--out", output); assert.ok(readFileSync(output).length > 0);
  await fetch(`${baseArgs[1]}/api/v1/projects/${project.id}/timeline`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: 1, tracks: [{ kind: "video", clips: [{ assetId: run.assetId, inPoint: 0, outPoint: 1, start: 0 }] }] }) });
  const render = await call("run", "render", "--project", project.id), renderedOutput = join(dir, "render.mp4"); await call("download", "--url", render.asset.downloadUrl, "--out", renderedOutput); assert.equal(readFileSync(renderedOutput).subarray(4, 8).toString(), "ftyp");
  await assert.rejects(() => call("node", "create", "--session", session.id), error => error.code === "INVALID_ARGUMENT");
  await assert.rejects(() => call("unknown", "command"), error => error.code === "INVALID_COMMAND");
  await assert.rejects(() => call("edge", "create", "--project", project.id, "--from", video.id, "--to", image.id), error => error.code === "INVALID_GRAPH");
  console.log(JSON.stringify({ status: "passed", projectId: project.id, commands: 20, negativeCommands: 3, renderSha256: render.sha256, renderBytes: readFileSync(renderedOutput).length }));
} finally { await new Promise(resolve => server.close(resolve)); }
