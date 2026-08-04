# DATA-1 production persistence boundary

OpenReel production metadata uses SQLite through the Node 22 `node:sqlite` API. The database enables WAL, `synchronous=FULL`, foreign keys, and a five-second busy timeout. Schema changes are ordered SQL files in `migrations/`; each is applied once inside `BEGIN IMMEDIATE` and recorded in `schema_migrations`.

This is a practical single-VPS, single-writer-process boundary. It is not PostgreSQL and does not claim PostgreSQL availability, network concurrency, replication, row-level security, or failover semantics. Production must pin and test a Node 22 release because `node:sqlite` is marked experimental in Node 22. Multiple OpenReel processes sharing one database are outside the supported boundary; the revision compare-and-swap rejects stale writers rather than losing updates.

## Runtime layout

- `OPENREEL_DATABASE` defaults to `.data/openreel.sqlite`; its `-wal` and `-shm` siblings are part of the live database.
- `OPENREEL_ASSETS` defaults to `<database>.assets`. It must be a local durable filesystem, owned by the unprivileged service account, and must not contain symlinks.
- Asset paths derive only from SHA-256 hashes of project and asset IDs. Bytes are written to an exclusive temporary file, fsynced, atomically renamed, and the containing directory fsynced before metadata commit. Metadata stores byte length and SHA-256, which every read verifies.
- The database contains asset metadata only, never durable asset blobs. Failed database commits remove newly written asset files.

## Baseline migration and recovery

Set `OPENREEL_LEGACY_JSON` to the v1-v3 JSON baseline for the first start. Import only runs against an empty revision-zero database, extracts base64 asset bytes to the asset boundary, then commits all metadata transactionally. Re-running with the same baseline is a no-op, so the migration is replayable. Keep the source JSON until database and asset backups have been verified; the importer does not delete or rewrite it.

SQLite crash recovery uses its WAL and full synchronous mode. Backups/restores, process supervision, and multi-host operation belong to OPS-2 and are not claimed by DATA-1.

## Failure behavior

Malformed entity JSON, unknown entity kinds, missing asset files, digest/length mismatches, path mismatches, traversal attempts, and symlinks fail closed. Tenant/object authorization is checked before asset lookup or reads. A stale transaction returns `CONCURRENT_UPDATE` (HTTP 409 where exposed); callers may retry the complete operation against the refreshed store.

## Replay

```sh
node --test test/durable.test.js
npm test
```

The focused suite covers migration replay, migration registry state, transaction conflict and retry, restart recovery, database corruption, external asset storage, integrity failure, traversal/symlink defense, and cross-tenant IDOR negatives.
