import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMetrics } from "../src/ops.js";
import { createProductFeedbackStore } from "../src/product-analytics.js";
import { decideProviderRoute } from "../src/provider-fallback.js";

test("product feedback is validated, persisted and summarized without metric-cardinality leaks", () => {
  const file = join(mkdtempSync(join(tmpdir(), "openreel-feedback-")), "feedback.json"), store = createProductFeedbackStore({ file, id: () => "feedback-1", now: () => "2026-09-04T00:00:00Z" });
  assert.deepEqual(store.record("account-1", { category: "generation", rating: 4, comment: "Useful" }), { id: "feedback-1", category: "generation", rating: 4, createdAt: "2026-09-04T00:00:00Z" });
  assert.equal(JSON.parse(readFileSync(file, "utf8")).feedback.length, 1);
  assert.deepEqual(store.summary().categories.generation, { count: 1, averageRating: 4 });
  assert.throws(() => store.record("account-1", { category: "secret-token", rating: 6 }), error => error.code === "INVALID_FEEDBACK");
});

test("operational metrics expose funnel, feedback, latency, cost and fallback dimensions", () => {
  const metrics = createMetrics(); metrics.begin(); metrics.end(200, 37); metrics.funnel("registration", "success"); metrics.feedback("generation", 4); metrics.generation("primary", "succeeded", { latencyMs: 1234, costMicros: 45, fallback: false });
  const rendered = metrics.render(true);
  for (const fragment of ["openreel_product_funnel_total", "stage=\"registration\"", "openreel_product_feedback_total", "rating=\"4\"", "openreel_generation_latency_milliseconds_sum", "1234", "openreel_generation_cost_micros_total", "45"]) assert.match(rendered, new RegExp(fragment));
});

test("provider fallback requires evidence, has bounded triggers and honors cooldown", () => {
  const base = { primary: "ark", fallback: "modelclaw", now: 1_000_000 };
  assert.equal(decideProviderRoute({ ...base, samples: { count: 5, failures: 5, p95LatencyMs: 200000 } }).reason, "insufficient_samples");
  assert.deepEqual(decideProviderRoute({ ...base, samples: { count: 20, failures: 5, p95LatencyMs: 1000 } }), { provider: "modelclaw", fallback: true, reason: "failure_rate" });
  assert.equal(decideProviderRoute({ ...base, samples: { count: 20, failures: 0, p95LatencyMs: 130000 } }).reason, "latency_p95");
  assert.equal(decideProviderRoute({ ...base, lastFallbackAt: 900000, samples: { count: 20, failures: 0, p95LatencyMs: 1000 } }).reason, "cooldown_active");
});
