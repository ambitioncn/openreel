import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_STATES = new Set(["not_submitted", "submitting", "running", "succeeded", "failed", "canceled", "unknown"]);

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeId(value) {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function safeCode(value) {
  return typeof value === "string" && SAFE_CODE.test(value) ? value : null;
}

export function terminalPacket({
  stage = "unknown",
  submissions = 0,
  retries = 0,
  job = null,
  usage = null,
  artifact = null,
  error = null,
  model = null,
  endpointId = null,
  route = null,
} = {}) {
  const state = SAFE_STATES.has(job?.state) ? job.state : submissions === 0 ? "not_submitted" : "unknown";
  const providerTaskId = safeId(job?.providerTaskId);
  const safeArtifact = artifact && typeof artifact === "object" ? {
    ...(safeId(artifact.id) ? { id: artifact.id } : {}),
    ...(typeof artifact.mimeType === "string" && /^[-a-z0-9+.]+\/[\-a-z0-9+.]+$/i.test(artifact.mimeType) ? { mimeType: artifact.mimeType } : {}),
    ...(safeInteger(artifact.byteLength) !== null ? { byteLength: artifact.byteLength } : {}),
    ...(typeof artifact.sha256 === "string" && /^[a-f0-9]{64}$/.test(artifact.sha256) ? { sha256: artifact.sha256 } : {}),
  } : null;
  return {
    schema: "openreel-async-provider-terminal-packet/v1",
    recordedAt: new Date().toISOString(),
    stage: typeof stage === "string" && /^[a-z0-9_]{1,64}$/.test(stage) ? stage : "unknown",
    submissions: safeInteger(submissions) ?? 0,
    retries: safeInteger(retries) ?? 0,
    ...(safeId(model) ? { model } : {}),
    ...(safeId(endpointId) ? { endpointId } : {}),
    ...(safeId(route) ? { route } : {}),
    job: {
      state,
      ...(safeId(job?.id) ? { id: job.id } : {}),
      ...(safeId(job?.arkJobId) ? { arkJobId: job.arkJobId } : {}),
      ...(providerTaskId ? { providerTaskId } : {}),
      ...(safeCode(job?.error?.code) ? { errorCode: job.error.code } : {}),
    },
    ledger: {
      spentUnits: safeInteger(usage?.subscription?.spentMicros),
      reservedUnits: safeInteger(usage?.subscription?.reservedMicros),
      reconciliation: typeof usage?.reconciliation?.consistent === "boolean" ? usage.reconciliation.consistent : null,
    },
    ...(safeArtifact ? { artifact: safeArtifact } : {}),
    ...(safeCode(error?.code) ? { failureCode: error.code } : {}),
  };
}

export async function persistTerminalPacket(path, packet) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw new Error("an absolute terminal packet path is required");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}
