import test from "node:test";
import assert from "node:assert/strict";
import { runStandardArkProbe, safeArkFailure } from "../scripts/standard-ark-seedance-probe.mjs";

test("standard Ark probe fails closed without the exact confirmation", async () => {
  let calls = 0;
  const result = await runStandardArkProbe({ env: {}, fetchImpl: async () => { calls += 1; } });
  assert.deepEqual(result, { outcome: "not_submitted", classification: "confirmation_missing", submissions: 0 });
  assert.equal(calls, 0);
});

test("standard Ark probe retains bounded safe HTTP diagnostics", async () => {
  const result = await runStandardArkProbe({
    env: { OPENREEL_STANDARD_ARK_PROBE_CONFIRM: "SUBMIT_ONE_STANDARD_ARK_PROBE", OPENREEL_STANDARD_ARK_SEEDANCE_ENDPOINT: "https://ark.example.test/api/v3/contents/generations/tasks", OPENREEL_STANDARD_ARK_API_KEY: "private", OPENREEL_STANDARD_ARK_SEEDANCE_MODEL: "seedance" },
    fetchImpl: async () => ({ ok: false, status: 400, headers: new Headers({ "x-request-id": "private-request-id" }), text: async () => JSON.stringify({ error: { code: "InvalidParameter", param: "content", message: "content is invalid" }, secret: "do-not-retain" }) })
  });
  assert.equal(result.submissions, 1);
  assert.equal(result.httpStatus, 400);
  assert.equal(result.providerCode, "InvalidParameter");
  assert.equal(result.providerParam, "content");
  assert.equal(result.providerMessage, "content is invalid");
  assert.match(result.providerRequestIdHash, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(result).includes("private-request-id"), false);
  assert.equal(JSON.stringify(result).includes("do-not-retain"), false);
});

test("standard Ark diagnostics discard messages containing credentials or URLs", () => {
  const result = safeArkFailure({ status: 403, headers: new Headers(), bodyText: JSON.stringify({ error: { code: "Forbidden", message: "Bearer secret-token rejected at https://private.example" } }) });
  assert.equal(result.classification, "provider_auth_error");
  assert.equal(result.providerCode, "Forbidden");
  assert.equal(result.providerMessage, undefined);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
});

test("standard Ark diagnostics never retain a request id embedded in a message", () => {
  const result = safeArkFailure({ status: 403, headers: new Headers({ "x-request-id": "private-request-id" }), bodyText: JSON.stringify({ error: { code: "AccountOverdueError", message: "Account overdue. Request id: 0217private" } }) });
  assert.equal(result.providerCode, "AccountOverdueError");
  assert.equal(result.providerMessage, undefined);
  assert.match(result.providerRequestIdHash, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(result).includes("0217private"), false);
});

test("standard Ark probe distinguishes malformed provider responses", async () => {
  const result = await runStandardArkProbe({
    env: { OPENREEL_STANDARD_ARK_PROBE_CONFIRM: "SUBMIT_ONE_STANDARD_ARK_PROBE", OPENREEL_STANDARD_ARK_SEEDANCE_ENDPOINT: "https://ark.example.test/api/v3/contents/generations/tasks", OPENREEL_STANDARD_ARK_API_KEY: "private", OPENREEL_STANDARD_ARK_SEEDANCE_MODEL: "seedance" },
    fetchImpl: async () => ({ ok: false, status: 502, headers: new Headers(), text: async () => "<html>upstream failed</html>" })
  });
  assert.deepEqual(result, { submissions: 1, outcome: "failed", classification: "provider_http_error", httpStatus: 502 });
});
