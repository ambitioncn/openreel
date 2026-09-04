import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const exactKeys = (value, expected, label) => {
  assert.equal(value && typeof value, "object", `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields are invalid`);
};
const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);

export function validateCollaborationEvidenceSnapshot(snapshot) {
  exactKeys(snapshot, ["capturedAt", "team", "invites", "presences", "document", "conflict", "restart", "externalIntegrations"], "collaboration snapshot");
  const capturedAt = Date.parse(snapshot.capturedAt);
  assert.ok(Number.isFinite(capturedAt), "collaboration capturedAt is invalid");
  exactKeys(snapshot.team, ["id", "tenantId", "members"], "collaboration team");
  assert.ok(typeof snapshot.team.id === "string" && snapshot.team.id, "collaboration team id is required");
  assert.ok(typeof snapshot.team.tenantId === "string" && snapshot.team.tenantId, "collaboration tenant id is required");
  assert.ok(Array.isArray(snapshot.team.members) && snapshot.team.members.length > 0, "collaboration members are required");
  const roles = new Set(["owner", "admin", "editor", "viewer"]);
  const memberIds = new Set();
  for (const member of snapshot.team.members) {
    exactKeys(member, ["accountId", "role"], "collaboration member");
    assert.ok(typeof member.accountId === "string" && member.accountId, "collaboration member accountId is required");
    assert.ok(!memberIds.has(member.accountId), "collaboration member is duplicated");
    assert.ok(roles.has(member.role), "collaboration member role is invalid");
    memberIds.add(member.accountId);
  }
  assert.ok(snapshot.team.members.some(member => member.role === "owner"), "collaboration team must retain an owner");
  assert.ok(Array.isArray(snapshot.invites), "collaboration invites must be an array");
  assert.ok(snapshot.invites.some(invite => invite.status === "revoked"), "collaboration evidence requires a revoked invite");
  for (const invite of snapshot.invites) {
    assert.equal(invite.teamId, snapshot.team.id, "collaboration invite escaped team scope");
    assert.equal(invite.tenantId, snapshot.team.tenantId, "collaboration invite escaped tenant scope");
    assert.ok(new Set(["pending", "accepted", "revoked"]).has(invite.status), "collaboration invite status is invalid");
  }
  assert.ok(Array.isArray(snapshot.presences), "collaboration presences must be an array");
  for (const presence of snapshot.presences) {
    assert.equal(presence.teamId, snapshot.team.id, "collaboration presence escaped team scope");
    assert.equal(presence.tenantId, snapshot.team.tenantId, "collaboration presence escaped tenant scope");
    assert.ok(memberIds.has(presence.accountId), "collaboration presence escaped membership scope");
    const updatedAt = Date.parse(presence.updatedAt), expiresAt = Date.parse(presence.expiresAt);
    assert.ok(Number.isFinite(updatedAt) && Number.isFinite(expiresAt), "collaboration presence timestamps are invalid");
    assert.equal(expiresAt - updatedAt, 30_000, "collaboration presence TTL drifted");
    assert.ok(expiresAt > capturedAt, "collaboration evidence contains expired presence");
  }
  exactKeys(snapshot.document, ["teamId", "tenantId", "documentId", "version", "content", "updatedAt", "updatedBy"], "collaboration document");
  assert.equal(snapshot.document.teamId, snapshot.team.id, "collaboration document escaped team scope");
  assert.equal(snapshot.document.tenantId, snapshot.team.tenantId, "collaboration document escaped tenant scope");
  assert.ok(Number.isSafeInteger(snapshot.document.version) && snapshot.document.version > 0, "collaboration document version is invalid");
  assert.ok(memberIds.has(snapshot.document.updatedBy), "collaboration document writer escaped membership scope");
  exactKeys(snapshot.conflict, ["code", "applied", "expectedVersion", "winningContent"], "collaboration conflict");
  assert.equal(snapshot.conflict.code, "VERSION_CONFLICT", "collaboration conflict code is invalid");
  assert.equal(snapshot.conflict.applied, false, "collaboration stale edit must not be applied");
  assert.equal(snapshot.conflict.expectedVersion, snapshot.document.version, "collaboration conflict expectedVersion drifted");
  assert.deepEqual(snapshot.conflict.winningContent, snapshot.document.content, "collaboration conflict did not preserve winning content");
  exactKeys(snapshot.restart, ["documentVersion", "documentContent", "presenceCount"], "collaboration restart");
  assert.equal(snapshot.restart.documentVersion, snapshot.document.version, "collaboration restart lost document version");
  assert.deepEqual(snapshot.restart.documentContent, snapshot.document.content, "collaboration restart lost document content");
  assert.equal(snapshot.restart.presenceCount, 0, "collaboration restart must clear ephemeral presence");
  exactKeys(snapshot.externalIntegrations, ["emailDelivery", "accountRecovery", "distributedRealtime", "productionReady"], "collaboration external integrations");
  for (const value of Object.values(snapshot.externalIntegrations)) assert.equal(value, false, "collaboration evidence must not claim an external integration");
  const serialized = canonical(snapshot);
  assert.doesNotMatch(serialized, /"(?:password|passwordHash|token|secret|apiKey)"\s*:/i, "collaboration snapshot contains secret-bearing fields");
  return Object.freeze({
    status: "verified",
    teamId: snapshot.team.id,
    tenantId: snapshot.team.tenantId,
    counts: Object.freeze({ members: snapshot.team.members.length, invites: snapshot.invites.length, presences: snapshot.presences.length }),
    documentVersion: snapshot.document.version,
    conflictPreserved: true,
    restartPreserved: true,
    productionReady: false,
    fingerprint: createHash("sha256").update(serialized).digest("hex")
  });
}
