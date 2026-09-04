#!/usr/bin/env node
import { openSync, closeSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { planPublishingReconciliation } from "../src/publishing-reconciler.js";

const stateRoot = process.env.OPENREEL_PUBLISHING_STATE;
if (!stateRoot || !stateRoot.startsWith("/")) throw new Error("OPENREEL_PUBLISHING_STATE must be an absolute path");
const report = resolve(process.env.OPENREEL_PUBLISHING_RECONCILE_REPORT || `${stateRoot}/reconciliation-plan.json`), lock = `${report}.lock`;
mkdirSync(dirname(report), { recursive: true, mode: 0o750 });
let descriptor;
try {
  descriptor = openSync(lock, "wx", 0o600);
  const plan = { ...planPublishingReconciliation(stateRoot), observedAt: new Date().toISOString(), mode: "plan_only" };
  writeFileSync(report, `${JSON.stringify(plan)}\n`, { mode: 0o640 });
  console.log(JSON.stringify({ status: "planned", candidates: plan.candidates.length, externalActions: 0, report }));
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
  try { await import("node:fs/promises").then(({ unlink }) => unlink(lock)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
