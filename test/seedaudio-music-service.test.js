import assert from "node:assert/strict";
import test from "node:test";
import { createSeedAudioMusicService, seedAudioMusicRoute } from "../src/seedaudio-music-service.js";

const mp3 = () => Buffer.concat([Buffer.from("ID3"), Buffer.alloc(128, 7)]);
const request = { prompt: "轻快温暖的海滩舞蹈纯音乐，无人声", durationSeconds: 5, idempotencyKey: "project:music:v1" };
const authority = { authorized: true, maximumCalls: 1, automaticRetries: 0 };

test("SeedAudio music is default-off and records the exact bounded route", async () => {
  assert.equal(seedAudioMusicRoute.provider, "volcengine-seedaudio");
  assert.equal(seedAudioMusicRoute.model, "seed-audio-1.0");
  assert.equal(seedAudioMusicRoute.maximumCostCny, 10);
  await assert.rejects(createSeedAudioMusicService().generate(request, authority), error => error.code === "MUSIC_PROVIDER_DISABLED");
});

test("SeedAudio music performs one quoted zero-retry call and validates returned media", async () => {
  let quotes = 0, calls = 0;
  const service = createSeedAudioMusicService({ enabled: true, quote: async value => (quotes += 1, assert.equal(value.model, "seed-audio-1.0"), { currency: "CNY", maximumCostCny: 8 }), transport: async value => (calls += 1, assert.equal(value.idempotencyKey, request.idempotencyKey), { mimeType: "audio/mpeg", bytes: mp3(), providerJobId: "music-job-1", usage: { currency: "CNY", costMicros: 8_000_000, unitScale: 1_000_000 } }) });
  const result = await service.generate(request, authority);
  assert.equal(quotes, 1); assert.equal(calls, 1); assert.equal(result.retries, 0); assert.equal(result.providerJobId, "music-job-1"); assert.deepEqual(result.quote, { currency: "CNY", maximumCostCny: 8 });
});

test("SeedAudio music fails closed before or after one call without fallback", async () => {
  for (const [quoteResult, output, code] of [
    [{ currency: "CNY", maximumCostCny: 11 }, null, "MUSIC_PRICE_UNVERIFIED"],
    [{ currency: "USD", maximumCostCny: 1 }, null, "MUSIC_PRICE_UNVERIFIED"],
    [{ currency: "CNY", maximumCostCny: 8 }, { mimeType: "audio/mpeg", bytes: Buffer.from("bad"), providerJobId: "x" }, "MUSIC_PROVIDER_ASSET_INVALID"]
  ]) {
    let calls = 0;
    const service = createSeedAudioMusicService({ enabled: true, quote: async () => quoteResult, transport: async () => (calls += 1, output) });
    await assert.rejects(service.generate(request, authority), error => error.code === code);
    assert.ok(calls <= 1);
  }
  const service = createSeedAudioMusicService({ enabled: true, quote: async () => ({ currency: "CNY", maximumCostCny: 8 }), transport: async () => { throw Object.assign(new Error("secret upstream detail"), { code: "UPSTREAM_503" }); } });
  await assert.rejects(service.generate(request, authority), error => error.code === "MUSIC_PROVIDER_FAILED" && error.details.retryable === false && !error.message.includes("secret"));
});

test("SeedAudio music rejects widened authority and noncanonical requests", async () => {
  const service = createSeedAudioMusicService({ enabled: true, quote: async () => ({ currency: "CNY", maximumCostCny: 8 }), transport: async () => ({ mimeType: "audio/mpeg", bytes: mp3(), providerJobId: "music-job" }) });
  for (const [value, auth, code] of [[request, { ...authority, maximumCalls: 2 }, "MUSIC_PROVIDER_AUTHORIZATION_REQUIRED"], [{ ...request, durationSeconds: 6 }, authority, "MUSIC_REQUEST_INVALID"], [{ ...request, prompt: "" }, authority, "MUSIC_REQUEST_INVALID"]]) await assert.rejects(service.generate(value, auth), error => error.code === code);
});
