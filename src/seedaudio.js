import { AdapterGateError } from "./adapters.js";

const OPTION_FIELDS = new Set(["enabled", "transport"]);
const REQUEST_FIELDS = new Set(["prompt", "durationSeconds", "mode"]);

function assertCanonicalRecord(value, label, fields) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AdapterGateError("SEEDEDAUDIO_CONFIG_INVALID", `${label} must be a plain record`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : null;
    if (typeof key !== "string" || !fields.has(key) || !descriptor?.enumerable || !("value" in descriptor)) {
      throw new AdapterGateError("SEEDEDAUDIO_CONFIG_INVALID", `${label} contains a noncanonical field`);
    }
  }
}

export const seedAudio10Descriptor = Object.freeze({
  id: "seedaudio-1.0",
  provider: "volcengine-seedaudio",
  model: "SeedAudio 1.0",
  kind: "audio",
  defaultEnabled: false,
  executable: false,
  executionDisabled: true,
  requiresHumanGate: true,
  requiresCredential: true,
  costed: true,
  capabilities: Object.freeze({
    audio: Object.freeze({
      modes: Object.freeze(["text-to-audio"]),
      durations: Object.freeze([5, 10]),
      maxReferences: 0,
    }),
  }),
});

export function createSeedAudio10Adapter(options = {}) {
  assertCanonicalRecord(options, "SeedAudio adapter options", OPTION_FIELDS);
  const enabled = options.enabled ?? false;
  if (enabled !== false) {
    throw new AdapterGateError("SEEDEDAUDIO_EXECUTION_DISABLED", "SeedAudio 1.0 is statically execution-disabled");
  }
  if (options.transport !== undefined && typeof options.transport !== "function") {
    throw new AdapterGateError("SEEDEDAUDIO_CONFIG_INVALID", "SeedAudio transport must be a function when supplied for negative testing");
  }
  return Object.freeze({
    ...seedAudio10Descriptor,
    prepare(request = {}) {
      assertCanonicalRecord(request, "SeedAudio request", REQUEST_FIELDS);
      const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
      const durationSeconds = request.durationSeconds ?? 5;
      const mode = request.mode ?? "text-to-audio";
      if (!prompt || [...prompt].length > 500) throw new AdapterGateError("SEEDEDAUDIO_REQUEST_INVALID", "prompt must contain 1 to 500 Unicode code points");
      if (!seedAudio10Descriptor.capabilities.audio.durations.includes(durationSeconds)) throw new AdapterGateError("SEEDEDAUDIO_REQUEST_INVALID", "durationSeconds must be 5 or 10");
      if (mode !== "text-to-audio") throw new AdapterGateError("SEEDEDAUDIO_REQUEST_INVALID", "mode must be text-to-audio");
      return Object.freeze({
        adapterId: seedAudio10Descriptor.id,
        model: seedAudio10Descriptor.model,
        kind: "audio",
        mode,
        prompt,
        durationSeconds,
        executable: false,
        executionDisabled: true,
        requiresHumanGate: true,
        providerCalls: 0,
      });
    },
    execute() {
      throw new AdapterGateError("SEEDEDAUDIO_EXECUTION_DISABLED", "SeedAudio 1.0 execution requires a new exact single-call authorization");
    },
  });
}
