# Local security and storage posture

This build is explicitly non-production. Passwords use salted scrypt hashes and opaque local sessions; authorization is enforced by team membership and role. Tenant IDs scope workflow, ledger, object and database adapter operations.

Production blockers: TLS termination, secret/key rotation, secure cookies and CSRF defenses, session expiry/revocation, rate limiting, tamper-evident audit export, external identity verification, distributed transaction/locking, object-store encryption, disaster recovery testing, vulnerability review and a real billing provider.

Back up the core JSON file and its adjacent `.platform` file together while the server is stopped, verify checksums, and restore into an isolated directory before validation. Schema migrations must be versioned, copy-on-write, reversible, and tested against a backup; this repository does not claim an online production migration path.

`LocalObjectAdapter` and `LocalDatabaseAdapter` are safe local reference implementations, not distributed infrastructure. Threats considered include cross-tenant identifiers, replay, stale membership, brute-force login, stolen session tokens, ledger double settlement, corrupt backups and untrusted workflow documents.
