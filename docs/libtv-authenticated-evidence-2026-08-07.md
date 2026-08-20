# LibTV authenticated read-only evidence — 2026-08-07

Scope: authenticated CLI inspection using an already valid owner session. No OTP was sent, no credential was written or changed, and no node/model was run. Identifiers, media URLs, prompts and phone digits are intentionally omitted.

## Method

- CLI binary: local LibTV CLI, read-only commands only.
- Commands inspected: `account info/list`, `workspace list`, `project list`, `node list`, `group list`, `model search`, representative `model` schemas, representative node details, and `image shortcut list`.
- Evidence class: `authenticated-observed` (`A2`). This proves the returned product surface for this account at capture time, not LibTV internals, production SLOs or every web-only feature.

## Observed account and project surface

- One active personal owner account; no team scope was returned.
- The account reported an effective standard recurring VIP membership. Payment, renewal, invoices, balance and usage ledger were not inspected or changed.
- The bound test workspace contained one canvas with seven nodes: one script, four storyboard images in one group, and one final video.
- The persisted chain recorded a four-shot script, generated storyboard group, ordered multi-image references and a 15.104-second 1280×720 final video with sound enabled.

## Current model catalog returned by CLI

| Node/model query | Count | Notable authenticated observations |
|---|---:|---|
| text | 4 | Multimodal text modes include image-to-text and video-to-text on a representative schema |
| image | 16 | Image generation/editing catalog; representative model exposes 1K/2K/4K, 13 ratios, 1/2/4 outputs, up to 10 image references, camera control, mentions and Slash support |
| video | 32 | Catalog includes text/image/frames/mixed/audio-to-video families, multi-shot and motion-control descriptions |
| audio | 6 | General audio, TTS and music models |
| script | 10 | Separate script text and script image modalities |
| storyboard | 10 | Same script text/image families available through storyboard query |

Representative Seedance 2.0 VIP schema exposed 480p/720p/1080p/4K, 4–15 second duration, generated audio toggle, search, automatic compliance checks, up to nine images, three videos and three audio references in mixed mode, and audio-to-video input.

Representative Seed Audio schema exposed text/image/audio-to-audio modes, Chinese/English, 8/16/24/48 kHz, WAV/MP3/PCM/Ogg Opus, speed, pitch and volume. Representative TTS schema exposed selectable voice, speed, pitch, volume, timbre/intensity adjustments and sound effects.

## Workflow shortcuts returned by CLI

Sixteen authenticated image shortcuts were listed, including storyboard/camera grids, character face and body turnarounds, product and scene setting sheets, continuous 25-frame storyboard, cinematic lighting correction and forward/backward frame prediction.

## Evidence-backed implications for OpenReel

1. Model/capability parity needs a versioned catalog-drift mechanism and richer schema UI; generic aspect/duration/audio fields are insufficient.
2. Consistency work should include first-class character, product and scene sheets plus ordered multi-reference provenance, not only a shared reference ID.
3. Audio scope is broader than an AAC render track: generation, TTS voices, music/SFX and audio-driven video are current authenticated targets.
4. Script-to-storyboard chain parity is evidenced, but bulk ordered execution, shortcut workflows and representative real-media E2E remain to be compared.
5. This personal account does not prove team collaboration behavior, billing ledger behavior, public publishing, production security or reliability; those remain unverified/gated.

## Bounded recovery observation

After re-validating the authenticated session, a second read-only inspection of the bound canvas returned the same seven-node graph. The four generated image nodes and final video each retained a stable task identifier, `loading: false`, successful terminal status and 100% progress. The final video retained the ordered four-image provenance list plus its 15.104-second, 1280×720 and sound-enabled resource metadata.

This supports a narrow observable recovery contract: after leaving and re-reading a completed canvas, task terminal state, progress, output metadata and ordered input provenance remain discoverable. It does **not** reveal or prove LibTV's internal polling cadence, retry policy, transient-failure handling, cancellation semantics or production durability. OpenReel therefore compares only this observable contract and separately verifies its own retry, cancel, idempotency, failed-batch stop, replacement-attempt traceability and restart discovery behavior with local deterministic tests.
