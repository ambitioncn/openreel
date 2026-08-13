# OpenReel–LibTV parity terminal contract

Version: 3.0 · Effective: 2026-08-06 · Status: active, not complete

## Terminal outcome

Deliver an independently implemented, production-operable AI video workspace whose evidenced product surface is aligned with the current LibTV comparison target. A checkpoint or milestone is phase progress only. The project may be called complete only when all of the following are true at the same reviewed revision:

1. Every `required` item in `docs/libtv-parity-backlog.json` is `accepted` with linked, reproducible evidence.
2. `docs/project-acceptance-ledger.json` has `unmet=[]` and `blockers=[]`.
3. The matrix has no required row marked `partial`, `unknown`, `unverified` or `gated`.
4. Unit/integration tests, negative security tests, deterministic smokes, browser E2E, restart recovery, backup/restore and rollback checks pass from a clean start.
5. A human reviewer accepts the authenticated LibTV research snapshot and the staging/production evidence bundle.

No local test, mock adapter, deterministic fixture, milestone or comparison document can independently satisfy the terminal outcome.

## Acceptance domains

- Product: workflows/Agents, multimodal catalog, canvas nodes and controls, character/product/scene consistency, audio, timeline/export, templates/tutorials, collaboration/accounts, billing/usage and asset reuse.
- Quality: accessibility, browser compatibility, performance, recovery, concurrency, observability and supportability.
- Security: authentication, authorization, CSRF/SSRF/IDOR, tenant isolation, secret handling, abuse/rate controls, dependency review, backup/restore and incident rollback.
- Evidence: each claim identifies source class (`first-party-public`, `authenticated-observed`, `OpenReel-local`, `staging`, or `production`) and capture date.

## Required evidence per backlog item

Each accepted item must include: behavior and explicit non-goals; focused automated tests; negative/edge cases; a replayable smoke; persistence/restart evidence where stateful; security and tenant checks where exposed; and an evidence link in the ledger. Visual or media claims additionally require artifact probes and human-visible E2E evidence.

## Research freshness

Before final review, refresh first-party public evidence and perform an authenticated product walkthrough no older than 30 days. Unknown internals stay unknown; OpenReel must meet its own security and reliability criteria rather than infer them from LibTV.

## Human gates

Local reads, edits, fixtures, tests and unprivileged local services are allowed. The following always pause for explicit approval at the point of action: OTP submission; paid generation or subscription; public publishing; staging/production deployment; credential creation/change; external messages; destructive actions; and production instrumentation/process control. A phone number alone is not OTP authorization.

## Continuation rule

Execute `docs/libtv-parity-backlog.json` in dependency and priority order. An accepted checkpoint advances the project but does not end it; continue with the highest-priority ready item. When a gate is reached, record the exact requested action, cost/exposure, rollback and evidence expected, then wait.
