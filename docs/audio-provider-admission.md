# Real audio provider admission contract

Status: local candidate validation only. Passing this contract does not configure a model, authorize spend, access credentials, contact an endpoint, or satisfy A-01/E-01.

`src/audio-provider-admission.js` accepts only non-sensitive candidate metadata and returns `executable: false` plus `requiresHumanGate: true`. Candidate metadata must identify one `text-to-audio` model, a credential-free HTTPS endpoint, the exact reviewed voice/speed/pitch/volume/sample-rate/audio-format control order, a 1–300 second duration bound, supported audio result MIME types, and immutable positive USD pricing with a dated HTTPS source.

Unknown top-level or pricing fields are rejected, which also prevents API keys, tokens, secrets, inline credentials, query tokens and similar values from entering the admission artifact. HTTP endpoints, URL user information, query strings, fragments, unknown controls, duplicate or non-audio MIME types, zero reservation ceilings and zero usage rates fail closed.

After a candidate passes locally, a successor E-01 packet must still name its exact model and endpoint id, non-secret credential-source reference, call count, per-call ceiling, aggregate ceiling, staging target, evidence, stop conditions and cleanup authority. An independent reviewer must verify the price source, provider terms, data handling, regional routing, output licensing and model behavior before the human gate. Only that later explicit approval may authorize staging configuration or calls.

The independent reviewer starts from `audio-candidate-review-template.json` and follows `audio-candidate-review-template.md`. Both acceptance and rejection artifacts must keep `executionAuthorized: false`; an accepted review advances only to preparation of a successor human gate.
