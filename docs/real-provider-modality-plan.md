# Real-provider modality verification plan

Status: prepared, not authorized. This plan does not grant permission to deploy, use credentials, subscribe, or make paid calls.

The historical phase-one request is `e01-authorization-packet.json`. Its authority is consumed and must not be replayed. Previously accepted image, video and audio results are reconciled in `m01-existing-real-provider-evidence-reconciliation-20260818.json`.

The current narrow request is `m01-vision-two-call-authorization-packet.json` with its human-readable companion. It is intentionally `authorized: false` and permits no execution until the exact owner gate is consumed. It covers only one image-to-text and one video-to-text call through `embedding-vision`, zero retries, USD 0.5556 maximum reservation and a CNY 4 owner ceiling.

## Human gate

Before execution, the operator must explicitly approve the target environment, provider/model allowlist, credential source, per-modality call count, and a total monetary ceiling. The runner must stop before its first provider submission if any value is absent. Credentials and provider output URLs must not enter checkpoints or logs.

## Bounded matrix

| Modality | Required path | Minimum evidence |
| --- | --- | --- |
| vision | image-to-text and video-to-text | accepted input metadata, terminal state, bounded usage, redacted result shape |
| image | text-to-image with optional ordered references | schema validation, terminal asset metadata, provenance, billed usage |
| video | text/image/audio-to-video as supported | duration/audio constraints, terminal asset metadata, provenance, billed usage |
| audio | text-to-audio | voice/audio schema constraints, terminal asset metadata, billed usage |

Each approved call uses a unique idempotency key and is polled to a bounded terminal deadline. A failure, timeout, cost-ceiling breach, capability mismatch, or unapproved redirect stops that modality; it is recorded as a gap, never retried automatically.

## Preconditions and cleanup

1. Run the credential-free catalog, capability coverage, authorization, tenant-isolation, and billing tests.
2. Confirm the approved models appear in the versioned catalog and that the catalog fingerprint is recorded.
3. Use a dedicated short-lived test account and allowance. Do not alter production credentials.
4. Revoke the test key and stop its allowance after the run, then reconcile attempted calls with the usage ledger.

The existing `scripts/paid-model-smoke.mjs` is a one-call vision harness only; it must not be treated as multi-modality coverage or run without a fresh human gate. Additional modality cases belong in the same bounded pattern after model-specific schemas are reviewed.
