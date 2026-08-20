import test from "node:test";
import assert from "node:assert/strict";
import { createQwenTtsClient, loadQwenTtsConfig, qwenTtsContract } from "../src/qwen-tts.js";

function createWav() {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(16_000, 4);
  format.writeUInt32LE(32_000, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  const audio = Buffer.from([0, 0]);
  const payload = Buffer.concat([
    Buffer.from("WAVEfmt "),
    Buffer.from([16, 0, 0, 0]),
    format,
    Buffer.from("data"),
    Buffer.from([audio.length, 0, 0, 0]),
    audio,
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

const wav = createWav();

test("Qwen TTS config is pinned to the owner-approved Tailnet service and disabled by default", () => {
  assert.equal(loadQwenTtsConfig({}).enabled, false);
  assert.equal(loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "false" }).enabled, false);
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  assert.equal(config.endpoint, "http://100.124.97.3:8004/v1/audio/speech");
  assert.equal(qwenTtsContract.realCallsRequireAuthorization, true);
  for (const baseUrl of [
    "",
    "http://127.0.0.1:8004",
    "http://100.124.97.3:8004/",
    " http://100.124.97.3:8004",
    new String("http://100.124.97.3:8004"),
    null,
  ]) {
    assert.throws(
      () => loadQwenTtsConfig({ OPENREEL_QWEN_TTS_BASE_URL: baseUrl }),
      error => error.code === "QWEN_TTS_CONFIG_INVALID" && /exactly match/.test(error.message),
    );
  }
});

test("Qwen TTS config rejects ambiguous enabled environment values", () => {
  for (const enabled of ["", "TRUE", "False", "1", "0", " true", "false ", true, false, 1, 0, null]) {
    assert.throws(
      () => loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: enabled }),
      error => error.code === "QWEN_TTS_CONFIG_INVALID" && /environment value/.test(error.message),
    );
  }
});

test("Qwen TTS config reads only canonical own environment data properties", () => {
  let getterReads = 0;
  const inherited = Object.create({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const hidden = {};
  Object.defineProperty(hidden, "OPENREEL_QWEN_TTS_ENABLED", { value: "true", enumerable: false });
  const accessor = {};
  Object.defineProperty(accessor, "OPENREEL_QWEN_TTS_ENABLED", { enumerable: true, get() { getterReads += 1; return "true"; } });
  for (const env of [null, [], inherited, hidden, accessor]) {
    assert.throws(
      () => loadQwenTtsConfig(env),
      error => error.code === "QWEN_TTS_CONFIG_INVALID" && /environment/.test(error.message),
    );
  }
  assert.equal(getterReads, 0);
  assert.equal(loadQwenTtsConfig(Object.assign(Object.create(null), { OPENREEL_QWEN_TTS_ENABLED: "true" })).enabled, true);
});

test("Qwen TTS client rejects injected contract-limit drift", () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const override of [
    { maxAudioBytes: config.maxAudioBytes + 1 },
    { maxInputCharacters: config.maxInputCharacters + 1 },
  ]) {
    assert.throws(
      () => createQwenTtsClient({ config: { ...config, ...override }, fetchImpl: async () => { throw new Error("must not call"); } }),
      error => error.code === "QWEN_TTS_CONFIG_INVALID",
    );
  }
});

test("Qwen TTS client accepts only an exact boolean enabled state", () => {
  const disabled = loadQwenTtsConfig({});
  assert.equal(createQwenTtsClient({ config: disabled }), null);
  for (const enabled of ["true", "false", 1, 0, {}, []]) {
    assert.throws(
      () => createQwenTtsClient({ config: { ...disabled, enabled }, fetchImpl: async () => { throw new Error("must not call"); } }),
      error => error.code === "QWEN_TTS_CONFIG_INVALID" && /exact boolean/.test(error.message),
    );
  }
  assert.ok(createQwenTtsClient({ config: loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" }) }));
});

test("Qwen TTS client rejects invalid or over-budget request timeouts", () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  assert.equal(qwenTtsContract.maximumRequestTimeoutMs, 60_000);
  for (const timeoutMs of [0, -1, 60_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createQwenTtsClient({ config, timeoutMs, fetchImpl: async () => { throw new Error("must not call"); } }),
      error => error.code === "QWEN_TTS_CONFIG_INVALID" && /timeout/.test(error.message),
    );
  }
  assert.ok(createQwenTtsClient({ config, timeoutMs: 1 }));
  assert.ok(createQwenTtsClient({ config, timeoutMs: 60_000 }));
});

test("Qwen TTS client reads only canonical option data properties", () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  let getterReads = 0;
  let calls = 0;
  const inherited = Object.create({ config });
  const hidden = {};
  Object.defineProperty(hidden, "config", { value: config, enumerable: false });
  const accessor = {};
  Object.defineProperty(accessor, "config", { enumerable: true, get() { getterReads += 1; return config; } });
  for (const options of [
    null,
    [],
    inherited,
    hidden,
    accessor,
    { config, extra: true },
    { config, [Symbol("scope")]: "extra" },
  ]) {
    assert.throws(
      () => createQwenTtsClient(options),
      error => error.code === "QWEN_TTS_CONFIG_INVALID" && /client options/.test(error.message),
    );
  }
  assert.equal(getterReads, 0);
  assert.equal(calls, 0);
  assert.ok(createQwenTtsClient({ config, fetchImpl: async () => { calls += 1; } }));
  assert.equal(calls, 0);
});

test("Qwen TTS client rejects a non-callable transport during construction", () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const fetchImpl of [null, false, 0, "fetch", {}, []]) {
    assert.throws(
      () => createQwenTtsClient({ config, fetchImpl }),
      error => error.code === "QWEN_TTS_CONFIG_INVALID" && /transport/.test(error.message),
    );
  }
  assert.ok(createQwenTtsClient({ config, fetchImpl: async () => { throw new Error("must not call during construction"); } }));
});

test("Qwen TTS client remains gated and maps the reviewed OpenAI-compatible request", async () => {
  const calls = [];
  const client = createQwenTtsClient({
    config: loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(wav, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(wav.length) } });
    },
  });
  await assert.rejects(client.synthesize({ input: "你好" }), error => error.code === "QWEN_TTS_CALL_GATED");
  for (const authorized of ["true", 1, {}, []]) {
    await assert.rejects(client.synthesize({ input: "你好" }, { authorized }), error => error.code === "QWEN_TTS_CALL_GATED");
  }
  assert.equal(calls.length, 0);
  const result = await client.synthesize({ input: " 你好 ", language: "chinese", voice: "default", response_format: "wav" }, { authorized: true });
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.inputCharacters, 2);
  assert.equal(result.durationSeconds, 1 / 16_000);
  assert.equal(result.audioFormat, "pcm");
  assert.equal(result.bitsPerSample, 16);
  assert.equal(result.sampleRate, 16_000);
  assert.equal(result.channels, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://100.124.97.3:8004/v1/audio/speech");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["accept-encoding"], "identity");
  assert.deepEqual(JSON.parse(calls[0].options.body), { input: "你好", response_format: "wav", language: "chinese", voice: "default" });
});

test("Qwen TTS client admits only languages advertised by the reviewed live contract", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  let calls = 0;
  const client = createQwenTtsClient({
    config,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not call for an invalid language");
    },
  });
  assert.deepEqual(qwenTtsContract.languages, ["auto", "chinese", "english", "french", "german", "italian", "japanese", "korean", "portuguese", "russian", "spanish"]);
  for (const language of ["zh", "Chinese", " chinese ", "mandarin", "", 1]) {
    await assert.rejects(
      client.synthesize({ input: "你好", language }, { authorized: true }),
      error => error.code === "QWEN_TTS_INPUT_INVALID",
    );
  }
  assert.equal(calls, 0);
});

test("Qwen TTS client accepts only a canonical authorization data property", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  let calls = 0;
  let getterReads = 0;
  const client = createQwenTtsClient({
    config,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not call");
    },
  });
  const hidden = {};
  Object.defineProperty(hidden, "authorized", { value: true, enumerable: false });
  const accessor = {};
  Object.defineProperty(accessor, "authorized", { enumerable: true, get() { getterReads += 1; return true; } });
  for (const authorization of [
    null,
    [],
    Object.create({ authorized: true }),
    hidden,
    accessor,
    { authorized: true, scope: "extra" },
    { authorized: true, [Symbol("scope")]: "hidden" },
  ]) {
    await assert.rejects(
      client.synthesize({ input: "x" }, authorization),
      error => error.code === "QWEN_TTS_CALL_GATED",
    );
  }
  assert.equal(getterReads, 0);
  assert.equal(calls, 0);
});

test("Qwen TTS client rejects unsupported input, upstream failures and invalid media", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const never = createQwenTtsClient({ config, fetchImpl: async () => { throw new Error("must not call"); } });
  for (const input of ["", "字".repeat(1001)]) await assert.rejects(never.synthesize({ input }, { authorized: true }), error => error.code === "QWEN_TTS_INPUT_INVALID");
  await assert.rejects(never.synthesize({ input: "x", response_format: "mp3" }, { authorized: true }), error => error.code === "QWEN_TTS_INPUT_INVALID");
  await assert.rejects(never.synthesize({ input: "x", unknown: true }, { authorized: true }), error => error.code === "QWEN_TTS_INPUT_INVALID");
  const rejected = createQwenTtsClient({ config, fetchImpl: async () => new Response("no", { status: 503 }) });
  await assert.rejects(rejected.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_PROVIDER_ERROR" && error.details.upstreamStatus === 503);
  const invalid = createQwenTtsClient({ config, fetchImpl: async () => new Response(Buffer.from("not wav"), { status: 200, headers: { "content-type": "audio/wav" } }) });
  await assert.rejects(invalid.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
});

test("Qwen TTS client accepts only canonical plain-record request fields", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  let calls = 0;
  const client = createQwenTtsClient({
    config,
    fetchImpl: async () => {
      calls += 1;
      return new Response(wav, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(wav.length) } });
    },
  });
  for (const request of [
    null,
    [],
    Object.create({ input: "inherited" }),
    { input: "x", response_format: "" },
    { input: "x", response_format: null },
    { input: "x", response_format: new String("wav") },
  ]) {
    await assert.rejects(client.synthesize(request, { authorized: true }), error => error.code === "QWEN_TTS_INPUT_INVALID");
  }
  assert.equal(calls, 0);

  const result = await client.synthesize({ input: "x", instruct: ` ${"😀".repeat(500)} ` }, { authorized: true });
  assert.equal(result.mimeType, "audio/wav");
  await assert.rejects(
    client.synthesize({ input: "x", instruct: "😀".repeat(501) }, { authorized: true }),
    error => error.code === "QWEN_TTS_INPUT_INVALID" && /instruct/.test(error.message),
  );
  assert.equal(calls, 1);
});

test("Qwen TTS client rejects hidden, symbol and accessor request fields before reading values", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  let calls = 0;
  let getterReads = 0;
  const client = createQwenTtsClient({
    config,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("must not call");
    },
  });
  const hidden = { input: "x" };
  Object.defineProperty(hidden, "voice", { value: "hidden", enumerable: false });
  const accessor = { input: "x" };
  Object.defineProperty(accessor, "voice", { enumerable: true, get() { getterReads += 1; return "accessor"; } });
  for (const request of [
    hidden,
    accessor,
    { input: "x", [Symbol("authority")]: true },
  ]) {
    await assert.rejects(
      client.synthesize(request, { authorized: true }),
      error => error.code === "QWEN_TTS_INPUT_INVALID" && /noncanonical field/.test(error.message),
    );
  }
  assert.equal(getterReads, 0);
  assert.equal(calls, 0);
});

test("Qwen TTS client accepts only a complete 200 response", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const status of [204, 206]) {
    let bodyRead = false;
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => ({
        ok: true,
        status,
        headers: new Headers({ "content-type": "audio/wav", "content-length": String(wav.length) }),
        body: { getReader() { bodyRead = true; throw new Error("must not read a non-200 response"); } },
      }),
    });
    await assert.rejects(client.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_PROVIDER_ERROR" && error.details.upstreamStatus === status);
    assert.equal(bodyRead, false);
  }
});

test("Qwen TTS client fails closed on malformed HTTP response envelopes", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const malformedResponses = [
    null,
    undefined,
    "response",
    {},
    { status: 99, headers: new Headers() },
    { status: 600, headers: new Headers() },
    { status: 200.5, headers: new Headers() },
    { status: 200, headers: null },
    { status: 200, headers: {} },
  ];
  for (const response of malformedResponses) {
    const client = createQwenTtsClient({ config, fetchImpl: async () => response });
    await assert.rejects(
      client.synthesize({ input: "x" }, { authorized: true }),
      error => error.code === "QWEN_TTS_RESULT_INVALID" && /HTTP response/.test(error.message),
    );
  }

  const unreadable = createQwenTtsClient({
    config,
    fetchImpl: async () => ({ status: 200, headers: new Headers({ "content-type": "audio/wav" }), body: null }),
  });
  await assert.rejects(
    unreadable.synthesize({ input: "x" }, { authorized: true }),
    error => error.code === "QWEN_TTS_RESULT_INVALID" && /readable audio body/.test(error.message),
  );
});

test("Qwen TTS client sanitizes unreadable response envelope properties before body access", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const property of ["status", "headers"]) {
    let bodyRead = false;
    const response = {
      status: 200,
      headers: new Headers({ "content-type": "audio/wav" }),
      body: { getReader() { bodyRead = true; throw new Error("must not read body"); } },
    };
    Object.defineProperty(response, property, {
      enumerable: true,
      get() { throw new Error(`private ${property} getter failure`); },
    });
    const client = createQwenTtsClient({ config, fetchImpl: async () => response });
    await assert.rejects(
      client.synthesize({ input: "x" }, { authorized: true }),
      error => error.code === "QWEN_TTS_RESULT_INVALID"
        && /invalid HTTP response/.test(error.message)
        && error.details.responseReadFailed === true
        && !error.message.includes("private"),
    );
    assert.equal(bodyRead, false);
  }
});

test("Qwen TTS client sanitizes unreadable response headers before body access", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const headers of [
    { get() { throw new Error("private header getter failure"); } },
    { get(name) { return name === "content-type" ? { toString() { throw new Error("private header value failure"); } } : null; } },
  ]) {
    let bodyRead = false;
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => ({
        status: 200,
        headers,
        body: { getReader() { bodyRead = true; throw new Error("must not read body"); } },
      }),
    });
    await assert.rejects(
      client.synthesize({ input: "x" }, { authorized: true }),
      error => error.code === "QWEN_TTS_RESULT_INVALID"
        && /unreadable HTTP headers/.test(error.message)
        && error.details.headerReadFailed === true
        && !error.message.includes("private"),
    );
    assert.equal(bodyRead, false);
  }
});

test("Qwen TTS client sanitizes unreadable audio-source properties before body access", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const property of ["body", "arrayBuffer"]) {
    let otherPropertyRead = false;
    const response = {
      status: 200,
      headers: new Headers({ "content-type": "audio/wav" }),
      body: null,
      arrayBuffer: async () => wav,
    };
    Object.defineProperty(response, property, {
      enumerable: true,
      get() { throw new Error(`private ${property} getter failure`); },
    });
    const otherProperty = property === "body" ? "arrayBuffer" : "body";
    const otherDescriptor = Object.getOwnPropertyDescriptor(response, otherProperty);
    Object.defineProperty(response, otherProperty, {
      enumerable: true,
      get() {
        otherPropertyRead = true;
        return otherDescriptor.value;
      },
    });
    const client = createQwenTtsClient({ config, fetchImpl: async () => response });
    await assert.rejects(
      client.synthesize({ input: "x" }, { authorized: true }),
      error => error.code === "QWEN_TTS_RESULT_INVALID"
        && /unreadable audio body/.test(error.message)
        && error.details.bodyReadFailed === true
        && !error.message.includes("private"),
    );
    if (property === "body") assert.equal(otherPropertyRead, false);
  }
});

test("Qwen TTS client normalizes buffered and streamed audio read failures", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const buffered = createQwenTtsClient({
    config,
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "audio/wav" }),
      body: null,
      arrayBuffer: async () => { throw Object.assign(new Error("private buffered failure"), { code: "E_BUFFER" }); },
    }),
  });
  await assert.rejects(
    buffered.synthesize({ input: "x" }, { authorized: true }),
    error => error.code === "QWEN_TTS_RESULT_INVALID" && error.details.causeCode === "E_BUFFER" && !error.message.includes("private"),
  );

  let released = false;
  const streamed = createQwenTtsClient({
    config,
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "audio/wav" }),
      body: {
        getReader: () => ({
          read: async () => { throw Object.assign(new Error("private streamed failure"), { code: "E_STREAM" }); },
          releaseLock: () => { released = true; },
        }),
      },
    }),
  });
  await assert.rejects(
    streamed.synthesize({ input: "x" }, { authorized: true }),
    error => error.code === "QWEN_TTS_RESULT_INVALID" && error.details.causeCode === "E_STREAM" && !error.message.includes("private"),
  );
  assert.equal(released, true);
});

test("Qwen TTS client sanitizes stream-reader acquisition and contract failures", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const invalidReaders = [
    () => { throw new Error("private reader acquisition failure"); },
    () => null,
    () => ({}),
    () => ({ read: async () => ({ done: true }), cancel: async () => {}, releaseLock: null }),
  ];
  for (const getReader of invalidReaders) {
    let audioBytesRead = false;
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => ({
        status: 200,
        headers: new Headers({ "content-type": "audio/wav" }),
        body: {
          getReader() {
            const reader = getReader();
            if (reader && typeof reader === "object" && typeof reader.read === "function") {
              const read = reader.read;
              reader.read = async () => { audioBytesRead = true; return read(); };
            }
            return reader;
          },
        },
      }),
    });
    await assert.rejects(
      client.synthesize({ input: "x" }, { authorized: true }),
      error => error.code === "QWEN_TTS_RESULT_INVALID"
        && /stream could not be opened/.test(error.message)
        && error.details.streamReaderFailed === true
        && !error.message.includes("private"),
    );
    assert.equal(audioBytesRead, false);
  }
});

test("Qwen TTS client rejects malformed streamed chunks before byte concatenation", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const value of [null, undefined, {}, "audio", new DataView(new ArrayBuffer(2))]) {
    let released = false;
    let reads = 0;
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => ({
        status: 200,
        headers: new Headers({ "content-type": "audio/wav" }),
        body: {
          getReader: () => ({
            read: async () => (++reads === 1 ? { done: false, value } : { done: true }),
            releaseLock: () => { released = true; },
          }),
        },
      }),
    });
    await assert.rejects(
      client.synthesize({ input: "x" }, { authorized: true }),
      error => error.code === "QWEN_TTS_RESULT_INVALID"
        && /invalid chunk/.test(error.message)
        && error.details.streamChunkInvalid === true,
    );
    assert.equal(reads, 1);
    assert.equal(released, true);
  }
});

test("Qwen TTS client rejects noncanonical configuration before reading values or calling fetch", () => {
  const canonical = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  let getterReads = 0;
  let calls = 0;
  const hidden = { ...canonical };
  Object.defineProperty(hidden, "scope", { value: "extra", enumerable: false });
  const accessor = { ...canonical };
  Object.defineProperty(accessor, "enabled", { enumerable: true, get() { getterReads += 1; return true; } });
  for (const config of [
    [],
    Object.create(canonical),
    hidden,
    accessor,
    { ...canonical, extra: true },
    { ...canonical, [Symbol("scope")]: "extra" },
  ]) {
    assert.throws(
      () => createQwenTtsClient({ config, fetchImpl: async () => { calls += 1; } }),
      error => error.code === "QWEN_TTS_CONFIG_INVALID",
    );
  }
  assert.equal(getterReads, 0);
  assert.equal(calls, 0);
});

test("Qwen TTS client rejects MIME drift and cancels an oversized streamed response", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const wrongType = createQwenTtsClient({ config, fetchImpl: async () => new Response(wav, { status: 200, headers: { "content-type": "text/plain" } }) });
  await assert.rejects(wrongType.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");

  let canceled = false;
  const oversizedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(config.maxAudioBytes));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { canceled = true; },
  });
  const oversized = createQwenTtsClient({ config, fetchImpl: async () => new Response(oversizedBody, { status: 200, headers: { "content-type": "audio/wav" } }) });
  await assert.rejects(oversized.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  assert.equal(canceled, true);
});

test("Qwen TTS byte-limit rejection survives stream cancellation failure", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  let reads = 0;
  let released = false;
  const client = createQwenTtsClient({
    config,
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "audio/wav" }),
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            return reads === 1
              ? { done: false, value: new Uint8Array(config.maxAudioBytes + 1) }
              : { done: true, value: undefined };
          },
          cancel: async () => { throw new Error("private cancellation failure"); },
          releaseLock: () => { released = true; },
        }),
      },
    }),
  });
  await assert.rejects(
    client.synthesize({ input: "x" }, { authorized: true }),
    error => error.code === "QWEN_TTS_RESULT_INVALID"
      && /exceeded the byte limit/.test(error.message)
      && error.details.cancellationFailed === true
      && !error.message.includes("private"),
  );
  assert.equal(reads, 1);
  assert.equal(released, true);
});

test("Qwen TTS stream cleanup failure preserves the primary rejection and stays sanitized", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const [read, expectedMessage, expectedCauseCode] of [
    [async () => { throw Object.assign(new Error("private read failure"), { code: "E_PRIVATE_READ" }); }, /could not be read/, "E_PRIVATE_READ"],
    [async () => ({ done: false, value: new Uint8Array(config.maxAudioBytes + 1) }), /exceeded the byte limit/, undefined],
  ]) {
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => ({
        status: 200,
        headers: new Headers({ "content-type": "audio/wav" }),
        body: {
          getReader: () => ({
            read,
            cancel: async () => {},
            releaseLock: () => { throw new Error("private release failure"); },
          }),
        },
      }),
    });
    await assert.rejects(
      client.synthesize({ input: "x" }, { authorized: true }),
      error => error.code === "QWEN_TTS_RESULT_INVALID"
        && expectedMessage.test(error.message)
        && error.details.releaseFailed === true
        && error.details.causeCode === expectedCauseCode
        && !error.message.includes("private"),
    );
  }

  const complete = createQwenTtsClient({
    config,
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "audio/wav" }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          releaseLock: () => { throw new Error("private release failure"); },
        }),
      },
    }),
  });
  await assert.rejects(
    complete.synthesize({ input: "x" }, { authorized: true }),
    error => error.code === "QWEN_TTS_RESULT_INVALID"
      && /could not be released/.test(error.message)
      && error.details.releaseFailed === true
      && !error.message.includes("private"),
  );
});

test("Qwen TTS client rejects content encoding before reading the audio body", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const encoding of ["gzip", "br"]) {
    let read = false;
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "audio/wav", "content-encoding": encoding }),
        body: { getReader() { read = true; throw new Error("must not read encoded audio"); } },
      }),
    });
    await assert.rejects(client.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID" && /encoded/.test(error.message));
    assert.equal(read, false);
  }
});

test("Qwen TTS client rejects truncated and overlong bodies against a declared response length", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const [body, declared] of [[wav.subarray(0, wav.length - 1), wav.length], [wav, wav.length - 1], [wav, 0]]) {
    const mismatched = createQwenTtsClient({
      config,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "audio/wav", "content-length": String(declared) }),
        body: null,
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      }),
    });
    await assert.rejects(mismatched.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID" && /length/.test(error.message));
  }
});

test("Qwen TTS client rejects noncanonical content lengths before reading the audio body", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  for (const declared of ["01", "+46", "4.6e1", "46.0", "46, 46", " 46"]) {
    let bodyRead = false;
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => ({
        status: 200,
        headers: { get(name) { return name.toLowerCase() === "content-type" ? "audio/wav" : name.toLowerCase() === "content-length" ? declared : null; } },
        body: { getReader() { bodyRead = true; throw new Error("must not read an ambiguously framed body"); } },
      }),
    });
    await assert.rejects(client.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID" && /content length/.test(error.message));
    assert.equal(bodyRead, false);
  }
});

test("Qwen TTS client rejects malformed RIFF structure and missing required chunks", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const malformed = [];
  const wrongRiffSize = Buffer.from(wav);
  wrongRiffSize.writeUInt32LE(wav.length - 9, 4);
  malformed.push(wrongRiffSize);
  const missingData = Buffer.from(wav.subarray(0, 36));
  missingData.writeUInt32LE(missingData.length - 8, 4);
  malformed.push(missingData);
  const overrun = Buffer.from(wav);
  overrun.writeUInt32LE(0xfffffff0, 40);
  malformed.push(overrun);
  for (const bytes of malformed) {
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(bytes.length) } }),
    });
    await assert.rejects(client.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  }
});

test("Qwen TTS client enforces the 600-second result boundary before persistence", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const createDurationWav = seconds => {
    const sampleRate = 8_000;
    const audio = Buffer.alloc(sampleRate * seconds);
    const format = Buffer.alloc(16);
    format.writeUInt16LE(1, 0);
    format.writeUInt16LE(1, 2);
    format.writeUInt32LE(sampleRate, 4);
    format.writeUInt32LE(sampleRate, 8);
    format.writeUInt16LE(1, 12);
    format.writeUInt16LE(8, 14);
    const payload = Buffer.concat([Buffer.from("WAVEfmt "), Buffer.from([16, 0, 0, 0]), format, Buffer.from("data"), Buffer.from([audio.length & 0xff, (audio.length >>> 8) & 0xff, (audio.length >>> 16) & 0xff, (audio.length >>> 24) & 0xff]), audio]);
    const header = Buffer.alloc(8);
    header.write("RIFF", 0);
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  const bounded = createDurationWav(600);
  const accepted = createQwenTtsClient({ config, fetchImpl: async () => new Response(bounded, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(bounded.length) } }) });
  assert.equal((await accepted.synthesize({ input: "x" }, { authorized: true })).durationSeconds, 600);
  assert.equal(qwenTtsContract.maximumAudioDurationSeconds, 600);

  const overlong = createDurationWav(601);
  const rejected = createQwenTtsClient({ config, fetchImpl: async () => new Response(overlong, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(overlong.length) } }) });
  await assert.rejects(rejected.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID" && /overlong/.test(error.message));
});

test("Qwen TTS client rejects inconsistent WAV format and frame metadata", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const malformed = [];
  for (const [offset, value, width] of [
    [20, 2, 2],
    [22, 3, 2],
    [24, 7_999, 4],
    [28, 31_999, 4],
    [32, 4, 2],
    [34, 12, 2],
  ]) {
    const bytes = Buffer.from(wav);
    width === 2 ? bytes.writeUInt16LE(value, offset) : bytes.writeUInt32LE(value, offset);
    malformed.push(bytes);
  }
  const misalignedData = Buffer.concat([wav, Buffer.from([0, 0])]);
  misalignedData.writeUInt32LE(misalignedData.length - 8, 4);
  misalignedData.writeUInt32LE(3, 40);
  malformed.push(misalignedData);
  for (const bytes of malformed) {
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(bytes.length) } }),
    });
    await assert.rejects(client.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  }
});

test("Qwen TTS client accepts only canonical supported fmt chunk layouts", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const withFormatExtension = extension => {
    const formatSize = 16 + extension.length;
    const payload = Buffer.concat([
      wav.subarray(8, 16),
      Buffer.from([formatSize, 0, 0, 0]),
      wav.subarray(20, 36),
      extension,
      wav.subarray(36),
    ]);
    const header = Buffer.alloc(8);
    header.write("RIFF", 0);
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  const canonicalExtended = withFormatExtension(Buffer.from([0, 0]));
  const accepted = createQwenTtsClient({
    config,
    fetchImpl: async () => new Response(canonicalExtended, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(canonicalExtended.length) } }),
  });
  assert.equal((await accepted.synthesize({ input: "x" }, { authorized: true })).audioFormat, "pcm");

  for (const bytes of [
    withFormatExtension(Buffer.from([0])),
    withFormatExtension(Buffer.from([1, 0, 0])),
    withFormatExtension(Buffer.from([1, 0, 0, 0])),
  ]) {
    const rejected = createQwenTtsClient({
      config,
      fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(bytes.length) } }),
    });
    await assert.rejects(rejected.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  }
});

test("Qwen TTS client accepts only canonical zero-valued RIFF padding", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const withOddJunkChunk = padding => {
    const payload = Buffer.concat([
      wav.subarray(8, 36),
      Buffer.from("JUNK"),
      Buffer.from([1, 0, 0, 0]),
      Buffer.from([0x41, padding]),
      wav.subarray(36),
    ]);
    const header = Buffer.alloc(8);
    header.write("RIFF", 0);
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  const canonical = withOddJunkChunk(0);
  const accepted = createQwenTtsClient({
    config,
    fetchImpl: async () => new Response(canonical, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(canonical.length) } }),
  });
  assert.equal((await accepted.synthesize({ input: "x" }, { authorized: true })).audioFormat, "pcm");

  const noncanonical = withOddJunkChunk(0x7f);
  const rejected = createQwenTtsClient({
    config,
    fetchImpl: async () => new Response(noncanonical, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(noncanonical.length) } }),
  });
  await assert.rejects(rejected.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
});

test("Qwen TTS client rejects noncanonical binary RIFF chunk identifiers", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const payload = Buffer.concat([
    wav.subarray(8, 36),
    Buffer.from([0x4a, 0x00, 0x4e, 0x4b]),
    Buffer.from([0, 0, 0, 0]),
    wav.subarray(36),
  ]);
  const bytes = Buffer.alloc(payload.length + 8);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(payload.length, 4);
  payload.copy(bytes, 8);
  const client = createQwenTtsClient({
    config,
    fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(bytes.length) } }),
  });
  await assert.rejects(client.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
});

test("Qwen TTS client requires matching fact frames and finite IEEE-float samples", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const createFloatWav = (factFrames, sample = 0) => {
    const format = Buffer.alloc(16);
    format.writeUInt16LE(3, 0);
    format.writeUInt16LE(1, 2);
    format.writeUInt32LE(16_000, 4);
    format.writeUInt32LE(64_000, 8);
    format.writeUInt16LE(4, 12);
    format.writeUInt16LE(32, 14);
    const fact = factFrames === null ? Buffer.alloc(0) : Buffer.concat([Buffer.from("fact"), Buffer.from([4, 0, 0, 0]), Buffer.from([factFrames, 0, 0, 0])]);
    const audio = Buffer.alloc(4);
    audio.writeFloatLE(sample);
    const payload = Buffer.concat([Buffer.from("WAVEfmt "), Buffer.from([16, 0, 0, 0]), format, fact, Buffer.from("data"), Buffer.from([4, 0, 0, 0]), audio]);
    const header = Buffer.alloc(8);
    header.write("RIFF", 0);
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  const acceptedBytes = createFloatWav(1);
  const accepted = createQwenTtsClient({
    config,
    fetchImpl: async () => new Response(acceptedBytes, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(acceptedBytes.length) } }),
  });
  assert.equal((await accepted.synthesize({ input: "x" }, { authorized: true })).audioFormat, "ieee-float");

  for (const bytes of [createFloatWav(null), createFloatWav(2), createFloatWav(1, Number.NaN), createFloatWav(1, Number.POSITIVE_INFINITY)]) {
    const rejected = createQwenTtsClient({
      config,
      fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(bytes.length) } }),
    });
    await assert.rejects(rejected.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
  }
});

test("Qwen TTS client reconciles optional PCM fact frames when present", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const withFact = factFrames => {
    const fact = Buffer.alloc(12);
    fact.write("fact", 0);
    fact.writeUInt32LE(4, 4);
    fact.writeUInt32LE(factFrames, 8);
    const payload = Buffer.concat([wav.subarray(8, 36), fact, wav.subarray(36)]);
    const header = Buffer.alloc(8);
    header.write("RIFF", 0);
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  const matching = withFact(1);
  const accepted = createQwenTtsClient({
    config,
    fetchImpl: async () => new Response(matching, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(matching.length) } }),
  });
  assert.equal((await accepted.synthesize({ input: "x" }, { authorized: true })).audioFormat, "pcm");

  const mismatched = withFact(2);
  const rejected = createQwenTtsClient({
    config,
    fetchImpl: async () => new Response(mismatched, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(mismatched.length) } }),
  });
  await assert.rejects(rejected.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
});

test("Qwen TTS client bounds RIFF chunk-count amplification", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const withJunkChunks = count => {
    const chunks = Buffer.alloc(count * 8);
    for (let offset = 0; offset < chunks.length; offset += 8) chunks.write("JUNK", offset);
    const payload = Buffer.concat([wav.subarray(8, 36), chunks, wav.subarray(36)]);
    const header = Buffer.alloc(8);
    header.write("RIFF", 0);
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };
  const bounded = withJunkChunks(1_022);
  const accepted = createQwenTtsClient({
    config,
    fetchImpl: async () => new Response(bounded, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(bounded.length) } }),
  });
  assert.equal((await accepted.synthesize({ input: "x" }, { authorized: true })).audioFormat, "pcm");

  const amplified = withJunkChunks(1_023);
  const rejected = createQwenTtsClient({
    config,
    fetchImpl: async () => new Response(amplified, { status: 200, headers: { "content-type": "audio/wav", "content-length": String(amplified.length) } }),
  });
  await assert.rejects(rejected.synthesize({ input: "x" }, { authorized: true }), error => error.code === "QWEN_TTS_RESULT_INVALID");
});

test("Qwen TTS client admits only genuine ArrayBuffer buffered bodies", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  const response = value => ({
    status: 200,
    headers: { get: name => name === "content-type" ? "audio/wav" : null },
    body: null,
    arrayBuffer: async () => value,
  });
  const accepted = createQwenTtsClient({
    config,
    fetchImpl: async () => response(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)),
  });
  assert.equal((await accepted.synthesize({ input: "x" }, { authorized: true })).audioFormat, "pcm");

  for (const value of [wav, new Uint8Array(wav), "RIFF", {}, null, undefined]) {
    const rejected = createQwenTtsClient({ config, fetchImpl: async () => response(value) });
    await assert.rejects(
      rejected.synthesize({ input: "x" }, { authorized: true }),
      error => error.code === "QWEN_TTS_RESULT_INVALID"
        && error.details?.arrayBufferInvalid === true
        && !JSON.stringify(error).includes("RIFF"),
    );
  }
});

test("Qwen TTS client admits only canonical stream read-result records", async () => {
  const config = loadQwenTtsConfig({ OPENREEL_QWEN_TTS_ENABLED: "true" });
  let getterReads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "done", { enumerable: true, get() { getterReads += 1; return true; } });
  const hidden = {};
  Object.defineProperty(hidden, "done", { enumerable: false, value: true });
  const malformed = [
    null,
    [],
    {},
    { done: "true" },
    { done: false },
    { done: true, value: new Uint8Array() },
    { done: true, extra: false },
    accessor,
    hidden,
  ];
  for (const readResult of malformed) {
    let released = false;
    const client = createQwenTtsClient({
      config,
      fetchImpl: async () => ({
        status: 200,
        headers: { get: name => name === "content-type" ? "audio/wav" : null },
        body: { getReader: () => ({ read: async () => readResult, releaseLock: () => { released = true; } }) },
      }),
    });
    await assert.rejects(
      client.synthesize({ input: "x" }, { authorized: true }),
      error => error.code === "QWEN_TTS_RESULT_INVALID" && error.details?.streamReadResultInvalid === true,
    );
    assert.equal(released, true);
  }
  assert.equal(getterReads, 0);
});
