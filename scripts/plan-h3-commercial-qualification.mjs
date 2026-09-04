import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createH3CapabilityMatrix, createH3CommercialQualificationProtocol } from "../src/prompt-director-v2.js";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const output = resolve(option("output", "artifacts/prompt-director-v2-h3-coverage"));
const matrix = createH3CapabilityMatrix();
const protocol = createH3CommercialQualificationProtocol({
  seeds: option("seeds", "37,73,109").split(",").map(Number),
  hardLimitCnyPerAction: Number(option("hard-limit-cny-per-action", "100")),
  estimatedCallCny: Number(option("estimated-call-cny", "0"))
});
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(resolve(output, "capability-matrix-v1.json"), `${JSON.stringify(matrix, null, 2)}\n`),
  writeFile(resolve(output, "qualification-protocol-v1.json"), `${JSON.stringify(protocol, null, 2)}\n`),
  writeFile(resolve(output, "evidence-ledger.jsonl"), "", { flag: "a" })
]);
process.stdout.write(`${JSON.stringify({ output, matrixCases: matrix.cases.length, qualificationCases: protocol.cases.length, seeds: protocol.seeds, estimatedTotalCny: protocol.budget.estimatedTotalCny })}\n`);
