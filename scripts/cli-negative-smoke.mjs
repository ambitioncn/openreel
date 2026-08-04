import assert from "node:assert/strict";
import { createOpenReelServer } from "../server.mjs";
import { runCli } from "../src/cli.js";

const server = createOpenReelServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = ["--base", `http://127.0.0.1:${server.address().port}`], call = (...args) => runCli([...args, ...base], { out: () => {} });
try { const project = await call("project", "create", "--name", "CLI negative"); await assert.rejects(() => call("run", "render", "--project", project.id), error => error.code === "EMPTY_TIMELINE" && error.status === 409); await assert.rejects(() => call("run", "render"), error => error.code === "INVALID_ARGUMENT"); await assert.rejects(() => call("download", "--url", "/api/v1/missing", "--out", "/tmp/openreel-never-written"), error => error.code === "NOT_FOUND"); console.log(JSON.stringify({ status: "passed", negativeCases: ["EMPTY_TIMELINE", "INVALID_ARGUMENT", "NOT_FOUND"] })); }
finally { await new Promise(resolve => server.close(resolve)); }
