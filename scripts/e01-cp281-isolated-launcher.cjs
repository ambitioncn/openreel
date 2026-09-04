const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-cp281."));
const env = { ...process.env };
for (const raw of fs.readFileSync("/etc/openreel/openreel.env", "utf8").split(/\r?\n/)) {
  const line = raw.trim(), separator = line.indexOf("=");
  if (!line || line.startsWith("#") || separator < 1) continue;
  let value = line.slice(separator + 1);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[line.slice(0, separator)] = value;
}
Object.assign(env, { NODE_ENV: "production", HOST: "127.0.0.1", PORT: "4373", OPENREEL_DATABASE: path.join(root, "openreel.sqlite"), OPENREEL_ASSETS: path.join(root, "assets"), OPENREEL_PLATFORM: path.join(root, "platform.json"), OPENREEL_SESSION_SECRET: crypto.randomBytes(32).toString("hex"), OPENREEL_ADMIN_KEY: crypto.randomBytes(32).toString("hex"), OPENREEL_PAID_INFERENCE_ENABLED: "true", OPENREEL_ARK_MAX_RETRIES: "0", OPENREEL_E01_CP281_EXECUTE: "true", OPENREEL_E01_MAX_SUBMISSIONS: "1", OPENREEL_E01_MAX_UNITS: "6945" });
const server = spawn(process.execPath, ["server.mjs"], { cwd: "/opt/openreel/current", env, stdio: ["ignore", "ignore", "ignore"] });
let runner;
async function cleanup(code) { if (runner && !runner.killed) runner.kill("SIGTERM"); if (!server.killed) server.kill("SIGTERM"); await new Promise(r => setTimeout(r, 250)); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync("/tmp/openreel-cp281-runner.mjs", { force: true }); process.exit(code); }
process.on("SIGINT", () => cleanup(130)); process.on("SIGTERM", () => cleanup(143));
(async () => {
  let ready = false;
  for (let i = 0; i < 40; i++) { try { if ((await fetch("http://127.0.0.1:4373/")).status === 200) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 250)); }
  if (!ready) { process.stdout.write('{"status":"stopped","code":"ISOLATED_STAGING_NOT_READY","submissions":0}\n'); return cleanup(1); }
  runner = spawn(process.execPath, ["/tmp/openreel-cp281-runner.mjs"], { cwd: "/opt/openreel/current", env, stdio: "inherit" });
  runner.on("exit", code => cleanup(code ?? 1));
})().catch(() => cleanup(1));
