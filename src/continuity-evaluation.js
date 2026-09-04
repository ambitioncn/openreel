import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve, sep } from "node:path";

export const CONTINUITY_EVALUATION_SCHEMA = "openreel-continuity-evaluation/v1";
const DIMENSIONS = ["identity", "scene", "referenceAdherence", "temporalCoherence", "artifactFreedom"];
const BLOCKING_FAILURES = new Set(["identity_swap", "reference_ignored", "scene_drift", "temporal_discontinuity", "unsafe_output"]);

export function validateContinuityEvaluation(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") throw new TypeError("evaluation must be an object");
  exactKeys(input, ["schema", "projectId", "storyboardVersion", "batchId", "provider", "model", "parameters", "outputAssetIds", "continuityEntityUsages", "evaluator", "evaluatedAt", "scores", "artifacts"]);
  if (input.schema !== CONTINUITY_EVALUATION_SCHEMA) throw new TypeError("unsupported continuity evaluation schema");
  for (const key of ["projectId", "batchId", "provider", "model", "evaluator"]) nonempty(input[key], key);
  if (!Number.isInteger(input.storyboardVersion) || input.storyboardVersion < 1) throw new TypeError("storyboardVersion must be a positive integer");
  isoDateTime(input.evaluatedAt, "evaluatedAt");
  const parameters = canonicalJsonObject(input.parameters, "parameters");
  const outputAssetIds = uniqueStrings(input.outputAssetIds, "outputAssetIds");
  if (!outputAssetIds.length) throw new TypeError("outputAssetIds must not be empty");
  if (!Array.isArray(input.continuityEntityUsages) || input.continuityEntityUsages.length !== outputAssetIds.length) throw new TypeError("continuityEntityUsages must align with ordered outputs");
  const continuityEntityUsages = input.continuityEntityUsages.map((usages, index) => validateUsages(usages, index));
  if (!Array.isArray(input.scores) || input.scores.length !== outputAssetIds.length) throw new TypeError("scores must align with ordered outputs");
  const seenShots = new Set(), seenOutputs = new Set();
  const scores = input.scores.map((score, index) => {
    exactKeys(score, ["shotId", "outputAssetId", "scores", "notes", "failures"]);
    nonempty(score.shotId, `scores[${index}].shotId`); nonempty(score.outputAssetId, `scores[${index}].outputAssetId`);
    if (score.outputAssetId !== outputAssetIds[index]) throw new TypeError("score output order must match outputAssetIds");
    if (seenShots.has(score.shotId) || seenOutputs.has(score.outputAssetId)) throw new TypeError("score shot and output ids must be unique");
    seenShots.add(score.shotId); seenOutputs.add(score.outputAssetId);
    exactKeys(score.scores, DIMENSIONS);
    for (const dimension of DIMENSIONS) if (!Number.isInteger(score.scores[dimension]) || score.scores[dimension] < 1 || score.scores[dimension] > 5) throw new TypeError(`${dimension} score must be an integer from 1 to 5`);
    if (typeof score.notes !== "string") throw new TypeError("score notes must be a string");
    const failures = uniqueStrings(score.failures, `scores[${index}].failures`);
    return { ...structuredClone(score), failures };
  });
  if (!Array.isArray(input.artifacts) || !input.artifacts.length) throw new TypeError("artifacts must not be empty");
  const seenArtifactPaths = new Set();
  const artifacts = input.artifacts.map((artifact, index) => {
    exactKeys(artifact, ["kind", "path", "sha256"]); nonempty(artifact.kind, `artifacts[${index}].kind`); nonempty(artifact.path, `artifacts[${index}].path`);
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(artifact.kind)) throw new TypeError(`artifacts[${index}].kind must be a canonical identifier`);
    if (!isCanonicalRelativePath(artifact.path)) throw new TypeError(`artifacts[${index}].path must be a canonical relative path`);
    if (seenArtifactPaths.has(artifact.path)) throw new TypeError("artifact paths must be unique");
    seenArtifactPaths.add(artifact.path);
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new TypeError("artifact sha256 must be lowercase hexadecimal");
    return structuredClone(artifact);
  });
  const accepted = scores.every(score => DIMENSIONS.every(dimension => score.scores[dimension] >= 4) && !score.failures.some(failure => BLOCKING_FAILURES.has(failure)));
  const normalized = canonicalJsonObject(structuredClone({ ...input, parameters, outputAssetIds, continuityEntityUsages, scores, artifacts, accepted }), "evaluation");
  return deepFreeze({ ...normalized, fingerprint: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") });
}

export async function verifyContinuityArtifactFiles(input, artifactRoot) {
  const evaluation = validateContinuityEvaluation(input);
  if (typeof artifactRoot !== "string" || !artifactRoot.trim()) throw new TypeError("artifactRoot must be a non-empty string");
  const root = await realpath(artifactRoot);
  if (!(await stat(root)).isDirectory()) throw new TypeError("artifactRoot must be a directory");
  const verifiedArtifacts = [];
  for (const artifact of evaluation.artifacts) {
    const candidate = resolve(root, artifact.path);
    let expectedFile;
    try {
      expectedFile = await realpath(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") throw new TypeError(`artifact file is missing: ${artifact.path}`);
      throw error;
    }
    assertBelowRoot(expectedFile, root, artifact.path);
    let handle;
    try {
      handle = await open(expectedFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if (error?.code === "ENOENT") throw new TypeError(`artifact file is missing: ${artifact.path}`);
      if (error?.code === "ELOOP") throw new TypeError(`artifact file changed during verification: ${artifact.path}`);
      throw error;
    }
    let sizeBytes;
    try {
      const openedFile = await realpath(`/proc/self/fd/${handle.fd}`);
      assertBelowRoot(openedFile, root, artifact.path);
      if (openedFile !== expectedFile) throw new TypeError(`artifact file changed during verification: ${artifact.path}`);
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()) throw new TypeError(`artifact path must resolve to a file: ${artifact.path}`);
      if (before.size === 0n) throw new TypeError(`artifact file must not be empty: ${artifact.path}`);
      const digest = createHash("sha256");
      sizeBytes = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        digest.update(chunk);
        sizeBytes += chunk.byteLength;
      }
      const after = await handle.stat({ bigint: true });
      if (!sameFileState(before, after) || BigInt(sizeBytes) !== after.size) throw new TypeError(`artifact file changed during verification: ${artifact.path}`);
      const actualSha256 = digest.digest("hex");
      if (actualSha256 !== artifact.sha256) throw new TypeError(`artifact sha256 mismatch: ${artifact.path}`);
      verifiedArtifacts.push(Object.freeze({ kind: artifact.kind, path: artifact.path, sha256: actualSha256, sizeBytes }));
    } finally {
      await handle.close();
    }
  }
  return Object.freeze({
    schema: "openreel-continuity-artifact-verification/v1",
    evaluationFingerprint: evaluation.fingerprint,
    artifacts: Object.freeze(verifiedArtifacts),
    verified: true
  });
}

function sameFileState(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function assertBelowRoot(file, root, artifactPath) {
  if (file !== root && !file.startsWith(`${root}${sep}`)) throw new TypeError(`artifact file escapes artifactRoot: ${artifactPath}`);
}

function exactKeys(value, allowed) { plainObject(value, "record"); const extra = Object.keys(value).filter(key => !allowed.includes(key)); const missing = allowed.filter(key => !Object.prototype.hasOwnProperty.call(value, key)); if (extra.length || missing.length) throw new TypeError(`record fields mismatch: extra=${extra.join(",")} missing=${missing.join(",")}`); }
function plainObject(value, name) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${name} must be a plain object`);
}
function canonicalJsonObject(value, name) {
  plainObject(value, name);
  return canonicalJsonValue(value, name, new Set());
}
function canonicalJsonValue(value, name, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must contain only finite JSON numbers`);
    return value;
  }
  if (!value || typeof value !== "object") throw new TypeError(`${name} must contain only JSON values`);
  if (ancestors.has(value)) throw new TypeError(`${name} must not contain circular references`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => canonicalJsonValue(item, `${name}[${index}]`, ancestors));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${name} must contain only plain JSON objects`);
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJsonValue(value[key], `${name}.${key}`, ancestors)]));
  } finally {
    ancestors.delete(value);
  }
}
function nonempty(value, name) { if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`); }
function uniqueStrings(value, name) { if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim()) || new Set(value).size !== value.length) throw new TypeError(`${name} must contain unique non-empty strings`); return [...value]; }
function isoDateTime(value, name) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an ISO UTC date-time`); }
function isCanonicalRelativePath(value) {
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || value.includes("//")) return false;
  const segments = value.split("/");
  return segments.every(segment => segment && segment !== "." && segment !== ".." && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment));
}
function validateUsages(value, shotIndex) {
  if (!Array.isArray(value)) throw new TypeError(`continuityEntityUsages[${shotIndex}] must be an array`);
  const seen = new Set();
  return value.map((usage, usageIndex) => {
    const label = `continuityEntityUsages[${shotIndex}][${usageIndex}]`;
    exactKeys(usage, ["entityId", "kind", "name", "version", "attributes", "lockedAttributes", "referenceAssetIds", "referenceProvenance"]);
    nonempty(usage.entityId, `${label}.entityId`); nonempty(usage.name, `${label}.name`);
    if (seen.has(usage.entityId)) throw new TypeError(`${label}.entityId must be unique within a shot`);
    seen.add(usage.entityId);
    if (!new Set(["character", "product", "scene"]).has(usage.kind)) throw new TypeError(`${label}.kind must be character, product, or scene`);
    if (!Number.isInteger(usage.version) || usage.version < 1) throw new TypeError(`${label}.version must be a positive integer`);
    plainObject(usage.attributes, `${label}.attributes`);
    const attributeEntries = Object.entries(usage.attributes);
    if (!attributeEntries.length || attributeEntries.some(([key, item]) => !key.trim() || typeof item !== "string" || !item.trim())) throw new TypeError(`${label}.attributes must contain non-empty string keys and values`);
    const lockedAttributes = uniqueStrings(usage.lockedAttributes, `${label}.lockedAttributes`);
    if (lockedAttributes.some(key => !(key in usage.attributes))) throw new TypeError(`${label}.lockedAttributes must exist in attributes`);
    const referenceAssetIds = uniqueStrings(usage.referenceAssetIds, `${label}.referenceAssetIds`);
    if (!Array.isArray(usage.referenceProvenance) || usage.referenceProvenance.length !== referenceAssetIds.length) throw new TypeError(`${label}.referenceProvenance must align with referenceAssetIds`);
    const referenceProvenance = usage.referenceProvenance.map((provenance, provenanceIndex) => {
      exactKeys(provenance, ["assetId", "source", "createdAt"]);
      if (provenance.assetId !== referenceAssetIds[provenanceIndex]) throw new TypeError(`${label}.referenceProvenance asset order must match referenceAssetIds`);
      const source = canonicalJsonObject(provenance.source, `${label}.referenceProvenance.source`);
      if (!Object.keys(source).length) throw new TypeError(`${label}.referenceProvenance.source must not be empty`);
      isoDateTime(provenance.createdAt, `${label}.referenceProvenance.createdAt`);
      return structuredClone({ ...provenance, source });
    });
    return structuredClone({ ...usage, lockedAttributes, referenceAssetIds, referenceProvenance });
  });
}
