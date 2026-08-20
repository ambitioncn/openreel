import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateCollaborationEvidenceSnapshot } from "../src/collaboration-evidence.js";
import { createPlatform } from "../src/platform.js";

function account(platform, email) {
  platform.register({ email, password: "local-pass-123" });
  return platform.login({ email, password: "local-pass-123" }).token;
}

function fixture() {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-collaboration-evidence-")), "platform.json");
  let clock = Date.parse("2026-08-15T16:00:00.000Z");
  let platform = createPlatform({ file, now: () => new Date(clock).toISOString() });
  const owner = account(platform, "owner@example.test"), editor = account(platform, "editor@example.test");
  const ownerId = platform.authenticate(owner).id, editorId = platform.authenticate(editor).id;
  const team = platform.createTeam(owner, { name: "Evidence team" });
  const accepted = platform.invite(owner, team.id, { email: "editor@example.test", role: "editor" });
  platform.acceptInvite(editor, accepted.id);
  const revoked = platform.revokeInvite(owner, team.id, platform.invite(owner, team.id, { email: "revoked@example.test", role: "viewer" }).id);
  const presences = platform.updatePresence(editor, team.id, { documentId: "canvas", cursor: { x: 4, y: 8 } });
  const document = platform.updateCollaborativeDocument(owner, team.id, "canvas", { version: 0, content: { title: "winning edit" } });
  let conflict;
  try { platform.updateCollaborativeDocument(editor, team.id, "canvas", { version: 0, content: { title: "stale edit" } }); }
  catch (error) { conflict = { code: error.code, applied: false, expectedVersion: error.details.expectedVersion, winningContent: platform.collaborativeDocument(editor, team.id, "canvas").content }; }
  platform = createPlatform({ file, now: () => new Date(clock).toISOString() });
  const ownerAfterRestart = platform.login({ email: "owner@example.test", password: "local-pass-123" }).token;
  const persisted = platform.collaborativeDocument(ownerAfterRestart, team.id, "canvas");
  return {
    capturedAt: new Date(clock).toISOString(),
    team: { id: team.id, tenantId: team.tenantId, members: [{ accountId: ownerId, role: "owner" }, { accountId: editorId, role: "editor" }] },
    invites: [accepted, revoked], presences, document, conflict,
    restart: { documentVersion: persisted.version, documentContent: persisted.content, presenceCount: platform.listPresence(ownerAfterRestart, team.id, "canvas").length },
    externalIntegrations: { emailDelivery: false, accountRecovery: false, distributedRealtime: false, productionReady: false }
  };
}

test("CO-01 collaboration evidence binds scoped membership, presence, conflict and restart behavior", () => {
  const result = validateCollaborationEvidenceSnapshot(fixture());
  assert.deepEqual(result.counts, { members: 2, invites: 2, presences: 1 });
  assert.equal(result.documentVersion, 1);
  assert.equal(result.conflictPreserved, true);
  assert.equal(result.restartPreserved, true);
  assert.equal(result.productionReady, false);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test("CO-01 collaboration evidence fails closed on scope, role and presence drift", () => {
  const escaped = fixture(); escaped.presences[0].tenantId = "other-tenant";
  assert.throws(() => validateCollaborationEvidenceSnapshot(escaped), /escaped tenant scope/);
  const ownerless = fixture(); ownerless.team.members[0].role = "viewer";
  assert.throws(() => validateCollaborationEvidenceSnapshot(ownerless), /retain an owner/);
  const ttl = fixture(); ttl.presences[0].expiresAt = new Date(Date.parse(ttl.presences[0].expiresAt) + 1).toISOString();
  assert.throws(() => validateCollaborationEvidenceSnapshot(ttl), /TTL drifted/);
});

test("CO-01 collaboration evidence rejects stale-write loss, restart loss and external claims", () => {
  const stale = fixture(); stale.conflict.applied = true;
  assert.throws(() => validateCollaborationEvidenceSnapshot(stale), /must not be applied/);
  const restart = fixture(); restart.restart.documentVersion = 0;
  assert.throws(() => validateCollaborationEvidenceSnapshot(restart), /lost document version/);
  const external = fixture(); external.externalIntegrations.emailDelivery = true;
  assert.throws(() => validateCollaborationEvidenceSnapshot(external), /must not claim an external integration/);
  const secret = fixture(); secret.team.members[0].token = "forbidden";
  assert.throws(() => validateCollaborationEvidenceSnapshot(secret), /fields are invalid|secret-bearing/);
});
