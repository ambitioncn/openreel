import { createHash } from "node:crypto";

export const CONTINUITY_KINDS = Object.freeze(["character", "scene", "prop", "style", "camera"]);
export const CONTINUITY_BIBLE_SCHEMA = "openreel-continuity-bible/v1";
export const SHOT_STATE_LEDGER_SCHEMA = "openreel-shot-state-ledger/v1";

const invalid = message => { throw new TypeError(message); };
const id = (value, name) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) invalid(`${name} must be a canonical id`);
  return value;
};
const exact = (value, keys, name) => {
  if (!value || Array.isArray(value) || typeof value !== "object") invalid(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  if (actual.join("\0") !== [...keys].sort().join("\0")) invalid(`${name} fields are invalid`);
};
const jsonObject = (value, name) => {
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) invalid(`${name} must be a plain object`);
  try { return JSON.parse(JSON.stringify(value)); } catch { invalid(`${name} must be JSON serializable`); }
};
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createContinuityBible(input) {
  exact(input, ["schema", "projectId", "revision", "entities"], "continuity bible");
  if (input.schema !== CONTINUITY_BIBLE_SCHEMA) invalid("continuity bible schema is invalid");
  id(input.projectId, "projectId");
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) invalid("revision must be a positive integer");
  if (!Array.isArray(input.entities)) invalid("entities must be an array");
  const seen = new Set();
  const entities = input.entities.map((entity, index) => {
    exact(entity, ["entityId", "kind", "version", "attributes", "lockedAttributes"], `entities[${index}]`);
    id(entity.entityId, `entities[${index}].entityId`);
    if (seen.has(entity.entityId)) invalid("entity ids must be unique");
    seen.add(entity.entityId);
    if (!CONTINUITY_KINDS.includes(entity.kind)) invalid("entity kind is invalid");
    if (!Number.isSafeInteger(entity.version) || entity.version < 1) invalid("entity version must be a positive integer");
    const attributes = jsonObject(entity.attributes, "entity attributes");
    if (!Object.keys(attributes).length || Object.values(attributes).some(value => typeof value !== "string" || !value.trim())) invalid("entity attributes must contain non-empty strings");
    if (!Array.isArray(entity.lockedAttributes) || new Set(entity.lockedAttributes).size !== entity.lockedAttributes.length || entity.lockedAttributes.some(key => typeof key !== "string" || !(key in attributes))) invalid("locked attributes must be unique attribute keys");
    return { entityId: entity.entityId, kind: entity.kind, version: entity.version, attributes, lockedAttributes: [...entity.lockedAttributes].sort() };
  });
  for (const kind of CONTINUITY_KINDS) if (!entities.some(entity => entity.kind === kind)) invalid(`continuity bible requires a ${kind} entity`);
  const normalized = { schema: input.schema, projectId: input.projectId, revision: input.revision, entities };
  return freeze({ ...normalized, fingerprint: digest(normalized) });
}

export function createShotStateLedger(input, bibleInput) {
  const bible = bibleInput?.fingerprint ? bibleInput : createContinuityBible(bibleInput);
  exact(input, ["schema", "projectId", "workflowId", "revision", "bibleRevision", "bibleFingerprint", "shots"], "shot state ledger");
  if (input.schema !== SHOT_STATE_LEDGER_SCHEMA) invalid("shot state ledger schema is invalid");
  if (input.projectId !== bible.projectId || input.bibleRevision !== bible.revision || input.bibleFingerprint !== bible.fingerprint) invalid("ledger must bind the exact continuity bible");
  id(input.workflowId, "workflowId");
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) invalid("revision must be a positive integer");
  if (!Array.isArray(input.shots) || !input.shots.length) invalid("shots must not be empty");
  const entityMap = new Map(bible.entities.map(entity => [entity.entityId, entity]));
  const shotIds = new Set();
  const shots = input.shots.map((shot, index) => {
    exact(shot, ["shotId", "sequence", "inputSnapshot", "outputSnapshot", "driftEvidence"], `shots[${index}]`);
    id(shot.shotId, `shots[${index}].shotId`);
    if (shotIds.has(shot.shotId) || shot.sequence !== index + 1) invalid("shots must have unique ids and contiguous sequence");
    shotIds.add(shot.shotId);
    const inputSnapshot = snapshot(shot.inputSnapshot, entityMap, `shots[${index}].inputSnapshot`);
    const outputSnapshot = snapshot(shot.outputSnapshot, entityMap, `shots[${index}].outputSnapshot`);
    if (inputSnapshot.length !== outputSnapshot.length || inputSnapshot.some((state, position) => state.entityId !== outputSnapshot[position].entityId)) invalid("input and output snapshots must bind the same entities");
    if (!Array.isArray(shot.driftEvidence)) invalid("driftEvidence must be an array");
    const evidence = new Map();
    const driftEvidence = shot.driftEvidence.map((item, evidenceIndex) => {
      exact(item, ["evidenceId", "shotId", "entityId", "attribute", "expected", "actual", "severity"], `driftEvidence[${evidenceIndex}]`);
      id(item.evidenceId, "evidenceId");
      if (item.shotId !== shot.shotId || !entityMap.has(item.entityId) || typeof item.attribute !== "string" || !item.attribute || !["warning", "blocking"].includes(item.severity)) invalid("drift evidence scope is invalid");
      const key = `${item.entityId}\0${item.attribute}`;
      if (evidence.has(key)) invalid("drift evidence scope must be unique");
      evidence.set(key, item);
      return { ...item };
    });
    for (let position = 0; position < inputSnapshot.length; position++) {
      const before = inputSnapshot[position], after = outputSnapshot[position], entity = entityMap.get(before.entityId);
      for (const attribute of new Set([...Object.keys(before.state), ...Object.keys(after.state)])) {
        if (before.state[attribute] === after.state[attribute]) continue;
        const item = evidence.get(`${before.entityId}\0${attribute}`);
        if (!item || item.expected !== before.state[attribute] || item.actual !== after.state[attribute]) invalid("every drift must have exact scoped evidence");
        if (entity.lockedAttributes.includes(attribute) && item.severity !== "blocking") invalid("locked attribute drift must be blocking");
      }
    }
    for (const item of driftEvidence) {
      const before = inputSnapshot.find(state => state.entityId === item.entityId)?.state[item.attribute];
      const after = outputSnapshot.find(state => state.entityId === item.entityId)?.state[item.attribute];
      if (before === after || item.expected !== before || item.actual !== after) invalid("drift evidence must describe a real state change");
    }
    return { shotId: shot.shotId, sequence: shot.sequence, inputSnapshot, outputSnapshot, driftEvidence, continuityStatus: driftEvidence.some(item => item.severity === "blocking") ? "blocked" : "accepted" };
  });
  const normalized = { schema: input.schema, projectId: input.projectId, workflowId: input.workflowId, revision: input.revision, bibleRevision: input.bibleRevision, bibleFingerprint: input.bibleFingerprint, shots };
  return freeze({ ...normalized, status: shots.some(shot => shot.continuityStatus === "blocked") ? "blocked" : "accepted", fingerprint: digest(normalized) });
}

function snapshot(value, entityMap, name) {
  if (!Array.isArray(value) || value.length !== entityMap.size) invalid(`${name} must contain every bible entity exactly once`);
  const seen = new Set();
  const normalized = value.map((binding, index) => {
    exact(binding, ["entityId", "kind", "version", "state"], `${name}[${index}]`);
    const entity = entityMap.get(binding.entityId);
    if (!entity || seen.has(binding.entityId) || binding.kind !== entity.kind || binding.version !== entity.version) invalid(`${name} entity binding is stale or invalid`);
    seen.add(binding.entityId);
    const state = jsonObject(binding.state, `${name}.state`);
    if (Object.values(state).some(item => typeof item !== "string" || !item.trim())) invalid(`${name}.state values must be non-empty strings`);
    for (const locked of entity.lockedAttributes) if (!(locked in state)) invalid(`${name} must include locked attribute ${locked}`);
    return { entityId: binding.entityId, kind: binding.kind, version: binding.version, state };
  });
  return normalized.sort((left, right) => left.entityId.localeCompare(right.entityId));
}
