# Ark canvas production gate

The local implementation is not production acceptance. The following actions require a human-approved maintenance window and bounded paid-call budget.

## Preconditions

- Record the release commit and take a verified SQLite, asset, and platform backup.
- Operator supplies Ark credentials and endpoint IDs outside git; keep `OPENREEL_PAID_INFERENCE_ENABLED=false` during deployment and migration.
- Review the immutable price version and per-model maximum reservations against the approved spend ceiling.
- Run `npm test`, `npm run scan:secrets`, `npm run rehearse:deployment`, and an isolated backup restore.
- Confirm proxy request-size/timeouts, TLS, secure cookies, CSRF, rate limits, and `/readyz`.

## Human gates

1. Approve production deployment and database migration 002 with paid inference still disabled.
2. Approve credential installation/change.
3. Approve a named model, one-call maximum budget, zero retries, test-user identity, and time window.
4. Enable paid inference only for that window; disable it immediately after evidence capture.

## Restricted new-user E2E

1. Register a previously unused browser user and verify login/session rotation.
2. Submit API access; verify generation remains unavailable before Admin approval.
3. Admin approves the exact microcredit ceiling; user issues a one-time API key and enters it into the canvas tab.
4. Create a video node, select the approved Ark model, and submit one generation with a unique idempotency key.
5. Refresh during polling and confirm the durable Ark task and canvas Job recover without a second reservation/provider submission.
6. Confirm the settled ledger entry contains the correct user/key, model, pricing version, trusted usage, and cost within the reservation.
7. Confirm result bytes are copied into the tenant asset store, preview from the authenticated asset URL, and the clip appears in the timeline/export manifest.
8. Verify another user cannot read the project, Job, Ark task, asset manifest, bytes, usage, or export by guessed IDs.
9. Render/export the timeline and verify playable output in the browser.

Capture redacted request IDs, object IDs, ledger values, screenshots, export manifest, and backup/restore proof. Never capture API or provider keys.

## Rollback

- Set `OPENREEL_PAID_INFERENCE_ENABLED=false` first and restart through the approved process-control gate.
- Restore the previous application release. Migration 002 is additive and can remain; if data rollback is required, restore the verified pre-release database/assets/platform snapshot as one unit.
- Revoke only the bounded E2E API key if needed; credential revocation is a separate human gate.
- Verify `/livez`, `/readyz`, login, existing projects/assets, deterministic generation, timeline preview, and export after rollback.
