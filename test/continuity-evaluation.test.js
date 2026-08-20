import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateContinuityEvaluation, verifyContinuityArtifactFiles } from "../src/continuity-evaluation.js";

const digest = "a".repeat(64);
const usage = () => ({ entityId: "hero", kind: "character", name: "Hero", version: 1, attributes: { face: "oval" }, lockedAttributes: ["face"], referenceAssetIds: ["reference-1"], referenceProvenance: [{ assetId: "reference-1", source: { operation: "upload", sourceAssetId: "reference-1" }, createdAt: "2026-08-14T00:00:00.000Z" }] });
const fixture = () => ({ schema: "openreel-continuity-evaluation/v1", projectId: "project-1", storyboardVersion: 2, batchId: "batch-1", provider: "review-only", model: "retained-output", parameters: { duration: 5 }, outputAssetIds: ["asset-1", "asset-2"], continuityEntityUsages: [[usage()], [usage()]], evaluator: "reviewer-1", evaluatedAt: "2026-08-15T00:00:00.000Z", scores: ["1", "2"].map(index => ({ shotId: `shot-${index}`, outputAssetId: `asset-${index}`, scores: { identity: 4, scene: 4, referenceAdherence: 4, temporalCoherence: 4, artifactFreedom: 4 }, notes: "reviewed", failures: [] })), artifacts: [{ kind: "manifest", path: "artifacts/manifest.json", sha256: digest }] });

test("continuity evaluation validates ordered retained review evidence", () => {
  const result = validateContinuityEvaluation(fixture());
  assert.equal(result.accepted, true); assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test("continuity evaluation recursively freezes fingerprinted evidence", () => {
  const result = validateContinuityEvaluation(fixture());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.parameters), true);
  assert.equal(Object.isFrozen(result.scores), true);
  assert.equal(Object.isFrozen(result.scores[0].scores), true);
  assert.equal(Object.isFrozen(result.continuityEntityUsages[0][0].referenceProvenance[0].source), true);
  assert.throws(() => { result.scores[0].scores.identity = 1; }, TypeError);
  assert.throws(() => { result.parameters.duration = 99; }, TypeError);
  assert.equal(result.scores[0].scores.identity, 4);
  assert.equal(result.parameters.duration, 5);
});

test("continuity evaluation canonicalizes nested JSON records before fingerprinting", () => {
  const first = fixture();
  first.parameters = { z: { beta: 2, alpha: 1 }, a: [true, null, "value"] };
  first.continuityEntityUsages[0][0].referenceProvenance[0].source = { z: "last", a: { y: 2, x: 1 } };
  const second = fixture();
  second.parameters = { a: [true, null, "value"], z: { alpha: 1, beta: 2 } };
  second.continuityEntityUsages[0][0].referenceProvenance[0].source = { a: { x: 1, y: 2 }, z: "last" };
  const firstResult = validateContinuityEvaluation(first);
  const secondResult = validateContinuityEvaluation(second);
  assert.deepEqual(firstResult.parameters, secondResult.parameters);
  assert.deepEqual(firstResult.continuityEntityUsages[0][0].referenceProvenance[0].source, secondResult.continuityEntityUsages[0][0].referenceProvenance[0].source);
  assert.equal(firstResult.fingerprint, secondResult.fingerprint);
});

test("continuity evaluation canonicalizes the complete object graph", () => {
  const first = fixture();
  first.continuityEntityUsages[0][0].attributes = { z: "last", a: "first" };
  first.continuityEntityUsages[0][0].lockedAttributes = ["z", "a"];
  first.scores[0].scores = { temporalCoherence: 4, scene: 4, identity: 4, artifactFreedom: 4, referenceAdherence: 4 };
  const secondBase = fixture();
  secondBase.continuityEntityUsages[0][0].attributes = { a: "first", z: "last" };
  secondBase.continuityEntityUsages[0][0].lockedAttributes = ["z", "a"];
  const second = Object.fromEntries(Object.entries(secondBase).reverse());
  assert.equal(validateContinuityEvaluation(first).fingerprint, validateContinuityEvaluation(second).fingerprint);
});

test("continuity evaluation requires schema fields to be own plain-object properties", () => {
  const inherited = Object.create({ projectId: "project-1" });
  Object.assign(inherited, fixture());
  delete inherited.projectId;
  assert.throws(() => validateContinuityEvaluation(inherited), /plain object/);
  class Parameters { constructor() { this.duration = 5; } }
  const typedParameters = fixture(); typedParameters.parameters = new Parameters();
  assert.throws(() => validateContinuityEvaluation(typedParameters), /plain object/);
});

test("continuity evaluation rejects values that JSON would omit or normalize", () => {
  const undefinedParameter = fixture(); undefinedParameter.parameters.seed = undefined;
  assert.throws(() => validateContinuityEvaluation(undefinedParameter), /only JSON values/);
  const nonFiniteParameter = fixture(); nonFiniteParameter.parameters.guidance = Number.NaN;
  assert.throws(() => validateContinuityEvaluation(nonFiniteParameter), /finite JSON numbers/);
  const typedSource = fixture(); typedSource.continuityEntityUsages[0][0].referenceProvenance[0].source = new Date();
  assert.throws(() => validateContinuityEvaluation(typedSource), /plain object/);
  const circular = fixture(); circular.parameters.loop = circular.parameters;
  assert.throws(() => validateContinuityEvaluation(circular), /circular references/);
});

test("continuity evaluation fails closed for structural and ordering drift", () => {
  const unknown = fixture(); unknown.unreviewed = true;
  assert.throws(() => validateContinuityEvaluation(unknown), /fields mismatch/);
  const reordered = fixture(); reordered.scores.reverse();
  assert.throws(() => validateContinuityEvaluation(reordered), /output order/);
  const malformedDigest = fixture(); malformedDigest.artifacts[0].sha256 = "abc";
  assert.throws(() => validateContinuityEvaluation(malformedDigest), /sha256/);
  const legacyDimension = fixture(); legacyDimension.scores[0].scores.temporalContinuity = legacyDimension.scores[0].scores.temporalCoherence; delete legacyDimension.scores[0].scores.temporalCoherence;
  assert.throws(() => validateContinuityEvaluation(legacyDimension), /fields mismatch/);
  const missingArtifactFreedom = fixture(); delete missingArtifactFreedom.scores[0].scores.artifactFreedom;
  assert.throws(() => validateContinuityEvaluation(missingArtifactFreedom), /fields mismatch/);
});

test("continuity evaluation rejects low scores and blocking failures without rejecting the artifact", () => {
  const low = fixture(); low.scores[0].scores.identity = 3;
  assert.equal(validateContinuityEvaluation(low).accepted, false);
  const artifact = fixture(); artifact.scores[0].scores.artifactFreedom = 3;
  assert.equal(validateContinuityEvaluation(artifact).accepted, false);
  const failure = fixture(); failure.scores[1].failures = ["scene_drift"];
  assert.equal(validateContinuityEvaluation(failure).accepted, false);
});

test("continuity evaluation rejects incomplete or forged entity-usage provenance", () => {
  const incomplete = fixture(); incomplete.continuityEntityUsages[0] = [{ entityId: "hero", version: 1 }];
  assert.throws(() => validateContinuityEvaluation(incomplete), /fields mismatch/);
  const unlocked = fixture(); unlocked.continuityEntityUsages[0][0].lockedAttributes = ["costume"];
  assert.throws(() => validateContinuityEvaluation(unlocked), /must exist in attributes/);
  const misordered = fixture(); misordered.continuityEntityUsages[0][0].referenceProvenance[0].assetId = "reference-2";
  assert.throws(() => validateContinuityEvaluation(misordered), /asset order/);
  const duplicate = fixture(); duplicate.continuityEntityUsages[0].push(usage());
  assert.throws(() => validateContinuityEvaluation(duplicate), /unique within a shot/);
  const nonIsoTime = fixture(); nonIsoTime.evaluatedAt = "August 15, 2026";
  assert.throws(() => validateContinuityEvaluation(nonIsoTime), /ISO UTC/);
});

test("continuity evaluation rejects ambiguous or unsafe artifact identities", () => {
  const traversal = fixture(); traversal.artifacts[0].path = "../outside/manifest.json";
  assert.throws(() => validateContinuityEvaluation(traversal), /canonical relative path/);
  const absolute = fixture(); absolute.artifacts[0].path = "/tmp/manifest.json";
  assert.throws(() => validateContinuityEvaluation(absolute), /canonical relative path/);
  const platformAmbiguous = fixture(); platformAmbiguous.artifacts[0].path = "artifacts\\manifest.json";
  assert.throws(() => validateContinuityEvaluation(platformAmbiguous), /canonical relative path/);
  const duplicate = fixture(); duplicate.artifacts.push({ ...duplicate.artifacts[0], kind: "prompt" });
  assert.throws(() => validateContinuityEvaluation(duplicate), /paths must be unique/);
  const nonCanonicalKind = fixture(); nonCanonicalKind.artifacts[0].kind = "Review Manifest";
  assert.throws(() => validateContinuityEvaluation(nonCanonicalKind), /canonical identifier/);
});

test("continuity artifact verification binds declared digests to retained bytes", async t => {
  const root = await mkdtemp(join(tmpdir(), "openreel-continuity-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(join(root, "artifacts"));
  const bytes = Buffer.from("retained review manifest\n");
  await writeFile(join(root, "artifacts", "manifest.json"), bytes);
  const input = fixture();
  input.artifacts[0].sha256 = createHash("sha256").update(bytes).digest("hex");
  const result = await verifyContinuityArtifactFiles(input, root);
  assert.equal(result.verified, true);
  assert.equal(result.artifacts[0].sizeBytes, bytes.byteLength);
  assert.equal(result.artifacts[0].sha256, input.artifacts[0].sha256);
});

test("continuity artifact verification rejects missing, changed, and root-escaping files", async t => {
  const root = await mkdtemp(join(tmpdir(), "openreel-continuity-"));
  const outside = await mkdtemp(join(tmpdir(), "openreel-continuity-outside-"));
  t.after(() => Promise.all([root, outside].map(path => import("node:fs/promises").then(({ rm }) => rm(path, { recursive: true, force: true })))));
  await mkdir(join(root, "artifacts"));
  await assert.rejects(verifyContinuityArtifactFiles(fixture(), root), /file is missing/);
  await writeFile(join(root, "artifacts", "manifest.json"), "changed bytes");
  await assert.rejects(verifyContinuityArtifactFiles(fixture(), root), /sha256 mismatch/);
  await writeFile(join(outside, "manifest.json"), "outside bytes");
  await import("node:fs/promises").then(({ rm }) => rm(join(root, "artifacts", "manifest.json")));
  await symlink(join(outside, "manifest.json"), join(root, "artifacts", "manifest.json"));
  const input = fixture();
  input.artifacts[0].sha256 = createHash("sha256").update("outside bytes").digest("hex");
  await assert.rejects(verifyContinuityArtifactFiles(input, root), /escapes artifactRoot/);
});

test("continuity artifact verification rejects empty retained evidence", async t => {
  const root = await mkdtemp(join(tmpdir(), "openreel-continuity-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(join(root, "artifacts"));
  await writeFile(join(root, "artifacts", "manifest.json"), "");
  const input = fixture();
  input.artifacts[0].sha256 = createHash("sha256").update("").digest("hex");
  await assert.rejects(verifyContinuityArtifactFiles(input, root), /must not be empty/);
});

test("continuity artifact verification binds the digest to the opened file descriptor", async t => {
  const root = await mkdtemp(join(tmpdir(), "openreel-continuity-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(join(root, "artifacts"));
  const bytes = Buffer.from("descriptor-bound evidence\n");
  await writeFile(join(root, "artifacts", "manifest.json"), bytes);
  const input = fixture();
  input.artifacts[0].sha256 = createHash("sha256").update(bytes).digest("hex");
  const result = await verifyContinuityArtifactFiles(input, root);
  assert.deepEqual(result.artifacts[0], {
    kind: "manifest",
    path: "artifacts/manifest.json",
    sha256: input.artifacts[0].sha256,
    sizeBytes: bytes.byteLength
  });
  assert.equal(Object.isFrozen(result.artifacts), true);
  assert.equal(Object.isFrozen(result.artifacts[0]), true);
});

test("continuity artifact verification streams retained bytes without FileHandle.readFile", async t => {
  const root = await mkdtemp(join(tmpdir(), "openreel-continuity-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(join(root, "artifacts"));
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 0x5a);
  await writeFile(join(root, "artifacts", "manifest.json"), bytes);
  const input = fixture();
  input.artifacts[0].sha256 = createHash("sha256").update(bytes).digest("hex");
  const result = await verifyContinuityArtifactFiles(input, root);
  assert.equal(result.artifacts[0].sizeBytes, bytes.byteLength);
  assert.equal(result.artifacts[0].sha256, input.artifacts[0].sha256);
});
