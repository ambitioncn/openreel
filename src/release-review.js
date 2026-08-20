import assert from "node:assert/strict";

export const releaseReviewCheckIds = Object.freeze([
  "source-state",
  "local-qualification",
  "manifest-integrity",
  "signature-boundary",
  "key-custody",
  "off-host-retention",
  "backup-rollback",
  "external-action-gates",
  "completion-language"
]);

const exactKeys = (value, expected, label) => {
  assert.equal(value && typeof value, "object", `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields are invalid`);
};

const nonEmpty = (value, label) => {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim(), `${label} must not be empty`);
  return value.trim();
};

export function validateIndependentReleaseReview(packet) {
  exactKeys(packet, ["version", "reviewedAt", "author", "reviewer", "scope", "externalActionsExecuted", "checks"], "release review");
  assert.equal(packet.version, 1);
  assert.ok(Number.isFinite(Date.parse(packet.reviewedAt)), "release review reviewedAt is invalid");
  const author = nonEmpty(packet.author, "release review author");
  const reviewer = nonEmpty(packet.reviewer, "release review reviewer");
  assert.notEqual(reviewer, author, "release review must be independent");
  nonEmpty(packet.scope, "release review scope");
  assert.equal(packet.externalActionsExecuted, false, "local review must not execute external actions");
  assert.ok(Array.isArray(packet.checks), "release review checks must be an array");
  assert.deepEqual(packet.checks.map(check => check.id), releaseReviewCheckIds, "release review checks are incomplete or out of order");
  for (const check of packet.checks) {
    exactKeys(check, ["id", "status", "evidence", "notes"], `release review check ${check?.id ?? "unknown"}`);
    assert.equal(check.status, "pass", `release review check did not pass: ${check.id}`);
    assert.ok(Array.isArray(check.evidence) && check.evidence.length > 0, `release review check lacks evidence: ${check.id}`);
    for (const reference of check.evidence) nonEmpty(reference, `release review evidence ${check.id}`);
    assert.equal(typeof check.notes, "string", `release review notes must be a string: ${check.id}`);
  }
  return Object.freeze({ status: "accepted", reviewer, checks: packet.checks.length, externalActionsExecuted: false });
}
