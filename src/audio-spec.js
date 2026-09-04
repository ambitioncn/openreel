const INTENTS = new Set(["voice", "music", "sfx"]);
const FORMATS = new Set(["wav", "mp3"]);
const SAMPLE_RATES = new Set([16000, 24000, 44100, 48000]);
const FIELDS = new Set(["intent", "voice", "speed", "pitch", "volume", "sampleRate", "format"]);

export function normalizeAudioSpec(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("audioSpec must be a plain record");
  for (const name of Reflect.ownKeys(value)) {
    const descriptor = typeof name === "string" ? Object.getOwnPropertyDescriptor(value, name) : null;
    if (typeof name !== "string" || !FIELDS.has(name) || !descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("audioSpec contains a noncanonical field");
  }
  if (!INTENTS.has(value.intent)) throw new TypeError("audioSpec.intent must be voice, music, or sfx");
  const spec = { intent: value.intent };
  if (value.voice !== undefined) {
    if (value.intent !== "voice" || typeof value.voice !== "string" || !value.voice.trim() || [...value.voice.trim()].length > 64) throw new TypeError("audioSpec.voice requires a voice intent and 1-64 characters");
    spec.voice = value.voice.trim();
  }
  for (const [field, min, max] of [["speed", 0.5, 2], ["pitch", -12, 12], ["volume", 0, 2]]) {
    if (value[field] === undefined) continue;
    if (value.intent !== "voice" || !Number.isFinite(value[field]) || value[field] < min || value[field] > max) throw new TypeError(`audioSpec.${field} requires a voice intent and a value from ${min} to ${max}`);
    spec[field] = value[field];
  }
  if (value.sampleRate !== undefined) {
    if (!SAMPLE_RATES.has(value.sampleRate)) throw new TypeError("audioSpec.sampleRate is unsupported");
    spec.sampleRate = value.sampleRate;
  }
  if (value.format !== undefined) {
    if (!FORMATS.has(value.format)) throw new TypeError("audioSpec.format is unsupported");
    spec.format = value.format;
  }
  return Object.freeze(spec);
}
