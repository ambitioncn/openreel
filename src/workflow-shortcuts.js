import { createHash } from "node:crypto";
import { DomainError } from "./core.js";

const observed = [
  ["storyboard_canvas_skill_new", "调度故事板", "storyboard", "motion-annotated-board"],
  ["storyboard_canvas_skill", "故事板", "storyboard", "story-sequence"],
  ["portrait_texture_adjustment", "人像质感调节", "image-edit", "single-image"],
  ["multi_camera_grid_9", "多机位九宫格", "camera-grid", "grid-9"],
  ["multi_camera_grid_9_4k", "多机位九宫格4K", "camera-grid", "grid-9-4k"],
  ["story_beat_grid_4", "剧情推演四宫格", "storyboard", "grid-4"],
  ["character_face_turnaround_3view", "角色脸部三视图", "consistency-sheet", "face-3-view"],
  ["product_turnaround_3view", "产品三视图", "consistency-sheet", "product-3-view"],
  ["character_setting_sheet", "角色设定图", "consistency-sheet", "character-sheet"],
  ["scene_setting_sheet", "场景设定图", "consistency-sheet", "scene-sheet"],
  ["product_setting_sheet", "产品设定图", "consistency-sheet", "product-sheet"],
  ["continuous_storyboard_grid_25", "25宫格连贯分镜", "storyboard", "grid-25"],
  ["cinematic_lighting_correction", "电影级光影校正", "image-edit", "single-image"],
  ["character_turnaround_3view", "角色三视图", "consistency-sheet", "character-3-view"],
  ["frame_prediction_plus_3s", "画面推演 - 3秒后", "frame-prediction", "plus-3s"],
  ["frame_prediction_minus_5s", "画面推演 - 5秒前", "frame-prediction", "minus-5s"]
];

export const WORKFLOW_SHORTCUT_CATALOG = Object.freeze({
  schema: "openreel-workflow-shortcut-catalog/v1",
  version: 1,
  observedAt: "2026-08-07",
  evidence: "docs/libtv-authenticated-evidence-2026-08-07.md",
  execution: "manual-review-required",
  templates: Object.freeze(observed.map(([id, label, family, output]) => Object.freeze({
    id, label, family, output,
    input: { kind: "image-reference", min: 1 },
    plan: [{ type: "image", promptSource: "user", references: "preserve-provenance" }],
    autoRun: false
  })))
});

export function workflowShortcutCatalog() {
  const value = structuredClone(WORKFLOW_SHORTCUT_CATALOG);
  value.fingerprint = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return value;
}

export function prepareWorkflowShortcutApplication(shortcutId, input = {}) {
  const catalog = workflowShortcutCatalog();
  const shortcut = catalog.templates.find(item => item.id === shortcutId);
  if (!shortcut) throw new DomainError("NOT_FOUND", "workflow shortcut not found", 404);
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) throw new DomainError("INVALID_INPUT", "prompt is required");
  if (!Array.isArray(input.referenceAssetIds) || !input.referenceAssetIds.length || input.referenceAssetIds.some(id => typeof id !== "string" || !id.trim())) throw new DomainError("INVALID_INPUT", "referenceAssetIds requires at least one asset id");
  return {
    type: "image",
    title: shortcut.label,
    content: JSON.stringify({ schema: "openreel-workflow-shortcut-application/v1", shortcutId, catalogFingerprint: catalog.fingerprint, prompt, referenceAssetIds: [...new Set(input.referenceAssetIds)] }),
    position: input.position
  };
}
