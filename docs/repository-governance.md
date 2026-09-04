# OpenReel repository and release governance

## Artifact classes

| Class | Canonical location | Git policy | Retention |
| --- | --- | --- | --- |
| Source and deploy templates | repository root, `src/`, `scripts/`, `deploy/`, `test/` | tracked and reviewed | permanent |
| Curated acceptance evidence | `docs/evidence/` plus its index | tracked, redacted, content-addressed | permanent for accepted releases |
| Raw qualification output | `.artifacts/`, `artifacts/`, `runtime/` | ignored | archive or expire after evidence curation |
| Runtime state and secrets | `/var/lib/openreel`, production environment overlays | never committed | protected backup policy |

Files under `docs/` that predate this policy remain historical evidence. New evidence must be copied into `docs/evidence/<release-id>/`, listed in `docs/evidence/index.json`, and checked for credentials or expiring provider URLs before review.

## Authoritative production identity

A production version is authoritative only when one immutable record binds all of:

1. a clean Git commit;
2. an immutable release directory `/opt/openreel/releases/<release-id>`;
3. `release-manifest.json`, whose `source.commit`, tree digest and file digests verify;
4. the `/opt/openreel/current` symlink target;
5. an explicit `rollback.releaseId` and its verified state-backup manifest.

The release ID is the primary key. A directory name, Git commit, deployment timestamp, or symlink target by itself is not a production version. `scripts/build-release-manifest.mjs` fails closed for dirty source by default and `scripts/verify-release-manifest.mjs` rejects file, commit, release, or rollback drift.

## Promotion rules

- Build and verify locally from a clean reviewed commit.
- Record dependency, secret, regression, browser, backup/restore and rollback evidence in the release evidence index.
- Copy to a new immutable Beijing release directory; never mutate an activated release.
- Verify manifest before switching `current`.
- Switch traffic only after the separately authorized production/DNS gate.
- Preserve the prior release and verified backup until the observation window closes.
- A rollback switches to the manifest-bound rollback release and restores only the matching verified state snapshot.

Phoenix is a legacy rollback site, not the version authority. Beijing is authoritative after the domain cutover passes external HTTPS and product E2E acceptance.
