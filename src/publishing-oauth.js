import { createCipheriv, createDecipheriv, createHash, randomBytes as secureRandomBytes, randomUUID } from "node:crypto";
import { DomainError } from "./core.js";

export const PUBLISHING_OAUTH_PROFILES = Object.freeze({
  tiktok: Object.freeze({ default: Object.freeze(["video.publish"]) }),
  douyin: Object.freeze({ default: Object.freeze(["video.create"]) }),
  instagram_reels: Object.freeze({
    instagram_login: Object.freeze(["instagram_business_basic", "instagram_business_content_publish"]),
    facebook_login: Object.freeze(["instagram_basic", "instagram_content_publish", "pages_read_engagement"])
  }),
  youtube_shorts: Object.freeze({ default: Object.freeze([
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly"
  ]) })
});

const clone = value => structuredClone(value);
const digest = value => createHash("sha256").update(value).digest("base64url");
const required = (value, field, max = 500) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new DomainError("PUBLISHING_OAUTH_INVALID", `${field} is required`, 422);
  return normalized;
};
const same = (left, right) => left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);

function profileFor(platform, profile = "default") {
  const profiles = PUBLISHING_OAUTH_PROFILES[platform];
  if (!profiles || !profiles[profile]) throw new DomainError("PUBLISHING_OAUTH_INVALID", "unsupported publishing OAuth profile", 422);
  return { profile, scopes: [...profiles[profile]] };
}

function publicBinding(binding) {
  const { tokenEnvelope, ...safe } = binding;
  return clone(safe);
}

export function createPublishingOAuth({
  masterKey,
  allowedRedirectUris = {},
  transports = {},
  seed = {},
  now = () => new Date().toISOString(),
  id = randomUUID,
  bytes = size => secureRandomBytes(size),
  stateTtlMs = 10 * 60 * 1000
} = {}) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new DomainError("PUBLISHING_OAUTH_CONFIG_INVALID", "a 32-byte publishing OAuth master key is required", 503);
  if (!Number.isInteger(stateTtlMs) || stateTtlMs < 60_000 || stateTtlMs > 30 * 60_000) throw new DomainError("PUBLISHING_OAUTH_CONFIG_INVALID", "state TTL must be between 1 and 30 minutes", 503);
  const pending = new Map((seed.pending || []).map(record => [record.stateDigest, clone(record)]));
  const bindings = new Map((seed.bindings || []).map(record => [record.id, clone(record)]));
  const refreshes = new Map();

  function encrypt(value, purpose) {
    const iv = bytes(12), cipher = createCipheriv("aes-256-gcm", masterKey, iv);
    cipher.setAAD(Buffer.from(purpose));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
  }

  function decrypt(envelope, purpose) {
    try {
      if (envelope?.version !== 1 || envelope?.algorithm !== "aes-256-gcm") throw new Error("unsupported envelope");
      const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(envelope.iv, "base64url"));
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]).toString("utf8"));
    } catch {
      throw new DomainError("PUBLISHING_CREDENTIAL_UNREADABLE", "publishing credential cannot be decrypted", 503);
    }
  }

  function redirectFor(platform, redirectUri) {
    const value = required(redirectUri, "redirectUri", 2_000);
    if (!(allowedRedirectUris[platform] || []).includes(value)) throw new DomainError("PUBLISHING_OAUTH_REDIRECT_REJECTED", "redirect URI is not allowlisted", 422);
    return value;
  }

  function owned(tenantId, bindingId, active = false) {
    const binding = bindings.get(required(bindingId, "bindingId"));
    if (!binding || binding.tenantId !== required(tenantId, "tenantId")) throw new DomainError("PUBLISHING_ACCOUNT_NOT_FOUND", "publishing account not found", 404);
    if (active && binding.status !== "active") throw new DomainError("PUBLISHING_ACCOUNT_DISCONNECTED", "publishing account is disconnected", 409);
    return binding;
  }

  function validateTokenResult(result, scopes) {
    if (!result || typeof result !== "object") throw new DomainError("PUBLISHING_OAUTH_EXCHANGE_FAILED", "platform returned an invalid OAuth result", 502);
    const accessToken = required(result.accessToken, "accessToken", 16_000);
    const grantedScopes = Array.isArray(result.scopes) ? result.scopes.map(scope => required(scope, "scope", 300)) : [];
    if (!same(grantedScopes, scopes)) throw new DomainError("PUBLISHING_OAUTH_SCOPE_MISMATCH", "platform grant does not match the minimum requested scopes", 409);
    const expiresAt = required(result.expiresAt, "expiresAt");
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(now())) throw new DomainError("PUBLISHING_OAUTH_EXCHANGE_FAILED", "platform returned an expired access token", 502);
    return { accessToken, refreshToken: result.refreshToken ? required(result.refreshToken, "refreshToken", 16_000) : null, scopes: grantedScopes, expiresAt };
  }

  return Object.freeze({
    begin(input = {}) {
      const tenantId = required(input.tenantId, "tenantId"), actorId = required(input.actorId, "actorId"), platform = required(input.platform, "platform"), selected = profileFor(platform, input.profile), redirectUri = redirectFor(platform, input.redirectUri);
      const returnPath = input.returnPath === undefined ? "/" : required(input.returnPath, "returnPath", 1_000);
      if (!returnPath.startsWith("/") || returnPath.startsWith("//") || returnPath.includes("\\")) throw new DomainError("PUBLISHING_OAUTH_INVALID", "returnPath must be a local absolute path", 422);
      const state = bytes(32).toString("base64url"), verifier = bytes(48).toString("base64url"), stateDigest = digest(state), issuedAt = now(), expiresAt = new Date(Date.parse(issuedAt) + stateTtlMs).toISOString();
      pending.set(stateDigest, { stateDigest, tenantId, actorId, platform, profile: selected.profile, scopes: selected.scopes, redirectUri, returnPath, verifierEnvelope: encrypt({ verifier }, `oauth-state:${stateDigest}`), issuedAt, expiresAt });
      return { state, codeChallenge: digest(verifier), codeChallengeMethod: "S256", platform, profile: selected.profile, scopes: selected.scopes, redirectUri, expiresAt };
    },

    async complete(input = {}) {
      const state = required(input.state, "state", 1_000), stateDigest = digest(state), record = pending.get(stateDigest);
      pending.delete(stateDigest);
      if (!record) throw new DomainError("PUBLISHING_OAUTH_STATE_INVALID", "OAuth state is invalid or already consumed", 409);
      if (Date.parse(record.expiresAt) <= Date.parse(now())) throw new DomainError("PUBLISHING_OAUTH_STATE_EXPIRED", "OAuth state has expired", 409);
      for (const field of ["tenantId", "actorId", "platform"]) if (required(input[field], field) !== record[field]) throw new DomainError("PUBLISHING_OAUTH_STATE_MISMATCH", "OAuth callback does not match the initiating context", 403);
      if (redirectFor(record.platform, input.redirectUri) !== record.redirectUri) throw new DomainError("PUBLISHING_OAUTH_STATE_MISMATCH", "OAuth callback redirect does not match", 403);
      const transport = transports[record.platform];
      if (!transport?.exchange) throw new DomainError("PUBLISHING_OAUTH_UNAVAILABLE", "platform OAuth exchange is unavailable", 503);
      const { verifier } = decrypt(record.verifierEnvelope, `oauth-state:${stateDigest}`);
      const result = await transport.exchange({ code: required(input.code, "code", 4_000), codeVerifier: verifier, redirectUri: record.redirectUri, scopes: [...record.scopes], profile: record.profile });
      const tokens = validateTokenResult(result, record.scopes), externalAccountId = required(result.account?.id, "account.id"), displayName = required(result.account?.displayName, "account.displayName"), existing = [...bindings.values()].find(binding => binding.tenantId === record.tenantId && binding.platform === record.platform && binding.profile === record.profile && binding.externalAccountId === externalAccountId), bindingId = existing?.id || id(), timestamp = now();
      const binding = { id: bindingId, tenantId: record.tenantId, platform: record.platform, profile: record.profile, externalAccountId, displayName, scopes: tokens.scopes, status: "active", tokenExpiresAt: tokens.expiresAt, tokenEnvelope: encrypt(tokens, `oauth-binding:${bindingId}`), createdAt: existing?.createdAt || timestamp, updatedAt: timestamp, disconnectedAt: null };
      bindings.set(binding.id, binding);
      return { binding: publicBinding(binding), returnPath: record.returnPath };
    },

    list(tenantId) {
      const owner = required(tenantId, "tenantId");
      return [...bindings.values()].filter(binding => binding.tenantId === owner).map(publicBinding);
    },

    async accessToken(tenantId, bindingId) {
      const binding = owned(tenantId, bindingId, true), tokens = decrypt(binding.tokenEnvelope, `oauth-binding:${binding.id}`);
      if (Date.parse(tokens.expiresAt) > Date.parse(now()) + 60_000) return tokens.accessToken;
      if (refreshes.has(binding.id)) return refreshes.get(binding.id);
      const operation = (async () => {
        const transport = transports[binding.platform];
        if (!tokens.refreshToken || !transport?.refresh) throw new DomainError("PUBLISHING_OAUTH_RECONNECT_REQUIRED", "publishing account must be reconnected", 409);
        const refreshed = validateTokenResult(await transport.refresh({ refreshToken: tokens.refreshToken, scopes: [...binding.scopes], profile: binding.profile }), binding.scopes);
        const latest = owned(tenantId, bindingId, true);
        latest.tokenEnvelope = encrypt({ ...refreshed, refreshToken: refreshed.refreshToken || tokens.refreshToken }, `oauth-binding:${latest.id}`);
        latest.tokenExpiresAt = refreshed.expiresAt; latest.updatedAt = now();
        return refreshed.accessToken;
      })().finally(() => refreshes.delete(binding.id));
      refreshes.set(binding.id, operation);
      return operation;
    },

    async disconnect(tenantId, bindingId) {
      const binding = owned(tenantId, bindingId, true), tokens = decrypt(binding.tokenEnvelope, `oauth-binding:${binding.id}`), transport = transports[binding.platform];
      let revocation = "unsupported";
      if (transport?.revoke) {
        try { await transport.revoke({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, profile: binding.profile }); revocation = "succeeded"; }
        catch { revocation = "failed"; }
      }
      delete binding.tokenEnvelope; binding.status = "disconnected"; binding.tokenExpiresAt = null; binding.disconnectedAt = now(); binding.updatedAt = binding.disconnectedAt;
      return { binding: publicBinding(binding), revocation };
    },

    snapshot() {
      return clone({ schema: "openreel-publishing-oauth/v1", pending: [...pending.values()], bindings: [...bindings.values()] });
    }
  });
}
