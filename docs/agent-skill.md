---
name: openreel-local
version: 1
description: Drive the local OpenReel creation-to-export API without paid credentials.
---

# OpenReel local Agent Skill

Base URL defaults to `http://127.0.0.1:4173/api/v1`. JSON errors are `{ "error": { "code", "message", "details"? } }`. Set `X-OpenReel-User` to a local user id; omission selects `local-owner` for the single-user default.

## Principal replay

1. `POST /projects` and `POST /projects/:id/sessions`.
2. `PUT /projects/:id/story` with `{title,synopsis,scenes:[{title,summary}]}`.
3. Upload raw bytes to `POST /projects/:pid/sessions/:sid/assets/references` with an exact supported `Content-Type` and optional `X-Filename`.
4. `PUT /projects/:id/storyboard` with ordered shots linking `sceneId`, prompt, duration, and reference asset ids.
5. Create typed nodes via `POST /sessions/:id/nodes`, then jobs via `POST /sessions/:id/jobs`. Optionally pass `modelId`, `capability`, `referenceAssetIds`, or deterministic `outcome:"failed"`.
6. Advance local jobs with `POST /jobs/:id/tick` and incrementally poll `GET /jobs/:id/progress?afterSeq=N` until terminal.
7. `PUT /projects/:id/timeline` with its current version and ordered video/audio tracks containing `{assetId,inPoint,outPoint,start}` clips.
8. `GET /projects/:id/exports/manifest`; download asset bytes from manifest URLs.

`npm run smoke:http` replays this sequence and prints a compact JSON artifact.

## Resource routes

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/users` | Create a local user. |
| `GET/POST` | `/projects` | List visible projects with `search`/`status`, or create. |
| `GET/PATCH` | `/projects/:id` | Snapshot, rename/archive with optimistic `version`. |
| `POST` | `/projects/:id/members` | Owner-only role assignment. |
| `GET` | `/projects/:id/assets?kind=&role=&search=` | Filtered isolated asset index. |
| `GET` | `/models` | Capability metadata for deterministic providers. |
| `PUT` | `/projects/:id/story`, `/storyboard`, `/timeline` | Structured authoring and edit decisions. |
| `GET` | `/projects/:id/exports/manifest` | Deterministic EDL/export manifest. |

Supported references: PNG/JPEG/WebP up to 8 MiB, MP4/WebM up to 32 MiB, MP3/WAV up to 16 MiB. A stale mutable-record version returns `409 VERSION_CONFLICT`; role denial returns `403 FORBIDDEN`; an unavailable model capability returns `422 UNSUPPORTED_CAPABILITY`.
