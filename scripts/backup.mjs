#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const digest = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const identifierDigest = value => createHash("sha256").update(String(value)).digest("hex");
const files = root => readdirSync(root, { recursive: true, withFileTypes: true }).filter(item => {
  if (item.isDirectory()) return false;
  if (!item.isFile() || item.isSymbolicLink()) throw new Error(`backup contains non-regular file: ${join(item.parentPath, item.name)}`);
  return true;
}).map(item => join(item.parentPath, item.name)).sort();
const inside = (root, value) => { const path = resolve(root, value); if (!path.startsWith(`${resolve(root)}/`)) throw new Error("backup path escaped asset root"); return path; };
const regularFile = path => {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`backup source must be a regular file: ${path}`);
  return metadata;
};
const secureTree = root => {
  chmodSync(root, 0o700);
  for (const item of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = join(item.parentPath, item.name);
    if (item.isSymbolicLink()) throw new Error(`backup contains non-regular file: ${path}`);
    if (item.isDirectory()) chmodSync(path, 0o700);
    else if (item.isFile()) chmodSync(path, 0o600);
    else throw new Error(`backup contains non-regular file: ${path}`);
  }
};
export const copyStableFile = (source, destination, copy = cpSync) => {
  const before = regularFile(source), beforeDigest = digest(source);
  copy(source, destination);
  const after = regularFile(source), afterDigest = digest(source), copiedDigest = digest(destination);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || beforeDigest !== afterDigest || beforeDigest !== copiedDigest) throw new Error(`backup source changed during copy: ${source}`);
};
const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} fields are invalid`);
};
const canonicalRelativePath = path => typeof path === "string" && path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !/[\u0000-\u001f\u007f]/u.test(path) && path.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== "..");
const nonemptyText = value => typeof value === "string" && value.trim().length > 0;
const positiveVersion = value => Number.isSafeInteger(value) && value > 0;
const finiteNonnegative = value => Number.isFinite(value) && value >= 0;
const finitePositive = value => Number.isFinite(value) && value > 0;
const canonicalTimestamp = value => {
  const parsed = Date.parse(value);
  return typeof value === "string" && Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};
export const canonicalBackupManifestText = manifest => `${JSON.stringify(manifest, null, 2)}\n`;
const checkDatabase = path => {
  const db = new DatabaseSync(path);
  try {
    const integrity = db.prepare("PRAGMA quick_check").get().quick_check;
    if (integrity !== "ok") throw new Error("restored database quick_check failed");
    const requiredTables = ["entities", "metadata", "schema_migrations"];
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (requiredTables.some(table => !tables.has(table))) throw new Error("restored database is missing required OpenReel tables");
    const migrations = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map(row => row.version);
    if (JSON.stringify(migrations) !== JSON.stringify([1, 2])) throw new Error("restored database migration state is unsupported");
    const revision = Number(db.prepare("SELECT value FROM metadata WHERE key='revision'").get()?.value);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("restored database revision is invalid");
    const kinds = new Set(["projects", "sessions", "nodes", "edges", "groups", "jobs", "assets", "users"]);
    const assetKeys = [], entities = new Map([...kinds].map(kind => [kind, new Map()]));
    for (const row of db.prepare("SELECT kind,id,data FROM entities").all()) {
      if (!kinds.has(row.kind) || typeof row.id !== "string" || !row.id) throw new Error("restored database entity identity is invalid");
      let value;
      try { value = JSON.parse(row.data); }
      catch { throw new Error("restored database entity JSON is invalid"); }
      if (!value || typeof value !== "object" || Array.isArray(value) || value.id !== row.id) throw new Error("restored database entity shape is invalid");
      if (entities.get(row.kind).has(row.id)) throw new Error("restored database entity identity is not unique");
      entities.get(row.kind).set(row.id, value);
      if (row.kind === "assets") {
        const expectedStorageKey = typeof value.projectId === "string" && value.projectId ? `${identifierDigest(value.projectId)}/${identifierDigest(value.id)}.bin` : null;
        if (!canonicalRelativePath(value.storageKey) || value.storageKey !== expectedStorageKey) throw new Error("restored database asset storage key is invalid");
        assetKeys.push(value.storageKey);
      }
    }
    if (new Set(assetKeys).size !== assetKeys.length) throw new Error("restored database asset storage keys are not unique");
    for (const user of entities.get("users").values()) {
      if (!nonemptyText(user.name) || !canonicalTimestamp(user.createdAt)) throw new Error("restored database user identity is invalid");
    }
    for (const session of entities.get("sessions").values()) {
      if (!entities.get("projects").has(session.projectId)) throw new Error("restored database canvas relationship is invalid: sessions");
      const createdAt = Date.parse(session.createdAt), updatedAt = Date.parse(session.updatedAt), closedAt = session.closedAt == null ? null : Date.parse(session.closedAt);
      if (!nonemptyText(session.name) || !positiveVersion(session.version) || !["active", "closed"].includes(session.status) || !canonicalTimestamp(session.createdAt) || !canonicalTimestamp(session.updatedAt) || updatedAt < createdAt || (session.status === "active" && session.closedAt != null) || (session.status === "closed" && (!canonicalTimestamp(session.closedAt) || closedAt < createdAt || closedAt > updatedAt))) throw new Error("restored database session lifecycle is invalid");
    }
    for (const node of entities.get("nodes").values()) {
      const session = entities.get("sessions").get(node.sessionId);
      if (!entities.get("projects").has(node.projectId) || !session || session.projectId !== node.projectId) throw new Error("restored database canvas relationship is invalid: nodes");
      const createdAt = Date.parse(node.createdAt), updatedAt = Date.parse(node.updatedAt);
      if (!["text", "image", "video", "audio", "script"].includes(node.type) || !nonemptyText(node.title) || typeof node.content !== "string" || !node.position || typeof node.position !== "object" || Array.isArray(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || !["draft", "queued", "running", "succeeded", "failed", "canceled"].includes(node.status) || !Number.isSafeInteger(node.resultVersion) || node.resultVersion < 0 || !positiveVersion(node.version) || !canonicalTimestamp(node.createdAt) || !canonicalTimestamp(node.updatedAt) || updatedAt < createdAt) throw new Error("restored database node lifecycle is invalid");
    }
    for (const session of entities.get("sessions").values()) {
      const expectedNodeIds = [...entities.get("nodes").values()].filter(node => node.sessionId === session.id).map(node => node.id).sort();
      if (!Array.isArray(session.nodeIds) || session.nodeIds.some(id => typeof id !== "string" || !id) || new Set(session.nodeIds).size !== session.nodeIds.length || JSON.stringify([...session.nodeIds].sort()) !== JSON.stringify(expectedNodeIds)) throw new Error("restored database session node index is invalid");
    }
    for (const edge of entities.get("edges").values()) {
      const from = entities.get("nodes").get(edge.fromNodeId), to = entities.get("nodes").get(edge.toNodeId);
      if (!entities.get("projects").has(edge.projectId) || !from || !to || from.projectId !== edge.projectId || to.projectId !== edge.projectId) throw new Error("restored database canvas relationship is invalid: edges");
      const createdAt = Date.parse(edge.createdAt), updatedAt = Date.parse(edge.updatedAt);
      if (from.id === to.id || !nonemptyText(edge.output) || !nonemptyText(edge.input) || typeof edge.title !== "string" || !positiveVersion(edge.version) || !canonicalTimestamp(edge.createdAt) || !canonicalTimestamp(edge.updatedAt) || updatedAt < createdAt) throw new Error("restored database edge lifecycle is invalid");
    }
    for (const project of entities.get("projects").values()) {
      const projectEdges = [...entities.get("edges").values()].filter(edge => edge.projectId === project.id), pairs = new Set(), visiting = new Set(), visited = new Set();
      for (const edge of projectEdges) {
        const pair = `${edge.fromNodeId}\u0000${edge.toNodeId}`;
        if (pairs.has(pair)) throw new Error("restored database edge graph is invalid: duplicate");
        pairs.add(pair);
      }
      const visit = nodeId => {
        if (visiting.has(nodeId)) throw new Error("restored database edge graph is invalid: cycle");
        if (visited.has(nodeId)) return;
        visiting.add(nodeId);
        for (const edge of projectEdges) if (edge.fromNodeId === nodeId) visit(edge.toNodeId);
        visiting.delete(nodeId); visited.add(nodeId);
      };
      for (const node of [...entities.get("nodes").values()].filter(node => node.projectId === project.id)) visit(node.id);
    }
    for (const group of entities.get("groups").values()) {
      if (!entities.get("projects").has(group.projectId) || !Array.isArray(group.nodeIds) || !group.nodeIds.length || new Set(group.nodeIds).size !== group.nodeIds.length || group.nodeIds.some(nodeId => entities.get("nodes").get(nodeId)?.projectId !== group.projectId)) throw new Error("restored database canvas relationship is invalid: groups");
    }
    for (const job of entities.get("jobs").values()) {
      const project = entities.get("projects").get(job.projectId), session = entities.get("sessions").get(job.sessionId), node = entities.get("nodes").get(job.nodeId);
      if (!project || !session || session.projectId !== job.projectId || !node || node.projectId !== job.projectId || node.sessionId !== job.sessionId) throw new Error("restored database job ownership relationship is invalid");
    }
    for (const node of entities.get("nodes").values()) {
      const expectedRunIds = [...entities.get("jobs").values()].filter(job => job.nodeId === node.id).map(job => job.id);
      if (!Array.isArray(node.runIds) || new Set(node.runIds).size !== node.runIds.length || JSON.stringify(node.runIds) !== JSON.stringify(expectedRunIds)) throw new Error("restored database job lifecycle relationship is invalid: node.runIds");
      if (node.assetId != null) {
        const asset = entities.get("assets").get(node.assetId);
        if (!asset || asset.projectId !== node.projectId || asset.sessionId !== node.sessionId || asset.nodeId !== node.id || asset.role !== "result") throw new Error("restored database job lifecycle relationship is invalid: node.assetId");
      }
    }
    for (const job of entities.get("jobs").values()) {
      const asset = job.assetId == null ? null : entities.get("assets").get(job.assetId);
      if ((job.state === "succeeded") !== Boolean(asset) || (asset && (asset.projectId !== job.projectId || asset.sessionId !== job.sessionId || asset.nodeId !== job.nodeId || asset.jobId !== job.id || asset.kind !== job.kind || asset.role !== "result"))) throw new Error("restored database job lifecycle relationship is invalid: job.assetId");
    }
    for (const asset of entities.get("assets").values()) {
      const project = entities.get("projects").get(asset.projectId), session = asset.sessionId == null ? null : entities.get("sessions").get(asset.sessionId);
      if (!project || (asset.sessionId != null && (!session || session.projectId !== asset.projectId))) throw new Error("restored database asset ownership relationship is invalid");
      const node = asset.nodeId == null ? null : entities.get("nodes").get(asset.nodeId), job = asset.jobId == null ? null : entities.get("jobs").get(asset.jobId);
      if (asset.nodeId != null && (!node || node.projectId !== asset.projectId || node.sessionId !== asset.sessionId)) throw new Error("restored database asset producer relationship is invalid");
      if (asset.jobId != null && (!job || job.projectId !== asset.projectId || job.sessionId !== asset.sessionId || (asset.nodeId != null && job.nodeId !== asset.nodeId))) throw new Error("restored database asset producer relationship is invalid");
      if (asset.role === "result" && (!job || job.assetId !== asset.id || asset.nodeId == null)) throw new Error("restored database job lifecycle relationship is invalid: result asset");
    }
    const requireProjectIndex = (project, field, kind) => {
      const indexed = project[field];
      if (!Array.isArray(indexed) || indexed.some(id => typeof id !== "string" || !id) || new Set(indexed).size !== indexed.length) throw new Error(`restored database project index is invalid: ${field}`);
      const expected = [...entities.get(kind).values()].filter(item => item.projectId === project.id).map(item => item.id).sort();
      if (JSON.stringify([...indexed].sort()) !== JSON.stringify(expected)) throw new Error(`restored database project index is invalid: ${field}`);
    };
    for (const project of entities.get("projects").values()) {
      if (!Array.isArray(project.members) || !project.members.length || project.members.some(member => !member || typeof member !== "object" || Array.isArray(member) || JSON.stringify(Object.keys(member).sort()) !== JSON.stringify(["role", "userId"]) || !entities.get("users").has(member.userId) || !["owner", "editor", "viewer"].includes(member.role)) || new Set(project.members.map(member => member.userId)).size !== project.members.length || !project.members.some(member => member.role === "owner")) throw new Error("restored database project membership relationship is invalid");
      for (const [field, kind] of [["sessionIds", "sessions"], ["nodeIds", "nodes"], ["edgeIds", "edges"], ["groupIds", "groups"], ["assetIds", "assets"]]) requireProjectIndex(project, field, kind);
      const continuity = project.continuityEntities || [], continuityIds = new Set();
      const validReferenceProvenance = (provenance, referenceAssetIds) => Array.isArray(provenance) && provenance.length === referenceAssetIds.length && provenance.every((entry, index) => {
        const asset = entities.get("assets").get(referenceAssetIds[index]);
        return entry && typeof entry === "object" && !Array.isArray(entry) && entry.assetId === referenceAssetIds[index] && canonicalTimestamp(entry.createdAt) && entry.createdAt === asset?.createdAt && entry.source && typeof entry.source === "object" && !Array.isArray(entry.source) && nonemptyText(entry.source.operation) && nonemptyText(entry.source.sourceAssetId);
      });
      if (!Array.isArray(continuity)) throw new Error("restored database project snapshot is invalid: continuity");
      for (const item of continuity) {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || !item.id || continuityIds.has(item.id) || !["character", "product", "scene"].includes(item.kind) || !nonemptyText(item.name) || !positiveVersion(item.version) || !Array.isArray(item.lockedAttributes) || item.lockedAttributes.some(key => !nonemptyText(key)) || new Set(item.lockedAttributes).size !== item.lockedAttributes.length || !item.attributes || typeof item.attributes !== "object" || Array.isArray(item.attributes) || item.lockedAttributes.some(key => !(key in item.attributes)) || !Array.isArray(item.referenceAssetIds) || new Set(item.referenceAssetIds).size !== item.referenceAssetIds.length || item.referenceAssetIds.some(id => entities.get("assets").get(id)?.projectId !== project.id) || !validReferenceProvenance(item.referenceProvenance, item.referenceAssetIds)) throw new Error("restored database project snapshot is invalid: continuity");
        continuityIds.add(item.id);
      }
      const scenes = project.story == null ? [] : project.story.scenes;
      if (!Array.isArray(scenes) || (project.story != null && (!nonemptyText(project.story.title) || !positiveVersion(project.story.version))) || scenes.some((scene, index) => !scene || typeof scene.id !== "string" || !scene.id || !nonemptyText(scene.title) || !positiveVersion(scene.version) || scene.order !== index) || new Set(scenes.map(scene => scene.id)).size !== scenes.length || !Array.isArray(project.sceneIds) || JSON.stringify(project.sceneIds) !== JSON.stringify(scenes.map(scene => scene.id))) throw new Error("restored database project snapshot is invalid: story");
      const shots = project.storyboard == null ? [] : project.storyboard.shots;
      const sceneIds = new Set(project.sceneIds);
      const validUsage = usage => usage && typeof usage === "object" && !Array.isArray(usage) && continuityIds.has(usage.entityId) && ["character", "product", "scene"].includes(usage.kind) && nonemptyText(usage.name) && positiveVersion(usage.version) && usage.attributes && typeof usage.attributes === "object" && !Array.isArray(usage.attributes) && Object.entries(usage.attributes).every(([key, value]) => nonemptyText(key) && nonemptyText(value)) && Array.isArray(usage.lockedAttributes) && usage.lockedAttributes.every(key => nonemptyText(key) && key in usage.attributes) && new Set(usage.lockedAttributes).size === usage.lockedAttributes.length && Array.isArray(usage.referenceAssetIds) && new Set(usage.referenceAssetIds).size === usage.referenceAssetIds.length && usage.referenceAssetIds.every(id => entities.get("assets").get(id)?.projectId === project.id) && validReferenceProvenance(usage.referenceProvenance, usage.referenceAssetIds);
      if (!Array.isArray(shots) || (project.storyboard != null && !positiveVersion(project.storyboard.version)) || shots.some((shot, index) => !shot || typeof shot.id !== "string" || !shot.id || !nonemptyText(shot.prompt) || !finitePositive(shot.duration) || shot.order !== index || !sceneIds.has(shot.sceneId) || !Array.isArray(shot.continuityEntityIds) || new Set(shot.continuityEntityIds).size !== shot.continuityEntityIds.length || shot.continuityEntityIds.some(id => !continuityIds.has(id)) || !Array.isArray(shot.continuityEntityUsages) || JSON.stringify(shot.continuityEntityUsages.map(usage => usage?.entityId)) !== JSON.stringify(shot.continuityEntityIds) || shot.continuityEntityUsages.some(usage => !validUsage(usage)) || !Array.isArray(shot.referenceAssetIds) || new Set(shot.referenceAssetIds).size !== shot.referenceAssetIds.length || shot.referenceAssetIds.some(id => entities.get("assets").get(id)?.projectId !== project.id) || shot.continuityEntityUsages.some(usage => usage.referenceAssetIds.some(id => !shot.referenceAssetIds.includes(id))) || (shot.generatedAssetId != null && entities.get("assets").get(shot.generatedAssetId)?.projectId !== project.id)) || new Set(shots.map(shot => shot.id)).size !== shots.length || !Array.isArray(project.shotIds) || JSON.stringify(project.shotIds) !== JSON.stringify(shots.map(shot => shot.id))) throw new Error("restored database project snapshot is invalid: storyboard");
      const tracks = project.timeline?.tracks;
      if (!positiveVersion(project.timeline?.version) || !Array.isArray(tracks) || new Set(tracks.map(track => track?.id)).size !== tracks.length) throw new Error("restored database project snapshot is invalid: timeline");
      const clipIds = new Set();
      for (const track of tracks) {
        if (!track || typeof track.id !== "string" || !track.id || !["video", "audio"].includes(track.kind) || !Array.isArray(track.clips) || track.clips.some((clip, index) => !clip || typeof clip.id !== "string" || !clip.id || clipIds.has(clip.id) || clip.order !== index || !finiteNonnegative(clip.inPoint) || !finitePositive(clip.outPoint) || clip.outPoint <= clip.inPoint || !finiteNonnegative(clip.start) || entities.get("assets").get(clip.assetId)?.projectId !== project.id || entities.get("assets").get(clip.assetId)?.kind !== track.kind)) throw new Error("restored database project snapshot is invalid: timeline");
        for (const clip of track.clips) clipIds.add(clip.id);
      }
    }
    return { integrity, assetKeys: assetKeys.sort() };
  }
  finally { db.close(); }
};
const checkPlatform = path => {
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("platform state must be valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("platform state must be a JSON object");
  if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1 || value.schemaVersion > 7) throw new Error("platform state schema version is unsupported");
  const collections = [["accounts", 1], ["teams", 1], ["invites", 1], ["wallets", 1], ["ledger", 1], ["workflows", 1], ["automations", 1], ["objects", 1], ["sessions", 2], ["subscriptions", 3], ["apiKeys", 3], ["usageReservations", 3], ["usageLedger", 3], ["keyApplications", 4], ["usageRefunds", 6], ["collaborativeDocuments", 7]];
  for (const [name, introduced] of collections) if (value.schemaVersion >= introduced && !Array.isArray(value[name])) throw new Error(`platform state collection is invalid: ${name}`);
  const ids = new Map();
  for (const [name, introduced] of collections) {
    if (value.schemaVersion < introduced) continue;
    const seen = new Set();
    for (const item of value[name]) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`platform state item is invalid: ${name}`);
      if (["objects", "collaborativeDocuments"].includes(name)) continue;
      if (typeof item.id !== "string" || !item.id || seen.has(item.id)) throw new Error(`platform state identity is invalid: ${name}`);
      seen.add(item.id);
    }
    ids.set(name, seen);
  }
  const uniqueStringField = (collection, field) => {
    const seen = new Set();
    for (const item of value[collection] || []) {
      const candidate = item[field];
      if (typeof candidate !== "string" || !candidate || seen.has(candidate)) throw new Error(`platform state identity is invalid: ${collection}.${field}`);
      seen.add(candidate);
    }
    return seen;
  };
  const tenantIds = uniqueStringField("teams", "tenantId");
  uniqueStringField("sessions", "tokenHash");
  const accountEmails = new Set();
  for (const account of value.accounts || []) {
    const canonicalCredentialFields = new Set(["passwordhash", "salt"]);
    const exactCanonicalCredentialFields = new Set(["passwordHash", "salt"]);
    const forbiddenCredentialFields = new Set(["password", "token", "sessiontoken", "accesstoken", "refreshtoken", "authtoken", "apitoken", "passwordresettoken", "otp", "otpcode", "secret"]);
    const normalizedField = field => field.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
    const containsForbiddenCredentialMaterial = (candidate, depth = 0) => candidate && typeof candidate === "object" && Object.entries(candidate).some(([field, fieldValue]) => {
      if (fieldValue == null) return false;
      const normalized = normalizedField(field);
      const misplacedOrAliasedCanonicalCredential = canonicalCredentialFields.has(normalized) && (depth > 0 || !exactCanonicalCredentialFields.has(field));
      return forbiddenCredentialFields.has(normalized) || misplacedOrAliasedCanonicalCredential || containsForbiddenCredentialMaterial(fieldValue, depth + 1);
    });
    if (containsForbiddenCredentialMaterial(account)) throw new Error("platform state contains forbidden account credential material");
    const credentialFields = ["email", "passwordHash", "salt", "createdAt"];
    const present = credentialFields.filter(field => account[field] != null);
    if (present.length > 0 && present.length !== credentialFields.length) throw new Error("platform state credential tuple is invalid: accounts");
    if (present.length === credentialFields.length) {
      if (typeof account.email !== "string" || account.email !== account.email.toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email)) throw new Error("platform state credential identity is invalid: accounts.email");
      if (accountEmails.has(account.email)) throw new Error("platform state credential identity is invalid: accounts.email");
      accountEmails.add(account.email);
      if (!/^[a-f0-9]{32}$/.test(account.salt)) throw new Error("platform state credential salt is invalid: accounts.salt");
      if (!/^[a-f0-9]{64}$/.test(account.passwordHash)) throw new Error("platform state credential digest is invalid: accounts.passwordHash");
      const createdAt = Date.parse(account.createdAt);
      if (typeof account.createdAt !== "string" || !Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== account.createdAt) throw new Error("platform state timestamp is invalid: accounts.createdAt");
    }
  }
  const requireReference = (collection, field, target, targetField = "id") => {
    const targets = target === "teams" && targetField === "tenantId" ? tenantIds : targetField === "id" ? ids.get(target) : new Set(value[target].map(item => item[targetField]).filter(item => typeof item === "string" && item));
    for (const item of value[collection] || []) if (item[field] !== undefined && item[field] !== null && (typeof item[field] !== "string" || !targets.has(item[field]))) throw new Error(`platform state reference is invalid: ${collection}.${field}`);
  };
  requireReference("sessions", "accountId", "accounts");
  for (const session of value.sessions || []) {
    if (!/^[a-f0-9]{64}$/.test(session.tokenHash)) throw new Error("platform state digest is invalid: sessions.tokenHash");
    const canonicalTimestamp = (candidate, field) => {
      const parsed = Date.parse(candidate);
      if (typeof candidate !== "string" || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== candidate) throw new Error(`platform state timestamp is invalid: sessions.${field}`);
      return parsed;
    };
    const createdAt = canonicalTimestamp(session.createdAt, "createdAt"), expiresAt = canonicalTimestamp(session.expiresAt, "expiresAt");
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) throw new Error("platform state lifecycle is invalid: sessions");
    if (session.revokedAt != null) {
      const revokedAt = canonicalTimestamp(session.revokedAt, "revokedAt");
      if (revokedAt < createdAt || revokedAt > expiresAt) throw new Error("platform state lifecycle is invalid: sessions.revokedAt");
    }
  }
  requireReference("invites", "teamId", "teams");
  for (const team of value.teams || []) {
    if (!nonemptyText(team.name) || !positiveVersion(team.version) || !canonicalTimestamp(team.createdAt)) throw new Error("platform state team identity is invalid");
    if (!Array.isArray(team.members) || !team.members.length) throw new Error("platform state collection is invalid: teams.members");
    const members = new Set();
    for (const member of team.members) {
      if (!member || typeof member !== "object" || Array.isArray(member) || JSON.stringify(Object.keys(member).sort()) !== JSON.stringify(["accountId", "role"])) throw new Error("platform state member fields are invalid: teams.members");
      if (!ids.get("accounts").has(member.accountId)) throw new Error("platform state reference is invalid: teams.members.accountId");
      if (members.has(member.accountId)) throw new Error("platform state identity is invalid: teams.members.accountId");
      if (!["owner", "admin", "editor", "viewer"].includes(member.role)) throw new Error("platform state role is invalid: teams.members.role");
      members.add(member.accountId);
    }
    if (!team.members.some(member => member.role === "owner")) throw new Error("platform state lifecycle is invalid: teams.owner");
  }
  const pendingInvites = new Set();
  for (const invite of value.invites || []) {
    if (typeof invite.email !== "string" || invite.email !== invite.email.toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email)) throw new Error("platform state identity is invalid: invites.email");
    if (!["admin", "editor", "viewer"].includes(invite.role)) throw new Error("platform state role is invalid: invites.role");
    if (!["pending", "accepted", "revoked"].includes(invite.status)) throw new Error("platform state status is invalid: invites");
    const createdAt = Date.parse(invite.createdAt);
    if (typeof invite.createdAt !== "string" || !Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== invite.createdAt) throw new Error("platform state timestamp is invalid: invites.createdAt");
    if (invite.status === "revoked") {
      const revokedAt = Date.parse(invite.revokedAt);
      if (typeof invite.revokedAt !== "string" || !Number.isFinite(revokedAt) || new Date(revokedAt).toISOString() !== invite.revokedAt || revokedAt < createdAt) throw new Error("platform state lifecycle is invalid: invites.revokedAt");
    } else if (invite.revokedAt != null) throw new Error("platform state lifecycle is invalid: invites.revokedAt");
    if (invite.status === "pending") {
      const identity = `${invite.teamId}\0${invite.email}`;
      if (pendingInvites.has(identity)) throw new Error("platform state identity is invalid: invites.pending");
      pendingInvites.add(identity);
    }
  }
  for (const collection of ["wallets", "ledger", "workflows", "automations", "objects", "collaborativeDocuments"]) requireReference(collection, "tenantId", "teams", "tenantId");
  for (const collection of ["subscriptions", "keyApplications", "apiKeys", "usageReservations", "usageLedger", "usageRefunds"]) requireReference(collection, "accountId", "accounts");
  requireReference("keyApplications", "subscriptionId", "subscriptions");
  for (const collection of ["apiKeys", "usageReservations", "usageLedger", "usageRefunds"]) requireReference(collection, "subscriptionId", "subscriptions");
  for (const collection of ["usageReservations", "usageLedger"]) requireReference(collection, "apiKeyId", "apiKeys");
  requireReference("usageLedger", "reservationId", "usageReservations");
  requireReference("usageRefunds", "usageId", "usageLedger");
  requireReference("collaborativeDocuments", "teamId", "teams");
  const byId = collection => new Map((value[collection] || []).map(item => [item.id, item]));
  const teams = byId("teams"), subscriptions = byId("subscriptions"), apiKeys = byId("apiKeys"), reservations = byId("usageReservations"), usage = byId("usageLedger");
  const objectIds = new Set();
  for (const object of value.objects || []) {
    if (!nonemptyText(object.key) || object.value === undefined) throw new Error("platform state object shape is invalid");
    const identity = `${object.tenantId}\0${object.key}`;
    if (objectIds.has(identity)) throw new Error("platform state identity is invalid: objects.key");
    objectIds.add(identity);
  }
  for (const workflow of value.workflows || []) {
    if (workflow.schema !== "openreel-workflow/v1" || !nonemptyText(workflow.template) || !positiveVersion(workflow.version) || !Array.isArray(workflow.nodes) || !workflow.nodes.length) throw new Error("platform state workflow schema is invalid");
    const nodeIds = new Set();
    for (const node of workflow.nodes) {
      if (!node || typeof node !== "object" || Array.isArray(node) || !nonemptyText(node.id) || nodeIds.has(node.id) || !["text", "script", "image", "video", "audio"].includes(node.type)) throw new Error("platform state workflow node is invalid");
      nodeIds.add(node.id);
    }
    const document = { schema: workflow.schema, template: workflow.template, version: workflow.version, nodes: workflow.nodes };
    const expectedDigest = createHash("sha256").update(JSON.stringify(document)).digest("hex");
    if (workflow.digest !== expectedDigest) throw new Error("platform state workflow digest is invalid");
    if (!workflow.provenance || typeof workflow.provenance !== "object" || Array.isArray(workflow.provenance) || workflow.provenance.source !== "local-import" || !canonicalTimestamp(workflow.provenance.importedAt)) throw new Error("platform state workflow provenance is invalid");
  }
  const workflows = byId("workflows"), automationKeys = new Set();
  for (const automation of value.automations || []) {
    const workflow = workflows.get(automation.plan?.workflowId), key = `${automation.tenantId}\0${automation.idempotencyKey}`;
    if (!nonemptyText(automation.idempotencyKey) || automationKeys.has(key)) throw new Error("platform state automation identity is invalid");
    automationKeys.add(key);
    if (!workflow || workflow.tenantId !== automation.tenantId || automation.plan?.schema !== "openreel-automation-plan/v1" || automation.plan.tenantId !== automation.tenantId || automation.plan.intent !== automation.intent || !nonemptyText(automation.intent)) throw new Error("platform state automation relationship is invalid");
    if (!Array.isArray(automation.plan.nodes) || automation.plan.nodes.length !== workflow.nodes.length || automation.plan.nodes.some((node, index) => node?.id !== workflow.nodes[index]?.id || node?.type !== workflow.nodes[index]?.type || node?.order !== index) || automation.plan.estimatedCost !== workflow.nodes.length * 10) throw new Error("platform state automation plan is invalid");
    if (!['succeeded', 'failed'].includes(automation.status) || !Number.isSafeInteger(automation.cost) || automation.cost < 0 || !canonicalTimestamp(automation.createdAt)) throw new Error("platform state automation lifecycle is invalid");
    if (automation.status === "succeeded" ? automation.failure != null : !automation.failure || !automation.plan.nodes.some(node => node.id === automation.failure.nodeId) || automation.failure.code !== "NODE_FAILED" || automation.cost !== 0) throw new Error("platform state automation outcome is invalid");
  }
  for (const invite of value.invites || []) if (invite.tenantId !== teams.get(invite.teamId)?.tenantId) throw new Error("platform state ownership is invalid: invites.tenantId");
  for (const document of value.collaborativeDocuments || []) if (document.tenantId !== teams.get(document.teamId)?.tenantId) throw new Error("platform state ownership is invalid: collaborativeDocuments.tenantId");
  const collaborativeDocumentIds = new Set();
  for (const document of value.collaborativeDocuments || []) {
    if (!nonemptyText(document.documentId)) throw new Error("platform state identity is invalid: collaborativeDocuments.documentId");
    const identity = `${document.teamId}\0${document.documentId}`;
    if (collaborativeDocumentIds.has(identity)) throw new Error("platform state identity is invalid: collaborativeDocuments.documentId");
    collaborativeDocumentIds.add(identity);
    if (!positiveVersion(document.version) || document.content === undefined || !canonicalTimestamp(document.updatedAt)) throw new Error("platform state lifecycle is invalid: collaborativeDocuments");
    const team = teams.get(document.teamId);
    if (typeof document.updatedBy !== "string" || !team?.members.some(member => member.accountId === document.updatedBy)) throw new Error("platform state authorization is invalid: collaborativeDocuments.updatedBy");
  }
  for (const key of value.apiKeys || []) if (subscriptions.get(key.subscriptionId)?.accountId !== key.accountId) throw new Error("platform state ownership is invalid: apiKeys.subscriptionId");
  for (const application of value.keyApplications || []) {
    if (!["pending", "approved", "rejected", "stopped"].includes(application.status)) throw new Error("platform state status is invalid: keyApplications");
    const requiresSubscription = ["approved", "stopped"].includes(application.status);
    if (requiresSubscription !== (application.subscriptionId != null)) throw new Error("platform state relationship is invalid: keyApplications.subscriptionId");
    if (requiresSubscription && subscriptions.get(application.subscriptionId)?.accountId !== application.accountId) throw new Error("platform state ownership is invalid: keyApplications.subscriptionId");
  }
  for (const reservation of value.usageReservations || []) {
    if (subscriptions.get(reservation.subscriptionId)?.accountId !== reservation.accountId) throw new Error("platform state ownership is invalid: usageReservations.subscriptionId");
    const key = reservation.apiKeyId == null ? null : apiKeys.get(reservation.apiKeyId);
    if (key && (key.accountId !== reservation.accountId || key.subscriptionId !== reservation.subscriptionId)) throw new Error("platform state ownership is invalid: usageReservations.apiKeyId");
  }
  for (const entry of value.usageLedger || []) {
    const reservation = reservations.get(entry.reservationId);
    if (reservation && (reservation.accountId !== entry.accountId || reservation.subscriptionId !== entry.subscriptionId || (reservation.apiKeyId || null) !== (entry.apiKeyId || null))) throw new Error("platform state ownership is invalid: usageLedger.reservationId");
  }
  for (const refund of value.usageRefunds || []) {
    const entry = usage.get(refund.usageId);
    if (entry && (entry.accountId !== refund.accountId || entry.subscriptionId !== refund.subscriptionId || entry.reservationId !== refund.reservationId)) throw new Error("platform state ownership is invalid: usageRefunds.usageId");
  }
  const nonNegativeSafeInteger = (item, field, label) => {
    if (!Number.isSafeInteger(item[field]) || item[field] < 0) throw new Error(`platform state amount is invalid: ${label}.${field}`);
    return item[field];
  };
  const supportedMoney = (item, label) => {
    const expectedScale = { USD: 10_000, CNY: 1_000_000 }[item.currency];
    if (!expectedScale || item.unitScale !== expectedScale) throw new Error(`platform state money metadata is invalid: ${label}`);
    return { currency: item.currency, unitScale: item.unitScale };
  };
  const sameMoney = (item, expected, label) => {
    const actual = supportedMoney(item, label);
    if (actual.currency !== expected.currency || actual.unitScale !== expected.unitScale) throw new Error(`platform state money metadata is inconsistent: ${label}`);
  };
  const allowedStatus = (item, allowed, label) => {
    if (!allowed.includes(item.status)) throw new Error(`platform state status is invalid: ${label}`);
  };
  for (const reservation of value.usageReservations || []) nonNegativeSafeInteger(reservation, "maxCostMicros", "usageReservations");
  for (const entry of value.usageLedger || []) {
    nonNegativeSafeInteger(entry, "costMicros", "usageLedger");
    if (entry.costMicros > reservations.get(entry.reservationId).maxCostMicros) throw new Error("platform state amount is invalid: usageLedger.costMicros");
  }
  for (const refund of value.usageRefunds || []) nonNegativeSafeInteger(refund, "amountMicros", "usageRefunds");
  for (const subscription of value.subscriptions || []) {
    const money = supportedMoney(subscription, "subscriptions");
    allowedStatus(subscription, ["active", "stopped"], "subscriptions");
    const hardLimit = nonNegativeSafeInteger(subscription, "hardLimitMicros", "subscriptions");
    const recordedReserved = nonNegativeSafeInteger(subscription, "reservedMicros", "subscriptions");
    const recordedSpent = nonNegativeSafeInteger(subscription, "spentMicros", "subscriptions");
    const relatedReservations = (value.usageReservations || []).filter(item => item.subscriptionId === subscription.id);
    for (const reservation of relatedReservations) {
      sameMoney(reservation, money, "usageReservations");
      allowedStatus(reservation, ["reserved", "settled", "failed"], "usageReservations");
    }
    const openReserved = relatedReservations.filter(item => item.status === "reserved").reduce((sum, item) => sum + item.maxCostMicros, 0);
    const relatedUsage = (value.usageLedger || []).filter(item => item.subscriptionId === subscription.id);
    for (const entry of relatedUsage) sameMoney(entry, money, "usageLedger");
    if (new Set(relatedUsage.map(item => item.reservationId)).size !== relatedUsage.length) throw new Error("platform state reconciliation is invalid: usageLedger.reservationId");
    const settled = relatedUsage.filter(item => item.status === "settled").reduce((sum, item) => sum + item.costMicros, 0);
    const refunds = (value.usageRefunds || []).filter(item => item.subscriptionId === subscription.id);
    for (const refund of refunds) {
      sameMoney(refund, money, "usageRefunds");
      allowedStatus(refund, ["partially_refunded", "refunded"], "usageRefunds");
    }
    for (const entry of relatedUsage) {
      const reservation = reservations.get(entry.reservationId);
      if (reservation.status !== entry.status || !["settled", "failed"].includes(entry.status)) throw new Error("platform state reconciliation is invalid: usageLedger.status");
      const refunded = refunds.filter(item => item.usageId === entry.id).reduce((sum, item) => sum + item.amountMicros, 0);
      if (refunded > entry.costMicros) throw new Error("platform state reconciliation is invalid: usageRefunds.amountMicros");
    }
    const spent = settled - refunds.reduce((sum, item) => sum + item.amountMicros, 0);
    if (recordedReserved !== openReserved || recordedSpent !== spent || recordedReserved + recordedSpent > hardLimit) throw new Error("platform state reconciliation is invalid: subscriptions");
  }
  return value;
};

export async function createBackup({ database, assets, platform, destination }) {
  for (const path of [database, assets, platform]) if (!existsSync(path)) throw new Error(`backup source missing: ${path}`);
  regularFile(database); regularFile(platform);
  if (!lstatSync(assets).isDirectory() || lstatSync(assets).isSymbolicLink()) throw new Error(`backup asset root must be a directory: ${assets}`);
  if (existsSync(destination)) throw new Error("backup destination must not already exist");
  const destinationRoot = resolve(destination), parent = dirname(destinationRoot);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(parent, `.${basename(destinationRoot)}.backup-`));
  let promoted = false;
  try {
    mkdirSync(join(staging, "assets"), { mode: 0o700 });
    const source = new DatabaseSync(database, { readOnly: true });
    let referenced;
    try {
      referenced = source.prepare("SELECT data FROM entities WHERE kind='assets'").all().map(row => JSON.parse(row.data).storageKey).filter(Boolean);
      await backup(source, join(staging, "openreel.sqlite"));
    } finally { source.close(); }
    for (const key of referenced) { const from = inside(assets, key), to = inside(join(staging, "assets"), key); mkdirSync(dirname(to), { recursive: true, mode: 0o700 }); copyStableFile(from, to); }
    cpSync(platform, join(staging, "platform.json"));
    checkPlatform(join(staging, "platform.json"));
    const databaseState = checkDatabase(join(staging, "openreel.sqlite"));
    const stagedAssets = files(join(staging, "assets")).map(path => path.slice(join(staging, "assets").length + 1)).sort();
    if (JSON.stringify(databaseState.assetKeys) !== JSON.stringify(stagedAssets)) throw new Error("backup database asset references differ from staged assets");
    secureTree(staging);
    const manifest = { version: 1, createdAt: new Date().toISOString(), files: files(staging).map(path => ({ path: path.slice(staging.length + 1), bytes: regularFile(path).size, sha256: digest(path) })) };
    writeFileSync(join(staging, "manifest.json"), canonicalBackupManifestText(manifest), { mode: 0o600 });
    if (existsSync(destinationRoot)) throw new Error("backup destination appeared during creation");
    renameSync(staging, destinationRoot); promoted = true;
    return manifest;
  } finally {
    if (!promoted) rmSync(staging, { recursive: true, force: true });
  }
}

export function verifyBackup({ source, destination }) {
  const sourceRoot = resolve(source), destinationRoot = resolve(destination);
  if (destinationRoot === sourceRoot || destinationRoot.startsWith(`${sourceRoot}${sep}`)) throw new Error("restore destination must be outside the backup source");
  regularFile(join(sourceRoot, "manifest.json"));
  const manifestText = readFileSync(join(sourceRoot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  exactKeys(manifest, ["version", "createdAt", "files"], "backup manifest");
  const createdAt = Date.parse(manifest.createdAt);
  if (manifest.version !== 1 || typeof manifest.createdAt !== "string" || !Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== manifest.createdAt || !Array.isArray(manifest.files)) throw new Error("backup manifest schema invalid");
  for (const item of manifest.files) exactKeys(item, ["path", "bytes", "sha256"], `backup manifest item ${item?.path ?? "unknown"}`);
  if (manifestText !== canonicalBackupManifestText(manifest)) throw new Error("backup manifest serialization is non-canonical");
  const expected = manifest.files.map(item => item.path);
  const canonicalPaths = expected.every(path => path !== "manifest.json" && canonicalRelativePath(path));
  if (!canonicalPaths || new Set(expected).size !== expected.length || JSON.stringify(expected) !== JSON.stringify([...expected].sort())) throw new Error("backup manifest file list invalid");
  if (!expected.includes("openreel.sqlite") || !expected.includes("platform.json")) throw new Error("backup manifest is missing required core files");
  if (expected.some(path => path !== "openreel.sqlite" && path !== "platform.json" && !path.startsWith("assets/"))) throw new Error("backup manifest file namespace is invalid");
  const actual = files(sourceRoot).map(path => path.slice(sourceRoot.length + 1)).filter(path => path !== "manifest.json");
  if (JSON.stringify([...expected].sort()) !== JSON.stringify(actual)) throw new Error("backup file set differs from manifest");
  for (const item of manifest.files) { const path = inside(sourceRoot, item.path); if (!existsSync(path) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256) || regularFile(path).size !== item.bytes || digest(path) !== item.sha256) throw new Error(`backup integrity failure: ${item.path}`); }
  if (existsSync(destinationRoot)) throw new Error("restore destination must not already exist");
  const parent = dirname(destinationRoot); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(parent, `.${basename(destinationRoot)}.restore-`));
  let promoted = false;
  try {
    cpSync(join(sourceRoot, "openreel.sqlite"), join(staging, "openreel.sqlite"));
    cpSync(join(sourceRoot, "assets"), join(staging, "assets"), { recursive: true });
    cpSync(join(sourceRoot, "platform.json"), join(staging, "platform.json"));
    const databaseState = checkDatabase(join(staging, "openreel.sqlite"));
    const restoredAssets = files(join(staging, "assets")).map(path => path.slice(join(staging, "assets").length + 1)).sort();
    if (JSON.stringify(databaseState.assetKeys) !== JSON.stringify(restoredAssets)) throw new Error("restored database asset references differ from backup assets");
    checkPlatform(join(staging, "platform.json"));
    if (existsSync(destinationRoot)) throw new Error("restore destination appeared during verification");
    renameSync(staging, destinationRoot); promoted = true;
  } finally {
    if (!promoted) rmSync(staging, { recursive: true, force: true });
  }
  return { database: "ok", assets: manifest.files.filter(item => item.path.startsWith("assets/")).length, isolatedDestination: resolve(destination) };
}

if (process.argv[1] && basename(process.argv[1]) === "backup.mjs") {
  const [command, source, assets, platform, destination] = process.argv.slice(2);
  if (command === "create") console.log(JSON.stringify(await createBackup({ database: source, assets, platform, destination })));
  else if (command === "verify") console.log(JSON.stringify(verifyBackup({ source, destination: assets })));
  else { console.error("usage: backup.mjs create <database> <assets> <platform> <destination> | verify <backup> <isolated-restore>"); process.exitCode = 2; }
}
