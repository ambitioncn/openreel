import test from "node:test";
import assert from "node:assert/strict";
import { isQwenTtsModel, prepareQwenTtsJob, qwenTtsPreparedMessage } from "../src/qwen-tts-ui.js";

test("Qwen browser preparation creates a local-job request without an execution authority field", () => {
  const request = prepareQwenTtsJob({ nodeId: "node-1", prompt: "  你好  ", duration: 2, audioSpec: { intent: "voice", format: "wav" }, reviewed: true, language: " Chinese ", instruct: " warm ", idempotencyKey: "once" });
  assert.deepEqual(request, { nodeId: "node-1", prompt: "你好", duration: 2, audioSpec: { intent: "voice", format: "wav" }, reviewed: true, language: "Chinese", instruct: "warm", idempotencyKey: "once" });
  assert.equal("authorized" in request, false);
  assert.equal("execute" in request, false);
  assert.equal(isQwenTtsModel({ id: "qwen-tts-tailnet", adapterId: "qwen-tts" }), true);
});

test("Qwen browser preparation fails closed and reports that no voice was generated", () => {
  assert.throws(() => prepareQwenTtsJob({ nodeId: "node-1", prompt: " ", idempotencyKey: "once" }), /requires/);
  assert.match(qwenTtsPreparedMessage({ id: "job-1" }), /No voice was generated/);
  assert.match(qwenTtsPreparedMessage({ id: "job-1" }), /server-side authorization/);
});

test("Qwen browser preparation accepts only canonical own-property request fields", () => {
  const accessorRequest = { nodeId: "node-1", idempotencyKey: "once" };
  Object.defineProperty(accessorRequest, "prompt", { enumerable: true, get: () => "hidden execution" });
  const hiddenRequest = { nodeId: "node-1", prompt: "hello", idempotencyKey: "once" };
  Object.defineProperty(hiddenRequest, "reviewed", { value: true, enumerable: false });
  for (const request of [
    null,
    [],
    Object.create({ nodeId: "node-1", prompt: "inherited", idempotencyKey: "once" }),
    { nodeId: new String("node-1"), prompt: "hello", idempotencyKey: "once" },
    { nodeId: "node-1", prompt: "hello", idempotencyKey: 1 },
    { nodeId: "node-1", prompt: "hello", idempotencyKey: "once", language: null },
    { nodeId: "node-1", prompt: "hello", idempotencyKey: "once", instruct: " " },
    { nodeId: "node-1", prompt: "hello", idempotencyKey: "once", reviewed: "true" },
    { nodeId: "node-1", prompt: "x".repeat(1_001), idempotencyKey: "once" },
    { nodeId: "node-1", prompt: "hello", idempotencyKey: "once", language: "x".repeat(501) },
    { nodeId: "node-1", prompt: "hello", idempotencyKey: "once", instruct: "😀".repeat(501) },
    { nodeId: "node-1", prompt: "hello", idempotencyKey: "once", authorized: true },
    { nodeId: "node-1", prompt: "hello", idempotencyKey: "once", [Symbol("authority")]: true },
    accessorRequest,
    hiddenRequest,
  ]) assert.throws(() => prepareQwenTtsJob(request), TypeError);

  assert.deepEqual(
    prepareQwenTtsJob({ nodeId: " node-1 ", prompt: ` ${"😀".repeat(1_000)} `, idempotencyKey: " once ", reviewed: false, language: "x".repeat(500) }),
    { nodeId: "node-1", prompt: "😀".repeat(1_000), duration: undefined, audioSpec: undefined, reviewed: false, language: "x".repeat(500), idempotencyKey: "once" },
  );
});
