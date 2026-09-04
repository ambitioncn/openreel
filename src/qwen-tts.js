import { DomainError } from "./core.js";
import { inspectWav } from "./wav.js";

const APPROVED_BASE_URL = "http://100.124.97.3:8004";
const FORMATS = new Set(["wav"]);
const LANGUAGES = new Set(["auto", "chinese", "english", "french", "german", "italian", "japanese", "korean", "portuguese", "russian", "spanish"]);
const MAX_INPUT_CHARACTERS = 1_000;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 600;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const REQUEST_FIELDS = new Set(["input", "response_format", "language", "speaker", "voice", "instruct", "instructions"]);
const CONFIG_FIELDS = new Set(["enabled", "baseUrl", "endpoint", "maxInputCharacters", "maxAudioBytes"]);
const CLIENT_OPTION_FIELDS = new Set(["config", "fetchImpl", "timeoutMs"]);

export function loadQwenTtsConfig(env = process.env) {
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS environment must be an object", 503);
  }
  const environmentValue = name => {
    const descriptor = Object.getOwnPropertyDescriptor(env, name);
    if (!descriptor) {
      if (name in env) throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS environment values must be own data properties", 503);
      return undefined;
    }
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS environment values must be enumerable data properties", 503);
    }
    return descriptor.value;
  };
  const enabledValue = environmentValue("OPENREEL_QWEN_TTS_ENABLED");
  if (enabledValue !== undefined && enabledValue !== "true" && enabledValue !== "false") {
    throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS enabled environment value must be exactly true or false", 503);
  }
  const enabled = enabledValue === "true";
  const configuredBaseUrl = environmentValue("OPENREEL_QWEN_TTS_BASE_URL");
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== APPROVED_BASE_URL) {
    throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS base URL must exactly match the owner-approved Tailnet service", 503);
  }
  const baseUrl = configuredBaseUrl === undefined ? APPROVED_BASE_URL : configuredBaseUrl;
  if (baseUrl !== APPROVED_BASE_URL) throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS base URL must match the owner-approved Tailnet service", 503);
  return Object.freeze({
    enabled,
    baseUrl,
    endpoint: `${baseUrl}/v1/audio/speech`,
    maxInputCharacters: MAX_INPUT_CHARACTERS,
    maxAudioBytes: MAX_AUDIO_BYTES,
  });
}

function requestBody(value = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new DomainError("QWEN_TTS_INPUT_INVALID", "request must be a plain record", 400);
  }
  for (const name of Reflect.ownKeys(value)) {
    const descriptor = typeof name === "string" ? Object.getOwnPropertyDescriptor(value, name) : null;
    if (typeof name !== "string" || !REQUEST_FIELDS.has(name) || !descriptor?.enumerable || !("value" in descriptor)) {
      throw new DomainError("QWEN_TTS_INPUT_INVALID", "request contains a noncanonical field", 400);
    }
  }
  if (typeof value.input !== "string" || !value.input.trim() || [...value.input.trim()].length > MAX_INPUT_CHARACTERS) {
    throw new DomainError("QWEN_TTS_INPUT_INVALID", `input must contain 1-${MAX_INPUT_CHARACTERS} characters`, 400);
  }
  const responseFormat = value.response_format === undefined ? "wav" : value.response_format;
  const body = { input: value.input.trim(), response_format: responseFormat };
  if (!FORMATS.has(body.response_format)) throw new DomainError("QWEN_TTS_INPUT_INVALID", "only reviewed WAV output is supported", 400);
  for (const name of ["language", "speaker", "voice", "instruct", "instructions"]) {
    if (value[name] === undefined || value[name] === null) continue;
    const normalized = typeof value[name] === "string" ? value[name].trim() : "";
    if (!normalized || [...normalized].length > 500) throw new DomainError("QWEN_TTS_INPUT_INVALID", `${name} is invalid`, 400);
    if (name === "language" && value[name] !== normalized) {
      throw new DomainError("QWEN_TTS_INPUT_INVALID", "language must be canonical", 400);
    }
    body[name] = normalized;
  }
  if (body.language !== undefined && !LANGUAGES.has(body.language)) {
    throw new DomainError("QWEN_TTS_INPUT_INVALID", "language must match a reviewed Qwen TTS language", 400);
  }
  return body;
}

function requestAuthorization(value = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new DomainError("QWEN_TTS_CALL_GATED", "a precise real-generation authorization is required", 403);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== "authorized") {
    throw new DomainError("QWEN_TTS_CALL_GATED", "a precise real-generation authorization is required", 403);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "authorized");
  if (!descriptor?.enumerable || !("value" in descriptor) || descriptor.value !== true) {
    throw new DomainError("QWEN_TTS_CALL_GATED", "a precise real-generation authorization is required", 403);
  }
}

function responseHeader(response, name, fallback = null) {
  try {
    const value = response.headers.get(name);
    return value === null ? fallback : String(value);
  } catch {
    throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS returned unreadable HTTP headers", 502, { headerReadFailed: true });
  }
}

function responseEnvelope(response) {
  try {
    if (response === null || typeof response !== "object") throw new Error("invalid response");
    const status = response.status;
    const headers = response.headers;
    if (
      !Number.isInteger(status)
      || status < 100
      || status > 599
      || headers === null
      || typeof headers !== "object"
      || typeof headers.get !== "function"
    ) throw new Error("invalid response");
    return { status, headers };
  } catch {
    throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS returned an invalid HTTP response", 502, { responseReadFailed: true });
  }
}


function responseAudioSource(response) {
  try {
    const body = response.body;
    const arrayBuffer = response.arrayBuffer;
    if (body !== null && body !== undefined && typeof body.getReader === "function") {
      return { body, arrayBuffer: null };
    }
    if (typeof arrayBuffer === "function") return { body: null, arrayBuffer: arrayBuffer.bind(response) };
  } catch {
    throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS returned an unreadable audio body", 502, { bodyReadFailed: true });
  }
  throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS response has no readable audio body", 502);
}

function streamReadResult(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio stream returned an invalid read result", 502, { streamReadResultInvalid: true });
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some(name => typeof name !== "string" || (name !== "done" && name !== "value"))) {
    throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio stream returned an invalid read result", 502, { streamReadResultInvalid: true });
  }
  const doneDescriptor = Object.getOwnPropertyDescriptor(value, "done");
  const valueDescriptor = Object.getOwnPropertyDescriptor(value, "value");
  if (
    !doneDescriptor?.enumerable
    || !("value" in doneDescriptor)
    || typeof doneDescriptor.value !== "boolean"
    || (valueDescriptor && (!valueDescriptor.enumerable || !("value" in valueDescriptor)))
    || (!doneDescriptor.value && !valueDescriptor)
    || (doneDescriptor.value && valueDescriptor?.value !== undefined)
  ) {
    throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio stream returned an invalid read result", 502, { streamReadResultInvalid: true });
  }
  return { done: doneDescriptor.value, value: valueDescriptor?.value };
}

async function readLimitedBody(source, maximumBytes) {
  if (!source.body) {
    let value;
    try {
      value = await source.arrayBuffer();
    } catch (cause) {
      throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio body could not be read", 502, {
        causeCode: typeof cause?.code === "string" ? cause.code : null,
      });
    }
    if (!(value instanceof ArrayBuffer)) {
      throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio body returned invalid bytes", 502, { arrayBufferInvalid: true });
    }
    const bytes = Buffer.from(value);
    if (bytes.length > maximumBytes) throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio exceeded the byte limit", 502);
    return bytes;
  }
  let reader;
  try {
    reader = source.body.getReader();
    if (
      reader === null
      || typeof reader !== "object"
      || typeof reader.read !== "function"
      || typeof reader.releaseLock !== "function"
    ) throw new Error("invalid reader");
  } catch {
    throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio stream could not be opened", 502, { streamReaderFailed: true });
  }
  const chunks = [];
  let total = 0;
  let failure = null;
  try {
    while (true) {
      const { done, value } = streamReadResult(await reader.read());
      if (done) break;
      if (!ArrayBuffer.isView(value) || value instanceof DataView) {
        throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio stream returned an invalid chunk", 502, { streamChunkInvalid: true });
      }
      let chunk;
      try {
        chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      } catch {
        throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio stream returned an unreadable chunk", 502, { streamChunkInvalid: true });
      }
      total += chunk.byteLength;
      if (total > maximumBytes) {
        let cancellationFailed = false;
        try {
          await reader.cancel("Qwen TTS audio exceeded the byte limit");
        } catch {
          cancellationFailed = true;
        }
        throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio exceeded the byte limit", 502, { cancellationFailed });
      }
      chunks.push(chunk);
    }
  } catch (cause) {
    failure = cause instanceof DomainError
      ? cause
      : new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio body could not be read", 502, {
        causeCode: typeof cause?.code === "string" ? cause.code : null,
      });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      if (failure) failure.details = { ...(failure.details || {}), releaseFailed: true };
      else failure = new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio stream could not be released", 502, { releaseFailed: true });
    }
  }
  if (failure) throw failure;
  return Buffer.concat(chunks, total);
}

export function createQwenTtsClient(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options) || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS client options must be a plain record", 503);
  }
  for (const name of Reflect.ownKeys(options)) {
    const descriptor = typeof name === "string" ? Object.getOwnPropertyDescriptor(options, name) : null;
    if (typeof name !== "string" || !CLIENT_OPTION_FIELDS.has(name) || !descriptor?.enumerable || !("value" in descriptor)) {
      throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS client options contain a noncanonical field", 503);
    }
  }
  const config = options.config;
  const fetchImpl = options.fetchImpl === undefined ? globalThis.fetch : options.fetchImpl;
  const timeoutMs = options.timeoutMs === undefined ? 60_000 : options.timeoutMs;
  if (config === undefined || config === null) return null;
  if (typeof fetchImpl !== "function") {
    throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS transport must be a function", 503);
  }
  if (typeof config !== "object" || Array.isArray(config) || Object.getPrototypeOf(config) !== Object.prototype) {
    throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS configuration must be a plain record", 503);
  }
  const configKeys = Reflect.ownKeys(config);
  for (const name of configKeys) {
    const descriptor = typeof name === "string" ? Object.getOwnPropertyDescriptor(config, name) : null;
    if (typeof name !== "string" || !CONFIG_FIELDS.has(name) || !descriptor?.enumerable || !("value" in descriptor)) {
      throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS configuration contains a noncanonical field", 503);
    }
  }
  if (config.enabled === false || config.enabled === undefined || config.enabled === null) return null;
  if (config.enabled !== true) throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS enabled state must be an exact boolean", 503);
  if (
    config.baseUrl !== APPROVED_BASE_URL
    || config.endpoint !== `${APPROVED_BASE_URL}/v1/audio/speech`
    || config.maxInputCharacters !== MAX_INPUT_CHARACTERS
    || config.maxAudioBytes !== MAX_AUDIO_BYTES
  ) throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS configuration drifted from the approved Tailnet service contract", 503);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_REQUEST_TIMEOUT_MS) {
    throw new DomainError("QWEN_TTS_CONFIG_INVALID", "Qwen TTS timeout must remain within the approved request budget", 503);
  }
  return Object.freeze({
    schema: () => Object.freeze({
      id: "qwen-tts-tailnet",
      kind: "audio",
      mode: "text-to-audio",
      endpointVisibility: "server-only-tailnet",
      resultMimeTypes: ["audio/wav"],
      controls: ["language", "speaker", "voice", "instruct", "instructions", "audio-format"],
      languages: [...LANGUAGES],
      realCallsEnabled: false,
    }),
    async synthesize(value, authorization = {}) {
      requestAuthorization(authorization);
      const body = requestBody(value);
      let response;
      try {
        response = await fetchImpl(config.endpoint, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json", accept: "audio/wav", "accept-encoding": "identity" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new DomainError("QWEN_TTS_PROVIDER_ERROR", "Qwen TTS service is unavailable", 502, { causeCode: typeof cause?.code === "string" ? cause.code : null });
      }
      const envelope = responseEnvelope(response);
      if (envelope.status !== 200) throw new DomainError("QWEN_TTS_PROVIDER_ERROR", "Qwen TTS service rejected the request", 502, { upstreamStatus: envelope.status });
      const contentType = responseHeader(envelope, "content-type", "").split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "audio/wav" && contentType !== "audio/x-wav") throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS returned an unsupported media type", 502);
      const contentEncoding = responseHeader(envelope, "content-encoding", "identity").trim().toLowerCase();
      if (contentEncoding !== "identity") throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS returned encoded audio", 502);
      const declaredHeader = responseHeader(envelope, "content-length");
      if (declaredHeader !== null && !/^(0|[1-9]\d*)$/.test(declaredHeader)) {
        throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS returned an invalid content length", 502);
      }
      const declared = declaredHeader === null ? 0 : Number(declaredHeader);
      if (!Number.isSafeInteger(declared) || declared > config.maxAudioBytes) throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio exceeded the byte limit", 502);
      const audioSource = responseAudioSource(response);
      let bytes;
      try {
        bytes = await readLimitedBody(audioSource, config.maxAudioBytes);
      } catch (cause) {
        if (cause instanceof DomainError) throw cause;
        throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio body could not be read", 502, {
          causeCode: typeof cause?.code === "string" ? cause.code : null,
        });
      }
      if (declaredHeader !== null && declared !== bytes.length) throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS audio length did not match the response declaration", 502);
      const metadata = inspectWav(bytes);
      if (!metadata || metadata.durationSeconds > MAX_AUDIO_DURATION_SECONDS) throw new DomainError("QWEN_TTS_RESULT_INVALID", "Qwen TTS returned invalid or overlong WAV audio", 502);
      return Object.freeze({ mimeType: "audio/wav", bytes, inputCharacters: [...body.input].length, ...metadata });
    },
  });
}

export const qwenTtsContract = Object.freeze({
  approvedBaseUrl: APPROVED_BASE_URL,
  maximumInputCharacters: MAX_INPUT_CHARACTERS,
  maximumAudioBytes: MAX_AUDIO_BYTES,
  maximumAudioDurationSeconds: MAX_AUDIO_DURATION_SECONDS,
  maximumRequestTimeoutMs: MAX_REQUEST_TIMEOUT_MS,
  languages: Object.freeze([...LANGUAGES]),
  realCallsRequireAuthorization: true,
});
