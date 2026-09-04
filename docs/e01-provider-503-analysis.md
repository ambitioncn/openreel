# E-01 provider 503 analysis

Status: zero-call analysis after the accepted cp59 diagnostic. No provider retry is authorized or performed.

## Observed boundary

- The corrected `seedream-5-lite` request reached the provider boundary and returned sanitized upstream HTTP 503 in approximately 100 ms.
- The standard-key base is HTTPS `ark.cn-beijing.volces.com/api/v3`; the direct-key base is HTTPS `ark.cn-beijing.volces.com/api/plan/v3`. DNS returned a public address and TLS validation passed from the Beijing host after the owner-managed resolver repair.
- The configured Seedream value is present and has the shape of an official model ID. Its value and all credential values are intentionally omitted.
- Staging and production remained ready. The failed reservation and usage settled at zero, temporary access was stopped, and paid inference was disabled.

## Evidence-based classification

The current official Volcengine Ark error table distinguishes authorization and activation failures from service availability:

- service not activated or operation denied: HTTP 403;
- model/endpoint absent, inaccessible, or model-ID access disabled: HTTP 404;
- exhausted quota or overload: HTTP 429;
- service unavailable/server busy: HTTP 503.

Sources consulted 2026-08-13:

- [Volcengine Ark error codes](https://www.volcengine.com/docs/82379/1299023)
- [Volcengine model list](https://www.volcengine.com/docs/82379/1330310)
- [Volcengine Seedream image-generation API](https://docs.volcengine.com/docs/6492/2172373)

The observed 503 therefore supports a transient provider service/capacity condition more strongly than an invalid key, missing activation, or nonexistent model. A later zero-cost read-only query returned the expected `404 ResourceNotFound` for standard key + `/api/v3` and direct key + `/api/plan/v3`, proving both credentials authenticate and the Beijing network reaches Ark. An earlier direct-key `401` is invalid diagnostic evidence because that probe incorrectly sent the direct key to `/api/v3`. It does not prove the exact cause of the historical generation failures because OpenReel deliberately does not retain the upstream response body.

## Local hardening

OpenReel now classifies allowlisted upstream retry statuses, including 503, as `retryable: true` while leaving automatic retries controlled by the existing zero-retry gate. When the provider supplies `x-request-id`, `request-id`, or `x-tt-logid`, OpenReel retains only the first 16 hexadecimal characters of its SHA-256 digest. The raw request ID and response body are never exposed or persisted. This enables a future authorized support correlation without weakening the sanitized error boundary.

OpenReel now keeps standard and direct route bases separate in configuration. `OPENREEL_VOLCENGINE_BASE_URL` defaults to `/api/v3`; `OPENREEL_VOLCENGINE_DIRECT_BASE_URL` defaults to `/api/plan/v3`. Direct model mappings cannot silently inherit the standard base.

## Next safe action

No new provider call is authorized by this correction. A later evidence-backed generation attempt still requires a new packet with an exact call count, zero automatic retries, budget ceiling and cleanup rules; console login is not a prerequisite merely to establish credential authentication or Beijing reachability.
