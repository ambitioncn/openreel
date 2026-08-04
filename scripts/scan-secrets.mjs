#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:api[_-]?key|password|secret|token)\s*[:=]\s*["'][A-Za-z0-9_+\/.=-]{20,}["']/i, /(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{20,}/];
const findings = [];
for (const file of tracked) { let text; try { text = readFileSync(file, "utf8"); } catch { continue; } text.split("\n").forEach((line, index) => { if (patterns.some(pattern => pattern.test(line)) && !line.includes("[REDACTED]") && !file.endsWith("scan-secrets.mjs")) findings.push(`${file}:${index + 1}`); }); }
if (findings.length) { console.error(`potential secrets found:\n${findings.join("\n")}`); process.exitCode = 1; } else console.log(`secret scan passed (${tracked.length} files)`);
