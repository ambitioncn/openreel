import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { DomainError } from "./core.js";

const PLATFORMS = new Set(["tiktok", "douyin", "instagram_reels", "youtube_shorts"]);
const BLOCKED_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^224\./, /^2(?:[4-9]\d|5[0-5])\./];

function fail(code, message, status = 400, details) { throw new DomainError(code, message, status, details); }
function safeEqual(left, right) { const a = Buffer.from(String(left || "")), b = Buffer.from(String(right || "")); return a.length === b.length && timingSafeEqual(a, b); }
function blockedAddress(address) {
  if (isIP(address) === 4) return BLOCKED_V4.some(pattern => pattern.test(address));
  if (isIP(address) === 6) { const value = address.toLowerCase().split("%", 1)[0]; return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("ff") || value.startsWith("::ffff:"); }
  return true;
}

export async function validatePublishingCallbackUrl(value, { resolve = async () => [] } = {}) {
  let url; try { url = new URL(value); } catch { fail("PUBLISHING_CALLBACK_URL_REJECTED", "callback URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) fail("PUBLISHING_CALLBACK_URL_REJECTED", "callback URL must be canonical HTTPS");
  if (url.hostname === "localhost" || isIP(url.hostname) && blockedAddress(url.hostname)) fail("PUBLISHING_CALLBACK_SSRF_REJECTED", "callback URL resolves to a non-public address");
  const first = await resolve(url.hostname), second = await resolve(url.hostname);
  if (!Array.isArray(first) || !first.length || !Array.isArray(second) || !second.length) fail("PUBLISHING_CALLBACK_DNS_REJECTED", "callback hostname must resolve");
  const normalize = records => records.map(item => typeof item === "string" ? item : item.address).sort();
  const a = normalize(first), b = normalize(second);
  if (a.some(blockedAddress) || b.some(blockedAddress)) fail("PUBLISHING_CALLBACK_SSRF_REJECTED", "callback hostname resolves to a non-public address");
  if (JSON.stringify(a) !== JSON.stringify(b)) fail("PUBLISHING_CALLBACK_REBINDING_REJECTED", "callback hostname changed during admission");
  return Object.freeze({ url: url.toString(), addresses: Object.freeze(a) });
}

export function createPublishingWebhookIngress({ secrets = () => null, now = Date.now, toleranceMs = 5 * 60_000, replayTtlMs = 24 * 60 * 60_000, rate = { max: 120, windowMs: 60_000 } } = {}) {
  const events = new Map(), limits = new Map();
  return ({ tenantId, accountId, platform, eventId, timestamp, signature, rawBody }) => {
    if (![tenantId, accountId, eventId].every(value => typeof value === "string" && value.length > 0 && value.length <= 200) || !PLATFORMS.has(platform) || !Buffer.isBuffer(rawBody)) fail("PUBLISHING_WEBHOOK_INVALID", "webhook envelope is invalid");
    const time = Number(timestamp), current = Number(now());
    if (!Number.isFinite(time) || Math.abs(current - time) > toleranceMs) fail("PUBLISHING_WEBHOOK_STALE", "webhook timestamp is outside the accepted window", 401);
    const key = `${tenantId}:${accountId}:${platform}`, old = limits.get(key), entry = !old || current - old.startedAt >= rate.windowMs ? { startedAt: current, count: 0 } : old;
    entry.count += 1; limits.set(key, entry);
    if (entry.count > rate.max) fail("PUBLISHING_WEBHOOK_RATE_LIMITED", "webhook rate limit exceeded", 429, { retryAfterSeconds: Math.max(1, Math.ceil((rate.windowMs - (current - entry.startedAt)) / 1000)) });
    const secret = secrets({ tenantId, accountId, platform });
    if (!Buffer.isBuffer(secret) || secret.length < 32) fail("PUBLISHING_WEBHOOK_UNAVAILABLE", "webhook secret is unavailable", 503);
    const expected = createHmac("sha256", secret).update(`${timestamp}.${eventId}.`).update(rawBody).digest("hex");
    if (!safeEqual(signature, expected)) fail("PUBLISHING_WEBHOOK_SIGNATURE_REJECTED", "webhook signature is invalid", 401);
    for (const [id, expiresAt] of events) if (expiresAt <= current) events.delete(id);
    const replayKey = `${key}:${eventId}`;
    if (events.has(replayKey)) fail("PUBLISHING_WEBHOOK_REPLAY_REJECTED", "webhook event was already accepted", 409);
    events.set(replayKey, current + replayTtlMs);
    return Object.freeze({ schema: "openreel-publishing-webhook/v1", tenantId, accountId, platform, eventId, accepted: true });
  };
}
