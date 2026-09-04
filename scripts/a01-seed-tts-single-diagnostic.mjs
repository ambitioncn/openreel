import { randomUUID } from "node:crypto";

const endpoint = "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse";
const resourceId = "seed-tts-2.0";
const speaker = "zh_female_vv_uranus_bigtts";
const apiKey = process.env.OPENREEL_SEEDAUDIO_API_KEY?.trim();
const text = "你好，这是 OpenReel 私有测试环境的语音权限诊断。";

if (!apiKey) throw new Error("missing approved dedicated credential reference");
if ([...text].length > 100) throw new Error("input ceiling mismatch");
if (new URL(endpoint).hostname !== "openspeech.bytedance.com") throw new Error("provider host mismatch");

const response = await fetch(endpoint, {
  method: "POST",
  redirect: "error",
  signal: AbortSignal.timeout(30_000),
  headers: {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "x-api-resource-id": resourceId,
    "x-api-request-id": randomUUID(),
    "x-control-require-usage-tokens-return": "text_words",
  },
  body: JSON.stringify({
    user: { uid: "openreel-private-staging" },
    namespace: "BidirectionalTTS",
    req_params: {
      text,
      speaker,
      audio_params: { format: "mp3", sample_rate: 24000 },
    },
  }),
});

const body = await response.text();
if (!response.ok) throw new Error(`provider HTTP ${response.status}`);

let terminalCode = "missing";
let billedCharacters = null;
let audioBytes = 0;
for (const block of body.split(/\r?\n\r?\n/)) {
  const event = Number(block.match(/^event:\s*(\d+)/m)?.[1]);
  const data = block.match(/^data:\s*(.+)$/m)?.[1];
  if (!event || !data) continue;
  const payload = JSON.parse(data);
  if (event === 152) {
    terminalCode = payload.code ?? "missing";
    billedCharacters = Number.isSafeInteger(Number(payload.usage?.text_words))
      ? Number(payload.usage.text_words)
      : null;
  }
  if (event === 352 && typeof payload.data === "string") {
    audioBytes += Buffer.from(payload.data, "base64").length;
  }
}

const maximumEstimatedSpendCny = billedCharacters === null
  ? null
  : Number((billedCharacters * 5 / 10000).toFixed(6));
if (maximumEstimatedSpendCny !== null && maximumEstimatedSpendCny > 0.05) {
  throw new Error("spend ceiling exceeded");
}

process.stdout.write(JSON.stringify({
  schema: "openreel-a01-seed-tts-single-diagnostic/v1",
  attemptedCalls: 1,
  automaticRetries: 0,
  inputCharacters: [...text].length,
  terminalCode,
  billedCharacters,
  maximumEstimatedSpendCny,
  audioBytes,
}, null, 2));
