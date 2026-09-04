import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const endpoint = "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse";
const resourceId = "seed-tts-2.0";
const apiKey = process.env.OPENREEL_VOLCENGINE_DIRECT_API_KEY?.trim();
const outputDir = process.env.OPENREEL_A01_OUTPUT_DIR?.trim();
const speaker = "zh_female_vv_uranus_bigtts";
const maximumCalls = Number(process.env.OPENREEL_A01_MAX_CALLS || "2");
const cases = [
  { id: "tts-voice-baseline-zh-1", text: "你好，这是 OpenReel 私有测试环境的普通话语音基线。" },
  { id: "tts-timeline-sync-zh-1", text: "第二段语音用于验证时间线对齐、音频导出与下载流程。" },
];

if (!apiKey) throw new Error("missing approved credential reference");
if (!outputDir) throw new Error("missing isolated output directory");
if (!Number.isSafeInteger(maximumCalls) || maximumCalls < 1 || maximumCalls > 2) throw new Error("call ceiling mismatch");
if (new URL(endpoint).hostname !== "openspeech.bytedance.com") throw new Error("provider host mismatch");
if (cases.length !== 2 || cases.some(item => [...item.text].length > 500)) throw new Error("call/input ceiling mismatch");
if (cases.reduce((sum, item) => sum + [...item.text].length, 0) > 1000) throw new Error("aggregate input ceiling mismatch");

await mkdir(outputDir, { recursive: true, mode: 0o700 });
const results = [];

function parseSse(body) {
  const events = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const event = block.match(/^event:\s*(\d+)/m)?.[1];
    const data = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!event || !data) continue;
    events.push({ event: Number(event), payload: JSON.parse(data) });
  }
  return events;
}

for (const item of cases.slice(0, maximumCalls)) {
  const requestId = randomUUID();
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-api-resource-id": resourceId,
      "x-api-request-id": requestId,
      "x-control-require-usage-tokens-return": "text_words",
    },
    body: JSON.stringify({
      user: { uid: "openreel-private-staging" },
      namespace: "BidirectionalTTS",
      req_params: {
        text: item.text,
        speaker,
        audio_params: { format: "mp3", sample_rate: 24000 },
      },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`provider HTTP ${response.status}; completed_calls=${results.length}`);
  const events = parseSse(body);
  const terminal = events.findLast(entry => entry.event === 152)?.payload;
  if (!terminal || terminal.code !== 20000000) {
    const safeCode = terminal?.code ?? events.find(entry => entry.payload?.code)?.payload?.code ?? "missing";
    throw new Error(`provider terminal code ${safeCode}; completed_calls=${results.length}`);
  }
  const audio = Buffer.concat(events
    .filter(entry => entry.event === 352 && typeof entry.payload?.data === "string")
    .map(entry => Buffer.from(entry.payload.data, "base64")));
  if (audio.length < 256) throw new Error(`provider returned insufficient audio; completed_calls=${results.length}`);
  const billedCharacters = Number(terminal.usage?.text_words);
  if (!Number.isSafeInteger(billedCharacters) || billedCharacters < 1 || billedCharacters > 500) {
    throw new Error(`untrusted usage report; completed_calls=${results.length}`);
  }
  const path = `${outputDir}/${item.id}.mp3`;
  await writeFile(path, audio, { mode: 0o600 });
  results.push({
    caseId: item.id,
    inputCharacters: [...item.text].length,
    billedCharacters,
    bytes: audio.length,
    sha256: createHash("sha256").update(audio).digest("hex"),
    mimeType: response.headers.get("content-type"),
    providerRequestIdDigest: createHash("sha256").update(response.headers.get("x-tt-logid") || requestId).digest("hex").slice(0, 16),
    outputPath: path,
  });
}

const aggregateBilledCharacters = results.reduce((sum, item) => sum + item.billedCharacters, 0);
const maximumEstimatedSpendCny = Number((aggregateBilledCharacters * 5 / 10000).toFixed(6));
if (maximumEstimatedSpendCny > 0.5) throw new Error("aggregate spend ceiling exceeded");
process.stdout.write(JSON.stringify({
  schema: "openreel-a01-seed-tts-execution/v1",
  providerHost: new URL(endpoint).hostname,
  resourceId,
  automaticRetries: 0,
  completedCalls: results.length,
  aggregateBilledCharacters,
  maximumEstimatedSpendCny,
  results,
}, null, 2));
