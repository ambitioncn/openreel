# E-01 bounded authorization packet

Status: prepared, not authorized. The machine-readable source is `e01-authorization-packet.json`; its `authorized` field is false and required human inputs are deliberately null.

## Requested first phase

This packet requests approval for staging-only verification with no public traffic and exactly eight provider submissions: two `embedding-vision` calls, four `seedream-5-lite` continuity images, and two `seedance-2-fast` short videos. Using the immutable `volcengine-2026-08-06-usd-7.20-markup-1.5` reservation ceilings, the maximum aggregate reservation is 30,558 units at 10,000 units per USD, or **USD 3.0558**.

The arithmetic is `2 × 2,778 + 4 × 2,778 + 2 × 6,945 = 30,558`. Each case receives one unique idempotency key. Automatic provider retry is disabled. A provider error, timeout, untrusted usage result, capability mismatch, ledger mismatch, per-call ceiling breach, or aggregate ceiling breach stops the run before another submission.

Audio is excluded because OpenReel currently has no reviewed real audio endpoint with an immutable positive price. This packet cannot close A-01 or E-01 by itself. Adding audio requires a new model mapping, price review, tests, and a successor human authorization packet; it must not reuse this budget.

Before such a successor packet can be proposed, candidate non-sensitive metadata must pass `src/audio-provider-admission.js` and its independent provider, price, data-handling and output-license review. Passing admission still returns `executable: false` and does not authorize configuration or spend.

## Human decision required before execution

The operator must provide and explicitly approve all of the following in a successor gate response:

- the exact private staging base URL and confirmation that no production/public traffic will be switched;
- a non-secret reference to the short-lived credential source, without copying the credential into task artifacts;
- the three account-specific provider endpoint IDs for `embedding-vision`, `seedream-5-lite`, and `seedance-2-fast`;
- the exact eight-call matrix and USD 3.0558 aggregate ceiling;
- permission to deploy only to that staging target, use the referenced credential, and make only those paid calls;
- an approver identity, timestamp, and unambiguous approval statement.

Missing, partial, or ambiguous input means stop before configuration, deployment, credential access, or provider submission. Approval of this packet does not authorize production deployment, public publishing, subscription changes, credential creation/rotation, signing, production process control, or E-02.

## Preconditions and evidence

Immediately before any authorized run, record the source revision, catalog fingerprint, pricing version, cleanly reviewed configuration diff, passing tests, dependency/secret scans, readiness, tenant-isolation checks, backup verification, and rollback preflight. Evidence must retain request case IDs, redacted input metadata, terminal states, bounded usage, ledger entries, artifact metadata and checksums, browser observations, and failures without credentials or expiring provider URLs.

After the last permitted call—or any stop condition—disable further paid submissions, reconcile all reservations, and produce a checkpoint that distinguishes passed cases, failed cases, unexecuted cases and remaining gaps. Credential revocation, service shutdown, traffic changes, or other process/credential mutations require their separately approved cleanup authority.
