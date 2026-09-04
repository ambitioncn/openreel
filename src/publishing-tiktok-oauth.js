import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "./core.js";
import { createPublishingOAuth } from "./publishing-oauth.js";

const required = (value, name, max = 8_000) => { const result = typeof value === "string" ? value.trim() : ""; if (!result || result.length > max) throw new DomainError("PUBLISHING_OAUTH_CONFIG_INVALID", `${name} is required`, 503); return result; };
const parse = async response => { let body = {}; try { body = await response.json(); } catch {} const providerError = typeof body.error === "string" ? body.error : body.error?.code; if (!response.ok || providerError && providerError !== "ok") throw new DomainError("PUBLISHING_OAUTH_PROVIDER_FAILED", "TikTok OAuth request failed", response.status); return body; };

export function createTikTokPublishingOAuth({ clientKey, clientSecret, redirectUri, masterKey, stateFile, request = fetch } = {}) {
  clientKey = required(clientKey, "TikTok client key"); clientSecret = required(clientSecret, "TikTok client secret"); redirectUri = required(redirectUri, "TikTok redirect URI"); stateFile = required(stateFile, "TikTok OAuth state file");
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new DomainError("PUBLISHING_OAUTH_CONFIG_INVALID", "publishing OAuth master key must be 32 bytes", 503);
  let seed = {}; try { seed = JSON.parse(readFileSync(stateFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw new DomainError("PUBLISHING_OAUTH_STORE_CORRUPT", "TikTok OAuth state is unreadable", 500); }
  const tokenRequest = async body => parse(await request("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }));
  const transport = {
    async exchange({ code, codeVerifier }) { const tokens = await tokenRequest({ client_key: clientKey, client_secret: clientSecret, code, code_verifier: codeVerifier, grant_type: "authorization_code", redirect_uri: redirectUri }); const creator = await parse(await request("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json; charset=UTF-8" }, body: "{}" })); return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scopes: String(tokens.scope || "").split(",").map(value => value.trim()).filter(Boolean), expiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString(), account: { id: tokens.open_id, displayName: creator.data?.creator_nickname || "TikTok Creator" } }; },
    async refresh({ refreshToken }) { const tokens = await tokenRequest({ client_key: clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }); return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, scopes: String(tokens.scope || "video.publish").split(",").map(value => value.trim()).filter(Boolean), expiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString() }; },
    async revoke({ accessToken }) { const response = await request("https://open.tiktokapis.com/v2/oauth/revoke/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_key: clientKey, token: accessToken }) }); if (!response.ok) throw new Error("TikTok token revocation failed"); }
  };
  const oauth = createPublishingOAuth({ masterKey, allowedRedirectUris: { tiktok: [redirectUri] }, transports: { tiktok: transport }, seed });
  const persist = () => { mkdirSync(dirname(stateFile), { recursive: true, mode: 0o750 }); const temp = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`; writeFileSync(temp, `${JSON.stringify(oauth.snapshot())}\n`, { flag: "wx", mode: 0o640 }); const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, stateFile); };
  persist();
  return Object.freeze({
    begin(input) { const value = oauth.begin({ ...input, platform: "tiktok", redirectUri }); persist(); const url = new URL("https://www.tiktok.com/v2/auth/authorize/"); for (const [name, item] of Object.entries({ client_key: clientKey, redirect_uri: redirectUri, response_type: "code", scope: value.scopes.join(","), state: value.state, code_challenge: value.codeChallenge, code_challenge_method: value.codeChallengeMethod })) url.searchParams.set(name, item); return { authorizationUrl: url.toString(), expiresAt: value.expiresAt, scopes: value.scopes }; },
    async complete(input) { const value = await oauth.complete({ ...input, platform: "tiktok", redirectUri }); persist(); return value; },
    async disconnect(input) { const value = await oauth.disconnect(input.tenantId, input.bindingId); persist(); return value; },
    accessToken(tenantId, bindingId) { return oauth.accessToken(tenantId, bindingId); },
    accounts(input) { return oauth.list(input.tenantId).map(binding => ({ platform: binding.platform, status: binding.status === "active" ? "connected" : "disconnected", accountId: binding.id, displayName: binding.displayName, canPublish: binding.status === "active", privacyOptions: ["SELF_ONLY"], interactions: { comment: true, duet: true, stitch: true } })); }
  });
}
