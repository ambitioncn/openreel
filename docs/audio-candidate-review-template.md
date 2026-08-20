# Independent audio candidate review template

Use `audio-candidate-review-template.json` only after a candidate passes the local admission contract. The blank template is deliberately `not_reviewed`, has no candidate or reviewer, and keeps `executionAuthorized: false`.

## Review procedure

1. Freeze the candidate admission artifact and record its SHA-256 digest. Do not include credentials or expiring output URLs.
2. Assign a reviewer other than the implementation author. Record identity, role, independence and conflicts before reviewing evidence.
3. Cite dated first-party evidence for provider terms, paid/automated use, retention, training use, subprocessors, deletion, processing/storage regions and cross-border transfers.
4. Cite the exact output-license and consent rules for commercial use, voices, music and SFX. Unknown ownership, attribution, consent or reuse terms are a rejection, not an assumption.
5. Reproduce the immutable USD pricing calculation, including tiers, taxes and maximum reservation. A marketing estimate cannot serve as the ledger rate.
6. Link replayable technical evidence for schema negatives, redaction, tenant isolation, idempotency, reservation/settlement, timeouts, MIME/size checks and consent/license fixtures.
7. List every open finding. The only allowed review decisions are `accept_for_gate` and `reject`; neither decision authorizes execution.

## Fail-closed decision rule

The reviewer may set `status` to `complete` and `decision` to `accept_for_gate` only when every required field is resolved, every evidence list is non-empty, all required tests pass, independence/conflicts are recorded, admission passed, immutable positive pricing is reproducible, and `openFindings` is empty. Otherwise the decision is `reject` or the status remains `not_reviewed`.

`executionAuthorized` must remain false in every review artifact. An accepted review only permits preparation of a successor E-01 human gate. That gate must separately approve the exact private staging target, non-secret credential-source reference, endpoint id, call count, per-call and aggregate ceilings, stop conditions and cleanup authority. It does not authorize production or public traffic.

Completed artifacts must pass `validateCompletedAudioCandidateReview` before they can be used to prepare that successor gate. The validator rejects incomplete evidence, failed tests, non-independent review, non-positive or non-USD pricing, unresolved accepted findings, missing stop/cleanup boundaries, and any attempt to set execution authority.
