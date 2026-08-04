#!/usr/bin/env node
import { runCli } from "../src/cli.js";
try { await runCli(process.argv.slice(2)); }
catch (error) { process.stderr.write(`${JSON.stringify({ error: { code: error.code || "CLI_ERROR", message: error.message } })}\n`); process.exitCode = 1; }
