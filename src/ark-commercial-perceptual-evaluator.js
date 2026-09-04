import { createHash } from "node:crypto";
import { DomainError } from "./core.js";

export const COMMERCIAL_PERCEPTUAL_SCHEMA = "openreel-commercial-perceptual-evaluation/v2";
export const COMMERCIAL_SHOT_DIMENSIONS = Object.freeze(["intent", "beat", "composition", "visual_identity_consistency", "performance_naturalness"]);
export const COMMERCIAL_FINAL_DIMENSIONS = Object.freeze(["story", "pacing", "continuity"]);
export const COMMERCIAL_PERCEPTUAL_THRESHOLD = 0.8;
export const COMMERCIAL_PERCEPTUAL_MAX_COMPLETION_TOKENS = 2_000;
export const COMMERCIAL_PERCEPTUAL_MAX_OBSERVATION_CHARS = 4_000;
export const COMMERCIAL_PERCEPTUAL_IDEMPOTENCY_VERSION = "commercial-perceptual-v6";

function invalid(message) { throw new DomainError("COMMERCIAL_QUALITY_EVIDENCE_INVALID", message, 502); }

function incomplete(message, diagnostic) {
  throw new DomainError("COMMERCIAL_QUALITY_EVIDENCE_INVALID", message, 502, { retryable: false, qualityDiagnostic: diagnostic });
}

function parseScores(content, dimensions) {
  let value;
  try { value = JSON.parse(content); } catch { incomplete("commercial evaluator returned incomplete JSON", "MODEL_OUTPUT_INCOMPLETE_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "observed,scores") invalid("commercial evaluator returned an invalid score object");
  if (!value.scores || typeof value.scores !== "object" || Array.isArray(value.scores) || Object.keys(value.scores).sort().join(",") !== [...dimensions].sort().join(",")) invalid("commercial evaluator returned invalid dimensions");
  for (const dimension of dimensions) if (!Number.isFinite(value.scores[dimension]) || value.scores[dimension] < 0 || value.scores[dimension] > 1) invalid(`commercial evaluator returned invalid ${dimension} score`);
  if (typeof value.observed !== "string" || !value.observed.trim() || value.observed.length > COMMERCIAL_PERCEPTUAL_MAX_OBSERVATION_CHARS) invalid("commercial evaluator returned invalid observation");
  return { scores: Object.fromEntries(dimensions.map(dimension => [dimension, value.scores[dimension]])), observed: value.observed.trim() };
}

function mediaMessage(bytes, mimeType, prompt) {
  const type = mimeType.startsWith("video/") ? "video_url" : "image_url";
  return [{ role: "system", content: "You are a commercial short-video quality evaluator. Score only visible evidence. Return one JSON object and no markdown." }, { role: "user", content: [{ type: "text", text: prompt }, { type, [type]: { url: `data:${mimeType};base64,${bytes.toString("base64")}` } }] }];
}

function usageOf(job) {
  const usage = job?.usage;
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens) || !Number.isSafeInteger(usage.costMicros) || usage.costMicros < 0 || !Number.isSafeInteger(usage.unitScale) || usage.unitScale <= 0 || !["CNY", "USD"].includes(usage.currency)) invalid("commercial evaluator usage is untrusted");
  return usage;
}

function requiredIdentity(value, name) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 500) invalid(`${name} is required for byte-bound evaluation`);
  return normalized;
}

function evaluationKey({ runId, projectId, storyboardVersion, stage, shotId = null, assetId, sha256 }) {
  const digest = createHash("sha256").update(JSON.stringify({ contract: COMMERCIAL_PERCEPTUAL_IDEMPOTENCY_VERSION, runId, projectId, storyboardVersion, stage, shotId, assetId, sha256 })).digest("hex");
  return `${COMMERCIAL_PERCEPTUAL_IDEMPOTENCY_VERSION}:${digest}`;
}

export function createArkCommercialPerceptualEvaluator({ arkService, artifactReader, model, maximumCostCnyPerCall, cnyPerUsd = 7.2, maxMediaBytes = 100 * 1024 * 1024 } = {}) {
  if (!arkService || typeof arkService.submit !== "function" || typeof artifactReader !== "function" || typeof model !== "string" || !model.trim()) throw new DomainError("COMMERCIAL_QUALITY_UNAVAILABLE", "a scoring-capable commercial evaluation model is required", 503);
  const route = arkService.models().find(item => item.name === model.trim());
  if (!route || route.capability !== "text" || !Number.isSafeInteger(route.maxCostMicros) || route.maxCostMicros <= 0 || !Number.isSafeInteger(route.unitScale) || route.unitScale <= 0) throw new DomainError("COMMERCIAL_QUALITY_UNAVAILABLE", "commercial evaluation model must be a bounded text route", 503);
  if (!Number.isFinite(maximumCostCnyPerCall) || maximumCostCnyPerCall <= 0 || !Number.isFinite(cnyPerUsd) || cnyPerUsd <= 0) throw new DomainError("COMMERCIAL_QUALITY_UNAVAILABLE", "commercial evaluation requires a positive CNY per-call ceiling", 503);
  const evaluate = async (principal, input = {}) => {
    const runId = requiredIdentity(input.evaluationRunId, "evaluationRunId"), projectId = requiredIdentity(input.binding?.projectId, "binding.projectId"), storyboardVersion = Number(input.binding?.storyboardVersion);
    if (!Number.isSafeInteger(storyboardVersion) || storyboardVersion < 1) invalid("binding.storyboardVersion is required for byte-bound evaluation");
    const calls = [], run = async ({ assetId, sha256, dimensions, prompt, key }) => {
      const content = await artifactReader(principal, input.binding.projectId, assetId), bytes = Buffer.from(content?.bytes || []), mimeType = String(content?.manifest?.mimeType || content?.mimeType || "video/mp4").toLowerCase();
      if (!bytes.length || bytes.length > maxMediaBytes || !["video/mp4", "video/webm", "image/png", "image/jpeg", "image/webp"].includes(mimeType)) invalid("commercial evaluator artifact is unavailable or unsupported");
      if (createHash("sha256").update(bytes).digest("hex") !== sha256) invalid("commercial evaluator artifact digest does not match quality evidence");
      const maximumCostMicros = Math.ceil(maximumCostCnyPerCall / (route.currency === "USD" ? cnyPerUsd : 1) * route.unitScale);
      const job = await arkService.submit(principal, { model: route.name, capability: "text", maximumCostMicros, input: { messages: mediaMessage(bytes, mimeType, `${prompt}\nArtifact id: ${assetId}\nArtifact sha256: ${sha256}\nReturn exactly {\"scores\":{${dimensions.map(dimension => `\"${dimension}\":0.0`).join(",")}},\"observed\":\"specific visual evidence\"}. Scores are numbers from 0 to 1.`), temperature: 0, max_completion_tokens: COMMERCIAL_PERCEPTUAL_MAX_COMPLETION_TOKENS, disableThinking: true, jsonOutput: true }, idempotencyKey: key });
      if (job?.idempotencyKey !== key) invalid("commercial evaluator replay identity does not match current bytes");
      if (job?.status !== "succeeded" || typeof job.result?.content !== "string") invalid("commercial evaluator did not produce a completed score");
      if (job.result.finishReason === "length") incomplete("commercial evaluator output reached its controlled token ceiling", "MODEL_OUTPUT_TOKEN_LIMIT");
      if (!job.result.content.trim()) incomplete("commercial evaluator returned empty output", "MODEL_OUTPUT_EMPTY");
      const usage = usageOf(job), score = parseScores(job.result.content, dimensions);
      const actualCostCny = usage.costMicros / usage.unitScale * (usage.currency === "USD" ? cnyPerUsd : 1);
      if (actualCostCny > maximumCostCnyPerCall) throw new DomainError("COMMERCIAL_QUALITY_COST_LIMIT", "commercial evaluation exceeded its confirmed per-call ceiling", 403);
      calls.push({ usage, jobId: job.id, idempotencyKey: key, assetId, sha256 }); return { ...score, evidence: { assetId, sha256, observed: score.observed } };
    };
    const shots = [];
    for (const item of input.media || []) {
      const effectiveShot = input.storyboard?.find(shot => shot.id === item.shotId) || {};
      shots.push({ shotId: item.shotId, ...(await run({ assetId: item.assetId, sha256: item.sha256, dimensions: COMMERCIAL_SHOT_DIMENSIONS, prompt: `Evaluate whether this shot fulfills its effective commercial intent, has a clear beat, uses effective composition, preserves the bound subject's visual identity, and shows natural visible performance without uncanny motion. The effective storyboard prompt is authoritative when it narrows or replaces older director motion/style language. The bound subject may be a person, product, prop, or other object. For a non-person subject, visual_identity_consistency means preserving its visible geometry, material, color, scale, and distinguishing features; performance_naturalness means its motion or intentional stillness is physically plausible and matches the stated beat. Do not assign zero merely because no person, face, gaze, expression, camera motion, or object motion is present when the effective shot is object-only and intentionally static. Score only supplied artifact evidence and the bound role/reference context. Effective shot: ${JSON.stringify({ id: effectiveShot.id, prompt: effectiveShot.prompt, duration: effectiveShot.duration })}. Director context: ${JSON.stringify(input.director?.shots?.find(shot => shot.shotId === item.shotId) || {})}`, key: evaluationKey({ runId, projectId, storyboardVersion, stage: "shot", shotId: item.shotId, assetId: item.assetId, sha256: item.sha256 }) })) });
    }
    const final = await run({ assetId: input.render.assetId, sha256: input.render.sha256, dimensions: COMMERCIAL_FINAL_DIMENSIONS, prompt: `Evaluate the finished commercial for coherent story, pacing, and continuity. A one-shot commercial can tell a minimal product story through setup, presentation, and resolved end state; for one shot, continuity means temporal consistency within that shot rather than unavailable cross-shot evidence. For an object-only three-micro-shot product commercial, a visible wide establish -> closer material/detail inspection -> balanced hero presentation is itself the complete intended minimal product story. When that progression is visible and ordered, score story by whether those three beats form that setup-development-resolution arc; do not require a person, dialogue, object motion, camera motion, a location change, or a separate dramatic event. Intentional deterministic reframing of the same byte-bound product frame may distinguish those beats and should not lower story or pacing merely because product pixels remain identical; continuity should reward preservation of geometry, material, color, tabletop, background, and lighting across the progression. A small platform-required AI provenance label that does not carry brand, promotional, caption, or story content is allowed and must not by itself lower story, pacing, or continuity scores; still penalize any other unplanned text. Judge against the effective stated shot plan and do not assign zero solely because there is only one source shot, three static derived micro-shots, or an object-only subject. Shots: ${JSON.stringify((input.storyboard || []).map(shot => ({ id: shot.id, prompt: shot.prompt, duration: shot.duration })))}`, key: evaluationKey({ runId, projectId, storyboardVersion, stage: "final", assetId: input.render.assetId, sha256: input.render.sha256 }) });
    const first = calls[0]?.usage;
    if (!first || calls.some(call => call.usage.currency !== first.currency || call.usage.unitScale !== first.unitScale || call.usage.pricingVersion !== first.pricingVersion)) invalid("commercial evaluator usage units are inconsistent");
    return { schema: COMMERCIAL_PERCEPTUAL_SCHEMA, provider: "volcengine-ark", model: route.name, identity: { contract: COMMERCIAL_PERCEPTUAL_IDEMPOTENCY_VERSION, runIdSha256: createHash("sha256").update(runId).digest("hex"), calls: calls.map(call => ({ jobId: call.jobId, idempotencyKey: call.idempotencyKey, assetId: call.assetId, sha256: call.sha256 })) }, shotPolicy: { threshold: COMMERCIAL_PERCEPTUAL_THRESHOLD, dimensions: [...COMMERCIAL_SHOT_DIMENSIONS] }, shots, finalPolicy: { threshold: COMMERCIAL_PERCEPTUAL_THRESHOLD, dimensions: [...COMMERCIAL_FINAL_DIMENSIONS] }, final, usage: { currency: first.currency, unitScale: first.unitScale, costMicros: calls.reduce((sum, call) => sum + call.usage.costMicros, 0), inputTokens: calls.reduce((sum, call) => sum + call.usage.inputTokens, 0), outputTokens: calls.reduce((sum, call) => sum + call.usage.outputTokens, 0), pricingVersion: first.pricingVersion }, maximum: { currency: "CNY", maximumCostCny: maximumCostCnyPerCall * calls.length, maximumCostCnyPerCall, calls: calls.length } };
  };
  return Object.assign(evaluate, { route: Object.freeze({ provider: "volcengine-ark", model: route.name, maximumCostCnyPerCall }) });
}
