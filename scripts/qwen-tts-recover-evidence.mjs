#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPersistentStore } from "../src/core.js";
import { inspectWav } from "../src/wav.js";

const evidenceDir = join(process.cwd(), "docs", "evidence", "a01-qwen-one-call-v2");
const stateFile = join(evidenceDir, "openreel-state.json");
const reservation = JSON.parse(readFileSync(join(evidenceDir, "reservation.json"), "utf8"));
const attempted = JSON.parse(readFileSync(join(evidenceDir, "result.json"), "utf8"));
assert.deepEqual({ status: reservation.status, providerCalls: reservation.providerCalls }, { status: "consumed", providerCalls: 1 });
assert.equal(attempted.externalActions.qwenSynthesisRequests, 1);

const store = createPersistentStore(stateFile);
const project = store.listProjects()[0];
const snapshot = store.snapshot(project.id);
const job = snapshot.nodes.flatMap(node => node.runs || []).find(item => item.provider === "qwen-tts-tailnet");
assert.equal(job.state, "succeeded");
const asset = snapshot.assets.find(item => item.id === job.assetId);
const bytes = store.assetContent(project.id, asset.id).bytes;
const wav = inspectWav(bytes);
assert.ok(wav && wav.durationSeconds > 0);
assert.equal(asset.mimeType, "audio/wav");
assert.equal(asset.metadata.duration, wav.durationSeconds);
assert.equal(asset.metadata.sampleRate, wav.sampleRate);

writeFileSync(join(evidenceDir, "qwen-result.wav"), bytes, { mode: 0o600, flag: "wx" });
const audioClipCount = snapshot.timeline.tracks.filter(track => track.kind === "audio").flatMap(track => track.clips).length;
const recovered = {
  version: 1,
  authorization: "A-01-QWEN-CHINESE-ONE-CALL-V2",
  status: "succeeded_recovered_from_durable_state",
  providerCalls: 1,
  retries: 0,
  recoveryExternalCalls: 0,
  result: {
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mimeType: asset.mimeType,
    durationSeconds: wav.durationSeconds,
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    audioFormat: wav.audioFormat,
    bitsPerSample: wav.bitsPerSample,
  },
  durable: { jobState: job.state, assetCount: snapshot.assets.length, timelineAudioClipCount: audioClipCount },
  note: "The provider and durable reconciliation succeeded. Evidence export resumed locally after the runner incorrectly expected HTTP 200 instead of the endpoint's HTTP 201 creation response.",
};
assert.equal(recovered.durable.assetCount, 1);
assert.equal(recovered.durable.timelineAudioClipCount, 1);
writeFileSync(join(evidenceDir, "recovered-result.json"), `${JSON.stringify(recovered, null, 2)}\n`, { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ status: recovered.status, providerCalls: 1, recoveryExternalCalls: 0, byteLength: bytes.length }));
