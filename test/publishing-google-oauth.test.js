import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGooglePublishingOAuth } from "../src/publishing-google-oauth.js";

test("Google publishing OAuth emits the exact minimum-scope PKCE URL and persists no plaintext tokens", () => {
  const root = mkdtempSync(join(tmpdir(), "openreel-google-oauth-")), stateFile = join(root, "oauth.json"), oauth = createGooglePublishingOAuth({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "https://openreel.example:4173/api/v1/publishing/oauth/youtube_shorts/callback", masterKey: Buffer.alloc(32, 7), stateFile, request: async () => { throw new Error("external request not expected"); } });
  const value = oauth.begin({ tenantId: "tenant-1", actorId: "owner-1", returnPath: "/" }), url = new URL(value.authorizationUrl);
  assert.equal(url.origin, "https://accounts.google.com"); assert.deepEqual(url.searchParams.get("scope").split(" "), ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.doesNotMatch(readFileSync(stateFile, "utf8"), /client-secret|access_token|refresh_token/);
});

test("Google publishing OAuth rejects incomplete production configuration", () => {
  assert.throws(() => createGooglePublishingOAuth({}), error => error.code === "PUBLISHING_OAUTH_CONFIG_INVALID");
});
