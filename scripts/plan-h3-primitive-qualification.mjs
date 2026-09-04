import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createH3PrimitiveQualificationPlan } from "../src/prompt-director-v2.js";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find(argument => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const output = resolve(option("output", "artifacts/h3-primitive-qualification-plan.json"));
const plan = createH3PrimitiveQualificationPlan({
  sceneIds: option("scenes", "rigid-product,soft-package").split(","),
  seeds: option("seeds", "17,29").split(",").map(Number),
  primitiveNames: option("primitives", "static_hold,micro_turn,dolly_in,orbit_left").split(","),
  hardLimitCny: Number(option("hard-limit-cny", "100")),
  estimatedCallCny: Number(option("estimated-call-cny", "0"))
});

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: "w" });
process.stdout.write(`${JSON.stringify({ output, cases: plan.cases.length, budget: plan.budget })}\n`);
