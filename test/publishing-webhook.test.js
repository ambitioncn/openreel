import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createPublishingWebhookIngress, validatePublishingCallbackUrl } from "../src/publishing-webhook.js";

test("callback admission requires stable public HTTPS DNS", async () => {
  const publicResolve = async () => [{ address: "203.0.113.20" }];
  assert.equal((await validatePublishingCallbackUrl("https://callbacks.example/events", { resolve: publicResolve })).addresses[0], "203.0.113.20");
  for (const [url, resolve, code] of [
    ["http://callbacks.example/events", publicResolve, "PUBLISHING_CALLBACK_URL_REJECTED"],
    ["https://127.0.0.1/events", publicResolve, "PUBLISHING_CALLBACK_SSRF_REJECTED"],
    ["https://callbacks.example/events", async () => [{ address: "169.254.169.254" }], "PUBLISHING_CALLBACK_SSRF_REJECTED"]
  ]) await assert.rejects(validatePublishingCallbackUrl(url, { resolve }), error => error.code === code);
  let turn = 0;
  await assert.rejects(validatePublishingCallbackUrl("https://callbacks.example/events", { resolve: async () => [{ address: turn++ ? "203.0.113.21" : "203.0.113.20" }] }), error => error.code === "PUBLISHING_CALLBACK_REBINDING_REJECTED");
});

test("webhook ingress authenticates, rejects stale/replayed events and isolates rate keys", () => {
  let clock = 1_800_000_000_000;
  const secret = Buffer.alloc(32, 7), rawBody = Buffer.from('{"status":"published"}'), sign = (timestamp, eventId, body = rawBody) => createHmac("sha256", secret).update(`${timestamp}.${eventId}.`).update(body).digest("hex");
  const ingress = createPublishingWebhookIngress({ secrets: () => secret, now: () => clock, rate: { max: 2, windowMs: 60_000 } });
  const request = (eventId, overrides = {}) => ({ tenantId: "tenant-1", accountId: "account-1", platform: "tiktok", eventId, timestamp: clock, rawBody, signature: sign(clock, eventId), ...overrides });
  assert.equal(ingress(request("event-1")).accepted, true);
  assert.throws(() => ingress(request("event-1")), error => error.code === "PUBLISHING_WEBHOOK_REPLAY_REJECTED");
  assert.throws(() => ingress(request("event-2", { signature: "00" })), error => error.code === "PUBLISHING_WEBHOOK_RATE_LIMITED");
  clock += 60_001;
  assert.throws(() => ingress(request("event-3", { timestamp: clock - 400_000, signature: sign(clock - 400_000, "event-3") })), error => error.code === "PUBLISHING_WEBHOOK_STALE");
  assert.throws(() => ingress(request("event-4", { signature: "00" })), error => error.code === "PUBLISHING_WEBHOOK_SIGNATURE_REJECTED");
  assert.equal(ingress(request("event-5", { accountId: "account-2" })).accepted, true);
});
