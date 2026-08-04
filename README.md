# OpenReel

Production persistence configuration and its single-VPS SQLite boundary are documented in [docs/production-persistence.md](docs/production-persistence.md). Local OPS-1/OPS-2 configuration, observability, backup/restore, deployment rehearsal, rollback, and human-gated DNS/HTTPS procedures are in [docs/production-operations.md](docs/production-operations.md).

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Project status: **v0.2.0 public multi-user production baseline live at [openreel.io](https://openreel.io)**. The production launch contract and acceptance ledger are in `docs/production-launch-contract.md` and `docs/production-acceptance-ledger.json`.

OpenReel is an independently implemented, AI-native video workspace. The production baseline joins public registration and secure sessions with project management, canvas nodes, structured storyboards, deterministic multimodal generation, timeline decisions, tenant isolation, durable persistence, and a versioned agent API in one creation-to-export workflow. It uses no paid model or credential; deterministic local providers validate the workflow but do not claim commercial AI output quality.

## Run and verify

The production server requires a pinned Node.js 22 release (for built-in SQLite) and has no package runtime dependencies. Library consumers may still use the in-memory/legacy test stores on Node.js 20+.

```bash
npm run dev
npm test
npm run smoke:http
npm run smoke:cli
npm run smoke:render
```

The server persists metadata to `.data/openreel.sqlite` and asset bytes to `.data/openreel.sqlite.assets`. Override these with `OPENREEL_DATABASE` and `OPENREEL_ASSETS`. `OPENREEL_LEGACY_JSON` selects a replayable v1-v3 JSON baseline to import into an empty database. See the production persistence document for transaction, migration, storage, and runtime limits. The legacy JSON store remains available only as a compatibility/test adapter.

## Product workflow

1. Create, list, open, rename, or archive a project and create a session.
2. Author an ordered structured story and scenes, then shots with prompt, duration, references, and generated asset links.
3. Upload image, video, or audio references. Search/filter the isolated project asset index.
4. Route image, video, or audio work through the capability-based registry. The deterministic local providers require no credentials and expose structured unsupported-capability/provider-failure errors.
5. Put generated assets into ordered video/audio tracks with trim and start ranges.
6. Retrieve the `openreel-edl/v1` edit manifest or render and download a deterministic local H.264 MP4 preview with AAC audio when an audio track is present.

The desktop UI retains canvas pan/zoom and node editing, adds project rename/archive and story/export controls, has loading/empty/error/success states, and collapses to a narrow-screen layout at 760 px. In production, protected API routes derive identity from expiring server-side sessions; spoofed identity headers are ignored. Owner/editor may write, viewer may read/export, and only owners manage membership. Cookie mutations require CSRF protection.

## API and evidence

All integrations should use `/api/v1`; legacy unversioned lifecycle routes remain for the accepted UI baseline. See [Agent Skill](docs/agent-skill.md) for the complete route and replay contract, [acceptance evidence](docs/acceptance-evidence.json) for item-by-item total-contract proof, and the [LibTV parity matrix](docs/libtv-parity-matrix.md) for carefully bounded external evidence.

Generation fixtures validate deterministic routing, lifecycle, byte persistence and interchange—not model quality. Generated node video bytes remain boundary fixtures, audio is a minimal WAV fixture, and images are deterministic SVGs. Final timeline export uses local ffmpeg 8.1 to create a playable deterministic preview composition; no production codec quality is claimed.

## License

OpenReel is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you modify OpenReel and make it available to users over a network, you must offer those users access to the corresponding source code as required by the license.
