import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAudioSpec } from "../src/audio-spec.js";

test("audio specs normalize evidenced voice, music, and sfx controls", () => {
  assert.deepEqual(normalizeAudioSpec({ intent: "voice", voice: "Narrator", speed: 1.1, pitch: -2, volume: 0.8, sampleRate: 48000, format: "wav" }), { intent: "voice", voice: "Narrator", speed: 1.1, pitch: -2, volume: 0.8, sampleRate: 48000, format: "wav" });
  assert.deepEqual(normalizeAudioSpec({ intent: "music", sampleRate: 44100, format: "mp3" }), { intent: "music", sampleRate: 44100, format: "mp3" });
  assert.deepEqual(normalizeAudioSpec({ intent: "sfx" }), { intent: "sfx" });
});

test("audio specs fail closed for unknown, misplaced, and out-of-range controls", () => {
  for (const value of [{ intent: "unknown" }, { intent: "music", voice: "no" }, { intent: "voice", speed: 3 }, { intent: "sfx", sampleRate: 123 }, { intent: "sfx", format: "aac" }, { intent: "sfx", seed: 1 }]) assert.throws(() => normalizeAudioSpec(value), TypeError);
});
