# E-01 first-submission failure analysis

Status: local diagnosis only; no provider retry is authorized or performed.

The cp56 `seedream-5-lite` request used `size: 1920x1080` (2,073,600 pixels). The current official Volcengine Seedream image-generation reference states that Seedream 5.0 Lite custom dimensions must contain at least `2560x1440` pixels (3,686,400 pixels), with aspect ratio between 1:16 and 16:1. The submitted dimensions were therefore outside the documented input contract.

Evidence: [Volcengine image-generation reference](https://docs.volcengine.com/docs/6492/2172373), consulted 2026-08-13. The reference also lists `2K` and `3K` presets and a default of `2048x2048`.

The local runner now uses `2560x1440`. The Ark adapter rejects unsupported Seedream 5 dimensions with `ARK_INPUT_INVALID` before reserving usage or contacting the provider. This is the leading root cause, but it is not terminal proof because retained cp56 evidence intentionally omitted the provider response body and the current Ironman identity cannot access the remote journal. Endpoint mapping, entitlement, and account state remain secondary possibilities.

Any real retry requires a fresh bounded human gate. A successor gate should authorize exactly one zero-retry diagnostic image submission, retain only sanitized upstream status and result shape, and stop on any provider, usage, ledger, budget, or asset-validation error.

## Corrected-size diagnostic outcome

The separately authorized diagnostic submitted exactly one `2560x1440` request with zero retries. It reached the provider boundary but failed with sanitized upstream HTTP 503. The reservation and usage entry settled failed at zero cost, temporary access was revoked/stopped, paid inference was disabled, and both staging and production remained ready. This disproves the smaller request size as the sole cause of provider success failure; provider availability, account entitlement, endpoint routing, or another server-side condition remains unresolved. No further submission is authorized.
