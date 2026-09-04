import { DomainError } from "./core.js";
import { renderCommercialMedia } from "./render.js";

const sameBinding = (asset, binding) => {
  const identity = asset?.identity || asset?.metadata?.identity;
  return identity?.projectId === binding.projectId && identity.projectVersion === binding.projectVersion && identity.storyVersion === binding.storyVersion && identity.storyboardVersion === binding.storyboardVersion;
};

export function composeReviewedCommercialMedia({ videos, voice, captionArtifacts = [], reviewedMusicArtifact = null, musicRightsConfirmation = null, plan, binding } = {}) {
  if (plan?.schema !== "openreel-commercial-composition/v1" || !binding?.projectId) throw new DomainError("COMMERCIAL_AV_INVALID", "composition plan and revision binding are required", 422);
  if (!Array.isArray(captionArtifacts) || captionArtifacts.length !== plan.timeline.filter(item => item.caption).length) throw new DomainError("COMMERCIAL_CAPTION_INVALID", "every planned caption requires one reviewed byte-backed artifact", 422);
  const captions = plan.timeline.filter(item => item.caption).map(item => {
    const asset = captionArtifacts.find(candidate => candidate.shotId === item.shotId);
    if (!asset || asset.captionText !== item.caption || !sameBinding(asset, binding) || asset.reviewed !== true) throw new DomainError("COMMERCIAL_CAPTION_INVALID", "caption artifact is missing, stale or does not match the reviewed text", 409);
    return { bytes: asset.bytes, mimeType: asset.mimeType, start: item.start, end: item.end };
  });
  let music = null;
  if (plan.audio?.musicGainDb !== null) {
    const review = reviewedMusicArtifact?.review;
    if (!reviewedMusicArtifact || !sameBinding(reviewedMusicArtifact, binding) || review?.status !== "reviewed" || typeof review.sourceDeclaration !== "string" || !review.sourceDeclaration.trim()) throw new DomainError("COMMERCIAL_MUSIC_INVALID", "reviewed byte-backed music with a source declaration is required", 409);
    if (musicRightsConfirmation?.accepted !== true || typeof musicRightsConfirmation.confirmedAt !== "string" || !musicRightsConfirmation.confirmedAt || musicRightsConfirmation.disclaimerVersion !== "music-rights-v1") throw new DomainError("COMMERCIAL_MUSIC_RIGHTS_CONFIRMATION_REQUIRED", "the user must accept responsibility for necessary music rights", 409);
    music = { bytes: reviewedMusicArtifact.bytes, mimeType: reviewedMusicArtifact.mimeType };
  }
  return renderCommercialMedia({ videos, audio: voice, captions, music, duration: plan.duration });
}
