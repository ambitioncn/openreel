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

The separate local credit-product contract in `src/credit-products.js` represents
evidenced general/model-specific point packages, membership eligibility, bonuses,
validity and periodic purchase limits. It is quote-only: every result is
non-executable, reports payment disconnected and requires a human gate. It does
not create an order, grant points or alter this usage ledger.

Local administrative refunds apply only to settled usage, require an idempotency
key and audit reason, and cannot exceed the remaining settled amount. The billing
status includes account-scoped refunds and a read-only reconciliation result that
compares recorded subscription totals with reservation, settlement and refund
records. Drift is reported but never repaired automatically. This is ledger logic,
not a connected payment-provider refund.

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
and pricing version `volcengine-2026-08-06-usd-7.20-markup-1.5`. Official CNY
costs are multiplied by 1.5 and converted at the fixed versioned rate
`1 USD = CNY 7.20`. New balances and ledger entries use integer USD units where
`10,000 units = USD 1.0000`; user interfaces always show USD with four decimal
places. Historical CNY micro-unit entries remain labeled `CNY / 1,000,000` and
are never silently reinterpreted or mixed with USD reservations. For
request-dependent provider tiers, the highest official cost is used
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

The verified mixed-route production contract and provider-neutral request examples
are documented in `docs/model-provider-routing.md`. In particular, commercial
short-video orchestration uses `OPENREEL_VOLCENGINE_ROUTE_PREFERENCE=hybrid`:
Seedream, text and vision use the standard `/api/v3` mapping, while Seedance uses
the direct `/api/plan/v3` mapping. Do not route Seedream through `/api/plan/v3` or
replace this with a blanket `direct` preference.

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
- `GET /api/v1/billing/usage` — account-scoped subscription, keys, reservation states,
  settled usage, refunds, reconciliation state, and an explicit
  `paymentIntegration.connected=false` boundary
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

`src/billing-evidence.js` validates a read-only `GET /api/v1/billing/usage` snapshot
before it is retained as local acceptance evidence. It checks account and
subscription scope, recalculates reserved/settled/refunded/spent totals, requires a
clean reconciliation result, rejects secret-bearing fields, and requires
`paymentIntegration.connected=false`. Passing this validator demonstrates internal
ledger consistency only; it does not connect a payment provider, verify an external
invoice or authorize a refund, charge, subscription, or provider call.
