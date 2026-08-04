#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = String(process.env.OPENREEL_LIVE_BASE || "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) throw new Error("OPENREEL_LIVE_BASE must be an https URL");
const marker = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const email = `live-smoke-${marker}@openreel.invalid`;
const password = randomBytes(24).toString("base64url");

async function request(path, options = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, options);
  const type = response.headers.get("content-type") || "";
  const value = type.includes("application/json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, expected, `${path}: ${response.status} ${Buffer.isBuffer(value) ? "binary" : JSON.stringify(value)}`);
  return { response, value };
}

await request("/api/v1/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }, 201);
const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
const cookies = login.response.headers.getSetCookie();
assert.ok(cookies.every(value => /Secure/.test(value) && /HttpOnly/.test(value) && /SameSite=Lax/.test(value)));
const cookie = cookies.map(value => value.split(";", 1)[0]).join("; ");
const csrf = login.value.csrfToken;
async function call(path, method = "GET", body, expected = method === "POST" ? 201 : 200) {
  return request(path, { method, headers: { cookie, ...(method === "GET" ? {} : { "content-type": "application/json", "x-csrf-token": csrf }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, expected);
}

const project = (await call("/api/v1/projects", "POST", { name: `LIVE smoke ${marker}` })).value;
const session = (await call(`/api/v1/projects/${project.id}/sessions`, "POST", { name: "Main" })).value;
const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const upload = await request(`/api/v1/projects/${project.id}/sessions/${session.id}/assets/references`, { method: "POST", headers: { cookie, "x-csrf-token": csrf, "content-type": "image/png", "x-filename": "reference.png" }, body: png }, 201);
const story = (await call(`/api/v1/projects/${project.id}/story`, "PUT", { title: "Live proof", synopsis: "Public deployment smoke", scenes: [{ title: "Scene", summary: "Reveal" }] }, 200)).value;
await call(`/api/v1/projects/${project.id}/storyboard`, "PUT", { shots: [{ sceneId: story.scenes[0].id, prompt: "Reveal", duration: 1, referenceAssetIds: [upload.value.id] }] }, 200);
const node = (await call(`/api/v1/sessions/${session.id}/nodes`, "POST", { type: "video" })).value;
let job = (await call(`/api/v1/sessions/${session.id}/jobs`, "POST", { nodeId: node.id, prompt: "live local video", referenceAssetIds: [upload.value.id] })).value;
while (job.state !== "succeeded") job = (await call(`/api/v1/jobs/${job.id}/tick`, "POST", {})).value;
await call(`/api/v1/projects/${project.id}/timeline`, "PUT", { version: 1, tracks: [{ kind: "video", clips: [{ assetId: job.assetId, inPoint: 0, outPoint: 1, start: 0 }] }] }, 200);
const rendered = (await call(`/api/v1/projects/${project.id}/exports/render`, "POST", {})).value;
const video = await request(rendered.asset.downloadUrl, { headers: { cookie } });
assert.equal(video.value.subarray(4, 8).toString(), "ftyp");

console.log(JSON.stringify({ status: "passed", base, accountMarker: email, projectId: project.id, secureCookies: true, registrationLogin: true, uploadStoryboardGeneration: true, playableMp4Bytes: video.value.length }));
