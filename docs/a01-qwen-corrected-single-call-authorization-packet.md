# A-01 Qwen corrected single-call authorization packet

Status: consumed. Exactly one request was made with zero retries; synthesis and durable OpenReel reconciliation succeeded.

Exact authorization phrase: `授权执行 A-01-QWEN-CHINESE-ONE-CALL-V2`

This authorizes exactly one request with zero retries to the existing Tailnet Qwen TTS endpoint. It keeps the v1 text and WAV/private-local-browser scope, but corrects only the language value from unsupported `zh` to the live service's advertised canonical value `chinese`.

It does not authorize payment, another request, another provider, deployment, service control, credential changes, LibTV writes, or publication. The run stops after the first terminal response regardless of outcome.
