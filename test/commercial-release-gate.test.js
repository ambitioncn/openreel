import test from "node:test";
import assert from "node:assert/strict";
import { requireCommercialRelease } from "../src/commercial-release-gate.js";

const shotDimensions = ["intent", "beat", "composition", "visual_identity_consistency", "performance_naturalness"];
const finalDimensions = ["story", "pacing", "continuity"];
const identity = { projectVersion: 3, storyVersion: 1, storyboardVersion: 2 };
const qualified = { status: "succeeded", ownerId: "owner", input: { projectId: "project", ...identity }, result: { status: "qualified", qualificationStatus: "approved", releaseEligible: true, quality: { schema: "openreel-commercial-quality-result/v2", accepted: true, releaseEligible: true, shots: [{ accepted: true, creativePolicy: { threshold: 0.8, dimensions: shotDimensions } }], final: { accepted: true, releaseEligible: true, directorPolicy: { threshold: 0.8, dimensions: finalDimensions }, evidence: { assetId: "render", sha256: "a".repeat(64) } } } } };

test("shared commercial release gate accepts exactly one byte-bound eight-dimension candidate", () => {
  const jobs = { listOwned: owner => owner === "owner" ? [structuredClone(qualified)] : [] };
  assert.equal(requireCommercialRelease({ commercialJobs: jobs, ownerId: "owner", projectId: "project", assetId: "render", assetSha256: "a".repeat(64), revisionIdentity: identity }).status, "succeeded");
});

test("shared commercial release gate fails closed on absent, rejected, stale, malformed, digest-drifted or ambiguous evidence", () => {
  const variants = [
    [],
    [{ ...qualified, status: "failed" }],
    [{ ...qualified, input: { ...qualified.input, storyboardVersion: 1 } }],
    [{ ...qualified, result: { ...qualified.result, quality: { ...qualified.result.quality, shots: [{ ...qualified.result.quality.shots[0], creativePolicy: { threshold: 0.8, dimensions: shotDimensions.slice(0, 4) } }] } } }],
    [{ ...qualified, result: { ...qualified.result, quality: { ...qualified.result.quality, final: { ...qualified.result.quality.final, evidence: { assetId: "render", sha256: "b".repeat(64) } } } } }],
    [qualified, structuredClone(qualified)]
  ];
  for (const records of variants) assert.throws(() => requireCommercialRelease({ commercialJobs: { listOwned: () => records }, ownerId: "owner", projectId: "project", assetId: "render", assetSha256: "a".repeat(64), revisionIdentity: identity }), error => error.code === "COMMERCIAL_RELEASE_EVIDENCE_INVALID");
});
