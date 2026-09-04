import { DomainError } from "./core.js";
import { COMMERCIAL_FINAL_DIMENSIONS, COMMERCIAL_PERCEPTUAL_THRESHOLD, COMMERCIAL_SHOT_DIMENSIONS } from "./ark-commercial-perceptual-evaluator.js";

const sameDimensions = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);

export function requireCommercialRelease({ commercialJobs, ownerId, projectId, assetId = null, assetSha256 = null, revisionIdentity = null }) {
  if (!commercialJobs?.listOwned) throw new DomainError("COMMERCIAL_RELEASE_EVIDENCE_UNAVAILABLE", "durable commercial quality evidence is unavailable", 503);
  const candidates = commercialJobs.listOwned(ownerId).filter(candidate => {
    const quality = candidate?.result?.quality, final = quality?.final;
    return candidate.status === "succeeded" && candidate.input?.projectId === projectId
      && (!revisionIdentity || (candidate.input?.projectVersion === revisionIdentity.projectVersion && candidate.input?.storyVersion === revisionIdentity.storyVersion && candidate.input?.storyboardVersion === revisionIdentity.storyboardVersion))
      && candidate.result?.status === "qualified" && candidate.result?.qualificationStatus === "approved"
      && candidate.result?.releaseEligible === true && quality?.schema === "openreel-commercial-quality-result/v2"
      && quality.accepted === true && quality.releaseEligible === true
      && Array.isArray(quality.shots) && quality.shots.length > 0
      && quality.shots.every(shot => shot.accepted === true && shot.creativePolicy?.threshold === COMMERCIAL_PERCEPTUAL_THRESHOLD && sameDimensions(shot.creativePolicy?.dimensions, COMMERCIAL_SHOT_DIMENSIONS))
      && final?.accepted === true && final.releaseEligible === true
      && final.directorPolicy?.threshold === COMMERCIAL_PERCEPTUAL_THRESHOLD && sameDimensions(final.directorPolicy?.dimensions, COMMERCIAL_FINAL_DIMENSIONS)
      && (assetId === null || final.evidence?.assetId === assetId)
      && (assetSha256 === null || final.evidence?.sha256 === assetSha256);
  });
  if (candidates.length !== 1) throw new DomainError("COMMERCIAL_RELEASE_EVIDENCE_INVALID", "exactly one owner-scoped qualified eight-dimension result must bind the commercial release", 422);
  return candidates[0];
}
