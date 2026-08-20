import test from "node:test";
import assert from "node:assert/strict";
import { createSeedAudio10Adapter, seedAudio10Descriptor } from "../src/seedaudio.js";

test("SeedAudio 1.0 adapter is immutable, default-disabled and non-executable", () => {
  const adapter = createSeedAudio10Adapter();
  assert.equal(adapter.id, "seedaudio-1.0");
  assert.equal(adapter.defaultEnabled, false);
  assert.equal(adapter.executable, false);
  assert.equal(adapter.executionDisabled, true);
  assert.equal(adapter.requiresHumanGate, true);
  assert.equal(adapter.requiresCredential, true);
  assert.equal(adapter.costed, true);
  assert.throws(() => { adapter.capabilities.audio.durations.push(20); }, TypeError);
  assert.throws(() => adapter.execute(), error => error.code === "SEEDEDAUDIO_EXECUTION_DISABLED");
});

test("SeedAudio 1.0 adapter prepares only a static zero-call plan", () => {
  const adapter = createSeedAudio10Adapter();
  const plan = adapter.prepare({ prompt: "  rain on a window  ", durationSeconds: 5 });
  assert.deepEqual(plan, {
    adapterId: "seedaudio-1.0",
    model: "SeedAudio 1.0",
    kind: "audio",
    mode: "text-to-audio",
    prompt: "rain on a window",
    durationSeconds: 5,
    executable: false,
    executionDisabled: true,
    requiresHumanGate: true,
    providerCalls: 0,
  });
  assert.throws(() => { plan.prompt = "changed"; }, TypeError);
});

test("SeedAudio 1.0 adapter rejects enablement and never invokes an injected transport", () => {
  let calls = 0;
  const transport = () => { calls += 1; };
  assert.throws(() => createSeedAudio10Adapter({ enabled: true, transport }), error => error.code === "SEEDEDAUDIO_EXECUTION_DISABLED");
  const adapter = createSeedAudio10Adapter({ enabled: false, transport });
  assert.throws(() => adapter.execute(), error => error.code === "SEEDEDAUDIO_EXECUTION_DISABLED");
  assert.equal(calls, 0);
});

test("SeedAudio 1.0 request boundary rejects noncanonical and out-of-scope input", () => {
  const adapter = createSeedAudio10Adapter();
  assert.throws(() => adapter.prepare({ prompt: "" }), error => error.code === "SEEDEDAUDIO_REQUEST_INVALID");
  assert.throws(() => adapter.prepare({ prompt: "sound", durationSeconds: 6 }), error => error.code === "SEEDEDAUDIO_REQUEST_INVALID");
  assert.throws(() => adapter.prepare({ prompt: "sound", mode: "text-to-music" }), error => error.code === "SEEDEDAUDIO_REQUEST_INVALID");
  assert.throws(() => adapter.prepare({ prompt: "sound", credential: "forbidden" }), error => error.code === "SEEDEDAUDIO_CONFIG_INVALID");
  assert.throws(() => createSeedAudio10Adapter({ enabled: false, endpoint: "forbidden" }), error => error.code === "SEEDEDAUDIO_CONFIG_INVALID");
  assert.equal(seedAudio10Descriptor.executable, false);
});
