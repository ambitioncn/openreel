# LibTV functional alignment matrix

Version: 3.0 · Evidence captured: 2026-08-04 · Authenticated findings supplied by project owner

This matrix separates authenticated LibTV observations from OpenReel local evidence. It is a comparison target, not a proprietary implementation specification or a parity declaration.

## Evidence labels

- **authenticated-observed**: supplied from an authenticated LibTV review; hidden implementation and production qualities remain unknown.
- **public-confirmed / public-marketing / unknown**: supported by the first-party public sources below at the stated strength.
- **OpenReel local**: independently implemented and tested locally; never implies production readiness.

Sources: S1 `https://www.liblib.tv/`; S2 `https://github.com/libtv-labs/libtv-skills/blob/main/README.md`; S3 `https://www.liblib.tv/zh/cli` (accessed 2026-08-04); A1 authenticated findings supplied in task `2026-08-04T08-50-20-625Z...`.

| Capability | Priority | LibTV evidence | OpenReel baseline at amendment | Required evidence to close |
|---|---:|---|---|---|
| Infinite typed node canvas, edges, groups, per-node execution/history | P0 | authenticated-observed (A1) | UI node scaffold; missing durable edges/groups/history | graph/API/UI tests and replay smoke |
| Provider-neutral real generation architecture | P0 | authenticated-observed (A1) | deterministic fixtures behind an internal list; not an adapter contract | adapter interface/registry, local executable adapter, credential gates |
| Playable media pipeline and final render/export | P0 | authenticated-observed (A1) | EDL plus non-playable boundary MP4 fixture; unmet | playable output probe, download and render smoke |
| First-class CLI: workspace/project/canvas/node/edge/run/schema/upload/download | P0 | authenticated-observed (A1); public CLI claim S3 | HTTP smoke only; unmet | CLI help, JSON contracts, full replay smoke |
| Script → storyboard table → image set → video chain | P1 | authenticated-observed (A1) | story/storyboard CRUD and independent jobs; chain unmet | provenance-aware chain smoke |
| Model schema/capability parameter UI | P1 | authenticated-observed (A1) | simple capability metadata; UI constraints unmet | schema UI and invalid-combination tests |
| History, asset library, result versions, project reuse | P1 | authenticated-observed (A1) | searchable asset list; versions/reuse incomplete | persistence/reuse/version tests |
| Skill/agent workflow automation beyond CRUD | P1 | authenticated-observed (A1); session API public-confirmed S2 | versioned CRUD/generation API; automation unmet | plan/run/idempotency/status/cost smoke |
| Examples/templates/workflow import | P1 | authenticated-observed (A1) | unmet | versioned fixture import/replay; public publish remains gated |
| Credits/plans/prices/balance/cost/budget | P2 | authenticated-observed (A1) | unmet | quote/reserve/settle ledger and hard-ceiling negatives |
| Auth/team/invite/collaboration | P2 | authenticated-observed (A1) | header-selected local roles only; not authentication | local auth/invite tests and production boundary doc |
| Cloud/database/multitenancy | P2 | authenticated-observed (A1) | atomic local JSON only | adapter contracts, local tenant isolation, security posture |
| Project/session/progress/download/upload | P0/P1 | public-confirmed (S2, image/video upload only) | locally implemented broader API | existing HTTP/restart tests; audio is OpenReel-only |
| Cross-shot identity/product consistency | differentiator | not established | unmet | continuity schema and cross-shot tests |
| Timeline/audio/pro delivery | differentiator | not established | local timeline/EDL; final delivery unmet | playable render/audio tests |

## Decision

OpenReel is **not project complete** at this amendment. Prior claims based on EDL output, a minimal MP4 byte fixture, or local header roles are withdrawn. The acceptance ledger is authoritative for current unmet items and blockers. Optional paid providers, production deployment/security certification, and community publishing remain gated; local adapter and architecture evidence must still be completed where required.
