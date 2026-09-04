import test from "node:test";
import assert from "node:assert/strict";
import { createH3CreativeSpec, normalizeH3CreativeSpec, compileH3ModelPrompt, compileH3PrimitivePrompt, getH3Primitive, createH3PrimitiveQualificationPlan, createH3CoverageMatrix, createH3CapabilityMatrix, createH3CommercialQualificationProtocol, createH3EvidenceRecord, getH3CommercialScenario, H3_CAMERA_ACTIONS, H3_COMMERCIAL_SCENARIOS } from "../src/prompt-director-v2.js";

test("Prompt Director v2 compiles editable H3 creative_spec into compact model_prompt", () => {
  const creative = createH3CreativeSpec({ shot: { prompt: "premium ceramic cup on a walnut table" }, directorShot: { style: "warm soft studio light" }, objectOnly: true });
  const result = compileH3ModelPrompt(creative);
  assert.equal(creative.duration_seconds, 5);
  assert.deepEqual(creative.action_beats.map(beat => [beat.start, beat.end]), [[0, 1], [1, 4], [4, 5]]);
  assert.equal(creative.camera.move, "locked");
  assert.equal(result.adapter, "minimax-h3-image-to-video/v2");
  for (const marker of ["FIRST FRAME:", "ACTION BEATS:", "SUBJECT MOTION:", "CAMERA (locked, one dominant move):", "AMBIENT:", "CONTINUITY:", "END:", "AVOID:"]) assert.match(result.model_prompt, new RegExp(marker.replace(/[()]/g, "\\$&")));
  assert.ok(result.model_prompt.length < 4_000);
});

test("Prompt Director v2 fails closed on overlapping beats and unsupported camera moves", () => {
  const base = createH3CreativeSpec({ shot: { prompt: "product" }, directorShot: { style: "neutral" }, objectOnly: true });
  assert.throws(() => normalizeH3CreativeSpec({ ...base, action_beats: [{ start: 0, end: 3, action: "a" }, { start: 2, end: 5, action: "b" }] }), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
  assert.throws(() => normalizeH3CreativeSpec({ ...base, camera: { ...base.camera, move: "pan_left_and_orbit_right" } }), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
});

test("H3 primitive qualification expands a deterministic multi-scene multi-seed matrix", () => {
  const plan = createH3PrimitiveQualificationPlan({ sceneIds: ["rigid-product", "soft-package"], seeds: [17, 29], primitiveNames: ["static_hold", "micro_turn"], hardLimitCny: 100, estimatedCallCny: 5 });
  assert.equal(plan.cases.length, 8);
  assert.deepEqual(plan.cases[0], { sceneId: "rigid-product", seed: 17, primitive: "static_hold" });
  assert.equal(plan.budget.estimatedTotalCny, 40);
  assert.match(plan.promotionRule, /every scene and seed/);
  assert.equal(getH3Primitive("dolly_in").cameraMove, "dolly_in");
});

test("H3 primitive qualification fails closed on weak evidence, unknown primitives, and budget overflow", () => {
  assert.throws(() => createH3PrimitiveQualificationPlan({ sceneIds: ["one"], seeds: [1, 2] }), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
  assert.throws(() => createH3PrimitiveQualificationPlan({ sceneIds: ["one", "two"], seeds: [1, 2], primitiveNames: ["spin"] }), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
  assert.throws(() => createH3PrimitiveQualificationPlan({ sceneIds: ["one", "two"], seeds: [1, 2], primitiveNames: ["static_hold", "micro_turn"], hardLimitCny: 10, estimatedCallCny: 2 }), error => error.code === "PROMPT_DIRECTOR_V2_BUDGET_EXCEEDED");
});

test("H3 primitive compiler emits the qualified short-action shape", () => {
  const creative = createH3CreativeSpec({ shot: { prompt: "premium cup" }, directorShot: { style: "studio" }, objectOnly: true });
  const result = compileH3PrimitivePrompt(creative, "micro_turn");
  assert.equal(result.primitive, "micro_turn");
  assert.equal(result.adapter, "minimax-h3-image-to-video/primitive-v1");
  assert.match(result.model_prompt, /ONE ACTION:/);
  assert.match(result.model_prompt, /END ANCHOR:/);
  assert.match(result.model_prompt, /LOCK:/);
  assert.ok(result.model_prompt.length < compileH3ModelPrompt(creative).model_prompt.length);
  assert.throws(() => compileH3PrimitivePrompt(creative, "spin"), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
});

test("commercial coverage matrix exhaustively crosses every supported scenario and camera action", () => {
  const matrix = createH3CoverageMatrix();
  assert.equal(matrix.cases.length, H3_CAMERA_ACTIONS.length * H3_COMMERCIAL_SCENARIOS.length);
  assert.equal(new Set(matrix.cases.map(item => `${item.commercialScenario}:${item.cameraAction}`)).size, matrix.cases.length);
  for (const cameraAction of H3_CAMERA_ACTIONS) {
    const primitive = getH3Primitive(cameraAction === "locked" ? "static_hold" : cameraAction);
    assert.equal(primitive.cameraMove, cameraAction);
  }
  for (const commercialScenario of H3_COMMERCIAL_SCENARIOS) assert.equal(getH3CommercialScenario(commercialScenario).id, commercialScenario);
});

test("every commercial scenario and camera action compiles into a bounded H3 prompt", () => {
  for (const commercialScenario of H3_COMMERCIAL_SCENARIOS) for (const cameraAction of H3_CAMERA_ACTIONS) {
    const creative = createH3CreativeSpec({ shot: { prompt: "reviewed commercial subject" }, directorShot: { style: "controlled studio", commercialScenario, cameraAction }, objectOnly: !["lifestyle_use", "testimonial", "fashion_beauty"].includes(commercialScenario) });
    const result = compileH3PrimitivePrompt(creative, cameraAction === "locked" ? "static_hold" : cameraAction);
    assert.equal(result.creative_spec.camera.move, cameraAction);
    assert.match(result.creative_spec.scene, new RegExp(`COMMERCIAL SCENARIO \\(${commercialScenario}\\)`));
    assert.ok(result.model_prompt.length < 2_000);
  }
});

test("unknown commercial scenarios and camera actions fail closed", () => {
  assert.throws(() => getH3CommercialScenario("anything"), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
  assert.throws(() => createH3CreativeSpec({ shot: { prompt: "product" }, directorShot: { style: "studio", commercialScenario: "anything" } }), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
  assert.throws(() => createH3CreativeSpec({ shot: { prompt: "product" }, directorShot: { style: "studio", cameraAction: "spin" } }), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
});

test("project capability matrix gives all 144 combinations deterministic boundaries", () => {
  const matrix = createH3CapabilityMatrix();
  assert.equal(matrix.cases.length, 144);
  assert.equal(new Set(matrix.cases.map(item => item.id)).size, 144);
  assert.ok(matrix.cases.every(item => item.productionEligible === false && item.qualificationStatus === "unqualified"));
  assert.ok(matrix.cases.some(item => item.applicability === "conditional_pending_real_h3" && item.riskTags.length));
});

test("commercial qualification protocol covers every action and scenario with three seeds", () => {
  const protocol = createH3CommercialQualificationProtocol({ estimatedCallCny: 1 });
  for (const value of H3_CAMERA_ACTIONS) assert.equal(new Set(protocol.cases.filter(item => item.cameraAction === value).map(item => item.seed)).size >= 3, true);
  for (const value of H3_COMMERCIAL_SCENARIOS) assert.equal(new Set(protocol.cases.filter(item => item.commercialScenario === value).map(item => item.seed)).size >= 3, true);
  assert.ok(protocol.criticalPairs.length >= 10);
  assert.equal(protocol.budget.hardLimitCnyPerAction, 100);
  assert.throws(() => createH3CommercialQualificationProtocol({ seeds: [1, 2] }), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
  assert.throws(() => createH3CommercialQualificationProtocol({ estimatedCallCny: 101 }), error => error.code === "PROMPT_DIRECTOR_V2_BUDGET_EXCEEDED");
});

test("qualification evidence record fails closed on incomplete hashes and overspend", () => {
  const digest = "a".repeat(64);
  const record = createH3EvidenceRecord({ caseId: "product_hero:locked:seed-37", seed: 37, prompt: "p", firstFrame: "f.png", video: "v.mp4", parameters: { width: 960 }, sha256: { prompt: digest, firstFrame: digest, video: digest }, actionReservationId: "paid:h3:1", costCny: 2, qualificationVerdict: "pending_review" });
  assert.equal(record.costCny, 2);
  assert.throws(() => createH3EvidenceRecord({ ...record, costCny: 101 }), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
  assert.throws(() => createH3EvidenceRecord({ ...record, sha256: { ...record.sha256, video: "bad" } }), error => error.code === "PROMPT_DIRECTOR_V2_INVALID");
});
