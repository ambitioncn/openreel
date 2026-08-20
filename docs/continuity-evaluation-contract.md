# Continuity evaluation contract

Status: local contract only; no real-media result is claimed.

Each evaluated storyboard batch must retain the reviewed `continuityEntityUsages` snapshot for every shot and produce a JSON artifact with schema `openreel-continuity-evaluation/v1`. The artifact identifies the project, storyboard version, batch id, provider/model, generation parameters, ordered output asset ids, evaluator, evaluation time, and one score record per ordered shot.

Every score is an integer from 1 (unacceptable) to 5 (strong match) for:

- `identity`: locked character or product attributes remain recognizable.
- `scene`: locked environment, lighting, palette, and spatial anchors remain consistent.
- `referenceAdherence`: the output follows the ordered reference set without substituting identity.
- `temporalCoherence`: adjacent shots preserve appearance and scene state without unexplained drift.
- `artifactFreedom`: hands, faces, text, geometry, flicker, and transitions are usable.

Each score record must include `shotId`, `outputAssetId`, `scores`, `notes`, and `failures`. Acceptance requires every required dimension to score at least 4 for every shot, no unresolved failure tagged `identity_swap`, `reference_ignored`, `scene_drift`, `temporal_discontinuity`, or `unsafe_output`, and a human reviewer decision. Raw outputs, manifests, prompts, reference provenance, and the immutable entity-usage snapshots must be retained with SHA-256 digests.

Local deterministic fixtures may validate ordering, persistence, schema shape, and failure handling, but cannot satisfy visual acceptance. Provider selection, credentials, call count, cost ceiling, staging deployment, and real-media generation remain behind E-01 explicit approval.
