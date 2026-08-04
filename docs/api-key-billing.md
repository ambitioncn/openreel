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
hard-stop core is implemented without a payment provider. Before paid inference, connect the
server-side Volcengine adapter so only trusted server code can call `settleUsage`.
Clients must never be allowed to submit their own token counts or prices.
