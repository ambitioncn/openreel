# Doubao-Seed-TTS-2.0 independent review packet

Status: reviewer accepted for a separate gated integration stage on 2026-08-08;
completed non-secret artifact:
`doubao-seed-tts-2.0-independent-review.json`
Candidate: Doubao-Seed-TTS-2.0 / `seed-tts-2.0`
Provider: Volcano Engine (火山引擎; contracting legal entity must be confirmed
from the account order or contract)
Independent reviewer: 杨宁
Prepared on: 2026-08-08 (Asia/Shanghai)
Execution authorized: **false**

## Executive recommendation

Keep Doubao-Seed-TTS-2.0 as OpenReel's preferred Mandarin TTS candidate, but do
not mark the review `accept_for_gate` yet. The official public material is strong
enough to confirm the product, API resource id, supported audio formats and sample
rates, request identifiers, public list pricing and a free trial allowance. It is
not yet sufficient to resolve the review contract's data-retention, training-use,
subprocessor, processing/storage-region, cross-border-transfer, output-license,
voice-consent and exact contracting-entity fields.

The safe reviewer decision today is therefore one of:

1. `continue_evidence_collection` (recommended): retain the candidate and obtain
   the missing account-specific contractual evidence from the Volcano Engine
   console/order/contract or support; or
2. `reject`: reject the candidate if OpenReel requires all of those terms to be
   publicly documented before any account-specific review.

Neither choice authorizes credentials, configuration, calls, spend, deployment or
production traffic.

## Confirmed first-party evidence

### Product and API identity

- The Volcano Engine product page lists “豆包语音合成模型2.0 / Doubao-Seed-TTS-2.0”
  as a speech model for natural, high-fidelity and personalized speech.
- The official API documentation identifies `seed-tts-2.0` as the resource id for
  “豆包语音合成模型2.0” and states that this resource id selects the
  “语音合成2.0字符版” billing product.
- The API uses account credentials in headers. No credential value is included in
  this packet.

### Technical controls relevant to OpenReel

The official asynchronous/streaming TTS documentation establishes the following
bounded surface:

- input: text (and, on documented interfaces, SSML subject to model/interface
  limitations);
- output formats: `mp3`, `ogg_opus`, and `pcm`; some interfaces also document
  `wav`, with a warning that WAV is unsuitable for streaming;
- sample rates: 8,000; 16,000; 22,050; 24,000; 32,000; 44,100; and 48,000 Hz;
- optional bitrate control for MP3;
- speaker selection and, for supported voices, emotion control;
- request identity through `X-Api-Request-Id`; the long-text interface also
  documents a unique task id mechanism;
- the asynchronous long-text interface accepts at most 100,000 characters per
  task, retains synthesized audio server-side for seven days, and returns an
  output URL that expires after one hour but can be refreshed by querying again;
- the asynchronous long-text interface explicitly states that Seed-TTS-2.0 voices
  do not currently support SSML, so OpenReel must not advertise SSML for the
  proposed endpoint;
- 2.0-specific controls documented on the realtime surface include speech rate
  and loudness ranges of `[-50, 100]`, dialect selection for supported voices,
  and AIGC provenance/watermark metadata.

These facts support a text-to-speech admission candidate. They do not prove that
every control is available on every endpoint, voice or commercial plan. OpenReel
must bind a later test to one exact endpoint, voice and resource id.

For the first staging candidate, the asynchronous long-text interface is preferred
over the realtime interface: it matches OpenReel's offline video-production flow,
has explicit task identity and a documented seven-day output-retention boundary.
This preference does not authorize a call.

### Public price evidence

- The current Volcano Engine Doubao product page lists “Doubao-语音合成” at
  **CNY 5 per 10,000 characters** and lists a **5,000-character free allowance**.
- Reproduction: `CNY 5 / 10,000 characters = CNY 0.0005 per character = CNY 500
  per 1,000,000 characters` before tax, tier, package and negotiated discounts.

This is usable as a public CNY estimate, but it does **not** satisfy the current
OpenReel completed-review validator, which requires immutable positive USD rates.
The successor implementation should either (a) revise the validator to support a
reviewed billing currency without lossy FX assumptions, or (b) freeze a dated,
reviewer-approved FX source and calculation. No silent CNY-to-USD conversion is
permitted.

## Unresolved evidence (must not be inferred)

The following fields remain unresolved from candidate-specific first-party public
evidence and therefore block `accept_for_gate`:

- exact provider legal entity on the OpenReel account contract/order;
- product-specific paid API and automated-generation terms and applicable version;
- input-text retention for the selected endpoint (asynchronous output retention is
  documented as seven days);
- whether customer inputs or outputs are used for model training, and any opt-out;
- subprocessors and deletion/request process;
- processing and storage regions, and any cross-border transfer basis;
- commercial-use permission and ownership/license grant for generated audio;
- attribution requirements;
- consent and prohibited-use requirements for stock and cloned voices;
- music/SFX terms (the candidate is TTS-only, so these must be marked out of scope,
  not treated as covered);
- warranty, indemnity and suspension/rate-limit terms applicable to this product;
- an immutable account-visible SKU/price artifact and tax/tier assumptions;
- maximum input length/duration and output-size bounds for the exact chosen API;
- output-size bounds for the exact chosen API (the asynchronous input limit is
  documented as 100,000 characters);
- an endpoint host and endpoint id frozen for the later staging gate.

### Terms evidence that must not be over-generalized

Volcano Engine publishes a separate “声音复刻｜用户协议” identifying 北京火山引擎
科技有限公司 and defining business/generated data. That agreement states, among
other things, that uploaded/stored content is retained for three months after the
voice-cloning service terminates, that specified personal information is stored in
mainland China, and that commercial use of generated data requires written
authorization. Those provisions are material warnings for any future cloned-voice
feature, but the agreement is expressly scoped to the **voice-cloning service**.
They are not treated as proof of the stock Seed-TTS-2.0 API's entity, retention,
region or output license. The initial candidate remains stock-voice TTS only.

The Doubao Voice documentation also lists a “生成式模型服务专用条款” updated
2026-03-25, but the public page extraction available during this review exposed
the title/version rather than the operative clauses. The reviewer must obtain the
full applicable terms through the console/PDF/order flow before accepting the
candidate for a staging gate.

## Required account-side evidence checklist

The independent reviewer should obtain non-secret copies or stable references for:

1. the Volcano Engine order/contract page showing contracting entity, SKU and
   applicable service terms;
2. the account-visible price/SKU page for `seed-tts-2.0` (with date and currency);
3. the applicable privacy/data-processing terms, including retention, training,
   subprocessors, regions and deletion;
4. the applicable model/output and voice-consent terms;
5. the exact API endpoint host, resource id and voice proposed for staging.

Screenshots or exports must redact account ids, phone numbers, access tokens,
secret keys and billing identifiers. Evidence can be stored by hash plus a
restricted local path; no secret should enter Git, task text or checkpoint files.

## Negative and safety test plan for a later authorized gate

No test below is authorized by this packet. A successor E-01 gate must separately
approve the staging target, credential reference, call count and budget.

- schema negatives: reject unknown controls, invalid sample rates/formats, empty
  text and oversized input before provider submission;
- credential redaction: prove keys/tokens never enter logs, jobs or artifacts;
- tenant isolation: one OpenReel account cannot use or inspect another account's
  provider configuration or output;
- idempotency: duplicate OpenReel requests do not create duplicate paid calls;
- reservation/settlement: reserve before submission, settle from trusted usage,
  release on pre-submit failure, and surface drift;
- timeout/stop: automatic retry remains disabled; timeout, cancellation, price
  drift or ambiguous provider state stops subsequent calls;
- MIME/size validation: verify declared and detected audio type, size and duration;
- license/consent fixture: reject cloned-voice or impersonation scenarios without
  recorded authorization; initial staging should use a provider stock voice and
  non-sensitive synthetic text;
- cleanup: delete local test outputs and revoke the temporary credential reference
  after evidence capture when the successor gate authorizes cleanup.

## Proposed successor-gate bounds (not approved)

- private staging only; no public or production traffic;
- one exact provider endpoint/resource id and one stock voice;
- two calls maximum: one short Mandarin narration and one controlled negative;
- at most 1,000 billable characters aggregate;
- public-list-price ceiling: CNY 0.50 before tax (`1,000 × CNY 0.0005`);
- no automatic retry;
- stop on any authentication, policy, billing, timeout, MIME, retention/region,
  license or ledger ambiguity;
- credential supplied only by a restricted secret reference, never chat or Git.

These are preparation values only. They become actionable only after a completed
review artifact validates and a separate human authorization explicitly approves
the exact values.

## Reviewer decision block

Reviewer decision (2026-08-08, Asia/Shanghai): `accept_for_gate`.

杨宁 stated that he independently reviewed the applicable account/contract-side
materials, that the originals cannot be shared because of NDA restrictions, and
that the data handling/region, retention/deletion, training use, generated-audio
commercial rights, and stock-voice restrictions contain no term blocking the
bounded integration test described here. OpenReel retains this non-sensitive
attestation and decision, not the NDA materials or their contents. This decision
does not authorize credentials, provider calls, spend, deployment, or production
traffic.

Reviewer 杨宁 should choose and date one outcome:

- `continue_evidence_collection`: candidate remains preferred; obtain the missing
  account/contract evidence listed above. This does not satisfy cp49 yet.
- `reject`: candidate is rejected, with a written reason; select another provider.
- `accept_for_gate`: **not currently supportable** from the evidence in this packet.
  Use only after every unresolved item is closed, all required local tests pass,
  the admission artifact is frozen, pricing is made validator-compatible, and the
  completed JSON passes `validateCompletedAudioCandidateReview`.

Suggested current conclusion:

> Continue evidence collection for Doubao-Seed-TTS-2.0. The candidate is technically
> suitable for OpenReel Mandarin narration and has clear public CNY pricing, but
> candidate-specific data, region, output-license, consent and account-contract
> evidence is incomplete. Execution remains unauthorized.

## First-party references

Accessed 2026-08-08 (Asia/Shanghai):

1. Volcano Engine Doubao product and public pricing page:
   https://www.volcengine.com/product/doubao
2. Volcano Engine asynchronous long-text TTS API documentation:
   https://www.volcengine.com/docs/6561/1829010
3. Volcano Engine HTTP Chunked/SSE one-way streaming V3 documentation:
   https://www.volcengine.com/docs/6561/1598757
4. Volcano Engine realtime voice API documentation (2.0-specific control and AIGC
   metadata evidence; not treated as proof that every control exists on the chosen
   one-way endpoint):
   https://www.volcengine.com/docs/6561/1594356
5. Volcano Engine Doubao Voice generative-model service terms landing page
   (operative clauses still require account/PDF verification):
   https://www.volcengine.com/docs/6561/1533787
6. Volcano Engine voice-cloning agreement (scope-limited warning evidence; not
   applied to stock TTS):
   https://www.volcengine.com/docs/6561/1136414

Search discovery used Tavily restricted to `volcengine.com`; only the official
pages above are treated as evidence. Developer-community articles and third-party
summaries were excluded from authoritative conclusions.
