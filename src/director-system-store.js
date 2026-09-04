import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "./core.js";

const invalid = message => { throw new DomainError("DIRECTOR_RECORD_INVALID", message, 422); };
const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} is required`);
  return value.trim();
};
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = (...parts) => parts.map((value, index) => required(value, `identity[${index}]`)).join("\u0000");

export function createDirectorSystemStore(path = null) {
  let records = path ? load(path) : {};
  const persist = () => {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ schema: "openreel-director-record-store/v1", records })}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  };
  return Object.freeze({
    put(principal, projectId, input) {
      const tenantId = required(principal?.tenantId, "tenantId"), actorId = required(principal?.actorId, "actorId");
      if (!input || typeof input !== "object" || Array.isArray(input)) invalid("record is required");
      const record = {
        schema: "openreel-director-record/v1",
        projectId: required(projectId, "projectId"),
        workflowId: required(input.workflowId, "workflowId"),
        revisionId: required(input.revisionId, "revisionId"),
        recordId: required(input.recordId, "recordId"),
        idempotencyKey: required(input.idempotencyKey, "idempotencyKey"),
        kind: required(input.kind, "kind"),
        value: input.value,
        actorId
      };
      if (record.value === undefined) invalid("value is required");
      const fingerprint = digest(record), id = key(tenantId, record.projectId, record.workflowId, record.revisionId, record.idempotencyKey);
      const existing = records[id];
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new DomainError("IDEMPOTENCY_CONFLICT", "idempotency key was already used with different director record bytes", 409);
        return existing;
      }
      const stored = Object.freeze({ ...record, fingerprint });
      records = { ...records, [id]: stored };
      persist();
      return stored;
    },
    get(principal, projectId, workflowId, revisionId, idempotencyKey) {
      const id = key(principal?.tenantId, projectId, workflowId, revisionId, idempotencyKey);
      const record = records[id];
      if (!record) throw new DomainError("NOT_FOUND", "director record not found", 404);
      return Object.freeze({ ...record });
    }
  });
}

function load(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed?.schema !== "openreel-director-record-store/v1" || !parsed.records || typeof parsed.records !== "object" || Array.isArray(parsed.records)) throw new Error();
    return parsed.records;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new DomainError("DIRECTOR_STORE_INVALID", "director record store cannot be restored", 500);
  }
}
