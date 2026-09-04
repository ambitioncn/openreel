import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "./core.js";

const clone = value => structuredClone(value);
const key = (ownerId, projectId, idempotencyKey) => `${ownerId}\n${projectId}\n${idempotencyKey}`;

export function createMemoryAgentFilmStore(seed = []) {
  const records = new Map(seed.map(record => [key(record.ownerId, record.projectId, record.idempotencyKey), clone(record)]));
  return Object.freeze({
    get: (ownerId, projectId, idempotencyKey) => clone(records.get(key(ownerId, projectId, idempotencyKey)) || null),
    put(record) { const id = key(record.ownerId, record.projectId, record.idempotencyKey); if (!records.has(id)) records.set(id, clone(record)); return clone(records.get(id)); },
    linkExecution(ownerId, projectId, idempotencyKey, executionJobId) {
      const id = key(ownerId, projectId, idempotencyKey), record = records.get(id);
      if (!record) throw new DomainError("AGENT_FILM_NOT_FOUND", "Agent film run not found", 404);
      const next = { ...record, executionJobId };
      records.set(id, clone(next));
      return clone(next);
    }
  });
}

export function createFileAgentFilmStore(file) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o750 });
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new DomainError("AGENT_FILM_STORE_CORRUPT", "Agent film store is unreadable", 500); state = { schema: "openreel-agent-film-store/v1", records: [] }; }
  if (state?.schema !== "openreel-agent-film-store/v1" || !Array.isArray(state.records)) throw new DomainError("AGENT_FILM_STORE_CORRUPT", "Agent film store has an invalid schema", 500);
  const persist = () => {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state)}\n`, { flag: "wx", mode: 0o640 });
    const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, file);
    const dirFd = openSync(dirname(file), "r"); try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  };
  return Object.freeze({
    get: (ownerId, projectId, idempotencyKey) => clone(state.records.find(record => record.ownerId === ownerId && record.projectId === projectId && record.idempotencyKey === idempotencyKey) || null),
    put(record) {
      const existing = state.records.find(item => item.ownerId === record.ownerId && item.projectId === record.projectId && item.idempotencyKey === record.idempotencyKey);
      if (existing) return clone(existing);
      state.records.push(clone(record)); persist(); return clone(record);
    },
    linkExecution(ownerId, projectId, idempotencyKey, executionJobId) {
      const index = state.records.findIndex(item => item.ownerId === ownerId && item.projectId === projectId && item.idempotencyKey === idempotencyKey);
      if (index < 0) throw new DomainError("AGENT_FILM_NOT_FOUND", "Agent film run not found", 404);
      state.records[index] = { ...state.records[index], executionJobId };
      persist();
      return clone(state.records[index]);
    }
  });
}
