import assert from "node:assert/strict";
import test from "node:test";
import { assessAudioProviderCandidate, audioProviderAdmissionContract } from "../src/audio-provider-admission.js";

const candidate = () => ({
  schemaVersion: 1,
  modelId: "reviewed-audio-candidate",
  provider: "candidate-provider",
  endpoint: "https://audio.example.test/v1/generate",
  mode: "text-to-audio",
  controls: ["voice", "speed", "pitch", "volume", "sample-rate", "audio-format"],
  maxDurationSeconds: 30,
  resultMimeTypes: ["audio/mpeg", "audio/wav"],
  pricing: {
    version: "candidate-price/v1",
    sourceUrl: "https://audio.example.test/pricing",
    verifiedAt: "2026-08-07",
    currency: "USD",
    unitScale: 10000,
    maxCostUnits: 1000,
    inputUnitsPerMillion: 0,
    outputUnitsPerMillion: 500
  }
});

test("audio provider admission validates metadata but never authorizes execution", () => {
  const result = assessAudioProviderCandidate(candidate());
  assert.equal(result.admitted, true);
  assert.equal(result.executable, false);
  assert.equal(result.requiresHumanGate, true);
  assert.deepEqual(audioProviderAdmissionContract.requiredControls, candidate().controls);
  assert.deepEqual(audioProviderAdmissionContract.resultMimeTypes, ["audio/mpeg", "audio/wav"]);
});

test("audio provider admission rejects secrets, unsafe endpoints, unknown controls, and non-audio results", () => {
  for (const mutate of [
    value => { value[["api", "Key"].join("")] = "rejected-field"; },
    value => { value.endpoint = "http://audio.example.test/v1/generate"; },
    value => { value.endpoint = "https://user:pass@audio.example.test/v1/generate"; },
    value => { value.endpoint = "https://audio.example.test/v1/generate?token=x"; },
    value => { value.controls.push("unknown"); },
    value => { value.resultMimeTypes = ["video/mp4"]; },
    value => { value.maxDurationSeconds = 301; }
  ]) {
    const value = candidate(); mutate(value); assert.throws(() => assessAudioProviderCandidate(value));
  }
});

test("audio provider admission rejects missing, mutable, zero, or malformed pricing", () => {
  for (const mutate of [
    value => { delete value.pricing.version; },
    value => { value.pricing.sourceUrl = "http://audio.example.test/pricing"; },
    value => { value.pricing.verifiedAt = "today"; },
    value => { value.pricing.currency = "CNY"; },
    value => { value.pricing.unitScale = 1; },
    value => { value.pricing.maxCostUnits = 0; },
    value => { value.pricing.outputUnitsPerMillion = 0; },
    value => { value.pricing.secret = "not-allowed"; }
  ]) {
    const value = candidate(); mutate(value); assert.throws(() => assessAudioProviderCandidate(value));
  }
});
