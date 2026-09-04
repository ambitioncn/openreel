import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTikTokPublishingOAuth } from "../src/publishing-tiktok-oauth.js";

test("TikTok publishing OAuth emits minimum-scope PKCE and persists no plaintext credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-tiktok-oauth-")), stateFile = join(root, "oauth.json"), oauth = createTikTokPublishingOAuth({ clientKey: "client-key", clientSecret: "client-secret", redirectUri: "https://openreel.example:4173/api/v1/publishing/oauth/tiktok/callback", masterKey: Buffer.alloc(32, 8), stateFile, request: async () => { throw new Error("external request not expected"); } });
  const value = oauth.begin({ tenantId: "tenant-1", actorId: "owner-1", returnPath: "/" }), url = new URL(value.authorizationUrl);
  assert.equal(url.origin, "https://www.tiktok.com"); assert.equal(url.searchParams.get("scope"), "video.publish"); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.doesNotMatch(readFileSync(stateFile, "utf8"), /client-secret|access_token|refresh_token/);
});

test("TikTok publishing OAuth exchanges through official endpoints and exposes no token", async () => {
  const calls = [], response = body => ({ ok: true, status: 200, json: async () => body }), root = mkdtempSync(join(tmpdir(), "openreel-tiktok-oauth-complete-"));
  const oauth = createTikTokPublishingOAuth({ clientKey: "client-key", clientSecret: "client-secret", redirectUri: "https://openreel.example/callback", masterKey: Buffer.alloc(32, 9), stateFile: join(root, "oauth.json"), request: async (url, options) => { calls.push([url, options]); return url.endsWith("/oauth/token/") ? response({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "video.publish", open_id: "creator-1" }) : response({ data: { creator_nickname: "Creator" }, error: { code: "ok" } }); } });
  const started = oauth.begin({ tenantId: "tenant-1", actorId: "owner-1", returnPath: "/" }), state = new URL(started.authorizationUrl).searchParams.get("state"), completed = await oauth.complete({ tenantId: "tenant-1", actorId: "owner-1", state, code: "code" });
  assert.equal(completed.binding.displayName, "Creator"); assert.equal("tokenEnvelope" in completed.binding, false); assert.equal(calls.length, 2);
});
