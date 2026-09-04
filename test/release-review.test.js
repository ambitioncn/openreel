import assert from "node:assert/strict";
import test from "node:test";
import { releaseReviewCheckIds, validateIndependentReleaseReview } from "../src/release-review.js";

const packet = () => ({
  version: 1,
  reviewedAt: "2026-08-15T16:30:00.000Z",
  author: "change-author",
  reviewer: "independent-reviewer",
  scope: "local release qualification only; no signing, upload, deployment or activation",
  externalActionsExecuted: false,
  checks: releaseReviewCheckIds.map(id => ({ id, status: "pass", evidence: [`evidence/${id}.json`], notes: "" }))
});

test("S-01 independent release review accepts a complete local-only packet", () => {
  assert.deepEqual(validateIndependentReleaseReview(packet()), { status: "accepted", reviewer: "independent-reviewer", checks: 9, externalActionsExecuted: false });
});

test("S-01 independent release review fails closed on identity and checklist drift", () => {
  assert.throws(() => validateIndependentReleaseReview({ ...packet(), reviewer: "change-author" }), /must be independent/);
  assert.throws(() => validateIndependentReleaseReview({ ...packet(), checks: packet().checks.slice(1) }), /incomplete or out of order/);
  assert.throws(() => validateIndependentReleaseReview({ ...packet(), checks: [...packet().checks].reverse() }), /incomplete or out of order/);
  assert.throws(() => validateIndependentReleaseReview({ ...packet(), unexpected: true }), /fields are invalid/);
});

test("S-01 independent release review rejects missing evidence, failures and external actions", () => {
  const failed = packet(); failed.checks[2] = { ...failed.checks[2], status: "fail" };
  assert.throws(() => validateIndependentReleaseReview(failed), /did not pass/);
  const missing = packet(); missing.checks[3] = { ...missing.checks[3], evidence: [] };
  assert.throws(() => validateIndependentReleaseReview(missing), /lacks evidence/);
  assert.throws(() => validateIndependentReleaseReview({ ...packet(), externalActionsExecuted: true }), /must not execute external actions/);
});
