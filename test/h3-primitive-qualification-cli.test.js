import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

test("H3 primitive qualification CLI writes a replayable plan", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openreel-h3-plan-"));
  const output = join(directory, "plan.json");
  const args = ["scripts/plan-h3-primitive-qualification.mjs", `--output=${output}`, "--scenes=rigid,package", "--seeds=3,5", "--primitives=static_hold,micro_turn", "--estimated-call-cny=4", "--hard-limit-cny=40"];
  await exec(process.execPath, args);
  const first = await readFile(output, "utf8");
  await exec(process.execPath, args);
  assert.equal(await readFile(output, "utf8"), first);
  const plan = JSON.parse(first);
  assert.equal(plan.cases.length, 8);
  assert.equal(plan.budget.estimatedTotalCny, 32);
});

test("H3 primitive qualification CLI leaves no output when budget fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openreel-h3-plan-negative-"));
  const output = join(directory, "plan.json");
  await assert.rejects(exec(process.execPath, ["scripts/plan-h3-primitive-qualification.mjs", `--output=${output}`, "--estimated-call-cny=100", "--hard-limit-cny=1"]));
  await assert.rejects(readFile(output));
});
