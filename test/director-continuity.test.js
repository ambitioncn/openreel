import test from "node:test";
import assert from "node:assert/strict";
import { CONTINUITY_BIBLE_SCHEMA, createContinuityBible, createShotStateLedger, SHOT_STATE_LEDGER_SCHEMA } from "../src/director-continuity.js";

const entities = [
  ["hero", "character", { wardrobe: "red coat", mood: "calm" }, ["wardrobe"]],
  ["alley", "scene", { light: "night blue" }, ["light"]],
  ["watch", "prop", { finish: "silver" }, ["finish"]],
  ["look", "style", { palette: "blue-red" }, ["palette"]],
  ["cam", "camera", { lens: "35mm", axis: "east" }, ["lens"]]
].map(([entityId, kind, attributes, lockedAttributes]) => ({ entityId, kind, version: 1, attributes, lockedAttributes }));
const bible = () => createContinuityBible({ schema: CONTINUITY_BIBLE_SCHEMA, projectId: "p-1", revision: 2, entities });
const states = book => book.entities.map(entity => ({ entityId: entity.entityId, kind: entity.kind, version: entity.version, state: { ...entity.attributes } }));
const ledger = (book, shot) => createShotStateLedger({ schema: SHOT_STATE_LEDGER_SCHEMA, projectId: "p-1", workflowId: "wf-1", revision: 3, bibleRevision: book.revision, bibleFingerprint: book.fingerprint, shots: [shot] }, book);

test("versions all five continuity kinds and binds every shot input and output", () => {
  const book = bible();
  assert.deepEqual(new Set(book.entities.map(entity => entity.kind)), new Set(["character", "scene", "prop", "style", "camera"]));
  const inputSnapshot = states(book), outputSnapshot = states(book);
  outputSnapshot.find(item => item.entityId === "hero").state.mood = "alert";
  const result = ledger(book, { shotId: "s-1", sequence: 1, inputSnapshot, outputSnapshot, driftEvidence: [{ evidenceId: "d-1", shotId: "s-1", entityId: "hero", attribute: "mood", expected: "calm", actual: "alert", severity: "warning" }] });
  assert.equal(result.status, "accepted");
  assert.equal(result.shots[0].inputSnapshot.length, 5);
  assert.ok(Object.isFrozen(result.shots[0].outputSnapshot[0].state));
});

test("fails closed for incomplete bibles and stale or partial snapshots", () => {
  assert.throws(() => createContinuityBible({ schema: CONTINUITY_BIBLE_SCHEMA, projectId: "p-1", revision: 1, entities: entities.slice(0, 4) }), /requires a camera/);
  const book = bible();
  const inputSnapshot = states(book);
  assert.throws(() => ledger(book, { shotId: "s-1", sequence: 1, inputSnapshot: inputSnapshot.slice(1), outputSnapshot: inputSnapshot.slice(1), driftEvidence: [] }), /every bible entity/);
  const stale = states(book); stale[0].version = 9;
  assert.throws(() => ledger(book, { shotId: "s-1", sequence: 1, inputSnapshot: stale, outputSnapshot: states(book), driftEvidence: [] }), /stale or invalid/);
});

test("requires exact scoped drift evidence and blocks locked-attribute drift", () => {
  const book = bible(), inputSnapshot = states(book), outputSnapshot = states(book);
  outputSnapshot.find(item => item.entityId === "cam").state.lens = "85mm";
  const shot = { shotId: "s-1", sequence: 1, inputSnapshot, outputSnapshot, driftEvidence: [] };
  assert.throws(() => ledger(book, shot), /every drift/);
  shot.driftEvidence = [{ evidenceId: "d-1", shotId: "s-1", entityId: "cam", attribute: "lens", expected: "35mm", actual: "85mm", severity: "warning" }];
  assert.throws(() => ledger(book, shot), /must be blocking/);
  shot.driftEvidence[0].severity = "blocking";
  assert.equal(ledger(book, shot).status, "blocked");
});

test("rejects evidence that is unscoped, stale, duplicate, or fabricated", () => {
  const book = bible(), inputSnapshot = states(book), outputSnapshot = states(book);
  const base = { evidenceId: "d-1", shotId: "s-1", entityId: "hero", attribute: "mood", expected: "calm", actual: "alert", severity: "warning" };
  for (const driftEvidence of [[{ ...base, shotId: "s-2" }], [base], [base, { ...base, evidenceId: "d-2" }]]) {
    assert.throws(() => ledger(book, { shotId: "s-1", sequence: 1, inputSnapshot, outputSnapshot, driftEvidence }), /scope|real state|unique/);
  }
});
