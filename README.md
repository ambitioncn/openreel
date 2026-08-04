# OpenReel

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Project status: **v0.1.0 local product baseline complete**. The terminal contract and acceptance ledger are in `docs/project-completion-contract.md` and `docs/project-acceptance-ledger.json`.

OpenReel is an independently implemented, local-first AI-native video workspace. The complete local baseline joins project management, canvas nodes, structured storyboards, deterministic multimodal generation, timeline decisions, permissions, persistence, and a versioned agent API in one creation-to-export workflow. It uses no paid model or credential and makes no production codec or security claim.

## Run and verify

Requires Node.js 20+ and has no runtime dependencies.

```bash
npm run dev
npm test
npm run smoke:http
npm run smoke:cli
npm run smoke:render
```

The server atomically persists schema-versioned JSON to `.data/openreel.json`. Override it with `OPENREEL_DATA=/absolute/path/state.json`; setting a temporary path is recommended for test runs. A schema-v1 state is migrated to v2 on load and durably rewritten on the next mutation. The test suite uses isolated temporary directories.

## Product workflow

1. Create, list, open, rename, or archive a project and create a session.
2. Author an ordered structured story and scenes, then shots with prompt, duration, references, and generated asset links.
3. Upload image, video, or audio references. Search/filter the isolated project asset index.
4. Route image, video, or audio work through the capability-based registry. The deterministic local providers require no credentials and expose structured unsupported-capability/provider-failure errors.
5. Put generated assets into ordered video/audio tracks with trim and start ranges.
6. Retrieve the `openreel-edl/v1` edit manifest or render and download a deterministic local H.264 MP4 preview with AAC audio when an audio track is present.

The desktop UI retains canvas pan/zoom and node editing, adds project rename/archive and story/export controls, has loading/empty/error/success states, and collapses to a narrow-screen layout at 760 px. The local roles baseline uses `X-OpenReel-User`: owner/editor may write; viewer may read/export; only owner manages membership. This is local authorization, not production authentication.

## API and evidence

All integrations should use `/api/v1`; legacy unversioned lifecycle routes remain for the accepted UI baseline. See [Agent Skill](docs/agent-skill.md) for the complete route and replay contract, [acceptance evidence](docs/acceptance-evidence.json) for item-by-item total-contract proof, and the [LibTV parity matrix](docs/libtv-parity-matrix.md) for carefully bounded external evidence.

Generation fixtures validate deterministic routing, lifecycle, byte persistence and interchange—not model quality. Generated node video bytes remain boundary fixtures, audio is a minimal WAV fixture, and images are deterministic SVGs. Final timeline export uses local ffmpeg 8.1 to create a playable deterministic preview composition; no production codec quality is claimed.

## License

OpenReel is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you modify OpenReel and make it available to users over a network, you must offer those users access to the corresponding source code as required by the license.
