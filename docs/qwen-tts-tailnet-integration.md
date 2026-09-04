# Qwen TTS Tailnet integration

## Graphical browser negative path

`npm run smoke:qwen-browser-negative` launches an isolated loopback OpenReel server with a non-executing Qwen service stub and Chromium. The browser selects Qwen on an audio node and prepares one reviewed queued job. Acceptance requires the visible no-generation message, zero retained audio assets, no client authority fields, and a zero Provider-call counter. The smoke never contacts the Tailnet endpoint and cannot authorize synthesis.

Amendment v5 replaces the abandoned Seed TTS/SeedAudio/Volcengine TTS route with the owner-selected Tailnet Qwen TTS service.

The reviewed service contract is available from Beijing at `http://100.124.97.3:8004` and exposes `GET /health`, `POST /synthesize`, and the OpenAI-compatible `POST /v1/audio/speech`. OpenReel uses only `/v1/audio/speech`.

`src/qwen-tts.js` provides the fail-closed integration boundary:

- disabled unless `OPENREEL_QWEN_TTS_ENABLED=true`;
- base URL pinned to the owner-approved Tailnet address;
- no credential or public Internet endpoint;
- every real synthesis call additionally requires an exact boolean `true` from both the server authorization callback and provider client boundary; truthy strings, numbers, arrays and objects remain denied;
- 1–1,000 input characters, reviewed WAV only, 20 MiB output ceiling; the client constructor revalidates these immutable contract limits and rejects injected configuration drift;
- request timeout must be an integer from 1 ms through the reviewed 60-second ceiling, preventing caller-supplied unbounded or invalid waits;
- redirects rejected; requests explicitly negotiate `Accept-Encoding: identity`, encoded responses fail before body reads, only exact HTTP `200` is admitted (including rejection of `206 Partial Content` before body reads), and `audio/wav` or `audio/x-wav` plus canonical decimal `Content-Length` and declared/actual HTTP length equality are required, including an explicit zero-length declaration;
- RIFF size, chunk boundaries, a single valid `fmt ` chunk, and a single non-empty `data` chunk are verified before admission;
- PCM/IEEE-float format, mono/stereo channel count, 8–192 kHz sample rate, supported bit depth, block alignment, byte rate, and complete sample-frame alignment must be internally consistent;
- `fmt ` admission is limited to canonical 16-byte WAVEFORMAT or 18-byte WAVEFORMATEX with a zero extension length; truncated, undeclared, or uninterpreted codec extensions fail closed;
- odd-sized RIFF chunks must include the required zero-valued alignment byte; missing or nonzero padding fails closed;
- every RIFF chunk identifier must be a printable four-character ASCII code; binary/control-byte identifiers fail closed before admission;
- validated WAV metadata yields the actual encoding, bit depth, duration, sample rate, and channel count; result admission is limited to 600 seconds;
- the 600-second limit is enforced by the Qwen client immediately after byte-level WAV inspection, before a result can reach durable canvas reconciliation; exactly 600 seconds is accepted and 601 seconds fails closed;
- response bytes are bounded while streaming, and an over-limit stream is canceled immediately rather than buffered in full;
- upstream bodies and generated audio are not logged by the client.

`src/core.js` and `server.mjs` now separate preparation from execution:

- `POST /api/v1/sessions/:sessionId/qwen-tts-jobs` creates a reviewed, tenant-scoped, idempotent job and persists it without contacting Qwen;
- only audio nodes with a normalized voice/WAV specification are accepted;
- `POST /api/v1/jobs/:jobId/qwen-tts-run` requires both a configured service and a server-side `authorizeQwenTts` decision; request-body booleans cannot authorize a call;
- the production entry point intentionally supplies no authorizer, so execution remains denied even if the client is configured;
- a validated WAV result is stored as a durable result asset, linked to the node and job, appended to the audio timeline, and included in the export manifest.
- retained asset metadata, the audio clip out-point, and export preview duration use the validated WAV duration rather than the pre-generation estimate.
- persistence also requires the byte-verified WAV sample rate to match the reviewed canvas `audioSpec.sampleRate`; a provider-side sample-rate drift cannot silently change the retained asset.
- persistence records byte-verified PCM/IEEE-float encoding and bit depth and rejects caller metadata drift before creating an asset or timeline clip.

The canvas exposes that same boundary instead of disguising preparation as generation:

- when Qwen is configured, the audio model selector labels it as `qwen-tts-tailnet`;
- the primary action changes to “Prepare Qwen voice job” and displays a no-generation/server-authorization notice;
- language and voice-instruction fields are stored in the reviewed local job;
- `src/qwen-tts-ui.js` creates a preparation payload with no execution or authorization field;
- browser preparation does not call `qwen-tts-run`; the HTTP negative test separately proves that endpoint returns 403 and leaves the provider call count at zero without a server-side authorization decision.

This increment does not enable Qwen TTS in the running Beijing OpenReel service and makes no real synthesis call. The isolated graphical-browser negative path passes; a precise real-generation gate and retained-media graphical-browser validation remain acceptance work.

### IEEE-float sample-count provenance

IEEE-float WAV admission requires a single four-byte `fact` chunk after `fmt ` and before `data`. Its declared sample-frame count must be non-zero and exactly match `dataBytes / blockAlign`. Missing, duplicate, late, malformed, or mismatched `fact` metadata fails closed. PCM remains governed by its byte-derived frame count and does not require `fact`.

PCM does not require a `fact` chunk, but an upstream-supplied one is treated as asserted provenance: its sample-frame count must match the byte-derived PCM frame count. Contradictory optional metadata fails closed instead of being ignored while duration and timeline evidence are derived from different bytes.

IEEE-float sample payloads are decoded at admission and every 32-bit or 64-bit sample must be finite. NaN and positive/negative infinity fail closed before the result can enter durable assets, timeline composition, or export evidence.

RIFF parsing admits at most 1,024 chunks, including required `fmt ` and `data` chunks. This limits CPU amplification from tiny or zero-length metadata chunks independently of the 20 MiB response-byte ceiling.
