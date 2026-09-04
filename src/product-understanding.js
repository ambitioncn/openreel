import { createHash } from "node:crypto";
import { DomainError } from "./core.js";

function bounded(value, max) { return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : ""; }
function evidence(id, field, quote, source) { return { id, field, quote: bounded(quote, 240), source: { finalUrl: source.finalUrl, sha256: source.sha256, fetchedAt: source.fetchedAt } }; }

export function understandProductPage(page) {
  if (page?.schema !== "openreel-product-page/v1" || !page.source || !/^[a-f0-9]{64}$/.test(page.source.sha256 || "") || !page.extracted) throw new DomainError("PRODUCT_EVIDENCE_INVALID", "product page evidence is invalid", 422);
  const title = bounded(page.extracted.title, 300), description = bounded(page.extracted.description, 1000), text = bounded(page.extracted.text, 20_000), facts = [], evidenceItems = [];
  if (title) { evidenceItems.push(evidence("ev-title", "extracted.title", title, page.source)); facts.push({ field: "name", value: title, evidenceIds: ["ev-title"] }); }
  if (description) { evidenceItems.push(evidence("ev-description", "extracted.description", description, page.source)); facts.push({ field: "description", value: description, evidenceIds: ["ev-description"] }); }
  const candidates = (description || text).split(/(?<=[。！？.!?])\s+|[\n•]+/).map(item => bounded(item, 240)).filter(item => item.length >= 12 && item !== description).slice(0, 5);
  candidates.forEach((value, index) => { const id = `ev-feature-${index + 1}`; evidenceItems.push(evidence(id, description ? "extracted.description" : "extracted.text", value, page.source)); facts.push({ field: "feature", value, evidenceIds: [id] }); });
  const score = Math.min(1, (title ? 0.35 : 0) + (description ? 0.35 : 0) + (text.length >= 80 ? 0.2 : 0) + (candidates.length >= 2 ? 0.1 : 0)), status = title && (description || text.length >= 80) ? "grounded" : "partial";
  return { schema: "openreel-product-understanding/v1", status, confidence: score, requiresReview: status !== "grounded", source: { mode: "fetched", ...page.source }, facts, creativeContext: { productName: title || null, summary: description || (text ? text.slice(0, 500) : null), valuePropositions: candidates.map(item => item), audience: null, unsupportedFields: ["audience", "price", "availability", "comparativeClaims"], instruction: "Use only facts linked to evidenceIds; do not invent price, availability, audience, performance or comparative claims." }, evidence: evidenceItems };
}

function modelPrompt(page) {
  return `Analyze only the fetched product evidence below. Return strict JSON with keys name, summary, valuePropositions, audience and evidenceQuotes. valuePropositions and evidenceQuotes must be arrays of strings. Every claimed string must be directly supported by an exact evidenceQuotes entry copied verbatim from the fetched text. Use null for unsupported audience. Do not infer price, availability, performance or comparative claims.\nFETCH_SHA256=${page.source.sha256}\nTITLE=${bounded(page.extracted.title, 300)}\nDESCRIPTION=${bounded(page.extracted.description, 1000)}\nTEXT=${bounded(page.extracted.text, 20000)}`;
}

function parseModelJson(content) {
  if (typeof content !== "string" || content.length > 100_000) throw new DomainError("PRODUCT_MODEL_OUTPUT_INVALID", "product understanding model returned invalid JSON", 502);
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const normalized = fenced ? fenced[1].trim() : trimmed;
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) throw new DomainError("PRODUCT_MODEL_OUTPUT_INVALID", "product understanding model returned invalid JSON", 502);
  try { return JSON.parse(normalized); } catch { throw new DomainError("PRODUCT_MODEL_OUTPUT_INVALID", "product understanding model returned invalid JSON", 502); }
}

function modelUnderstanding(page, content, job, model, prompt) {
  const value = parseModelJson(content);
  if (!value || Array.isArray(value) || typeof value !== "object" || !Array.isArray(value.valuePropositions) || !Array.isArray(value.evidenceQuotes)) throw new DomainError("PRODUCT_MODEL_OUTPUT_INVALID", "product understanding model returned an invalid contract", 502);
  const corpus = [page.extracted.title, page.extracted.description, page.extracted.text].map(item => bounded(item, 20_000)).join(" "), quotes = [...new Set(value.evidenceQuotes.map(item => bounded(item, 240)).filter(Boolean))];
  if (!quotes.length || quotes.some(quote => !corpus.includes(quote))) throw new DomainError("PRODUCT_MODEL_EVIDENCE_INVALID", "product understanding model cited unsupported evidence", 502);
  const claims = [["name", bounded(value.name, 300)], ["description", bounded(value.summary, 1000)], ...value.valuePropositions.map(item => ["feature", bounded(item, 240)]), ["audience", bounded(value.audience, 300)]].filter(([, claim]) => claim);
  const supportedClaims = claims.map(([field, claim]) => ({ field, claim, quoteIndex: quotes.findIndex(quote => quote.includes(claim) || claim.includes(quote)) })).filter(item => item.quoteIndex >= 0);
  if (!supportedClaims.length) throw new DomainError("PRODUCT_MODEL_EVIDENCE_INVALID", "product understanding model returned no directly supported claims", 502);
  const facts = supportedClaims.map(({ field, claim, quoteIndex }) => ({ field, value: claim, evidenceIds: [`model-ev-${quoteIndex + 1}`] }));
  const supported = field => supportedClaims.find(item => item.field === field)?.claim || null;
  const usage = job.usage && typeof job.usage === "object" ? { costMicros: job.usage.costMicros ?? null, currency: job.usage.currency ?? null, unitScale: job.usage.unitScale ?? null, inputTokens: job.usage.inputTokens ?? null, outputTokens: job.usage.outputTokens ?? null } : null;
  return { schema: "openreel-product-understanding/v1", status: "model_grounded", confidence: null, requiresReview: true, source: { mode: "fetched_model", ...page.source }, model: { provider: "ark", model, jobId: job.id, status: job.status, usage, promptSha256: createHash("sha256").update(prompt).digest("hex"), outputSha256: createHash("sha256").update(content).digest("hex") }, facts, creativeContext: { productName: supported("name"), summary: supported("description"), valuePropositions: supportedClaims.filter(item => item.field === "feature").map(item => item.claim).slice(0, 5), audience: supported("audience"), unsupportedFields: ["price", "availability", "comparativeClaims"], instruction: "Use only model claims linked to fetched evidenceIds; human review remains required." }, evidence: quotes.map((quote, index) => evidence(`model-ev-${index + 1}`, "model.evidenceQuotes", quote, page.source)) };
}

function fallbackUnderstanding(fallback, error) {
  const name = bounded(fallback?.name, 300), description = bounded(fallback?.description, 1000), audience = bounded(fallback?.audience, 300), benefits = Array.isArray(fallback?.benefits) ? fallback.benefits.map(item => bounded(item, 240)).filter(Boolean).slice(0, 5) : [];
  if (!name && !description && !audience && !benefits.length) throw error;
  const entries = [["name", name], ["description", description], ["audience", audience], ...benefits.map(value => ["benefit", value])].filter(([, value]) => value);
  return { schema: "openreel-product-understanding/v1", status: "fallback", confidence: 0, requiresReview: true, source: { mode: "user_fallback", fetchError: { code: error.code } }, facts: entries.map(([field, value], index) => ({ field, value, evidenceIds: [`user-${index + 1}`] })), creativeContext: { productName: name || null, summary: description || null, valuePropositions: benefits, audience: audience || null, unsupportedFields: ["price", "availability", "comparativeClaims"], instruction: "User fallback is unverified. Review every fact before generation." }, evidence: entries.map(([field, value], index) => ({ id: `user-${index + 1}`, field: `fallback.${field}`, quote: value, source: { mode: "user_input" } })) };
}

export function createProductUnderstandingService(fetchPage, arkService = null) {
  if (typeof fetchPage !== "function") throw new TypeError("fetchPage must be a function");
  return async ({ url, fallback, model, idempotencyKey, principal } = {}) => {
    let page;
    try { page = await fetchPage({ url }); }
    catch (error) { if (!(error instanceof DomainError)) throw error; return fallbackUnderstanding(fallback, error); }
    if (!arkService) throw new DomainError("PRODUCT_MODEL_UNAVAILABLE", "real product understanding model is not configured", 503);
    const selected = model || arkService.models().find(item => item.capability === "text")?.name;
    if (!selected) throw new DomainError("PRODUCT_MODEL_UNAVAILABLE", "no real product understanding model is configured", 503);
    if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 200) throw new DomainError("PRODUCT_MODEL_INPUT_INVALID", "idempotencyKey is required", 422);
    const prompt = modelPrompt(page), job = await arkService.submit(principal, { model: selected, capability: "text", input: { prompt, temperature: 0, max_completion_tokens: 2000, disableThinking: true, jsonOutput: true }, idempotencyKey: idempotencyKey.trim() });
    if (job.status !== "succeeded" || typeof job.result?.content !== "string") throw new DomainError("PRODUCT_MODEL_FAILED", "product understanding model did not produce content", 502);
    return modelUnderstanding(page, job.result.content, job, selected, prompt);
  };
}
