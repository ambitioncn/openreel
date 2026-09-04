# A-01 Qwen single-call authorization packet

Status: consumed. The single request ended with an upstream HTTP 500 because the authorized `language=zh` value is not accepted by the live model. It was not retried.

Exact authorization phrase: `授权执行 A-01-QWEN-ONE-CALL-V1`

This authorizes one request, zero retries, to the owner-selected Tailnet Qwen TTS endpoint using the exact text “你好，这是 OpenReel 语音链路测试。” and WAV/Chinese output. The call runs only through isolated local OpenReel state and a loopback graphical browser. The generated WAV may be retained only as private local task evidence until project acceptance or an explicit cleanup request.

It does not authorize paid spend, another call, another provider, Seed TTS/SeedAudio/Volcengine TTS, deployment, service control, production changes, credentials, LibTV writes, or publication. Execution stops before submission if payment, credentials, endpoint drift or a different request contract is required, and stops after the first terminal response regardless of outcome.
