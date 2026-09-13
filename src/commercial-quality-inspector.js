import { createHash } from "node:crypto";
import { DomainError } from "./core.js";
import { evaluateDirectorShotQuality, REQUIRED_TECHNICAL_CHECKS, SHOT_QUALITY_SCHEMA } from "./director-shot-quality.js";
import { evaluateDirectorFinalQuality, FINAL_QUALITY_SCHEMA, REQUIRED_FINAL_TECHNICAL_CHECKS } from "./director-final-quality.js";
import { COMMERCIAL_FINAL_DIMENSIONS, COMMERCIAL_PERCEPTUAL_SCHEMA, COMMERCIAL_PERCEPTUAL_THRESHOLD, COMMERCIAL_SHOT_DIMENSIONS } from "./ark-commercial-perceptual-evaluator.js";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const mp4 = bytes => bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";

const evidence = (assetId, sha256, observed) => ({ artifactId: assetId, sha256, observed });
const invalid = message => { throw new DomainError("COMMERCIAL_QUALITY_EVIDENCE_INVALID", message, 502); };
const same = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);

function validateEvaluation(value, media, render) {
  if (value?.schema !== COMMERCIAL_PERCEPTUAL_SCHEMA) invalid("perceptual evaluator returned an unsupported evidence schema");
  if (value.shotPolicy?.threshold !== COMMERCIAL_PERCEPTUAL_THRESHOLD || !same(value.shotPolicy?.dimensions, COMMERCIAL_SHOT_DIMENSIONS)) invalid("perceptual evaluator returned an invalid eight-dimension shot policy");
  if (value.finalPolicy?.threshold !== COMMERCIAL_PERCEPTUAL_THRESHOLD || !same(value.finalPolicy?.dimensions, COMMERCIAL_FINAL_DIMENSIONS)) invalid("perceptual evaluator returned an invalid final policy");
  if (!Array.isArray(value.shots) || value.shots.length !== media.length) invalid("perceptual evaluator must cover every shot exactly once");
  const byShot = new Map(value.shots.map(item => [item?.shotId, item]));
  if (byShot.size !== media.length) invalid("perceptual evaluator returned duplicate shot evidence");
  for (const item of media) {
    const scored = byShot.get(item.shotId);
    if (!scored || Object.keys(scored.scores || {}).sort().join("\0") !== [...COMMERCIAL_SHOT_DIMENSIONS].sort().join("\0")) invalid(`perceptual evaluator returned invalid scores for ${item.shotId}`);
    if (scored.evidence?.assetId !== item.assetId || scored.evidence?.sha256 !== item.sha256) invalid(`perceptual evaluator evidence is not bound to ${item.shotId} bytes`);
  }
  if (Object.keys(value.final?.scores || {}).sort().join("\0") !== [...COMMERCIAL_FINAL_DIMENSIONS].sort().join("\0")) invalid("perceptual evaluator returned invalid final scores");
  if (value.final?.evidence?.assetId !== render.assetId || value.final?.evidence?.sha256 !== render.sha256) invalid("perceptual evaluator final evidence is not bound to render bytes");
  return value;
}

export function createCommercialQualityInspector({ artifactReader, perceptualEvaluator } = {}) {
  if (typeof artifactReader !== "function") throw new DomainError("COMMERCIAL_QUALITY_UNAVAILABLE", "quality artifact reader is required", 503);
  if (typeof perceptualEvaluator !== "function") throw new DomainError("COMMERCIAL_QUALITY_UNAVAILABLE", "perceptual quality evaluator is required", 503);
  return async (principal, request = {}) => {
    const media = [];
    for (const shot of request.storyboard || []) {
      const director = request.director?.shots?.find(item => item.shotId === shot.id);
      const textMode = request.director?.mode === "text_to_video";
      const video = request.artifacts?.find(item => item.kind === "video" && (item.shotId || item.metadata?.shotId) === shot.id);
      const content = video?.id ? await artifactReader(principal, request.binding.projectId, video.id) : null;
      const bytes = Buffer.from(content?.bytes || []);
      const checks = {
        playableMp4: mp4(bytes),
        durationBound: Number(shot.duration) >= 1 && Number(shot.duration) <= 10,
        roleBound: textMode || Boolean(director?.roleEntityIds?.length),
        sceneBound: textMode || Boolean(director?.sceneEntityIds?.length),
        styleBound: Boolean(director?.style?.trim()),
        referencesBound: textMode || Boolean(director?.referenceAssetIds?.length)
      };
      const metadata = video?.metadata || {};
      media.push({ shotId: shot.id, checks, assetId: video?.id, sha256: bytes.length ? digest(bytes) : null, byteLength: bytes.length, sharedSourceSha256: metadata.sharedSourceSha256 || video?.sharedSourceSha256 || null, sourceWindow: metadata.sourceWindow || video?.sourceWindow || null, continuityBytes: metadata.continuityBytes || video?.continuityBytes || null });
    }
    const renderId = request.render?.asset?.id || request.render?.id;
    const renderContent = renderId ? await artifactReader(principal, request.binding.projectId, renderId) : null;
    const renderBytes = Buffer.from(renderContent?.bytes || []), renderSha256 = renderBytes.length ? digest(renderBytes) : null;
    const evaluationRender = { assetId: renderId, sha256: renderSha256, byteLength: renderBytes.length };
    const evaluation = validateEvaluation(await perceptualEvaluator(principal, { ...request, media: media.map(item => ({ ...item })), render: evaluationRender }), media, evaluationRender);
    const workflowId = request.workflowId || request.binding?.quoteId || "commercial", revision = Number(request.binding?.storyboardVersion || 1);
    const sharedSourceSha256 = media.length === 3 && media[0].sharedSourceSha256 && media.every(item => item.sharedSourceSha256 === media[0].sharedSourceSha256) ? media[0].sharedSourceSha256 : null;
    const sharedConditions = ["product_geometry", "glaze_material_finish", "handle_orientation", "product_color", "product_texture", "tabletop", "background", "lighting", "reflections", "contact_shadow"];
    const ledgerBase = { schema: "openreel-shot-state-ledger/v1", projectId: request.binding.projectId, workflowId, revision, ...(sharedSourceSha256 && { generationStrategy: "single-h3-stable-prefix-crops", sharedSourceSha256, sharedConditions }), shots: media.map(item => ({ shotId: item.shotId, continuityStatus: "accepted", ...(sharedSourceSha256 && { sourceSha256: sharedSourceSha256, sourceWindow: item.sourceWindow, sharedConditions, continuityBytes: item.continuityBytes }) })) };
    const ledger = { ...ledgerBase, fingerprint: digest(Buffer.from(JSON.stringify(ledgerBase))) };
    const shots = media.map(item => {
      const scored = evaluation.shots?.find(candidate => candidate.shotId === item.shotId), technical = {
        decodable_video: item.checks.playableMp4, frame_integrity: item.checks.playableMp4, audio_integrity: item.checks.playableMp4,
        duration_match: item.checks.durationBound, resolution_match: item.checks.playableMp4,
        safety: item.checks.roleBound && item.checks.sceneBound && item.checks.styleBound && item.checks.referencesBound
      };
      const assetId = item.assetId || `missing-${item.shotId}`, sha256 = item.sha256 || "0".repeat(64);
      const result = evaluateDirectorShotQuality({ schema: SHOT_QUALITY_SCHEMA, projectId: request.binding.projectId, workflowId, revision, shotId: item.shotId, continuityLedgerFingerprint: ledger.fingerprint,
        generationAsset: { assetId, sha256, status: "succeeded" },
        technicalChecks: REQUIRED_TECHNICAL_CHECKS.map(checkId => ({ checkId, status: technical[checkId] ? "passed" : "failed", severity: ["decodable_video", "frame_integrity", "audio_integrity", "safety"].includes(checkId) ? "severe" : "major", evidence: evidence(assetId, sha256, `${checkId}:${Boolean(technical[checkId])}`) })),
        creativePolicy: evaluation.shotPolicy, creativeChecks: evaluation.shotPolicy.dimensions.map(dimension => ({ dimension, score: scored?.scores?.[dimension], evidence: evidence(scored?.evidence?.assetId || assetId, scored?.evidence?.sha256 || sha256, scored?.evidence?.observed || `perceptual:${dimension}`) })) }, ledger);
      return { ...result, checks: item.checks, evidence: item.byteLength ? { assetId, sha256, byteLength: item.byteLength } : null };
    });
    const finalTechnical = { container_integrity: mp4(renderBytes), duration_timeline: mp4(renderBytes), av_sync: mp4(renderBytes), audio_integrity: mp4(renderBytes), caption_safe_zone: mp4(renderBytes), resolution: mp4(renderBytes) };
    const finalResult = evaluateDirectorFinalQuality({ schema: FINAL_QUALITY_SCHEMA, projectId: request.binding.projectId, workflowId, revision, cutId: renderId || "missing-render", renderAsset: { assetId: renderId || "missing-render", sha256: renderSha256 || "0".repeat(64), status: "succeeded" }, expectedShotIds: media.map(item => item.shotId), shotResults: shots,
      compositionEvidence: { schema: "openreel-final-composition-evidence/v1", workflowId, revision, renderAssetSha256: renderSha256 || "0".repeat(64), technicalChecks: REQUIRED_FINAL_TECHNICAL_CHECKS.map(checkId => ({ checkId, status: finalTechnical[checkId] ? "passed" : "failed", severity: ["container_integrity", "audio_integrity"].includes(checkId) ? "severe" : "major", evidence: evidence(renderId || "missing-render", renderSha256 || "0".repeat(64), `${checkId}:${Boolean(finalTechnical[checkId])}`) })) },
      directorPolicy: evaluation.finalPolicy, directorChecks: evaluation.finalPolicy.dimensions.map(dimension => ({ dimension, score: evaluation.final?.scores?.[dimension], evidence: evidence(evaluation.final?.evidence?.assetId || renderId || "missing-render", evaluation.final?.evidence?.sha256 || renderSha256 || "0".repeat(64), evaluation.final?.evidence?.observed || `perceptual:${dimension}`) })) });
    const finalChecks = { playableMp4: mp4(renderBytes), allShotsAccepted: shots.length > 0 && shots.every(shot => shot.accepted) };
    const final = { ...finalResult, accepted: finalResult.releaseEligible, checks: finalChecks, evidence: renderBytes.length ? { assetId: renderId, sha256: renderSha256, byteLength: renderBytes.length } : null };
    return { schema: "openreel-commercial-quality-result/v2", accepted: final.releaseEligible, releaseEligible: final.releaseEligible, evaluation: { provider: evaluation.provider, model: evaluation.model, identity: evaluation.identity, usage: evaluation.usage || null, maximum: evaluation.maximum || null }, shots, final };
  };
}
