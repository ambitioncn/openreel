import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

export async function readEvidenceKeys(ledgerPath) {
  if (!(await exists(ledgerPath))) return { caseIds: new Set(), reservationIds: new Set() };
  const lines = (await readFile(ledgerPath, "utf8")).split("\n").filter(Boolean);
  const records = lines.map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`evidence ledger has invalid JSON at line ${index + 1}`); }
  });
  return {
    caseIds: new Set(records.map(record => record.caseId).filter(Boolean)),
    reservationIds: new Set(records.map(record => record.actionReservationId).filter(Boolean))
  };
}

export async function acquireQualificationBatchGuard({ outputDir, ledgerPath, caseIds, reservationIds, owner = {} }) {
  if (new Set(caseIds).size !== caseIds.length) throw new Error("batch contains duplicate case IDs");
  if (new Set(reservationIds).size !== reservationIds.length) throw new Error("batch contains duplicate action reservation IDs");
  const lockDir = `${outputDir}.batch.lock`;
  await mkdir(dirname(lockDir), { recursive: true });
  try {
    await mkdir(lockDir);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`qualification batch already active for output: ${outputDir}`);
    throw error;
  }
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await rm(lockDir, { recursive: true, force: true });
  };
  try {
    await writeFile(join(lockDir, "owner.json"), `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), ...owner }, null, 2)}\n`, { flag: "wx" });
    if (await exists(join(outputDir, "manifest.json"))) throw new Error(`qualification output already has a manifest: ${outputDir}`);
    const existing = await readEvidenceKeys(ledgerPath);
    const duplicateCase = caseIds.find(value => existing.caseIds.has(value));
    if (duplicateCase) throw new Error(`evidence ledger already contains case ID: ${duplicateCase}`);
    const duplicateReservation = reservationIds.find(value => existing.reservationIds.has(value));
    if (duplicateReservation) throw new Error(`evidence ledger already contains action reservation ID: ${duplicateReservation}`);
    return { lockDir, release };
  } catch (error) {
    await release();
    throw error;
  }
}
