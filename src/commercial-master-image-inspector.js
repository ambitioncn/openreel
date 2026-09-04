import { createHash } from "node:crypto";
import { DomainError } from "./core.js";

export const COMMERCIAL_MASTER_IMAGE_DIMENSIONS = Object.freeze(["single_product", "geometry_handle", "color_material_texture", "environment_lighting", "no_text_panels_duplicates"]);
export const COMMERCIAL_MASTER_IMAGE_THRESHOLD = 0.8;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const invalid = message => { throw new DomainError("COMMERCIAL_MASTER_QUALITY_EVIDENCE_INVALID", message, 502); };

export function createCommercialMasterImageInspector({ arkService, model, maximumCostCnyPerCall, cnyPerUsd = 7.2, maxMediaBytes = 10 * 1024 * 1024 } = {}) {
  const route = arkService?.models?.().find(item => item.name === model);
  if (!route || route.capability !== "text" || !Number.isFinite(maximumCostCnyPerCall) || maximumCostCnyPerCall <= 0) throw new DomainError("COMMERCIAL_MASTER_QUALITY_UNAVAILABLE", "a bounded vision-capable master image evaluator is required", 503);
  return async (principal, input = {}) => {
    const masterBytes = Buffer.from(input.master?.bytes || []), references = input.references || [];
    if (!input.master?.assetId || !masterBytes.length || masterBytes.length > maxMediaBytes || !references.length || references.length > 3) invalid("master and one to three reference images are required");
    if (references.some(item => !item.assetId || !Buffer.from(item.bytes || []).length || Buffer.from(item.bytes).length > maxMediaBytes)) invalid("reference image bytes are invalid");
    const masterSha256 = digest(masterBytes), referenceEvidence = references.map(item => ({ assetId: item.assetId, sha256: digest(Buffer.from(item.bytes)) }));
    const dimensions = COMMERCIAL_MASTER_IMAGE_DIMENSIONS;
    const prompt = `Compare the GENERATED MASTER against the REFERENCE images and locked continuity. Score only visible pixels. The generated master must contain exactly one product in one full-frame photograph; preserve the reference product geometry including handle count, shape, orientation and attachment; preserve color, glaze/material and texture; preserve one coherent tabletop, background and lighting; and contain no words, letters, numbers, labels, logos, panels, collage, borders, duplicate products or detached product parts. Locked continuity: ${JSON.stringify(input.continuity || [])}. Return exactly {"scores":{${dimensions.map(key => `"${key}":0.0`).join(",")}},"observed":"specific visible evidence"}.`;
    const content = [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${input.master.mimeType};base64,${masterBytes.toString("base64")}` } }, ...references.map(item => ({ type: "image_url", image_url: { url: `data:${item.mimeType};base64,${Buffer.from(item.bytes).toString("base64")}` } }))];
    const maximumCostMicros = Math.ceil(maximumCostCnyPerCall / (route.currency === "USD" ? cnyPerUsd : 1) * route.unitScale);
    const key = `commercial-master-quality-v1:${digest(Buffer.from(JSON.stringify({ run: input.evaluationRunId, project: input.binding?.projectId, masterSha256, references: referenceEvidence })))}`;
    const job = await arkService.submit(principal, { model: route.name, capability: "text", maximumCostMicros, input: { messages: [{ role: "system", content: "You are a strict product-reference visual quality gate. Return JSON only." }, { role: "user", content }], temperature: 0, max_completion_tokens: 1000, disableThinking: true, jsonOutput: true }, idempotencyKey: key });
    if (job?.status !== "succeeded" || typeof job.result?.content !== "string" || !job.usage) invalid("master image evaluator did not complete with trusted usage");
    let parsed; try { parsed = JSON.parse(job.result.content); } catch { invalid("master image evaluator returned invalid JSON"); }
    if (!parsed?.scores || typeof parsed.observed !== "string" || Object.keys(parsed.scores).sort().join() !== [...dimensions].sort().join() || dimensions.some(key => !Number.isFinite(parsed.scores[key]) || parsed.scores[key] < 0 || parsed.scores[key] > 1)) invalid("master image evaluator returned invalid scores");
    const accepted = dimensions.every(key => parsed.scores[key] >= COMMERCIAL_MASTER_IMAGE_THRESHOLD);
    return { schema: "openreel-commercial-master-image-quality/v1", accepted, threshold: COMMERCIAL_MASTER_IMAGE_THRESHOLD, scores: parsed.scores, observed: parsed.observed.trim(), provider: "volcengine-ark", model: route.name, usage: job.usage, evidence: { master: { assetId: input.master.assetId, sha256: masterSha256 }, references: referenceEvidence, idempotencyKey: key } };
  };
}
