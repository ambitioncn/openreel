import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "./core.js";
import { createPublishingOAuth } from "./publishing-oauth.js";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly"
];
const required = (value, name, max = 8_000) => { const result = typeof value === "string" ? value.trim() : ""; if (!result || result.length > max) throw new DomainError("PUBLISHING_OAUTH_CONFIG_INVALID", `${name} is required`, 503); return result; };
const parse = async response => { let body = {}; try { body = await response.json(); } catch {} if (!response.ok) throw new DomainError("PUBLISHING_OAUTH_PROVIDER_FAILED", "Google OAuth request failed", response.status); return body; };

export function createGooglePublishingOAuth({ clientId, clientSecret, redirectUri, masterKey, stateFile, request = fetch } = {}) {
  clientId = required(clientId, "Google OAuth client id"); clientSecret = required(clientSecret, "Google OAuth client secret"); redirectUri = required(redirectUri, "Google OAuth redirect URI"); stateFile = required(stateFile, "publishing OAuth state file");
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new DomainError("PUBLISHING_OAUTH_CONFIG_INVALID", "publishing OAuth master key must be 32 bytes", 503);
  let seed = {};
  try { seed = JSON.parse(readFileSync(stateFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw new DomainError("PUBLISHING_OAUTH_STORE_CORRUPT", "publishing OAuth state is unreadable", 500); }
  const transport = {
    async exchange({ code, codeVerifier }) {
      const tokens = await parse(await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: codeVerifier, grant_type: "authorization_code", redirect_uri: redirectUri }) }));
      const account = await parse(await request("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", { headers: { authorization: `Bearer ${tokens.access_token}` } })), channels = account.items;
      if (!Array.isArray(channels) || channels.length !== 1) throw new DomainError("YOUTUBE_CHANNEL_INELIGIBLE", "Google identity must resolve to one YouTube channel", 422);
      return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scopes: String(tokens.scope || "").split(/\s+/).filter(Boolean), expiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString(), account: { id: channels[0].id, displayName: channels[0].snippet?.title } };
    },
    async refresh({ refreshToken }) { const tokens = await parse(await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) })); return { accessToken: tokens.access_token, scopes: String(tokens.scope || SCOPES.join(" ")).split(/\s+/).filter(Boolean), expiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString() }; },
    async revoke({ accessToken, refreshToken }) { const response = await request("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken || accessToken }) }); if (!response.ok) throw new Error("Google token revocation failed"); }
  };
  const oauth = createPublishingOAuth({ masterKey, allowedRedirectUris: { youtube_shorts: [redirectUri] }, transports: { youtube_shorts: transport }, seed });
  const persist = () => { mkdirSync(dirname(stateFile), { recursive: true, mode: 0o750 }); const temp = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`; writeFileSync(temp, `${JSON.stringify(oauth.snapshot())}\n`, { flag: "wx", mode: 0o640 }); const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, stateFile); };
  persist();
  return Object.freeze({
    begin(input) { const value = oauth.begin({ ...input, platform: "youtube_shorts", redirectUri }); persist(); const url = new URL("https://accounts.google.com/o/oauth2/v2/auth"); for (const [name, item] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: value.scopes.join(" "), state: value.state, code_challenge: value.codeChallenge, code_challenge_method: value.codeChallengeMethod, access_type: "offline", prompt: "consent" })) url.searchParams.set(name, item); return { authorizationUrl: url.toString(), expiresAt: value.expiresAt, scopes: value.scopes }; },
    async complete(input) { const value = await oauth.complete({ ...input, platform: "youtube_shorts", redirectUri }); persist(); return value; },
    async disconnect(input) { const value = await oauth.disconnect(input.tenantId, input.bindingId); persist(); return value; },
    accessToken(tenantId, bindingId) { return oauth.accessToken(tenantId, bindingId); },
    accounts(input) { return oauth.list(input.tenantId).map(binding => ({ platform: binding.platform, status: binding.status === "active" ? "connected" : "disconnected", accountId: binding.id, displayName: binding.displayName, canPublish: binding.status === "active", privacyOptions: ["private", "unlisted", "public"], audienceRequired: true, interactions: {} })); }
  });
}
