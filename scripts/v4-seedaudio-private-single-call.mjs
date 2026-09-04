import { createHash } from "node:crypto";
import { mkdirSync, openSync, writeFileSync, closeSync } from "node:fs";
import { dirname } from "node:path";

const endpoint = "https://openspeech.bytedance.com/api/v3/tts/create";
const outputPath = process.env.OPENREEL_SEEDAUDIO_OUTPUT;
const evidencePath = process.env.OPENREEL_SEEDAUDIO_EVIDENCE;
const apiKey = process.env.OPENREEL_SEEDAUDIO_API_KEY;
if (!outputPath || !evidencePath || !apiKey) throw new Error("required SeedAudio execution input is missing");

const request = {
  model: "seed-audio-1.0",
  text_prompt: "轻快温暖的海滩舞蹈纯音乐，明亮夏日氛围，节奏清晰，无人声，适合作为五秒短视频背景音乐",
  duration: 5,
};

let submissions = 0;
submissions += 1;
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": apiKey },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(120_000),
});
const payload = await response.json();
if (!response.ok) throw new Error(`SeedAudio request failed with HTTP ${response.status}`);
if (submissions !== 1) throw new Error("single-call invariant violated");

const encoded = payload.audio ?? payload.data?.audio;
if (typeof encoded !== "string" || !encoded.length) throw new Error("SeedAudio response did not contain audio");
const bytes = Buffer.from(encoded, "base64");
const isMp3 = bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
const isWav = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
if ((!isMp3 && !isWav) || bytes.length === 0 || bytes.length > 25 * 1024 * 1024) throw new Error("SeedAudio returned invalid audio bytes");

mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
const descriptor = openSync(outputPath, "wx", 0o600);
try { writeFileSync(descriptor, bytes); } finally { closeSync(descriptor); }
const evidence = {
  schema: "openreel-v4-seedaudio-private-check/v1",
  provider: "volcengine-seedaudio",
  model: request.model,
  endpointContract: "POST /api/v3/tts/create",
  promptSha256: createHash("sha256").update(request.text_prompt).digest("hex"),
  requestedDurationSeconds: request.duration,
  providerDurationSeconds: payload.duration ?? payload.data?.duration ?? null,
  providerOriginalDurationSeconds: payload.original_duration ?? payload.data?.original_duration ?? null,
  providerJobId: payload.request_id ?? payload.data?.request_id ?? payload.id ?? null,
  httpStatus: response.status,
  calls: submissions,
  retries: 0,
  expectedCostCny: 0,
  maximumAuthorizedCostCny: 10,
  mimeType: isMp3 ? "audio/mpeg" : "audio/wav",
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  outputPath,
  rawProviderResponseRetained: false,
};
const evidenceDescriptor = openSync(evidencePath, "wx", 0o600);
try { writeFileSync(evidenceDescriptor, `${JSON.stringify(evidence, null, 2)}\n`); } finally { closeSync(evidenceDescriptor); }
process.stdout.write(`${JSON.stringify(evidence)}\n`);
