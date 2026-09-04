import { DomainError } from "./core.js";
import { getCreativeStrategy } from "./creative-strategies.js";

function invalid(message) { throw new DomainError("CREATIVE_DIRECTOR_INPUT_INVALID", message, 422); }
function text(value, name, max = 2_000) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || [...result].length > max) invalid(`${name} is required and must be at most ${max} characters`);
  return result;
}
function score(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) invalid(`${name} must be between 0 and 1`);
  return value;
}

export function createCreativeDirection(input = {}) {
  const shots = input.storyboard?.shots;
  if (!Array.isArray(shots) || !shots.length || shots.length > 12) invalid("storyboard must contain 1-12 shots");
  const threshold = input.qualityThreshold === undefined ? 0.8 : score(input.qualityThreshold, "qualityThreshold");
  const directedShots = shots.map((shot, index) => Object.freeze({
    id: text(shot?.id || `shot-${index + 1}`, `storyboard.shots[${index}].id`, 100),
    intent: text(shot?.intent, `storyboard.shots[${index}].intent`, 500),
    requiredBeat: text(shot?.requiredBeat, `storyboard.shots[${index}].requiredBeat`, 500),
    duration: Number(shot?.duration)
  }));
  if (directedShots.some(shot => !Number.isFinite(shot.duration) || shot.duration <= 0 || shot.duration > 10)) invalid("shot durations must be greater than 0 and at most 10 seconds");
  if (new Set(directedShots.map(shot => shot.id)).size !== directedShots.length) invalid("shot ids must be unique");
  const strategy = getCreativeStrategy(input.type);
  return Object.freeze({
    schema: "openreel-creative-direction/v2",
    brief: Object.freeze({
      objective: text(input.objective, "objective"),
      audience: text(input.audience, "audience"),
      singleMessage: text(input.singleMessage, "singleMessage"),
      tone: text(input.tone, "tone", 500)
    }),
    strategy,
    shots: Object.freeze(directedShots),
    qualityPolicy: Object.freeze({ owner: "director", threshold, dimensions: strategy.qualityDimensions, failClosed: true })
  });
}

export function reviewDirectedCut(input = {}) {
  const direction = input.direction;
  if (direction?.schema !== "openreel-creative-direction/v2") invalid("a creative direction is required");
  const cutId = text(input.cutId, "cutId", 100);
  const revision = Number(input.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) invalid("revision must be a positive integer");
  const generation = input.generationEvidence;
  if (generation?.schema !== "openreel-generation-evidence/v1" || generation.cutId !== cutId || generation.revision !== revision || generation.status !== "succeeded") invalid("successful generationEvidence for this cut revision is required");
  const prior = input.previousReview || null;
  if (prior && (prior.schema !== "openreel-director-review/v2" || prior.cutId !== cutId || prior.revision !== revision - 1 || prior.qualificationStatus !== "revision_required")) invalid("previousReview must be the immediately preceding rejected revision of this cut");

  const reviews = input.shotReviews;
  if (!Array.isArray(reviews) || reviews.length !== direction.shots.length) invalid("shotReviews must cover every directed shot exactly once");
  const reviewById = new Map(reviews.map(review => [review?.shotId, review]));
  if (reviewById.size !== reviews.length || direction.shots.some(shot => !reviewById.has(shot.id))) invalid("shotReviews must match the directed shot ids exactly");

  const directives = [];
  for (const shot of direction.shots) {
    const review = reviewById.get(shot.id);
    if (review?.schema !== "openreel-commercial-shot-quality/v1" || typeof review.accepted !== "boolean" || !Array.isArray(review.failures)) invalid(`shotReviews.${shot.id} is not a quality review`);
    if (!review.accepted) directives.push(Object.freeze({ scope: "shot", shotId: shot.id, reasons: Object.freeze([...review.failures]), action: review.action || "retry_shot" }));
  }
  const composition = input.compositionReview;
  if (composition?.schema !== "openreel-commercial-composition-quality/v1" || typeof composition.accepted !== "boolean" || !Array.isArray(composition.failures)) invalid("compositionReview is not a quality review");
  if (!composition.accepted) directives.push(Object.freeze({ scope: "composition", shotId: null, reasons: Object.freeze([...composition.failures]), action: composition.action || "recompose" }));

  const editorial = input.editorialScores;
  const dimensions = direction.qualityPolicy.dimensions;
  if (!editorial || Array.isArray(editorial) || typeof editorial !== "object" || Object.keys(editorial).length !== dimensions.length || dimensions.some(dimension => !Object.hasOwn(editorial, dimension))) invalid("editorialScores must contain exactly the strategy quality dimensions");
  const observedScores = Object.fromEntries(dimensions.map(dimension => [dimension, score(editorial[dimension], `editorialScores.${dimension}`)]));
  for (const [dimension, value] of Object.entries(observedScores)) if (value < direction.qualityPolicy.threshold) directives.push(Object.freeze({ scope: "editorial", shotId: null, reasons: Object.freeze([`${dimension}_below_threshold`]), action: "revise_edit" }));

  const accepted = directives.length === 0;
  return Object.freeze({
    schema: "openreel-director-review/v2",
    cutId,
    revision,
    generationStatus: "succeeded",
    qualificationStatus: accepted ? "approved" : "revision_required",
    releaseEligible: accepted,
    responsibility: Object.freeze({ owner: direction.qualityPolicy.owner, decision: accepted ? "accept" : "reject", evidenceComplete: true }),
    editorialScores: Object.freeze(observedScores),
    directives: Object.freeze(directives)
  });
}
