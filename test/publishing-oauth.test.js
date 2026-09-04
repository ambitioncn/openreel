import test from "node:test";
import assert from "node:assert/strict";
import { createPublishingOAuth } from "../src/publishing-oauth.js";

const key = Buffer.alloc(32, 7);
const redirects = { tiktok: ["https://openreel.example/oauth/tiktok"], douyin: ["https://openreel.example/oauth/douyin"] };
const future = "2026-08-21T01:00:00.000Z";
const request = { tenantId: "tenant-a", actorId: "owner-a", platform: "tiktok", redirectUri: redirects.tiktok[0], returnPath: "/publish" };

function fixture(overrides = {}) {
  let instant = "2026-08-20T23:00:00.000Z", exchanges = 0, refreshes = 0, revokes = 0;
  const transport = {
    exchange: async input => { exchanges += 1; assert.ok(input.codeVerifier); return { accessToken: "access-one", refreshToken: "refresh-one", expiresAt: future, scopes: ["video.publish"], account: { id: "creator-1", displayName: "Creator" } }; },
    refresh: async () => { refreshes += 1; return { accessToken: "access-two", refreshToken: "refresh-two", expiresAt: "2026-08-21T02:00:00.000Z", scopes: ["video.publish"] }; },
    revoke: async () => { revokes += 1; }
  };
  const oauth = createPublishingOAuth({ masterKey: key, allowedRedirectUris: redirects, transports: { tiktok: transport }, now: () => instant, id: () => "binding-1", ...overrides });
  return { oauth, setNow: value => { instant = value; }, counts: () => ({ exchanges, refreshes, revokes }), transport };
}

test("single-use state and PKCE bind a minimum-scope account without exposing tokens", async () => {
  const { oauth, counts } = fixture(), started = oauth.begin(request);
  assert.equal(started.codeChallengeMethod, "S256"); assert.deepEqual(started.scopes, ["video.publish"]); assert.equal("codeVerifier" in started, false);
  const completed = await oauth.complete({ ...request, state: started.state, code: "authorization-code" });
  assert.equal(completed.binding.status, "active"); assert.equal(completed.returnPath, "/publish"); assert.doesNotMatch(JSON.stringify(completed), /access-one|refresh-one/);
  assert.equal(counts().exchanges, 1);
  await assert.rejects(() => oauth.complete({ ...request, state: started.state, code: "again" }), error => error.code === "PUBLISHING_OAUTH_STATE_INVALID");
  assert.equal(counts().exchanges, 1);
});

test("callback mismatch, expiry and unsafe redirects fail before exchange", async () => {
  const contextMismatch = fixture(), first = contextMismatch.oauth.begin(request);
  await assert.rejects(() => contextMismatch.oauth.complete({ ...request, tenantId: "tenant-b", state: first.state, code: "code" }), error => error.code === "PUBLISHING_OAUTH_STATE_MISMATCH");
  assert.equal(contextMismatch.counts().exchanges, 0);
  const expired = fixture(), second = expired.oauth.begin(request); expired.setNow("2026-08-20T23:11:00.000Z");
  await assert.rejects(() => expired.oauth.complete({ ...request, state: second.state, code: "code" }), error => error.code === "PUBLISHING_OAUTH_STATE_EXPIRED");
  assert.equal(expired.counts().exchanges, 0);
  assert.throws(() => fixture().oauth.begin({ ...request, redirectUri: "https://attacker.example/callback" }), error => error.code === "PUBLISHING_OAUTH_REDIRECT_REJECTED");
  assert.throws(() => fixture().oauth.begin({ ...request, returnPath: "//attacker.example" }), error => error.code === "PUBLISHING_OAUTH_INVALID");
});

test("encrypted snapshots restart safely and enforce tenant isolation", async () => {
  const first = fixture(), started = first.oauth.begin(request); await first.oauth.complete({ ...request, state: started.state, code: "code" });
  const snapshot = first.oauth.snapshot(), serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /access-one|refresh-one|authorization-code/); assert.match(serialized, /aes-256-gcm/);
  const restarted = fixture({ seed: snapshot }).oauth;
  assert.equal(restarted.list("tenant-a")[0].externalAccountId, "creator-1");
  await assert.rejects(() => restarted.accessToken("tenant-b", "binding-1"), error => error.code === "PUBLISHING_ACCOUNT_NOT_FOUND");
  assert.equal(await restarted.accessToken("tenant-a", "binding-1"), "access-one");
});

test("refresh is single-flight and preserves minimum scopes", async () => {
  const state = fixture(), started = state.oauth.begin(request); await state.oauth.complete({ ...request, state: started.state, code: "code" }); state.setNow("2026-08-21T00:59:30.000Z");
  const [left, right] = await Promise.all([state.oauth.accessToken("tenant-a", "binding-1"), state.oauth.accessToken("tenant-a", "binding-1")]);
  assert.deepEqual([left, right], ["access-two", "access-two"]); assert.equal(state.counts().refreshes, 1);
});

test("scope escalation fails closed and consumes the state", async () => {
  let calls = 0;
  const oauth = createPublishingOAuth({ masterKey: key, allowedRedirectUris: redirects, transports: { tiktok: { exchange: async () => { calls += 1; return { accessToken: "a", refreshToken: "r", expiresAt: future, scopes: ["video.publish", "user.info.basic"], account: { id: "x", displayName: "X" } }; } } } });
  const started = oauth.begin(request);
  await assert.rejects(() => oauth.complete({ ...request, state: started.state, code: "code" }), error => error.code === "PUBLISHING_OAUTH_SCOPE_MISMATCH");
  await assert.rejects(() => oauth.complete({ ...request, state: started.state, code: "code" }), error => error.code === "PUBLISHING_OAUTH_STATE_INVALID");
  assert.equal(calls, 1);
});

test("reconnect reuses the binding and disconnect removes usable credentials even when revoke fails", async () => {
  const state = fixture(), first = state.oauth.begin(request); await state.oauth.complete({ ...request, state: first.state, code: "first" });
  const second = state.oauth.begin(request), reconnected = await state.oauth.complete({ ...request, state: second.state, code: "second" }); assert.equal(reconnected.binding.id, "binding-1");
  state.transport.revoke = async () => { throw new Error("provider unavailable with private detail"); };
  const disconnected = await state.oauth.disconnect("tenant-a", "binding-1");
  assert.equal(disconnected.revocation, "failed"); assert.equal(disconnected.binding.status, "disconnected"); assert.doesNotMatch(JSON.stringify(disconnected), /private detail|access-one|refresh-one/);
  await assert.rejects(() => state.oauth.accessToken("tenant-a", "binding-1"), error => error.code === "PUBLISHING_ACCOUNT_DISCONNECTED");
  assert.doesNotMatch(JSON.stringify(state.oauth.snapshot()), /access-one|refresh-one/);
});
