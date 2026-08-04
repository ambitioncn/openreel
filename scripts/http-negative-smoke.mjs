import assert from "node:assert/strict";
import { createOpenReelServer } from "../server.mjs";

const server = createOpenReelServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
try { const projectResponse = await fetch(`${base}/api/v1/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "HTTP negative" }) }), project = await projectResponse.json(); const response = await fetch(`${base}/api/v1/projects/${project.id}/exports/render`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), body = await response.json(); assert.equal(response.status, 409); assert.equal(body.error.code, "EMPTY_TIMELINE"); console.log(JSON.stringify({ status: "passed", httpStatus: response.status, error: body.error })); }
finally { await new Promise(resolve => server.close(resolve)); }
