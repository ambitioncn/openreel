# OpenReel–LibTV parity terminal contract

Version: 4.0 · Effective: 2026-08-21 · Status: completed and human-accepted 2026-08-31

The 2026-08-20 terminal acceptance is superseded. It covered the earlier parity contract but did not prove the production beginner-workbench product requested on 2026-08-21. In particular, deterministic/local generation, separately exercised provider modules, and an older retained MP4 do not prove a newly created work, real text planning, browser-driven full generation, or strict current-version binding. `docs/project-acceptance-ledger.json` is the authoritative current status and must remain `in_progress` until every v4 item is accepted at one reviewed revision.

Release-policy amendment (2026-08-19): the owner explicitly waived `S01-OFFLINE-SIGN` as a required acceptance item for the frozen 139-file release candidate identified by manifest SHA-256 `457e793a7d73fc2dba2daad2f93850e0a670e6a1c2aa598e4626f0495fdc479d`, Git tree `d0cfe54ef2ee6c0e55a9257e59065438523933e2`, and parentless commit `5aac1cf10fbb4c5c02b952b7e48321273613a55d`. This release-specific waiver is not a signature acceptance claim and does not waive the remaining security, retention, deployment-evidence, or project-terminal criteria.

## Terminal outcome

Deliver an independently implemented, production-operable AI video workspace whose evidenced product surface is aligned with the current LibTV comparison target. A checkpoint or milestone is phase progress only. The project may be called complete only when all of the following are true at the same reviewed revision:

1. Every `required` item in `docs/libtv-parity-backlog.json` is `accepted` with linked, reproducible evidence. Items explicitly canceled by the owner must be `required: false`, recorded as `out_of_scope` / `canceled_by_owner`, and are not acceptance passes.
2. `docs/project-acceptance-ledger.json` has `unmet=[]` and `blockers=[]`.
3. The matrix has no required row marked `partial`, `unknown`, `unverified` or `gated`.
4. Unit/integration tests, negative security tests, deterministic smokes, browser E2E, restart recovery, backup/restore and rollback checks pass from a clean start.
5. A human reviewer accepts the authenticated LibTV research snapshot and the staging/production evidence bundle.
6. A fresh ordinary account creates a distinct project (or explicitly selects one before changing creative input), starts with the exact prompt `美女在海滩跳舞`, and completes the Beijing production browser path through a newly generated playable MP4.
7. The retained bundle proves the text model, cost quote/confirmation, provider jobs, per-shot Seedream first frames, per-shot Seedance videos, TTS, captions, music, composition, storyboard version, timeline and render all belong to the same current project/story/storyboard revision. Reusing an asset is allowed only through an explicit provenance-bearing copy/reference operation and can never satisfy fresh-generation evidence.

No local test, mock adapter, deterministic fixture, milestone or comparison document can independently satisfy the terminal outcome.

## Acceptance domains

- Product: workflows/Agents, multimodal catalog, canvas nodes and controls, character/product/scene consistency, audio, timeline/export, templates/tutorials and asset reuse. Team collaboration and LibTV team-space integration (CO-01), plus billing/credits/usage and payment-system alignment (B-01), were canceled by the owner on 2026-08-19 and are outside the terminal scope; historical local and read-only comparison evidence remains evidence of prior investigation only.
- Beginner production workflow: explicit create/select-work boundary; real text-model creative-to-script-to-storyboard planning; a real step 4 with quote and confirmation, Seedream first frames, Seedance shot video, TTS, captions, music, composition, progress, restart recovery and per-shot redo; production Server API and browser integration of the commercial provider orchestrator and durable lifecycle; and one Agent entry point from creative prompt to bound final render.
- Product URL understanding: server-side safe retrieval with scheme/host/DNS/redirect/size/type/time limits, no browser credential forwarding, and retained source/provenance evidence feeding the real understanding model.
- Quality: accessibility, browser compatibility, performance, recovery, concurrency, observability and supportability.
- Security: authentication, authorization, CSRF/SSRF/IDOR, tenant isolation, secret handling, abuse/rate controls, dependency review, backup/restore and incident rollback.
- Evidence: each claim identifies source class (`first-party-public`, `authenticated-observed`, `OpenReel-local`, `staging`, or `production`) and capture date.

## Required evidence per backlog item

Each accepted item must include: behavior and explicit non-goals; focused automated tests; negative/edge cases; a replayable smoke; persistence/restart evidence where stateful; security and tenant checks where exposed; and an evidence link in the ledger. Visual or media claims additionally require artifact probes and human-visible E2E evidence.

## Research freshness

Before final review, refresh first-party public evidence and perform an authenticated product walkthrough no older than 30 days. Unknown internals stay unknown; OpenReel must meet its own security and reliability criteria rather than infer them from LibTV.

## Human gates

Local reads, edits, fixtures and tests are allowed. OpenReel in-scope deployment, production configuration, backup, restore and rollback use the standing authorization. Existing-credential paid model tests are authorized when each independent action is at most CNY 100. More than CNY 100 per action, new credentials, destructive or out-of-scope actions, public publishing, and external messages remain separately gated.

## Continuation rule

Execute `docs/libtv-parity-backlog.json` in dependency and priority order. An accepted checkpoint advances the project but does not end it; continue with the highest-priority ready item. When a gate is reached, record the exact requested action, cost/exposure, rollback and evidence expected, then wait.

## Final acceptance

On 2026-08-31, the owner reviewed and explicitly accepted the current OpenReel v4 evidence bundle. At that accepted revision, all required items are accepted, `unmet=[]`, and `blockers=[]`. This satisfies the human-review criterion and closes the project terminal contract. The authoritative decision is recorded in `docs/project-acceptance-ledger.json`; the same acceptance decision must not be requested again.
