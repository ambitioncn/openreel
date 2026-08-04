# OpenReel production operations

This is local, replayable OPS-1/OPS-2 evidence. It does not authorize a VPS deployment, DNS changes, credential access, or a production-complete claim.

## Startup and observability

Production startup requires every value in `deploy/openreel.env.example`, absolute and distinct state paths, a loopback bind, a valid port, and a non-placeholder secret of at least 32 characters. Invalid input exits before opening storage or listening. Generate the real secret on the target host, store the environment file as root-readable only, and never commit it.

The service emits one-line JSON request, security/audit and startup events. Each request accepts a syntactically constrained `X-Request-ID` or creates a UUID, returns it in the response, and logs it. Authorization, cookie, CSRF, password, session, secret and token fields plus bearer values are redacted. `/health/live` proves only that the HTTP process runs. `/health/ready` checks SQLite integrity and asset-root safety. `/metrics` has only fixed status-class, active-request and readiness series—no tenant, route, user, token, or request-ID labels. Caddy denies external access to readiness and metrics; scrape them over loopback.

Replay scans with `npm run scan:dependencies` and `npm run scan:secrets`. The dependency scan uses the committed lockfile and fails on high/critical advisories; its advisory result depends on npm registry availability and must be captured at release time. The repository scan is fully local, covers tracked and unignored files, and fails on private-key blocks, credential assignments and common provider token prefixes.

## Backup and isolated restore

Create immutable, timestamped destinations on a separately mounted backup volume:

```sh
node scripts/backup.mjs create /var/lib/openreel/openreel.sqlite /var/lib/openreel/assets /var/lib/openreel/platform.json /mnt/openreel-backups/2026-08-04T120000Z
node scripts/backup.mjs verify /mnt/openreel-backups/2026-08-04T120000Z /var/tmp/openreel-restore-drill
```

SQLite's online backup API produces one database snapshot. Asset objects are immutable and written before their metadata transaction; the script then copies exactly the asset keys referenced by that snapshot, plus the authentication store, and writes SHA-256/length metadata. Verification refuses an existing restore directory, validates every file before copying, runs SQLite `quick_check`, and never points at live paths. Install and enable `deploy/openreel-backup.service` plus `deploy/openreel-backup.timer`; its wrapper creates a unique UTC destination daily as the `openreel` user. Alert on unit failure, retain at least seven daily and four weekly copies, and run `verify` into a fresh isolated directory weekly. Copy completed backup directories off-host using an operator-approved facility; no such external copy was performed here.

## Install, rehearsal, rollout and rollback

Install a pinned Node 22 release and Caddy from their signed OS repositories. Create the locked `openreel` system user, `/opt/openreel/releases/<version>` owned by root, `/var/lib/openreel` owned by `openreel`, and `/etc/openreel/openreel.env` mode `0600`. Validate locally before activation:

```sh
node --test test/ops.test.js
npm run scan:dependencies
npm run scan:secrets
npm run rehearse:deployment
systemd-analyze security deploy/openreel.service
caddy validate --config deploy/Caddyfile --adapter caddyfile
```

The rehearsal is deliberately unprivileged, creates isolated production-like absolute paths, starts the real `server.mjs` with `NODE_ENV=production`, waits for dependency readiness on a random loopback port, and terminates only its own child. For an approved rollout, copy a release to a new immutable directory, point `/opt/openreel/current` at it, run migrations by starting against a restored rehearsal copy first, then restart the unit and check loopback liveness/readiness before Caddy traffic.

Rollback: stop the unit; preserve current logs and state; repoint `current` to the previous application release. If no migration or data write occurred, restart and verify. If data changed or the prior release cannot read the schema, keep the service stopped, restore the last pre-rollout verified database, assets and platform store together into new empty paths, update the environment file to those paths, start, verify readiness and a read-only user journey, then re-enable proxy traffic. Never mix database, asset, and platform files from different backup manifests.

## DNS and HTTPS runbook (human-gated)

No DNS or public validation is performed locally. After E2E-1 and separate LIVE-1 approval: inventory current records and TTLs; lower TTL in advance; create `A`/`AAAA` records for `openreel.io` and `www.openreel.io` only after confirming the VPS addresses and IPv6 reachability; ensure inbound TCP 80/443 reaches Caddy while port 4173 remains loopback-only. Validate authoritative and public resolver answers with `dig +trace`, `dig A`, and `dig AAAA`.

Run `caddy validate`, start Caddy, and confirm automatic ACME issuance in its journal. From an external network validate hostname/SAN, trusted chain, expiry, TLS 1.2/1.3, HTTP-to-HTTPS redirect, HSTS, application security headers, registration/login, and that `/metrics` and `/health/ready` return 404. Use `curl --resolve` before DNS cutover where possible. Monitor certificate renewal and HTTP 5xx/readiness alerts. On failure, restore prior DNS records and TTLs, stop routing to the failed release, and execute the rollback above.
