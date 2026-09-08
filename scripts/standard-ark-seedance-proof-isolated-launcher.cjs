const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const codeRoot = process.env.OPENREEL_STANDARD_ARK_PROOF_CODE_ROOT || process.cwd();
const proofRoot = process.env.OPENREEL_STANDARD_ARK_PROOF_ROOT;
const endpointId = process.env.OPENREEL_STANDARD_ARK_ENDPOINT_ID;
if (!proofRoot || !endpointId) throw new Error("proof root and endpoint id are required");

const env = { ...process.env };
for (const raw of fs.readFileSync("/etc/openreel/openreel.env", "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  const separator = line.indexOf("=");
  if (!line || line.startsWith("#") || separator < 1) continue;
  let value = line.slice(separator + 1);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[line.slice(0, separator)] = value;
}

Object.assign(env, {
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: "4373",
  OPENREEL_DATABASE: path.join(proofRoot, "openreel.sqlite"),
  OPENREEL_ASSETS: path.join(proofRoot, "assets"),
  OPENREEL_PLATFORM: path.join(proofRoot, "platform.json"),
  OPENREEL_FEEDBACK_STATE: path.join(proofRoot, "feedback.json"),
  OPENREEL_PUBLISHING_STATE: path.join(proofRoot, "publishing"),
  OPENREEL_VOLCENGINE_SEEDANCE2_MODEL: endpointId,
  OPENREEL_ARK_MAX_RETRIES: "0",
  OPENREEL_PAID_INFERENCE_ENABLED: "true",
  OPENREEL_STANDARD_ARK_PROOF_BASE: "http://127.0.0.1:4373",
  OPENREEL_STANDARD_ARK_MODEL: "seedance-2",
  OPENREEL_STANDARD_ARK_ENDPOINT_ID: endpointId,
  OPENREEL_STANDARD_ARK_MAX_UNITS: "138889",
  OPENREEL_STANDARD_ARK_PAID_PROOF_CONFIRM: "SUBMIT_ONE_STANDARD_ARK_PAID_PROOF",
  OPENREEL_STANDARD_ARK_TERMINAL_PACKET: path.join(proofRoot, "terminal-packet.json"),
  OPENREEL_STANDARD_ARK_RETAINED_MEDIA: path.join(proofRoot, "seedance-2-5s-480p.mp4")
});

let server;
const cleanup = code => {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  process.exitCode = code;
};

(async () => {
  const { loadArkConfig } = await import(path.join(codeRoot, "src/ark.js"));
  const model = loadArkConfig(env).models["seedance-2"];
  const expected = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
  if (model?.endpoint !== expected || model?.pollEndpoint !== expected || model?.providerModel !== endpointId || model?.maxCostMicros > 138889) {
    throw new Error("standard Ark route or budget preflight failed");
  }
  process.stdout.write(`${JSON.stringify({ status: "preflight_passed", route: "standard_api_v3", model: "seedance-2", endpointId, maximumSubmissions: 1, automaticRetries: 0, maximumUnits: 138889 })}\n`);
  server = spawn(process.execPath, ["server.mjs"], { cwd: codeRoot, env, stdio: ["ignore", "ignore", "inherit"] });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4373/health/ready");
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("isolated proof server did not become ready");
  const runner = spawn(process.execPath, [path.join(codeRoot, "scripts/standard-ark-seedance-canvas-proof.mjs")], { cwd: codeRoot, env, stdio: "inherit" });
  runner.on("exit", code => cleanup(code ?? 1));
  runner.on("error", () => cleanup(1));
})().catch(error => {
  process.stdout.write(`${JSON.stringify({ status: "stopped", code: "PROOF_PREFLIGHT_FAILED", submissions: 0, retries: 0 })}\n`);
  cleanup(1);
});

process.on("SIGTERM", () => cleanup(143));
process.on("SIGINT", () => cleanup(130));
