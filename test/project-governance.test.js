import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("project ledger unmet items match required non-accepted backlog items", async () => {
  const backlog = await readJson("../docs/libtv-parity-backlog.json");
  const ledger = await readJson("../docs/project-acceptance-ledger.json");
  const expected = backlog.items.filter(item => item.required && item.status !== "accepted").map(item => item.id).sort();
  assert.deepEqual([...ledger.unmet].sort(), expected);
});

test("project blockers identify current human-gated required backlog items only", async () => {
  const backlog = await readJson("../docs/libtv-parity-backlog.json");
  const ledger = await readJson("../docs/project-acceptance-ledger.json");
  const items = new Map(backlog.items.map(item => [item.id, item]));
  assert.ok(ledger.blockers.length > 0);
  for (const blocker of ledger.blockers) {
    const item = items.get(blocker.id);
    assert.ok(item, `unknown blocker ${blocker.id}`);
    assert.equal(item.required, true);
    assert.equal(item.status, "human_gated");
    assert.ok(typeof blocker.reason === "string" && blocker.reason.length > 0);
  }
  const expected = backlog.items.filter(item => item.required && item.status === "human_gated").map(item => item.id).sort();
  assert.deepEqual(ledger.blockers.map(blocker => blocker.id).sort(), expected);
});

test("security backlog retains a bounded evidence and remaining-work contract", async () => {
  const backlog = await readJson("../docs/libtv-parity-backlog.json");
  const security = backlog.items.find(item => item.id === "S-01");
  assert.ok(security, "missing S-01 backlog item");
  assert.ok(Array.isArray(security.evidence));
  assert.ok(Array.isArray(security.remaining));
  assert.ok(security.remaining.every(entry => !entry.includes("Restrict public /health/ready")));
});
