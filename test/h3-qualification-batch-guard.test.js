import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { acquireQualificationBatchGuard } from "../src/h3-qualification-batch-guard.js";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "openreel-h3-guard-"));
  try { await run({ root, outputDir: join(root, "run"), ledgerPath: join(root, "ledger.jsonl") }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("concurrent acquisition for one output fails closed", () => fixture(async options => {
  const first = await acquireQualificationBatchGuard({ ...options, caseIds: ["a"], reservationIds: ["r1"] });
  await assert.rejects(acquireQualificationBatchGuard({ ...options, caseIds: ["a"], reservationIds: ["r1"] }), /already active/);
  await first.release();
}));

test("completed output cannot be resubmitted", () => fixture(async options => {
  await mkdir(options.outputDir, { recursive: true });
  await writeFile(join(options.outputDir, "manifest.json"), "{}\n");
  await assert.rejects(acquireQualificationBatchGuard({ ...options, caseIds: ["a"], reservationIds: ["r1"] }), /already has a manifest/);
}));

test("ledger case and reservation conflicts are rejected", () => fixture(async options => {
  await writeFile(options.ledgerPath, `${JSON.stringify({ caseId: "a", actionReservationId: "r1" })}\n`);
  await assert.rejects(acquireQualificationBatchGuard({ ...options, caseIds: ["a"], reservationIds: ["r2"] }), /case ID/);
  await assert.rejects(acquireQualificationBatchGuard({ ...options, caseIds: ["b"], reservationIds: ["r1"] }), /reservation ID/);
}));

test("duplicate keys inside a requested batch are rejected", () => fixture(async options => {
  await assert.rejects(acquireQualificationBatchGuard({ ...options, caseIds: ["a", "a"], reservationIds: ["r1", "r2"] }), /duplicate case IDs/);
  await assert.rejects(acquireQualificationBatchGuard({ ...options, caseIds: ["a", "b"], reservationIds: ["r1", "r1"] }), /duplicate action reservation IDs/);
}));
