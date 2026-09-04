const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const codeRoot = process.env.OPENREEL_CP312_CODE_ROOT;
if (!codeRoot || !fs.existsSync(path.join(codeRoot, "server.mjs"))) throw new Error("OPENREEL_CP312_CODE_ROOT is required");
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-cp312-state."));
const env = { ...process.env };
for (const raw of fs.readFileSync("/etc/openreel/openreel.env", "utf8").split(/\r?\n/)) {
  const line = raw.trim(), separator = line.indexOf("=");
  if (!line || line.startsWith("#") || separator < 1) continue;
  let value = line.slice(separator + 1);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[line.slice(0, separator)] = value;
}
Object.assign(env, {
  NODE_ENV: "production", HOST: "127.0.0.1", PORT: "4373",
  OPENREEL_DATABASE: path.join(stateRoot, "openreel.sqlite"), OPENREEL_ASSETS: path.join(stateRoot, "assets"), OPENREEL_PLATFORM: path.join(stateRoot, "platform.json"),
  OPENREEL_SESSION_SECRET: crypto.randomBytes(32).toString("hex"), OPENREEL_ADMIN_KEY: crypto.randomBytes(32).toString("hex"),
  OPENREEL_PAID_INFERENCE_ENABLED: "true", OPENREEL_ARK_MAX_RETRIES: "0", OPENREEL_VOLCENGINE_ROUTE_PREFERENCE: "direct",
  OPENREEL_VOLCENGINE_DIRECT_BASE_URL: "https://ark.cn-beijing.volces.com/api/plan/v3",
  OPENREEL_E01_CP312_EXECUTE: "true", OPENREEL_E01_MAX_SUBMISSIONS: "1", OPENREEL_E01_MAX_UNITS: "6945",
  OPENREEL_E01_BROWSER_PACKET: "/tmp/openreel-cp312-browser.json",
  OPENREEL_E01_RETAINED_MEDIA: "/tmp/openreel-cp318-retained.mp4"
});
delete env.ARK_MODELS_JSON;
if (!env.OPENREEL_VOLCENGINE_DIRECT_API_KEY?.trim() || !env.OPENREEL_VOLCENGINE_SEEDANCE2_FAST_DIRECT_MODEL?.trim()) throw new Error("direct credential/model mapping unavailable");
let server, runner, cleaning = false;
async function cleanup(code) {
  if (cleaning) return; cleaning = true;
  if (runner && !runner.killed) runner.kill("SIGTERM");
  if (server && !server.killed) server.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 300));
  fs.rmSync(stateRoot, { recursive: true, force: true });
  for (const file of ["/tmp/openreel-cp312-runner.mjs", "/tmp/openreel-cp312-result.mjs", "/tmp/openreel-cp312-browser.json", "/tmp/openreel-cp312-browser.done", "/tmp/openreel-cp318-retained.mp4"]) fs.rmSync(file, { force: true });
  process.exit(code);
}
process.on("SIGINT", () => cleanup(130)); process.on("SIGTERM", () => cleanup(143));
(async () => {
  const { loadArkConfig } = await import(path.join(codeRoot, "src/ark.js"));
  const model = loadArkConfig(env).models["seedance-2-fast"];
  const expected = "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks";
  if (model?.endpoint !== expected || model?.pollEndpoint !== expected || model?.maxCostMicros > 6_945) throw new Error("direct route or budget preflight failed");
  process.stdout.write(JSON.stringify({ status: "preflight_passed", diagnostics: "stage_labeled", route: "direct_plan_v3", maximumSubmissions: 1, automaticRetries: 0, maximumUnits: 6_945 }) + "\n");
  server = spawn(process.execPath, ["server.mjs"], { cwd: codeRoot, env, stdio: ["ignore", "ignore", "ignore"] });
  let ready = false;
  for (let i = 0; i < 40; i++) { try { if ((await fetch("http://127.0.0.1:4373/")).status === 200) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
  if (!ready) { process.stdout.write('{"status":"stopped","code":"ISOLATED_STAGING_NOT_READY","submissions":0}\n'); return cleanup(1); }
  runner = spawn(process.execPath, ["/tmp/openreel-cp312-runner.mjs"], { cwd: codeRoot, env, stdio: "inherit" });
  runner.on("exit", async code => {
    if (code !== 0) return cleanup(code ?? 1);
    process.stdout.write('{"status":"awaiting_graphical_browser","submissions":1}\n');
    for (let i = 0; i < 240; i++) { if (fs.existsSync("/tmp/openreel-cp312-browser.done")) return cleanup(0); await new Promise(resolve => setTimeout(resolve, 2500)); }
    process.stdout.write('{"status":"stopped","code":"GRAPHICAL_BROWSER_TIMEOUT","submissions":1}\n'); cleanup(1);
  });
})().catch(error => { process.stdout.write(JSON.stringify({ status: "stopped", code: error.code || "PREFLIGHT_FAILED", submissions: 0 }) + "\n"); cleanup(1); });
