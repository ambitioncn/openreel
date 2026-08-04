# SEC-1 and SEC-2 acceptance evidence

Date: 2026-08-04

## SEC-1 identity boundary

- `src/platform.js` stores salted scrypt password hashes and SHA-256 session-token digests, never plaintext tokens. Sessions expire, revoke on logout, and rotate by revoking the old token before issuing a new one.
- `server.mjs` authenticates every API route except registration and login in production mode. The authenticated account id is the only project actor; `X-OpenReel-User` is ignored.
- `test/http.test.js` enumerates all 44 protected route shapes and checks each with anonymous access, an invalid cookie, an invalid bearer token, and a spoofed identity header (132 negative requests). Valid bearer tests cover project ownership and cross-user job progress/tick/cancel denial.
- Cookie login, CSRF rejection, bearer CSRF exemption, logout, rotation, old-token rejection, and server-side expiry/hashed-at-rest behavior are replayable in `test/http.test.js` and `test/terminal.test.js`.

## SEC-2 request boundary

- Session and CSRF cookies use `Secure`, `HttpOnly`, `SameSite=Lax`, `Max-Age`, and `Expires`; mutation requests authenticated by cookie require a constant-time double-submit CSRF token.
- JSON bodies require `application/json`, a JSON object, and the configured byte limit (including declared and streamed sizes). Domain methods validate required fields, enumerations, numeric bounds, scopes, versions, and nested workflow/storyboard/timeline shapes.
- Binary bodies are bounded by media policy. PNG, JPEG, WebP, MP4, WebM, MP3, and WAV are identified by signatures; declared MIME mismatches and unsafe/missing/wrong-extension filenames are rejected.
- Production API requests use a fixed-window rate limit with injectable clock/key/max/window hooks for deterministic tests and return `429` plus `Retry-After`.
- All responses include CSP, nosniff, frame, referrer, permissions, cross-origin opener, and cross-origin resource policies.

## Replay

```sh
npm test
npm run smoke:http-negative
```

Observed: 43 tests passed, 0 failed; focused HTTP negative smoke passed with the expected structured `EMPTY_TIMELINE` response.
