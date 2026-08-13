const REQUIRED_CONTROLS = Object.freeze(["voice", "speed", "pitch", "volume", "sample-rate", "audio-format"]);
const RESULT_MIME_TYPES = new Set(["audio/mpeg", "audio/wav"]);
const ALLOWED_FIELDS = new Set(["schemaVersion", "modelId", "provider", "endpoint", "mode", "controls", "maxDurationSeconds", "resultMimeTypes", "pricing"]);
const PRICING_FIELDS = new Set(["version", "sourceUrl", "verifiedAt", "currency", "unitScale", "maxCostUnits", "inputUnitsPerMillion", "outputUnitsPerMillion"]);

const text = (value, field) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
};

const exactFields = (value, allowed, field) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) throw new TypeError(`${field}.${unknown} is not allowed`);
};

const httpsUrl = (value, field) => {
  let url;
  try { url = new URL(text(value, field)); } catch { throw new TypeError(`${field} must be an HTTPS URL`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname) throw new TypeError(`${field} must be a credential-free HTTPS URL without query or fragment`);
  return url.href;
};

const nonNegativeInteger = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
};

export function assessAudioProviderCandidate(candidate) {
  exactFields(candidate, ALLOWED_FIELDS, "candidate");
  if (candidate.schemaVersion !== 1) throw new TypeError("candidate.schemaVersion must be 1");
  if (candidate.mode !== "text-to-audio") throw new TypeError("candidate.mode must be text-to-audio");
  if (!Array.isArray(candidate.controls) || candidate.controls.length !== REQUIRED_CONTROLS.length || candidate.controls.some((control, index) => control !== REQUIRED_CONTROLS[index])) throw new TypeError("candidate.controls must exactly match the reviewed audio control order");
  if (!Number.isSafeInteger(candidate.maxDurationSeconds) || candidate.maxDurationSeconds < 1 || candidate.maxDurationSeconds > 300) throw new TypeError("candidate.maxDurationSeconds must be from 1 to 300");
  if (!Array.isArray(candidate.resultMimeTypes) || !candidate.resultMimeTypes.length || new Set(candidate.resultMimeTypes).size !== candidate.resultMimeTypes.length || candidate.resultMimeTypes.some(type => !RESULT_MIME_TYPES.has(type))) throw new TypeError("candidate.resultMimeTypes must be unique supported audio MIME types");

  exactFields(candidate.pricing, PRICING_FIELDS, "candidate.pricing");
  const pricing = {
    version: text(candidate.pricing.version, "candidate.pricing.version"),
    sourceUrl: httpsUrl(candidate.pricing.sourceUrl, "candidate.pricing.sourceUrl"),
    verifiedAt: text(candidate.pricing.verifiedAt, "candidate.pricing.verifiedAt"),
    currency: candidate.pricing.currency,
    unitScale: nonNegativeInteger(candidate.pricing.unitScale, "candidate.pricing.unitScale"),
    maxCostUnits: nonNegativeInteger(candidate.pricing.maxCostUnits, "candidate.pricing.maxCostUnits"),
    inputUnitsPerMillion: nonNegativeInteger(candidate.pricing.inputUnitsPerMillion, "candidate.pricing.inputUnitsPerMillion"),
    outputUnitsPerMillion: nonNegativeInteger(candidate.pricing.outputUnitsPerMillion, "candidate.pricing.outputUnitsPerMillion")
  };
  if (pricing.currency !== "USD" || pricing.unitScale !== 10_000 || pricing.maxCostUnits === 0 || pricing.inputUnitsPerMillion + pricing.outputUnitsPerMillion === 0) throw new TypeError("candidate.pricing must have positive immutable USD rates and reservation ceiling");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pricing.verifiedAt)) throw new TypeError("candidate.pricing.verifiedAt must be YYYY-MM-DD");

  return Object.freeze({
    admitted: true,
    executable: false,
    requiresHumanGate: true,
    candidate: Object.freeze({
      schemaVersion: 1,
      modelId: text(candidate.modelId, "candidate.modelId"),
      provider: text(candidate.provider, "candidate.provider"),
      endpoint: httpsUrl(candidate.endpoint, "candidate.endpoint"),
      mode: candidate.mode,
      controls: Object.freeze([...candidate.controls]),
      maxDurationSeconds: candidate.maxDurationSeconds,
      resultMimeTypes: Object.freeze([...candidate.resultMimeTypes]),
      pricing: Object.freeze(pricing)
    })
  });
}

export const audioProviderAdmissionContract = Object.freeze({
  schemaVersion: 1,
  requiredControls: REQUIRED_CONTROLS,
  resultMimeTypes: Object.freeze([...RESULT_MIME_TYPES]),
  executable: false,
  requiresHumanGate: true
});
