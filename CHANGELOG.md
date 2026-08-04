# Changelog

## v0.2.0 — 2026-08-04

First public multi-user production baseline, deployed at [openreel.io](https://openreel.io).

### Highlights

- Bind every protected API route to an authenticated, expiring server-side session; ignore spoofable identity headers and enforce tenant/object authorization.
- Add salted password hashing, hashed-at-rest session tokens, secure cookies, CSRF protection, rate limits, request bounds, MIME sniffing, and browser security headers.
- Replace the production JSON store with versioned SQLite migrations, WAL durability, optimistic concurrency, and atomic content-addressed asset storage.
- Add structured redacted audit logs, liveness/readiness checks, bounded Prometheus metrics, dependency and secret scans, and production configuration validation.
- Add systemd, Nginx/Caddy, automated backup, isolated restore, rollback, deployment rehearsal, production E2E, and live smoke tooling.
- Add anonymous registration/sign-in UI and authenticated reload/session recovery.
- Complete production acceptance with 54 automated tests plus public registration-to-playable-MP4 verification.

### Scope

This release is a secure single-VPS production baseline. It does not claim high availability, distributed storage, paid-model output quality, or one-to-one parity with private LibTV functionality.

## v0.1.1 — 2026-08-04

- License OpenReel under the GNU Affero General Public License v3.0 only.
- Document the network-source obligation in the README and package metadata.

## v0.1.0 — 2026-08-04

First public local-product baseline of OpenReel.

### Highlights

- Persistent infinite canvas with nodes, edges, groups, progress, and result history.
- Local-first project, asset, storyboard, generation, timeline, and export workflows.
- Deterministic H.264/AAC MP4 preview rendering through FFmpeg.
- Versioned `/api/v1` agent API and an `openreel` CLI.
- Schema-driven model capabilities and provider-neutral generation adapters.
- Workflow import, generation history, asset reuse, budget enforcement, local auth, teams, roles, and tenant isolation.
- 38 automated tests plus HTTP, CLI, render, workflow, budget, auth, tenant, and import smoke coverage.

### Scope

This release is a complete local product baseline. It does not claim production SaaS readiness, paid-model output quality, cloud deployment security, or one-to-one parity with private LibTV functionality.
