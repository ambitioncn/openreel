import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { directorPerceptualUiRows, directorRuntimeUiState, directorRuntimeUiSummary } from "../src/director-runtime-ui.js";

test("director UI separates generation, qualification, release, gate, cost and retry state", () => {
  const quote = { id: "quote-1", cost: { estimatedCny: 12 } };
  const quoted = directorRuntimeUiState(quote, null);
  assert.equal(quoted.stage, "formal_generation");
  assert.equal(quoted.gate, "explicit_generation_confirmation_required");
  assert.equal(quoted.qualificationStatus, "not_qualified");
  assert.equal(quoted.releaseEligible, false);
  const running = directorRuntimeUiState(null, { id: "job-1", status: "running", attempts: 1, maxAttempts: 2, input: { cost: { estimatedCny: 12 } } });
  assert.equal(running.generationStatus, "running");
  assert.equal(running.gate, "director_quality_review_required");
  assert.match(directorRuntimeUiSummary(running), /质量 not_qualified.*发布资格 禁止.*重试 1\/2/);
});

test("director UI exposes persisted quote split and granular v2 quality failures", () => {
  const job = { status: "failed", attempts: 1, maxAttempts: 3, cost: { estimatedCny: 3, generationEstimatedCny: 2, evaluationEstimatedCny: 1 }, result: { qualificationStatus: "rejected", releaseEligible: false, quality: { shots: [{ shotId: "s1", creativeFailures: ["beat"], technicalFailures: [] }], final: { directorFailures: ["pacing"], technicalFailures: [] } } }, director: { stages: [] } };
  const state = directorRuntimeUiState(null, job), summary = directorRuntimeUiSummary(state);
  assert.deepEqual(state.cost, { estimatedCny: 3, generationEstimatedCny: 2, evaluationEstimatedCny: 1, paidActionExecuted: true });
  assert.deepEqual(state.failures, { shots: ["s1:beat"], final: ["pacing"] });
  assert.match(summary, /生成 ¥2\.00 \+ 评估 ¥1\.00/); assert.match(summary, /s1:beat,pacing/);
});

test("director UI names identity and performance with byte evidence and independent decisions", () => {
  const evidence = { assetId: "video-1", sha256: "a".repeat(64), observed: "visible movement and bound identity" };
  const job = { status: "failed", result: { qualificationStatus: "rejected", releaseEligible: false, quality: { shots: [{ shotId: "s1", creativeFailures: ["performance_naturalness"], technicalFailures: [], creativeChecks: [{ dimension: "visual_identity_consistency", score: 0.91, evidence }, { dimension: "performance_naturalness", score: 0.72, evidence }] }], final: {} } } };
  const rows = directorPerceptualUiRows(directorRuntimeUiState(null, job));
  assert.deepEqual(rows.map(row => [row.label, row.accepted]), [["镜头 s1 · 人物视觉身份一致性", true], ["镜头 s1 · 表演自然度", false]]);
  assert.match(rows[0].detail, /分数 0\.91 · 证据 video-1 · SHA-256 a{64}/);
});

test("real commercial workflow renders through the director status panel", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(html, /id="director-runtime-state"/);
  assert.match(html, /id="commercial-perceptual-evidence"/);
  assert.match(html, /人物视觉身份一致性 \/ 表演自然度/);
  assert.match(app, /directorRuntimeUiState\(commercialQuote, commercialJob\)/);
  assert.match(app, /directorPerceptualUiRows\(state\)/);
  assert.match(app, /renderDirectorRuntime\(\)/);
});
