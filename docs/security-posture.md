# Local security and storage posture

This build is explicitly non-production. Passwords use salted scrypt hashes and opaque local sessions; authorization is enforced by team membership and role. Tenant IDs scope workflow, ledger, object and database adapter operations.

Production blockers: TLS termination, secret/key rotation, secure cookies and CSRF defenses, session expiry/revocation, rate limiting, tamper-evident audit export, external identity verification, distributed transaction/locking, object-store encryption, disaster recovery testing, vulnerability review and a real billing provider.

Team invites are durable local records, not email messages. The local API supports invite revocation, member role changes and member removal with owner/admin boundaries and last-owner protection. It does not deliver or verify email, recover accounts, or operate an external identity provider; those require a separately reviewed production integration.

Collaboration presence is an authenticated, tenant-scoped, in-memory heartbeat with a 30-second TTL; it deliberately disappears on expiry or restart and is not an audit record. Collaborative documents are durable tenant-scoped records using optimistic versions. Editors, admins and owners may write only from the current version; stale writes fail with `VERSION_CONFLICT` and preserve the winning content. Viewers may read and publish presence but cannot edit documents. This is polling-oriented local behavior, not a claim of distributed real-time transport or automatic merge support.

Back up the core JSON file and its adjacent `.platform` file together while the server is stopped, verify checksums, and restore into an isolated directory before validation. Schema migrations must be versioned, copy-on-write, reversible, and tested against a backup; this repository does not claim an online production migration path.

`LocalObjectAdapter` and `LocalDatabaseAdapter` are safe local reference implementations, not distributed infrastructure. Threats considered include cross-tenant identifiers, replay, stale membership, brute-force login, stolen session tokens, ledger double settlement, corrupt backups and untrusted workflow documents.

## Qualification matrix

| Boundary | Threat or failure | Local control and evidence | Remaining production boundary |
| --- | --- | --- | --- |
| Identity and tenant scope | stolen/spoofed identity, IDOR, stale membership | production protected-route matrix, hashed expiring sessions, rotation/revocation, role and cross-tenant negatives | external identity verification and monitored abuse response |
| Web requests | CSRF, oversized or disguised uploads, unsafe filenames, brute force | CSRF cookies, bounded bodies, MIME sniffing, safe filenames, rate-limit and security-header tests | TLS edge and distributed rate limiting |
| Workflow and billing state | replay, concurrent writes, double settlement, ledger drift | idempotency keys, optimistic conflicts, atomic reservations, refunds and reconciliation tests | distributed locking and provider reconciliation |
| Availability | dependency failure and request bursts | `npm run qualify:reliability` proves 200 concurrent liveness responses plus fail-closed readiness and recovery | staged sustained load, latency SLOs and monitored chaos |
| Persistence and release rollback | restart, corruption, backup tampering, release artifact drift | production E2E restart plus checksum-verified isolated backup/restore; `npm run qualify:release-artifacts` hashes the 10 release/rollback inputs and proves tampering fails closed before activation; `docs/release-signing-review-plan.md` defines the unsigned design and independent review gate | execute an authorized signing ceremony, off-host retention test, scheduled restore drill and production rollback |
| Supply chain and secrets | committed credentials or high-severity dependency findings | `npm run scan:secrets` and `npm run scan:dependencies` | continuous scanning, review and incident handling |

These are local qualification results, not evidence about LibTV internals and not authorization to deploy. Rollback is rehearsed locally by preserving the source state, restoring a checksum-verified snapshot into an isolated directory, and validating it before any switch. The release manifest is intentionally generated and verified in a temporary directory; it neither signs nor publishes artifacts and never activates a deployment. A production rollback remains separately human-gated.

The signing plan is intentionally algorithm-neutral until an independent reviewer approves the key provider, custody model, rotation and revocation procedure. Its checklist requires author/reviewer separation and replayable evidence, but completing the document is not an independent review and is not signed/off-host artifact evidence.
