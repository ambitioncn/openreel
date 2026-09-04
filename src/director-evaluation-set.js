import { createHash } from "node:crypto";
import { DomainError } from "./core.js";
import { listCreativeStrategyTypes } from "./creative-strategies.js";

const DIMENSIONS = Object.freeze({
  aspectRatio: Object.freeze(["9:16", "16:9", "1:1"]),
  durationSeconds: Object.freeze([15, 30, 60]),
  medium: Object.freeze(["live_action", "animation", "product", "mixed_media"]),
  audioMode: Object.freeze(["monologue", "dialogue", "silent", "music_beat"])
});

const CASES = Object.freeze([
  ["eval-001", "comedy", "9:16", 15, "live_action", "dialogue"],
  ["eval-002", "comedy", "16:9", 30, "animation", "silent"],
  ["eval-003", "comedy", "1:1", 60, "mixed_media", "music_beat"],
  ["eval-004", "talking_head", "9:16", 30, "live_action", "monologue"],
  ["eval-005", "talking_head", "16:9", 60, "mixed_media", "dialogue"],
  ["eval-006", "talking_head", "1:1", 15, "animation", "music_beat"],
  ["eval-007", "advertisement", "9:16", 60, "product", "music_beat"],
  ["eval-008", "advertisement", "16:9", 15, "live_action", "dialogue"],
  ["eval-009", "advertisement", "1:1", 30, "mixed_media", "monologue"],
  ["eval-010", "narrative", "9:16", 30, "animation", "dialogue"],
  ["eval-011", "narrative", "16:9", 60, "live_action", "silent"],
  ["eval-012", "narrative", "1:1", 15, "mixed_media", "music_beat"],
  ["eval-013", "tutorial", "9:16", 60, "mixed_media", "monologue"],
  ["eval-014", "tutorial", "16:9", 15, "product", "silent"],
  ["eval-015", "tutorial", "1:1", 30, "live_action", "dialogue"]
].map(([id, strategy, aspectRatio, durationSeconds, medium, audioMode]) => Object.freeze({ id, strategy, aspectRatio, durationSeconds, medium, audioMode })));

export const DIRECTOR_EVALUATION_SET = Object.freeze({ schema: "openreel-director-evaluation-set/v1", version: "2026-08-24.1", cases: CASES });

const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const reject = message => { throw new DomainError("DIRECTOR_EVALUATION_SET_INVALID", message, 422); };
const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) reject(`${label} fields are invalid`);
};

export function validateDirectorEvaluationSet(value) {
  exactKeys(value, ["schema", "version", "cases"], "evaluation set");
  if (value.schema !== "openreel-director-evaluation-set/v1" || typeof value.version !== "string" || value.version.length === 0) reject("schema or version is invalid");
  if (!Array.isArray(value.cases) || value.cases.length === 0) reject("cases must be a non-empty array");
  const ids = new Set();
  const coverage = Object.fromEntries(Object.keys(DIMENSIONS).map(key => [key, new Set()]));
  const strategies = new Set();
  for (const item of value.cases) {
    exactKeys(item, ["id", "strategy", "aspectRatio", "durationSeconds", "medium", "audioMode"], `case ${item?.id ?? "unknown"}`);
    if (typeof item.id !== "string" || item.id.length === 0 || ids.has(item.id)) reject("case ids must be non-empty and unique");
    ids.add(item.id);
    if (!listCreativeStrategyTypes().includes(item.strategy)) reject(`unsupported strategy in ${item.id}`);
    strategies.add(item.strategy);
    for (const key of Object.keys(DIMENSIONS)) {
      if (!DIMENSIONS[key].includes(item[key])) reject(`unsupported ${key} in ${item.id}`);
      coverage[key].add(item[key]);
    }
  }
  for (const strategy of listCreativeStrategyTypes()) if (!strategies.has(strategy)) reject(`missing strategy coverage: ${strategy}`);
  for (const [key, required] of Object.entries(DIMENSIONS)) for (const option of required) if (!coverage[key].has(option)) reject(`missing ${key} coverage: ${option}`);
  return Object.freeze({
    status: "qualified",
    version: value.version,
    caseCount: value.cases.length,
    fingerprint: createHash("sha256").update(canonicalJson(value)).digest("hex"),
    coverage: Object.freeze({ strategies: strategies.size, ...Object.fromEntries(Object.entries(coverage).map(([key, values]) => [key, values.size])) })
  });
}
