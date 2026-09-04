export const QWEN_TTS_MODEL_ID = "qwen-tts-tailnet";
const MAX_INPUT_CHARACTERS = 1_000;
const MAX_OPTIONAL_CHARACTERS = 500;

export function isQwenTtsModel(model) {
  return model?.id === QWEN_TTS_MODEL_ID && model?.adapterId === "qwen-tts";
}

export function prepareQwenTtsJob(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Qwen TTS preparation requires a plain request record");
  }
  const allowed = new Set(["nodeId", "prompt", "duration", "audioSpec", "reviewed", "language", "instruct", "idempotencyKey"]);
  const keys = Reflect.ownKeys(value);
  if (keys.some(name => typeof name !== "string" || !allowed.has(name))) throw new TypeError("Qwen TTS preparation contains an unsupported field");
  if (keys.some(name => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return !descriptor?.enumerable || !("value" in descriptor);
  })) throw new TypeError("Qwen TTS preparation requires enumerable data fields");
  const { nodeId, prompt, duration, audioSpec, reviewed, language, instruct, idempotencyKey } = value;
  if (typeof nodeId !== "string" || !nodeId.trim() || typeof prompt !== "string" || !prompt.trim() || [...prompt.trim()].length > MAX_INPUT_CHARACTERS || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw new TypeError("Qwen TTS preparation requires a node, prompt and idempotency key");
  }
  if (reviewed !== undefined && typeof reviewed !== "boolean") throw new TypeError("Qwen TTS preparation reviewed must be a boolean");
  for (const [name, optional] of [["language", language], ["instruct", instruct]]) {
    if (optional !== undefined && (typeof optional !== "string" || !optional.trim() || [...optional.trim()].length > MAX_OPTIONAL_CHARACTERS)) throw new TypeError(`Qwen TTS preparation ${name} must be a non-empty bounded string`);
  }
  return {
    nodeId: nodeId.trim(),
    prompt: prompt.trim(),
    duration,
    audioSpec,
    reviewed: reviewed === true,
    ...(language?.trim() ? { language: language.trim() } : {}),
    ...(instruct?.trim() ? { instruct: instruct.trim() } : {}),
    idempotencyKey: idempotencyKey.trim(),
  };
}

export function qwenTtsPreparedMessage(job) {
  return "Prepared: " + job.id + " is queued locally. No voice was generated; execution requires a separate server-side authorization.";
}
