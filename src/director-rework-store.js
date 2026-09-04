import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { restoreDirectorReworkState, validateDirectorReworkState } from "./director-rework.js";

export function createDirectorReworkStore(path) {
  return Object.freeze({
    save(state) {
      validateDirectorReworkState(state);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(`${path}.tmp`, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      return state;
    },
    load() { return restoreDirectorReworkState(JSON.parse(readFileSync(path, "utf8"))); }
  });
}
