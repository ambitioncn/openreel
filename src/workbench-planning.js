import { createHash } from "node:crypto";
import { DomainError } from "./core.js";

const TYPES = new Set(["knowledge", "product", "story", "talking", "news"]);
const text = (value, field, max = 4000) => { if (typeof value !== "string" || !value.trim() || value.length > max) throw new DomainError("INVALID_INPUT", `${field} is required and must be at most ${max} characters`); return value.trim(); };
const hash = value => createHash("sha256").update(value).digest("hex");
const modelText = (value, field, max) => { try { return text(value, field, max); } catch { throw new DomainError("MODEL_OUTPUT_INVALID", `text model returned invalid ${field}`, 502); } };
const hasHan = value => /\p{Script=Han}/u.test(value);

export const planningLanguage = brief => hasHan(text(brief, "brief")) ? "zh-Hans" : null;

export function planningPrompt(input = {}) {
  const brief = text(input.brief, "brief"), type = text(input.type, "type", 40), duration = Number(input.duration);
  if (!TYPES.has(type)) throw new DomainError("INVALID_INPUT", "type is unsupported");
  if (!Number.isInteger(duration) || duration < 5 || duration > 180) throw new DomainError("INVALID_INPUT", "duration must be an integer from 5 to 180 seconds");
  const sourceContext = input.sourceContext === undefined ? brief : text(input.sourceContext, "sourceContext");
  const languageRule = planningLanguage(brief) === "zh-Hans" ? " User-facing title, synopsis, hooks, and every shot title and line must remain in Chinese; visual prompts may use another language." : "";
  const structureRule = type === "product" && duration === 15 ? " Exactly three shots of 5 seconds each: reveal, detail, and final hold." : "";
  return `You are OpenReel's short-video planner. Return JSON only, without markdown.\nSchema: {"title":string,"synopsis":string,"hooks":[string,string,string],"selectedHook":0,"shots":[{"title":string,"line":string,"visual":string,"broll":string,"duration":integer}]}.\nRules: 1-12 shots; total shot duration exactly ${duration}; every shot duration must be 5 or 10 seconds; every string non-empty except broll; vertical-video visuals must be concrete; do not invent product facts.${structureRule}${languageRule}\nType: ${type}\nCreative brief: ${brief}\nSource context: ${sourceContext}`;
}

export function parsePlanningResult(content, expectedDuration, expectedLanguage = null) {
  let value; try { value = JSON.parse(text(content, "model result", 100_000)); } catch { throw new DomainError("MODEL_OUTPUT_INVALID", "text model did not return valid planning JSON", 502); }
  const top = ["title", "synopsis", "hooks", "selectedHook", "shots"];
  if (!value || Array.isArray(value) || Object.keys(value).some(key => !top.includes(key))) throw new DomainError("MODEL_OUTPUT_INVALID", "text model planning JSON has an invalid shape", 502);
  if (!Array.isArray(value.hooks) || value.hooks.length !== 3 || value.hooks.some(item => typeof item !== "string" || !item.trim())) throw new DomainError("MODEL_OUTPUT_INVALID", "text model must return exactly three hooks", 502);
  if (!Number.isInteger(value.selectedHook) || value.selectedHook < 0 || value.selectedHook >= value.hooks.length || !Array.isArray(value.shots) || value.shots.length < 1 || value.shots.length > 12) throw new DomainError("MODEL_OUTPUT_INVALID", "text model returned invalid hook selection or shots", 502);
  const shots = value.shots.map((shot, index) => { if (!shot || Array.isArray(shot) || Object.keys(shot).some(key => !["title", "line", "visual", "broll", "duration"].includes(key))) throw new DomainError("MODEL_OUTPUT_INVALID", `shot ${index + 1} has an invalid shape`, 502); const duration = Number(shot.duration); if (![5, 10].includes(duration)) throw new DomainError("MODEL_OUTPUT_INVALID", `shot ${index + 1} duration is invalid`, 502); return { title: modelText(shot.title, `shots[${index}].title`, 120), line: modelText(shot.line, `shots[${index}].line`, 1200), visual: modelText(shot.visual, `shots[${index}].visual`, 1200), broll: typeof shot.broll === "string" ? shot.broll.trim().slice(0, 1200) : "", duration }; });
  if (shots.reduce((sum, shot) => sum + shot.duration, 0) !== expectedDuration) throw new DomainError("MODEL_OUTPUT_INVALID", "shot durations do not match the requested duration", 502);
  const plan = { title: modelText(value.title, "title", 80), synopsis: modelText(value.synopsis, "synopsis", 10_000), hooks: value.hooks.map(item => item.trim()), selectedHook: value.selectedHook, shots };
  if (expectedLanguage === "zh-Hans" && [plan.title, plan.synopsis, ...plan.hooks, ...plan.shots.flatMap(shot => [shot.title, shot.line])].some(value => !hasHan(value))) throw new DomainError("MODEL_OUTPUT_INVALID", "Chinese brief requires Chinese user-facing planning text", 502);
  return plan;
}

export function planningProvenance({ prompt, output, job, model }) { return { schema: "openreel-text-planning-provenance/v1", provider: "volcengine-ark", model, providerJobId: job.id, status: job.status, cost: job.usage || null, promptSha256: hash(prompt), outputSha256: hash(output), createdAt: job.updatedAt }; }
