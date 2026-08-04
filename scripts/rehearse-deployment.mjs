#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "openreel-rehearsal-")), port = String(20000 + Math.floor(Math.random() * 20000));
const env = { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: port, OPENREEL_DATABASE: join(root, "data/openreel.sqlite"), OPENREEL_ASSETS: join(root, "data/assets"), OPENREEL_PLATFORM: join(root, "data/platform.json"), OPENREEL_SESSION_SECRET: "x".repeat(40) };
if (process.getuid?.() === 0) throw new Error("deployment rehearsal must run unprivileged");
const child = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], { env, stdio: ["ignore", "pipe", "pipe"] });
let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
try {
  let response;
  for (let attempt = 0; attempt < 50; attempt++) { try { response = await fetch(`http://127.0.0.1:${port}/health/ready`); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
  if (!response?.ok || (await response.json()).status !== "ready") throw new Error(`real service did not become ready: ${stderr}`);
  console.log(JSON.stringify({ status: "passed", binding: `127.0.0.1:${port}`, isolatedRoot: root }));
} finally { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
