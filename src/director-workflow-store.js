import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { restoreDirectorWorkflow, validateDirectorWorkflow } from "./director-workflow.js";

export function createDirectorWorkflowStore(path) {
  return Object.freeze({
    save(workflow) {
      validateDirectorWorkflow(workflow);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(workflow)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
      return workflow;
    },
    load() {
      return restoreDirectorWorkflow(JSON.parse(readFileSync(path, "utf8")));
    }
  });
}
