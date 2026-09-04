import test from "node:test";
import assert from "node:assert/strict";
import { createPublishingRequest } from "../src/publishing-proxy.js";

test("publishing proxy defaults to the native fetch transport", () => {
  assert.equal(createPublishingRequest(""), fetch);
});

test("publishing proxy accepts only an unauthenticated loopback HTTP endpoint", () => {
  assert.equal(typeof createPublishingRequest("http://127.0.0.1:4188"), "function");
  for (const value of ["https://127.0.0.1:4188", "http://example.com:4188", "http://user:pass@127.0.0.1:4188", "not-a-url"]) {
    assert.throws(() => createPublishingRequest(value), error => error.code === "PUBLISHING_PROXY_CONFIG_INVALID");
  }
});
