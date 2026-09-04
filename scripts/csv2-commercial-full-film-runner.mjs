#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:4373";
const MAX_UNITS = 9_723;
const output = process.env.OPENREEL_CSV2_OUTPUT;
const retainedAudio = process.env.OPENREEL_CSV2_RETAINED_QWEN_AUDIO;
for (const [key, value] of Object.entries({ OPENREEL_CSV2_EXECUTE: "true", OPENREEL_CSV2_MAX_SUBMISSIONS: "2", OPENREEL_CSV2_MAX_UNITS: String(MAX_UNITS), OPENREEL_ARK_MAX_RETRIES: "0" })) assert.equal(process.env[key], value);
assert.ok(output && retainedAudio);

let cookie, csrf, application, issued, submissions = 0;
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const prompt = "Premium insulated travel mug on a warm stone table, morning sunlight, clean commercial product photography, vertical 9:16, no text, no logo";
const request = async (path, { expected = 200, ...options } = {}) => { const response = await fetch(`${BASE}${path}`, options), type = response.headers.get("content-type") || "", value = type.includes("json") ? await response.json() : await response.arrayBuffer(); if (response.status !== expected) throw Object.assign(new Error(value?.error?.message || `HTTP ${response.status}`), { code: value?.error?.code || "HTTP_ERROR", status: response.status }); return { response, value }; };
const headers = () => ({ "content-type": "application/json", cookie, "x-csrf-token": csrf });
const complete = async body => { submissions += 1; let job = (await request("/api/v1/inference/jobs", { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-api-key": issued.key }, body: JSON.stringify(body) })).value; for (let poll = 0; job.status === "running" && poll < 120; poll += 1) { await new Promise(resolve => setTimeout(resolve, 5_000)); job = (await request(`/api/v1/inference/jobs/${job.id}`, { headers: { "x-openreel-api-key": issued.key } })).value; } assert.equal(job.status, "succeeded"); return job; };

try {
  const email = `csv2-${marker}@openreel.invalid`, password = randomBytes(24).toString("base64url");
  await request("/api/v1/auth/register", { method: "POST", expected: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); cookie = login.response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); csrf = login.value.csrfToken;
  application = (await request("/api/v1/key-applications", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ reason: "CSV2-10 bounded commercial full-film acceptance", requestedLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000 }) })).value;
  await request(`/api/v1/admin/key-applications/${application.id}/approve`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ plan: "csv2-commercial-full-film", hardLimitUnits: MAX_UNITS, currency: "USD", unitScale: 10_000, periodEndsAt: new Date(Date.now() + 30 * 60_000).toISOString(), reviewedBy: "standing-openreel-2026-08-19", reviewNote: "one image plus one 5s 480p silent video; zero retries; each action below CNY 100" }) });
  issued = (await request("/api/v1/api-keys", { method: "POST", expected: 201, headers: headers(), body: JSON.stringify({ name: "csv2-commercial-full-film" }) })).value;
  const image = await complete({ model: "seedream-5-lite", capability: "image", input: { prompt, size: "2K", watermark: false, response_format: "url" }, idempotencyKey: `csv2-${marker}-image` });
  assert.ok(image.result?.url?.startsWith("https://"));
  const video = await complete({ model: "seedance-2-fast", capability: "video", input: { content: [{ type: "text", text: "Slow camera push toward the same travel mug while sunlight glints across its lid, stable premium commercial shot, no cuts" }, { type: "image_url", image_url: { url: image.result.url }, role: "first_frame" }], ratio: "9:16", resolution: "480p", duration: 5, generate_audio: false, watermark: false }, idempotencyKey: `csv2-${marker}-video` });
  assert.ok(video.result?.url?.startsWith("https://"));
  const videoBytes = Buffer.from(await (await fetch(video.result.url)).arrayBuffer()); assert.ok(videoBytes.length > 10_000); writeFileSync(`${output}.provider.mp4`, videoBytes, { mode: 0o600 });
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", `${output}.provider.mp4`, "-i", retainedAudio, "-vf", "drawtext=text='OpenReel AI Commercial':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.45:x=(w-text_w)/2:y=h*0.78", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-af", "loudnorm=I=-14:TP=-1:LRA=7,apad", "-t", "5", "-movflags", "+faststart", "-y", output]);
  const bytes = readFileSync(output); assert.equal(bytes.subarray(4, 8).toString(), "ftyp");
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", output], { encoding: "utf8" }));
  const usage = (await request("/api/v1/billing/usage", { headers: headers() })).value; assert.equal(usage.reconciliation.consistent, true); assert.equal(usage.subscription.reservedMicros, 0); assert.ok(usage.subscription.spentMicros <= MAX_UNITS); assert.equal(submissions, 2);
  process.stdout.write(JSON.stringify({ status: "passed", submissions, retries: 0, models: [image.model, video.model], imageProviderJobId: image.id, videoProviderJobId: video.id, imageFirstFrameBound: true, retainedQwenAudioSha256: createHash("sha256").update(readFileSync(retainedAudio)).digest("hex"), spentUnits: usage.subscription.spentMicros, maximumUnits: MAX_UNITS, playableMp4: { path: output, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), probe } }) + "\n");
} finally {
  if (issued?.id && cookie) await request(`/api/v1/api-keys/${issued.id}`, { method: "DELETE", headers: headers() }).catch(() => {});
  if (application?.id) await request(`/api/v1/admin/key-applications/${application.id}/stop`, { method: "POST", expected: 201, headers: { "content-type": "application/json", "x-openreel-admin-key": process.env.OPENREEL_ADMIN_KEY }, body: JSON.stringify({ reviewNote: "CSV2-10 bounded run ended" }) }).catch(() => {});
}
