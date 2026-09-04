# Production analytics and provider fallback

OpenReel exposes bounded Prometheus metrics for the registration → login → project-created → export-ready funnel, HTTP failures and latency, feedback ratings by fixed category, publishing operations, and generation outcomes/cost/latency by provider and primary/fallback route. User ids, comments, prompts, URLs, job ids and error messages are never metric labels.

Feedback is accepted at authenticated `POST /api/v1/feedback` with a fixed category, integer rating 1–5 and optional 1000-character comment. Production persists the protected state at `OPENREEL_FEEDBACK_STATE` or beside the main database with mode `0600`.

## Dashboard panels

- Funnel conversion: `sum(openreel_product_funnel_total{outcome="success"}) by (stage)`
- HTTP failure rate: `sum(rate(openreel_http_requests_total{status_class=~"4xx|5xx"}[5m])) / sum(rate(openreel_http_requests_total[5m]))`
- Feedback volume/rating: `sum(openreel_product_feedback_total) by (category,rating)`
- Generation failure rate: `sum(rate(openreel_generation_operations_total{outcome!="succeeded"}[15m])) by (provider) / sum(rate(openreel_generation_operations_total[15m])) by (provider)`
- Mean generation latency: `sum(rate(openreel_generation_latency_milliseconds_sum[15m])) by (provider,route) / sum(rate(openreel_generation_operations_total[15m])) by (provider,route)`
- Generation cost: `sum(increase(openreel_generation_cost_micros_total[1d])) by (provider,route)`

## Fallback policy

The default route remains primary until at least 20 representative samples exist. Fallback is selected when failure rate is at least 20% or p95 latency is at least 120 seconds, then held for a five-minute cooldown to prevent flapping. A fallback must preserve tenant, model capability, budget and safety constraints; it must fail closed if no equivalent provider is configured. Promotion or permanent routing changes require a reviewed observation window, not a single incident.

No post-launch feature is prioritized until a representative usage window records funnel drop-off, failure rate, feedback themes, generation cost and latency. Empty or synthetic metrics establish instrumentation only, not a product decision.
