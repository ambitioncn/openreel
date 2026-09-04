import { DomainError } from "./core.js";

export const seedAudioMusicRoute = Object.freeze({
  provider: "volcengine-seedaudio",
  model: "seed-audio-1.0",
  capability: "text-to-music",
  credentialReference: "OPENREEL_SEEDAUDIO_API_KEY",
  automaticRetries: 0,
  maximumCallsPerRun: 1,
  maximumCostCny: 10,
  enabledByDefault: false,
});

const text = (value, field, maximum = 500) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || [...normalized].length > maximum) throw new DomainError("MUSIC_REQUEST_INVALID", `${field} is required`, 422);
  return normalized;
};

const validAudio = output => {
  const mimeType = String(output?.mimeType || "").toLowerCase(), bytes = Buffer.from(output?.bytes || []);
  const mp3 = mimeType === "audio/mpeg" && (bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
  const wav = mimeType === "audio/wav" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
  if ((!mp3 && !wav) || bytes.length > 25 * 1024 * 1024) throw new DomainError("MUSIC_PROVIDER_ASSET_INVALID", "music provider returned invalid audio", 502);
  return { mimeType, bytes };
};

export function createSeedAudioMusicService({ enabled = false, quote, transport, maximumCostCny = 10 } = {}) {
  if (enabled !== true) return Object.freeze({ route: seedAudioMusicRoute, enabled: false, generate: async () => { throw new DomainError("MUSIC_PROVIDER_DISABLED", "real music generation is disabled", 503); } });
  if (typeof quote !== "function" || typeof transport !== "function" || !Number.isFinite(maximumCostCny) || maximumCostCny <= 0 || maximumCostCny > 10) throw new DomainError("MUSIC_PROVIDER_CONFIG_INVALID", "music provider configuration is invalid", 503);
  return Object.freeze({
    route: Object.freeze({ ...seedAudioMusicRoute, maximumCostCny }),
    enabled: true,
    async generate(request = {}, authority = {}) {
      if (authority.authorized !== true || authority.maximumCalls !== 1 || authority.automaticRetries !== 0) throw new DomainError("MUSIC_PROVIDER_AUTHORIZATION_REQUIRED", "music generation requires an exact one-call zero-retry authorization", 403);
      const normalized = { model: seedAudioMusicRoute.model, prompt: text(request.prompt, "prompt"), durationSeconds: Number(request.durationSeconds), idempotencyKey: text(request.idempotencyKey, "idempotencyKey", 200) };
      if (![5, 10].includes(normalized.durationSeconds)) throw new DomainError("MUSIC_REQUEST_INVALID", "durationSeconds must be 5 or 10", 422);
      const estimate = await quote(normalized);
      if (estimate?.currency !== "CNY" || !Number.isFinite(estimate.maximumCostCny) || estimate.maximumCostCny <= 0 || estimate.maximumCostCny > maximumCostCny) throw new DomainError("MUSIC_PRICE_UNVERIFIED", "music generation requires an exact bounded CNY preflight", 403);
      let output;
      try { output = await transport(normalized); }
      catch (error) { throw new DomainError("MUSIC_PROVIDER_FAILED", "music generation failed without retry", 502, { retryable: false, providerCode: typeof error?.code === "string" ? error.code.slice(0, 80) : null }); }
      const audio = validAudio(output);
      return { ...audio, provider: seedAudioMusicRoute.provider, model: seedAudioMusicRoute.model, providerJobId: text(output?.providerJobId, "providerJobId", 200), durationSeconds: normalized.durationSeconds, usage: output?.usage || null, quote: { currency: "CNY", maximumCostCny: estimate.maximumCostCny }, calls: 1, retries: 0 };
    }
  });
}
