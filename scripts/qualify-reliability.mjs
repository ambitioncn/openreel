#!/usr/bin/env node
import assert from "node:assert/strict";
import { createOpenReelServer } from "../server.mjs";

let dependencyReady = true;
const server = createOpenReelServer(undefined, undefined, {
  readiness: () => {
    if (!dependencyReady) throw new Error("injected dependency failure");
    return { database: "ok" };
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const requests = 200;
  const responses = await Promise.all(Array.from({ length: requests }, () => fetch(`${base}/health/live`)));
  assert.equal(responses.filter(response => response.status === 200).length, requests);

  dependencyReady = false;
  const failed = await fetch(`${base}/health/ready`);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).status, "not_ready");

  dependencyReady = true;
  const recovered = await fetch(`${base}/health/ready`);
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).status, "ready");

  console.log(JSON.stringify({
    status: "passed",
    mode: "local",
    concurrentRequests: requests,
    successfulRequests: requests,
    readinessFailureStatus: 503,
    readinessRecoveredStatus: 200,
    externalCalls: false
  }));
} finally {
  await new Promise(resolve => server.close(resolve));
}
