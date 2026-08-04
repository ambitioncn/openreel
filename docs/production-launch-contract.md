# OpenReel production launch completion contract

Version: 1.0 · 2026-08-04 · Status: completed

The v0.1.1 feature baseline remains preserved. Its earlier project ledger proves local product behavior only; it does not prove public-production readiness. Public launch may be called complete only when `production-acceptance-ledger.json` contains `unmet=[]` and `blockers=[]`, every item links replayable evidence, and the full test/security/deployment rehearsal is clean.

## Dependency-ordered acceptance backlog

1. **SEC-1 identity boundary:** every protected API derives its actor from an authenticated, expiring server-side session; spoofed identity headers have no effect; registration/login/logout/rotation use salted password hashes and hashed-at-rest tokens; cookie and bearer behavior has negative tests.
2. **SEC-2 web request boundary** (depends SEC-1): CSRF for cookie-authenticated mutations; Secure/HttpOnly/SameSite cookies; strict JSON/upload limits; schema validation; MIME sniffing and safe filenames; rate limits; CSP and security headers.
3. **DATA-1 production persistence** (depends SEC-1): versioned migrations on a production database; transactional tenant/object authorization, concurrency and IDOR negatives; crash/restart recovery; durable asset storage outside JSON with integrity and traversal tests.
4. **OPS-1 operability** (depends SEC-2, DATA-1): startup secret/config validation, sanitized structured audit logs, liveness/readiness, metrics/monitoring hooks, dependency and secret scans.
5. **OPS-2 recovery/deployment** (depends OPS-1): automated backup plus isolated restore drill; Linux systemd and Caddy artifacts; unprivileged local deployment rehearsal; rollback and openreel.io DNS/HTTPS runbook.
6. **E2E-1 launch proof** (depends all): clean full tests and security checks; concurrent/restart tests; browser and API journey from public registration through project creation and playable export; acceptance ledger has no unmet items or blockers.
7. **LIVE-1 production activation** (depends E2E-1): separately human-approved VPS access, credentials, DNS, deploy, HTTPS observation, monitoring observation and rollback readiness. No live action is authorized by this contract.

## Evidence rules

Each accepted item records commands, exit status, focused negative cases, and artifact paths. A checkpoint is progress only. Missing VPS/DNS access is not a reason to stop local work; it becomes the final concrete gate only after E2E-1 passes locally.
