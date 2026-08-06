# Changelog

## Unreleased

- Switch new paid inference applications, reservations, and usage ledgers to USD at a fixed versioned rate of `1 USD = CNY 7.20`, displayed to four decimal places.
- Preserve historical CNY micro-unit records with explicit currency/scale metadata and prevent cross-currency settlement.

## v0.4.0 — 2026-08-06

Production Ark inference and canvas workflow release.

### Highlights

- Add server-side Volcengine Ark adapters for seven configured text, vision, image, video, and multimodal embedding models, with credentials isolated from clients.
- Connect approved `or_live_...` platform keys to quota reservation, immutable 1.5x pricing snapshots, trusted settlement, and per-user/per-model usage ledgers.
- Persist recoverable synchronous and asynchronous Ark jobs in SQLite with idempotency, crash recovery, bounded retries, sanitized provider errors, and tenant isolation.
- Bridge Ark canvas jobs into validated OpenReel assets and automatically append generated video results to the timeline for authenticated preview and export.
- Add migration `002`, production configuration examples, bounded paid smoke tooling, a real-new-user production E2E, and a rollback runbook.
- Harden provider downloads against SSRF and DNS rebinding, enforce MIME and byte limits, and keep paid inference fail-closed until explicitly enabled.

### Acceptance

- Pass 79 automated tests, secret scanning, deployment rehearsal, and the production new-user/Admin approval/Key Server/canvas/asset/timeline/preview/export workflow.
- Retain manual administrator entitlement and API-key issuance; automated payment collection and customer self-service top-ups remain out of scope.

## v0.3.0 — 2026-08-04

Manual API access approval and usage-control release.

### Highlights

- Add user-submitted API access applications with durable pending, approved, rejected, and stopped states.
- Add a dedicated administrator page for reviewing applications, assigning hard limits and expiries, rejecting requests, and stopping access.
- Issue one-time `or_live_...` platform keys only after approval; persist only hashes and safe prefixes.
- Preserve token reservation and settlement accounting, and suspend all active keys when limits are exhausted or access is stopped.
- Add schema v3-to-v4 migration, audit fields, protected administrator endpoints, and end-to-end negative tests.

### Scope

This release uses manual administrator approval while payment integration is unavailable. Provider credentials and real Volcengine inference remain separate follow-up work.

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
