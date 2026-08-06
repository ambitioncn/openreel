# API key and usage billing

OpenReel issues its own `or_live_...` platform keys. Provider credentials such as
`ARK_API_KEY` remain on the server and are never disclosed to customers.

## Entitlement flow

1. A signed-in user submits an API access application with a reason and requested limit.
2. An administrator approves it with an explicit hard limit and expiry, or rejects it.
3. Only an account with approved, active, unexpired access can create an API key.
4. The full key is returned once. OpenReel persists only its SHA-256 digest and prefix.
5. A request reserves its maximum possible cost before any paid provider call.
6. Provider-reported input/output tokens are settled against an immutable pricing
   snapshot in integer micro-units.
7. A request that would exceed the hard limit is rejected before execution.
8. When settled spend reaches the hard limit, every active key for the account is
   suspended immediately.
9. An administrator can stop approved access at any time, immediately suspending keys.

Reservations and settlements require idempotency keys/IDs so retries do not charge
twice. Failed provider calls settle at zero cost. A settlement cannot exceed the
reserved maximum.

## Server-side Ark inference

`POST /api/v1/inference/jobs` accepts an `or_live_...` key in
`X-OpenReel-API-Key` (or a Bearer header), plus a provider-neutral body containing
`model`, `capability`, `input`, and `idempotencyKey`. Poll asynchronous work with
`GET /api/v1/inference/jobs/:id` and download a completed result with
`GET /api/v1/inference/jobs/:id/asset`. Jobs are scoped to their creating API key.
Job ownership, idempotency keys, reservations, provider task IDs, poll state,
settlement recovery data, and results are stored in the production SQLite database.
Submit, poll, and settlement replay safely after a process restart. The legacy
client-directed `POST /api/v1/teams/:id/budget/settle` route is disabled; Ark
settlement is server-controlled.

The service reserves the configured maximum before calling Ark, settles only token
counts in a successful Ark response, and releases the full reservation on provider
or terminal task failure. These routes never accept client-supplied usage or prices.

## Production price policy

The built-in Volcengine presets use the official Ark model price page
<https://www.volcengine.com/docs/82379/1544106?lang=zh>, verified 2026-08-06,
and pricing version `volcengine-2026-08-01-markup-1.5`. Costs are converted to
integer CNY micro-units and multiplied by 1.5. Seed 2.1 Pro sells at CNY 9/45
per million input/output tokens and Turbo at CNY 4.5/22.5. Seedream 5 Lite/Pro
sell at CNY 0.33/0.45 per image. Seedance 2 Fast/standard use CNY 55.5/69 per
million output tokens, and Embedding Vision uses CNY 2.7 per million input
tokens. For request-dependent provider tiers, the highest official cost is used
until the provider returns a trustworthy per-tier usage breakdown.

Paid mode fails closed during startup if a configured model has no positive price
and maximum reservation. Price changes require a new immutable pricing version,
source review, tests, and deployment; existing jobs retain their rate snapshot.

Ark is disabled unless `ARK_ENABLED=true`. `ARK_API_KEY` is read only at server
startup and used only in provider Authorization headers. It is never included in
models, jobs, errors, or logs. There are deliberately no built-in account endpoint
IDs: `ARK_MODELS_JSON` must explicitly map each public model name to the account's
`providerModel`, HTTPS `endpoint`, maximum cost, and immutable rates.

The production presets load seven operator-supplied endpoint IDs: Seedance 2 Fast,
Seedance 2, Seedream 5 Lite, Seedream 5 Pro, Seed 2.1 Turbo, Seed 2.1 Pro, and
Embedding Vision. Merely configuring those IDs does not authorize spend:
`OPENREEL_PAID_INFERENCE_ENABLED` defaults to false, and submit returns
`PAID_INFERENCE_GATED` before reservation or provider traffic until an operator
approves a bounded verification budget and explicitly enables the switch.

`ARK_ALLOWED_HOSTS` is a comma-separated allowlist for endpoints and result assets.
The schema supports `text` (Doubao Seed planning), `vision` (Seed Vision), `image`
(Seedream), `video` (Seedance), and `audio`. Audio is advertised only when an
actually available endpoint is configured. Async mappings additionally set
`asynchronous: true` and `pollEndpoint`; asset mappings set `resultMimeTypes`.
IP literals, localhost, `.local`, non-HTTPS URLs, redirects, MIME mismatches, and
oversized assets are rejected. Before every request, DNS is resolved twice; private,
loopback, link-local, mixed, empty, or changing answers are rejected, and the TLS
connection is pinned to the validated public address to prevent rebinding. Provider
calls use bounded exponential backoff, cap `Retry-After`, and share a 30-second total
attempt-and-delay budget. Only transient transport, 429, and 5xx failures retry.

## User endpoints

- `POST /api/v1/api-keys` — create a key (paid session required)
- `GET /api/v1/api-keys` — list prefixes and status; secrets are never returned
- `DELETE /api/v1/api-keys/:id` — revoke a key
- `GET /api/v1/billing/usage` — subscription, spend, reservations and usage ledger
- `GET /api/v1/key/status` — authenticate a platform key and return remaining limit
- `POST /api/v1/key-applications` — submit one pending application per account
- `GET /api/v1/key-applications` — view the signed-in user's application history
- `GET /api/v1/admin/key-applications?status=pending` — administrator review queue
- `POST /api/v1/admin/key-applications/:id/approve` — approve with limit and expiry
- `POST /api/v1/admin/key-applications/:id/reject` — reject with an audit note
- `POST /api/v1/admin/key-applications/:id/stop` — stop access and suspend active keys

Browser mutations require the existing CSRF protection. Administrative application
endpoints require `X-OpenReel-Admin-Key`. The `/admin.html` page keeps that secret
in memory for the current tab only; it never places it in a URL or browser storage.
`OPENREEL_ADMIN_KEY` must be a distinct production secret.

## Production boundary

The application, manual entitlement, key lifecycle, metering, reservation and
hard-stop core is implemented without a payment provider. The optional Ark service
connects inference to trusted server-side `settleUsage`; it stays disabled until an
operator supplies verified account endpoint mappings and credentials. Clients must
never be allowed to submit their own token counts or prices.
