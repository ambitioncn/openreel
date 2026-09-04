const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const env = { ...process.env };
for (const file of ["/etc/openreel/openreel.env", "/etc/openreel/openreel-e01-staging.env"]) {
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[line.slice(0, separator)] = value;
  }
}

Object.assign(env, {
  OPENREEL_E01_SINGLE_VIDEO_EXECUTE: "true",
  OPENREEL_E01_AUTHORIZATION_ID: "openreel-e01-seedance2-cp80",
  OPENREEL_E01_MAX_SUBMISSIONS: "1",
  OPENREEL_E01_MAX_UNITS: "138889",
  OPENREEL_ARK_MAX_RETRIES: "0",
  OPENREEL_E01_BASE: "http://127.0.0.1:4273"
});

const result = spawnSync(process.execPath, ["/tmp/openreel-e01-cp80-runner.mjs"], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
