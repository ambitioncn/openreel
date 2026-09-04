const DEFAULT_POLICY = Object.freeze({ minimumSamples: 20, failureRateThreshold: 0.2, p95LatencyMsThreshold: 120000, cooldownMs: 300000 });

export function decideProviderRoute({ primary, fallback, samples, now = Date.now(), lastFallbackAt = 0, policy = {} }) {
  const effective = { ...DEFAULT_POLICY, ...policy }, count = Number(samples?.count || 0), failures = Number(samples?.failures || 0), p95LatencyMs = Number(samples?.p95LatencyMs || 0);
  if (!primary || !fallback || primary === fallback) throw new Error("distinct primary and fallback providers are required");
  if (count < effective.minimumSamples) return { provider: primary, fallback: false, reason: "insufficient_samples" };
  if (Number(now) - Number(lastFallbackAt) < effective.cooldownMs) return { provider: fallback, fallback: true, reason: "cooldown_active" };
  if (failures / count >= effective.failureRateThreshold) return { provider: fallback, fallback: true, reason: "failure_rate" };
  if (p95LatencyMs >= effective.p95LatencyMsThreshold) return { provider: fallback, fallback: true, reason: "latency_p95" };
  return { provider: primary, fallback: false, reason: "healthy" };
}

export { DEFAULT_POLICY as PROVIDER_FALLBACK_POLICY };
