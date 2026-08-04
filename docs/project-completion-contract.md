# OpenReel project completion contract

Version: 2.0 · Amended: 2026-08-04 · Status: active, not complete

## Terminal outcome

Deliver a locally executable, independently implemented AI-native video workspace. A task, checkpoint, milestone, local baseline, or comparison result is only phase progress. The project may be called complete only when the machine-readable acceptance ledger has `unmet=[]` and `blockers=[]`.

Authenticated LibTV observations in `libtv-parity-matrix.md` are comparison evidence, not proof of OpenReel implementation and not permission to copy proprietary behavior.

## Dependency-ordered total acceptance contract

### P0 — executable production spine

1. **P0.1 durable graph domain:** unbounded-coordinate canvas with typed executable nodes, validated directed edges, groups, graph persistence/migration, per-node run/progress/results/versioned history, and focused negative tests.
2. **P0.2 generation adapters:** provider-neutral adapter contract and registry, model capability schemas, at least one credential-free/local executable adapter, structured failure/cancel behavior, and explicit credential/cost gates for optional real providers.
3. **P0.3 playable render/export:** actual locally playable media output assembled from timeline inputs, downloadable render manifest/result, deterministic replay smoke, and no claim of production codec quality where unevidenced. EDL-only output does not satisfy this item.
4. **P0.4 first-class CLI:** workspace/project/canvas/node/edge/run/model-schema/upload/download commands, stable JSON output/errors, help, and replayable CLI smoke.

### P1 — creation workflow and reuse

5. **P1.1 executable chain:** script → editable storyboard table → storyboard image set → video-node production chain with provenance, identity/product continuity fields, and end-to-end tests.
6. **P1.2 constrained model UI:** schema-driven model/mode/aspect/resolution/duration/audio/reference-count controls; incompatible combinations are prevented in UI and rejected in domain/API tests.
7. **P1.3 reusable results:** generation history, searchable asset library, immutable result versions, project reuse/copy provenance, and restart tests.
8. **P1.4 Skill/agent automation:** workflow plan/run/status/failure/cost automation beyond CRUD, preserving intent from Skill → project → nodes, with idempotent replay smoke.
9. **P1.5 templates/import:** documented examples/templates and reproducible versioned workflow import with validation. Community/public publishing remains human-gated and is not a local acceptance prerequisite.

### P2 — commercial and collaboration boundaries

10. **P2.1 budget ledger:** plans/credits/model or per-node prices/balance/reservations/final costs, reliable preflight quote, atomic hard budget ceiling, transparent status/failure/cost, and concurrency/insufficient-budget negatives.
11. **P2.2 auth/team baseline:** real local authentication boundary, team spaces/invites/membership/roles/conflict handling and authorization negatives; explicitly no production security claim without deployment evidence and review.
12. **P2.3 infrastructure adapters:** cloud object/database/multitenancy interfaces plus a safe local implementation, tenant isolation tests, threat-model/security posture, migration/backup guidance, and explicit production-readiness blockers.

## Cross-cutting acceptance

- Preserve hard budget caps, intent continuity, transparent plan/status/failure/cost, cross-shot identity/product consistency, and stronger timeline/audio delivery.
- Every implemented item needs focused automated tests and a replayable smoke. `npm test` and `npm run smoke:http` must pass; CLI/render/workflow/budget/auth-negative smokes apply as their capabilities land.
- Evidence must label: authenticated LibTV observation, locally implemented OpenReel baseline, or production claim. One category never substitutes for another.
- Clean-start and persistence restart recovery, authorization negatives, and evidence-boundary review must pass.

## Allowed and gated actions

Local reads, edits, fixtures, tests, and local services are allowed. Paid calls, credential changes, push, publish, deploy, production changes, external messages, and destructive actions require explicit owner confirmation and are not performed by this contract.

## Continuation and terminal rule

Implement in P0 → P1 → P2 dependency order. After an accepted checkpoint, continue with the highest-priority unmet item. Genuine credential/cost/deploy/product-decision gates remain explicit blockers. Project completion is permitted only when `docs/project-acceptance-ledger.json` reports both `unmet` and `blockers` as empty arrays.
