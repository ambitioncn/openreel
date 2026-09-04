import { DomainError } from "./core.js";

export const H3_CAMERA_ACTIONS = Object.freeze(["locked", "dolly_in", "dolly_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit_left", "orbit_right", "crane_up", "crane_down", "handheld_drift"]);
const MOVES = new Set(H3_CAMERA_ACTIONS);
const FORBIDDEN = ["cuts", "scene changes", "morphing", "duplication", "topology changes", "text", "logos", "watermarks"];

const H3_PRIMITIVES = Object.freeze({
  static_hold: Object.freeze({ cameraMove: "locked", subjectMotion: "Remain still throughout the shot.", cameraMotion: "No camera motion, reframing, or focus pull." }),
  micro_turn: Object.freeze({ cameraMove: "locked", subjectMotion: "Perform one barely perceptible turn while preserving the first-frame silhouette; then hold still.", cameraMotion: "No camera motion, reframing, or focus pull." }),
  dolly_in: Object.freeze({ cameraMove: "dolly_in", subjectMotion: "Remain physically still and preserve the first-frame pose.", cameraMotion: "One slow shallow dolly-in only; no pan, tilt, orbit, roll, or focus pull." }),
  dolly_out: Object.freeze({ cameraMove: "dolly_out", subjectMotion: "Remain physically still and preserve the first-frame pose.", cameraMotion: "One slow shallow dolly-out only; no pan, tilt, orbit, roll, or focus pull." }),
  pan_left: Object.freeze({ cameraMove: "pan_left", subjectMotion: "Remain physically still and preserve geometry and support contact.", cameraMotion: "One slow shallow pan to image-left only; no dolly, tilt, orbit, roll, or focus pull." }),
  pan_right: Object.freeze({ cameraMove: "pan_right", subjectMotion: "Remain physically still and preserve geometry and support contact.", cameraMotion: "One slow shallow pan to image-right only; no dolly, tilt, orbit, roll, or focus pull." }),
  tilt_up: Object.freeze({ cameraMove: "tilt_up", subjectMotion: "Remain physically still and preserve geometry and support contact.", cameraMotion: "One slow shallow tilt upward only; no dolly, pan, orbit, roll, or focus pull." }),
  tilt_down: Object.freeze({ cameraMove: "tilt_down", subjectMotion: "Remain physically still and preserve geometry and support contact.", cameraMotion: "One slow shallow tilt downward only; no dolly, pan, orbit, roll, or focus pull." }),
  orbit_left: Object.freeze({ cameraMove: "orbit_left", subjectMotion: "Remain physically still and preserve geometry and support contact.", cameraMotion: "One slow shallow orbit to image-left only; no dolly, pan, tilt, roll, or focus pull." }),
  orbit_right: Object.freeze({ cameraMove: "orbit_right", subjectMotion: "Remain physically still and preserve geometry and support contact.", cameraMotion: "One slow shallow orbit to image-right only; no dolly, pan, tilt, roll, or focus pull." }),
  crane_up: Object.freeze({ cameraMove: "crane_up", subjectMotion: "Remain physically still and preserve geometry and support contact.", cameraMotion: "One slow shallow vertical rise only; no dolly, pan, tilt, orbit, roll, or focus pull." }),
  crane_down: Object.freeze({ cameraMove: "crane_down", subjectMotion: "Remain physically still and preserve geometry and support contact.", cameraMotion: "One slow shallow vertical descent only; no dolly, pan, tilt, orbit, roll, or focus pull." }),
  handheld_drift: Object.freeze({ cameraMove: "handheld_drift", subjectMotion: "Remain physically stable and preserve the first-frame pose.", cameraMotion: "One subtle stabilized handheld drift only; no deliberate pan, tilt, orbit, dolly, roll, or focus pull." })
});

export const H3_COMMERCIAL_SCENARIOS = Object.freeze(["product_hero", "feature_demo", "macro_detail", "unboxing", "before_after", "lifestyle_use", "testimonial", "food_beverage", "fashion_beauty", "retail_ecommerce", "service_app", "brand_payoff"]);
const COMMERCIAL_SCENARIOS = Object.freeze({
  product_hero: ["Make the product the single visual hero.", "resolve in a clean hero pose", ["competing products", "visual clutter"]],
  feature_demo: ["Show one feature through one legible physical action.", "hold the completed feature state", ["multiple feature actions", "unclear interaction"]],
  macro_detail: ["Keep one material or construction detail readable.", "settle on the same detail", ["loss of macro detail", "unmotivated refocus"]],
  unboxing: ["Reveal one packaging layer without changing product identity.", "hold the product and package in a readable arrangement", ["extra package parts", "instantaneous opening"]],
  before_after: ["Show one continuous, physically plausible transition toward the promised result.", "hold the resolved result", ["split-screen mutation", "unsupported transformation"]],
  lifestyle_use: ["Show one natural use action with the person and product both readable.", "finish the use action naturally", ["extra people", "unsafe use"]],
  testimonial: ["Keep the speaker's face readable with one restrained presentational gesture.", "finish facing the viewer", ["lip-sync claims", "face obstruction"]],
  food_beverage: ["Show one appetizing serving, pour, steam, or texture action with plausible physics.", "hold the served product cleanly", ["spillage", "implausible fluid motion"]],
  fashion_beauty: ["Show one controlled wear, application, or material movement while preserving anatomy.", "finish in a clear beauty pose", ["anatomy distortion", "wardrobe mutation"]],
  retail_ecommerce: ["Keep the product fully inspectable against a clean selling background.", "finish with the complete product visible", ["cropped product", "price text"]],
  service_app: ["Visualize one service benefit through a person, device, or environment without inventing interface text.", "finish on the achieved real-world outcome", ["unreadable UI", "invented interface copy"]],
  brand_payoff: ["Resolve the preceding promise into one calm memorable brand-world image.", "hold a clean end-card-safe composition", ["generated logo", "generated slogan"]]
});

export function getH3CommercialScenario(name) {
  const scenario = COMMERCIAL_SCENARIOS[name];
  if (!scenario) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", `unsupported commercial scenario: ${name || "(empty)"}`, 422);
  return Object.freeze({ id: name, direction: scenario[0], endPose: scenario[1], negativeConstraints: [...scenario[2]] });
}

export function createH3CoverageMatrix() {
  return Object.freeze({ schema: "openreel-h3-commercial-coverage-matrix/v1", cameraActions: [...H3_CAMERA_ACTIONS], commercialScenarios: [...H3_COMMERCIAL_SCENARIOS], cases: H3_COMMERCIAL_SCENARIOS.flatMap(commercialScenario => H3_CAMERA_ACTIONS.map(cameraAction => Object.freeze({ commercialScenario, cameraAction }))) });
}

const HIGH_GEOMETRY_RISK = new Set(["macro_detail", "unboxing", "before_after", "testimonial", "food_beverage", "fashion_beauty", "service_app"]);
const PARALLAX_MOVES = new Set(["orbit_left", "orbit_right", "crane_up", "crane_down", "handheld_drift"]);

export function createH3CapabilityMatrix() {
  const cases = H3_COMMERCIAL_SCENARIOS.flatMap((commercialScenario, scenarioIndex) => H3_CAMERA_ACTIONS.map((cameraAction, actionIndex) => {
    const riskTags = [];
    if (HIGH_GEOMETRY_RISK.has(commercialScenario)) riskTags.push("subject_or_geometry_continuity");
    if (PARALLAX_MOVES.has(cameraAction)) riskTags.push("parallax_and_occlusion");
    if (commercialScenario === "macro_detail" && cameraAction !== "locked") riskTags.push("detail_readability");
    if (commercialScenario === "testimonial" && cameraAction !== "locked") riskTags.push("face_identity");
    const applicability = riskTags.length ? "conditional_pending_real_h3" : "candidate_pending_real_h3";
    return Object.freeze({
      id: `pd2h3-${String(scenarioIndex + 1).padStart(2, "0")}-${String(actionIndex + 1).padStart(2, "0")}`,
      commercialScenario,
      cameraAction,
      applicability,
      riskTags,
      intendedBehavior: `${getH3CommercialScenario(commercialScenario).direction} Use exactly one shallow ${cameraAction} camera action.`,
      productionEligible: false,
      qualificationStatus: "unqualified"
    });
  }));
  return Object.freeze({ schema: "openreel-h3-capability-matrix/v1", modelConfiguration: "minimax-h3-fl2va-q5-turbo-v4", cameraActions: [...H3_CAMERA_ACTIONS], commercialScenarios: [...H3_COMMERCIAL_SCENARIOS], cases });
}

export function createH3CommercialQualificationProtocol({ seeds = [37, 73, 109], hardLimitCnyPerAction = 100, estimatedCallCny = 0 } = {}) {
  const normalizedSeeds = [...new Set(seeds.map(Number))];
  if (normalizedSeeds.length < 3 || normalizedSeeds.some(seed => !Number.isSafeInteger(seed) || seed < 0)) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", "commercial qualification requires at least three distinct non-negative integer seeds", 422);
  const perActionLimit = Number(hardLimitCnyPerAction), perCall = Number(estimatedCallCny);
  if (!Number.isFinite(perActionLimit) || perActionLimit <= 0 || perActionLimit > 100 || !Number.isFinite(perCall) || perCall < 0 || perCall > perActionLimit) throw new DomainError("PROMPT_DIRECTOR_V2_BUDGET_EXCEEDED", "each paid action must be bounded at or below CNY 100", 422);
  const anchorPairs = H3_COMMERCIAL_SCENARIOS.map((commercialScenario, index) => ({ commercialScenario, cameraAction: H3_CAMERA_ACTIONS[index] }));
  const criticalPairs = [
    ["macro_detail", "orbit_left"], ["unboxing", "dolly_in"], ["before_after", "locked"], ["lifestyle_use", "handheld_drift"],
    ["testimonial", "dolly_in"], ["food_beverage", "tilt_down"], ["fashion_beauty", "orbit_right"], ["retail_ecommerce", "crane_down"],
    ["service_app", "pan_right"], ["brand_payoff", "crane_up"]
  ].map(([commercialScenario, cameraAction]) => ({ commercialScenario, cameraAction }));
  const pairs = [...new Map([...anchorPairs, ...criticalPairs].map(pair => [`${pair.commercialScenario}:${pair.cameraAction}`, pair])).values()];
  const cases = pairs.flatMap(pair => normalizedSeeds.map(seed => Object.freeze({ id: `${pair.commercialScenario}:${pair.cameraAction}:seed-${seed}`, ...pair, seed, requiredEvidence: ["prompt", "first_frame", "parameters", "video", "sha256", "cost"] })));
  return Object.freeze({
    schema: "openreel-h3-commercial-qualification-protocol/v1",
    modelConfiguration: "minimax-h3-fl2va-q5-turbo-v4",
    output: Object.freeze({ width: 960, height: 544, durationSeconds: 5 }),
    seeds: normalizedSeeds,
    anchorPairs,
    criticalPairs,
    cases,
    graders: Object.freeze(["subject_product_identity", "subject_action_adherence", "camera_action_adherence", "timing", "material_lighting_continuity", "artifacts", "commercial_usability"]),
    thresholds: Object.freeze({ perMetricMinimum: 3, scaleMaximum: 5, criticalArtifactMaximum: 0, classPassSeeds: 2, classRequiredSeeds: 3 }),
    budget: Object.freeze({ hardLimitCnyPerAction: perActionLimit, estimatedCallCny: perCall, estimatedTotalCny: Number((cases.length * perCall).toFixed(2)) }),
    retryRule: "No identical retry. A failure may be retried only with a recorded changed strategy, a fresh seed, and an action reservation within the per-action limit.",
    promotionRule: "Production eligibility requires accepted multi-seed visual evidence; unqualified, failed, or unsupported combinations remain blocked."
  });
}

export function createH3EvidenceRecord(input = {}) {
  const required = ["caseId", "prompt", "firstFrame", "video", "actionReservationId", "qualificationVerdict"];
  for (const field of required) clean(input[field], field, 4_000);
  const seed = Number(input.seed), costCny = Number(input.costCny);
  if (!Number.isSafeInteger(seed) || seed < 0 || !Number.isFinite(costCny) || costCny < 0 || costCny > 100) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", "evidence seed and cost must satisfy qualification policy", 422);
  const sha256 = input.sha256 || {};
  for (const field of ["prompt", "firstFrame", "video"]) if (!/^[a-f0-9]{64}$/.test(String(sha256[field] || ""))) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", `sha256.${field} must be a lowercase SHA-256 digest`, 422);
  return Object.freeze({ schema: "openreel-h3-qualification-evidence/v1", caseId: input.caseId, seed, prompt: input.prompt, firstFrame: input.firstFrame, video: input.video, parameters: Object.freeze({ ...(input.parameters || {}) }), sha256: Object.freeze({ ...sha256 }), actionReservationId: input.actionReservationId, costCny, qualificationVerdict: input.qualificationVerdict, changedStrategyRef: input.changedStrategyRef || null });
}

export function getH3Primitive(name) {
  const primitive = H3_PRIMITIVES[name];
  if (!primitive) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", `unsupported H3 primitive: ${name || "(empty)"}`, 422);
  return primitive;
}

export function createH3PrimitiveQualificationPlan({ sceneIds = [], seeds = [], primitiveNames = Object.keys(H3_PRIMITIVES), hardLimitCny = 100, estimatedCallCny = 0 } = {}) {
  const scenes = [...new Set(sceneIds.map(value => clean(value, "sceneIds[]", 80)))];
  const normalizedSeeds = [...new Set(seeds.map(Number))];
  const primitives = [...new Set(primitiveNames.map(value => clean(value, "primitiveNames[]", 40)))];
  if (scenes.length < 2) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", "qualification requires at least two distinct scenes", 422);
  if (normalizedSeeds.length < 2 || normalizedSeeds.some(seed => !Number.isSafeInteger(seed) || seed < 0)) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", "qualification requires at least two distinct non-negative integer seeds", 422);
  primitives.forEach(getH3Primitive);
  const limit = Number(hardLimitCny), perCall = Number(estimatedCallCny);
  if (!Number.isFinite(limit) || limit < 0 || !Number.isFinite(perCall) || perCall < 0) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", "qualification budget values must be non-negative", 422);
  const cases = scenes.flatMap(sceneId => normalizedSeeds.flatMap(seed => primitives.map(primitive => Object.freeze({ sceneId, seed, primitive }))));
  const estimatedTotalCny = Number((cases.length * perCall).toFixed(2));
  if (estimatedTotalCny > limit) throw new DomainError("PROMPT_DIRECTOR_V2_BUDGET_EXCEEDED", `qualification estimate CNY ${estimatedTotalCny} exceeds hard limit CNY ${limit}`, 422);
  return Object.freeze({ schema: "openreel-h3-primitive-qualification-plan/v1", scenes, seeds: normalizedSeeds, primitives, cases, budget: Object.freeze({ hardLimitCny: limit, estimatedCallCny: perCall, estimatedTotalCny }), promotionRule: "Promote a primitive only when it beats or ties legacy on every scene and seed, has no critical identity/geometry artifact, and improves the aggregate commercial score." });
}

function clean(value, name, max = 600) {
  const result = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!result || [...result].length > max) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", `${name} is required and must be at most ${max} characters`, 422);
  return result;
}

function beat(value, index) {
  const start = Number(value?.start), end = Number(value?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 5 || start >= end) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", `action_beats[${index}] must fit inside 0..5 seconds`, 422);
  return { start, end, action: clean(value?.action, `action_beats[${index}].action`) };
}

export function normalizeH3CreativeSpec(input = {}) {
  const actionBeats = Array.isArray(input.action_beats) ? input.action_beats.map(beat) : [];
  if (!actionBeats.length || actionBeats.length > 4 || actionBeats.some((item, index) => index && item.start < actionBeats[index - 1].end)) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", "action_beats must contain 1-4 ordered, non-overlapping beats", 422);
  const move = clean(input.camera?.move, "camera.move", 40);
  if (!MOVES.has(move)) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", "camera.move must be one supported dominant move", 422);
  const negatives = [...new Set([...(Array.isArray(input.negative_constraints) ? input.negative_constraints.map((item, index) => clean(item, `negative_constraints[${index}]`, 120)) : []), ...FORBIDDEN])];
  return Object.freeze({
    schema: "openreel-prompt-director-creative-spec/v2",
    duration_seconds: 5,
    first_frame_inheritance: clean(input.first_frame_inheritance, "first_frame_inheritance"),
    scene: clean(input.scene, "scene", 2_000),
    subject: clean(input.subject, "subject"),
    action_beats: actionBeats,
    subject_motion: clean(input.subject_motion, "subject_motion"),
    camera: { move, framing: clean(input.camera?.framing, "camera.framing"), motion: clean(input.camera?.motion, "camera.motion") },
    ambient_motion: clean(input.ambient_motion, "ambient_motion"),
    lighting_material_continuity: clean(input.lighting_material_continuity, "lighting_material_continuity"),
    end_pose: clean(input.end_pose, "end_pose"),
    negative_constraints: negatives
  });
}

export function createH3CreativeSpec({ shot, directorShot, objectOnly = false } = {}) {
  const prompt = clean(shot?.prompt, "shot.prompt", 2_000), style = clean(directorShot?.style, "directorShot.style", 500);
  const scenario = getH3CommercialScenario(directorShot?.commercialScenario || "product_hero");
  const cameraAction = directorShot?.cameraAction || "locked", primitive = getH3Primitive(cameraAction === "locked" ? "static_hold" : cameraAction);
  return normalizeH3CreativeSpec({
    first_frame_inheritance: "Start from the supplied first frame; preserve subject identity, geometry, placement, wardrobe or packaging, and scene layout.",
    scene: `${prompt} COMMERCIAL SCENARIO (${scenario.id}): ${scenario.direction}`,
    subject: objectOnly ? "The same single product from the first frame remains physically supported and fully visible." : "The same subject and key object from the first frame remain coherent, visible, and unobstructed.",
    action_beats: [{ start: 0, end: 1, action: "hold the inherited opening pose" }, { start: 1, end: 4, action: objectOnly ? "perform one small smooth product reveal" : "perform one small controlled subject action" }, { start: 4, end: 5, action: "ease into the resolved end pose" }],
    subject_motion: objectOnly ? "One slow low-amplitude rotation; no translation, lift, deformation, or secondary action." : "One low-complexity action with small controlled movement; keep face, hands, and key object separated.",
    camera: { move: primitive.cameraMove, framing: "Maintain the inherited framing and keep the complete key subject inside frame.", motion: primitive.cameraMotion },
    ambient_motion: "Only subtle physically plausible background motion; no new elements.",
    lighting_material_continuity: `Preserve lighting direction, exposure, reflections, contact shadows, material response, color, and ${style}.`,
    end_pose: `Finish stable and readable during the final second; ${scenario.endPose}; suitable for a clean commercial edit.`,
    negative_constraints: [...(objectOnly ? ["people", "faces", "hands", "floating product", "extra products"] : ["face obstruction", "cropped hands", "object occlusion", "anatomy distortion"]), ...scenario.negativeConstraints]
  });
}

export function compileH3ModelPrompt(specInput) {
  const spec = specInput?.schema === "openreel-prompt-director-creative-spec/v2" ? specInput : normalizeH3CreativeSpec(specInput);
  const beats = spec.action_beats.map(item => `${item.start}-${item.end}s ${item.action}`).join("; ");
  const modelPrompt = `5-second image-to-video shot. FIRST FRAME: ${spec.first_frame_inheritance} SCENE/SUBJECT: ${spec.scene} ${spec.subject} ACTION BEATS: ${beats}. SUBJECT MOTION: ${spec.subject_motion} CAMERA (${spec.camera.move}, one dominant move): ${spec.camera.framing} ${spec.camera.motion} AMBIENT: ${spec.ambient_motion} CONTINUITY: ${spec.lighting_material_continuity} END: ${spec.end_pose} AVOID: ${spec.negative_constraints.join(", ")}.`;
  if ([...modelPrompt].length > 4_000) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", "compiled model_prompt exceeds 4000 characters", 422);
  return Object.freeze({ schema: "openreel-prompt-director-model-prompt/v2", adapter: "minimax-h3-image-to-video/v2", creative_spec: spec, model_prompt: modelPrompt });
}

export function compileH3PrimitivePrompt(specInput, primitiveName) {
  const spec = specInput?.schema === "openreel-prompt-director-creative-spec/v2" ? specInput : normalizeH3CreativeSpec(specInput);
  const primitive = getH3Primitive(primitiveName);
  const endAnchor = primitiveName === "micro_turn"
    ? "Finish nearly identical to frame one; preserve the opening silhouette and keep every distinguishing feature on the same image side."
    : primitiveName === "dolly_in"
      ? "Finish only slightly closer with the complete subject still inside frame."
      : primitive.cameraMove !== "locked"
        ? `Finish after one shallow ${primitive.cameraMove} move while the complete subject stays inside frame.`
        : "Finish visually identical to frame one.";
  const modelPrompt = `Same supplied first frame. ONE ACTION: ${primitive.subjectMotion} ${primitive.cameraMotion} END ANCHOR: ${endAnchor} LOCK: ${spec.subject} ${spec.camera.framing} ${spec.lighting_material_continuity} NEVER: ${spec.negative_constraints.join(", ")}.`;
  if ([...modelPrompt].length > 2_000) throw new DomainError("PROMPT_DIRECTOR_V2_INVALID", "compiled primitive model_prompt exceeds 2000 characters", 422);
  return Object.freeze({ schema: "openreel-prompt-director-primitive-prompt/v2", adapter: "minimax-h3-image-to-video/primitive-v1", primitive: primitiveName, creative_spec: spec, model_prompt: modelPrompt });
}
