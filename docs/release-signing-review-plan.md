# Release signing and independent review plan

Status: design only. No key exists, no manifest has been signed, and no artifact has been uploaded, published, deployed, or activated.

## Signed manifest contract

The existing `scripts/qualify-release-artifacts.mjs` manifest remains the canonical payload. `canonicalReleaseManifestBytes()` validates its exact version-1 schema, rejects extra or malformed fields, sorts object keys recursively, preserves the reviewed artifact-array order, and emits whitespace-free UTF-8 bytes. A future authorized signing ceremony must sign those exact bytes with an offline asymmetric key and retain these four separate files:

1. `release-manifest.json` — the canonical payload containing the fixed ordered artifact list, byte counts, and SHA-256 digests.
2. `release-manifest.sig` — a detached signature over the exact payload bytes.
3. `signing-key-id.txt` — a non-secret fingerprint identifying the reviewed public verification key.
4. `verification-report.json` — verifier version, payload digest, key fingerprint, signature result, artifact-integrity result, timestamp, and reviewer identity.

Verification must fail closed before any activation when the signature is absent, the key fingerprint is not allowlisted, the payload bytes differ, an artifact digest or byte count differs, the ordered artifact set changes, or verification tooling returns an unknown result. The private key must not enter this repository, CI logs, application storage, backups, or runtime environment variables. Algorithm and key-provider selection remain an explicit security-review decision; this document does not silently choose either.

Off-host retention must use a separately authorized immutable destination with restricted write access and tested retrieval. Uploading, key creation/import, signing, retention-policy changes, deployment, and rollback activation are external or credential-bearing actions and remain behind E-01/E-02 human gates.

## Independent review checklist

The reviewer must be someone other than the change author and must record pass, fail, or not-applicable plus a concrete evidence reference for every item.

- Confirm the release commit and dirty-worktree state are identified; unexplained files stop review.
- Re-run `npm test`, `npm run scan:secrets`, `npm run scan:dependencies`, `npm run qualify:reliability`, and `npm run qualify:release-artifacts` from the reviewed source.
- Confirm the manifest contains exactly the expected regular files in fixed order and rejects path escape, symlinks, count/order drift, byte drift, and digest drift.
- Confirm the proposed signature covers the exact canonical manifest bytes and verification occurs before restore, deployment, traffic switching, or rollback activation.
- Confirm private-key custody, public-key fingerprint approval, rotation, revocation, loss response, and two-person ceremony roles are documented without exposing secrets.
- Confirm the off-host destination is immutable for the retention window, separately access-controlled, retrievable, and not the same failure domain as the deployment host.
- Confirm backup/restore evidence uses an isolated destination and the rollback runbook names stop conditions, health checks, ownership, and recovery-forward criteria.
- Confirm E-01/E-02 explicitly authorize any staging load/chaos, credential use, signing ceremony, upload, deployment, process control, traffic change, or production rollback before it occurs.
- Confirm the final report distinguishes local qualification, staging evidence, and production evidence and does not claim project completion from this milestone.

Review fails if any required item lacks replayable evidence, a high-severity finding is unexplained, key custody is ambiguous, a gate is missing, or rollback cannot be stopped safely. A failed review produces a revision request; it never authorizes activation.

`src/release-review.js` makes the nine-item review packet machine-checkable. It requires a reviewer distinct from the author, the fixed ordered checklist, pass status and at least one evidence reference for every item, and an explicit `externalActionsExecuted=false` local boundary. Passing this validator proves only that a complete local review packet is internally consistent; it does not perform or replace the independent review, select a signing algorithm, create or use a key, authorize retention, or activate a release.
