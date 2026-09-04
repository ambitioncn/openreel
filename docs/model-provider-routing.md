# OpenReel 模型与调用路由

最后核对：2026-08-20

本文记录 OpenReel 当前模型别名、服务端调用方式、已验证证据和路由边界。不得在本文、日志或客户端代码中记录 provider key、完整平台 key或账户专属 endpoint/model ID。

## 推荐生产路由

火山方舟同时存在 standard 与 direct 两套既有凭据/模型映射。商业短视频完整链路应使用：

```text
OPENREEL_VOLCENGINE_ROUTE_PREFERENCE=hybrid
OPENREEL_VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
OPENREEL_VOLCENGINE_DIRECT_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
```

`hybrid` 的选择规则：

- 图片、文本、视觉理解：使用 standard 映射与 `/api/v3`。
- 视频：使用 direct 映射与 `/api/plan/v3`。
- 不得把 Seedream 图片请求拼到 `/api/plan/v3`；该错误曾导致上游 502。
- 不得把 commercial-v2 启动器硬编码为 `direct`；direct 图片凭据在 standard-v3 图片端点曾返回 `ARK_PROVIDER_AUTH`。
- provider 选择与 endpoint 拼接的权威实现是 `src/ark.js`；回归覆盖在 `test/ark.test.js`。

## 模型清单

| OpenReel 别名 | 能力 | 服务端协议/路径 | 当前证据 |
| --- | --- | --- | --- |
| `seedream-5-lite` | 图片生成 | standard `/api/v3/images/generations` | 已有真实成功图片证据；commercial-v2 应走 hybrid 的 standard 分支 |
| `seedream-5-pro` | 图片生成 | standard `/api/v3/images/generations` | 已配置；尚不能用 Lite 的成功证据替代逐模型验收 |
| `seedance-2-fast` | 视频生成 | direct `/api/plan/v3/contents/generations/tasks`，同路径轮询 | 已有两段参考图驱动视频成功证据，支持 `first_frame` |
| `seedance-2` | 视频生成 | direct `/api/plan/v3/contents/generations/tasks`，同路径轮询 | 已配置；逐模型真实成功证据需单独保留 |
| `seed-2.1-turbo` | 文本/规划 | standard `/api/v3/chat/completions` | 已配置 |
| `seed-2.1-pro` | 文本/规划 | standard `/api/v3/chat/completions` | 已配置 |
| `embedding-vision` | 图片/视频理解 | standard `/api/v3/embeddings/multimodal` | 图片理解、视频理解均有真实成功证据 |
| `seedaudio-1.0` | 音频生成 | 独立 SeedAudio 适配器 | 有真实 MP3 及画布/时间线接入证据；不能假定当前适配器已开放执行 |
| Qwen TTS | 文本转语音 | 独立服务端 TTS 适配器 | 有真实 WAV 成功证据；默认关闭，必须以当前生产配置和授权为准 |
| `local-image` / `local-video` / `local-audio` | 本地演示 | 本地确定性实现 | 可用于零 provider 工作流，不代表真实生成模型质量 |

## OpenReel API 调用方式

客户端只调用 OpenReel 服务端，不直接接触 provider 凭据。创建任务：

```http
POST /api/v1/inference/jobs
X-OpenReel-API-Key: or_live_...
Content-Type: application/json
```

通用请求体：

```json
{
  "model": "seedream-5-lite",
  "capability": "image",
  "input": {
    "prompt": "9:16 product hero shot",
    "size": "2K",
    "watermark": false,
    "response_format": "url"
  },
  "idempotencyKey": "stable-client-generated-key"
}
```

视频示例（参考图作为首帧）：

```json
{
  "model": "seedance-2-fast",
  "capability": "video",
  "input": {
    "content": [
      { "type": "text", "text": "Slow camera push, stable product shot" },
      { "type": "image_url", "image_url": { "url": "https://validated-result.example/image" }, "role": "first_frame" }
    ],
    "ratio": "9:16",
    "resolution": "480p",
    "duration": 5,
    "generate_audio": false,
    "watermark": false
  },
  "idempotencyKey": "stable-client-generated-key"
}
```

异步任务用 `GET /api/v1/inference/jobs/:id` 轮询；成功后用 `GET /api/v1/inference/jobs/:id/asset` 下载结果。画布内调用使用租户授权的 `/api/v1/sessions/:sessionId/ark-jobs` 路径，但底层仍复用同一 Ark 配置、计费和安全边界。

## 强制安全与费用边界

- `OPENREEL_PAID_INFERENCE_ENABLED` 必须显式开启，否则在 provider 流量前返回 `PAID_INFERENCE_GATED`。
- 调用前必须有有效账号额度；系统先预留最大费用，成功后结算，失败释放预留。
- 每次调用使用稳定且唯一的 idempotency key，防止重复计费。
- 验收调用默认 `OPENREEL_ARK_MAX_RETRIES=0`，出现新 provider 错误立即停下，不盲重试。
- endpoint、结果 URL、DNS、MIME、大小和重定向均由服务端校验；客户端不得提交价格或结算用量。
- 模型“已配置”不等于“已逐个真实验收”；只有上表明确写有成功证据的模型才能宣称对应模式已验证。

## 证据索引

- `docs/m01-existing-real-provider-evidence-reconciliation-20260818.json`
- `docs/e01-historical-config-diagnostic-evidence.json`
- `docs/c01-e01-cp323-reference-conditioned-continuity-evidence-20260818.json`
- `docs/m01-vision-corrected-v2-execution-evidence.json`
- `runtime/a01-cp343-private/integration-evidence.json`
- `scripts/csv2-commercial-full-film-launcher.cjs`
- `scripts/csv2-commercial-full-film-runner.mjs`
