import test from "node:test";
import assert from "node:assert/strict";
import { safeAcceptanceStage, terminalJobError } from "../scripts/e01-runner-result.mjs";
import { readFileSync } from "node:fs";

test("E-01 runner preserves only a bounded terminal state, safe error code and local billing facts", () => {
  const error = terminalJobError(
    { state: "failed", error: { code: "ARK_TASK_FAILED", message: "provider-private detail" } },
    { subscription: { spentMicros: 0, reservedMicros: 0 }, reconciliation: { consistent: true } }
  );
  assert.deepEqual(
    { code: error.code, terminalState: error.terminalState, spentUnits: error.spentUnits, reservedUnits: error.reservedUnits, reconciliation: error.reconciliation },
    { code: "ARK_TASK_FAILED", terminalState: "failed", spentUnits: 0, reservedUnits: 0, reconciliation: true }
  );
  assert.equal(JSON.stringify(error).includes("provider-private"), false);
});

test("E-01 runner rejects untrusted terminal error fields", () => {
  const error = terminalJobError({ state: "private-state", error: { code: "private code https://secret.invalid" } }, {});
  assert.equal(error.code, "ARK_TASK_FAILED");
  assert.equal(error.terminalState, "failed");
  assert.equal(error.spentUnits, null);
  assert.equal(error.reservedUnits, null);
  assert.equal(error.reconciliation, null);
});

test("E-01 runner retains only allowlisted acceptance stages", () => {
  assert.equal(safeAcceptanceStage("asset_download"), "asset_download");
  assert.equal(safeAcceptanceStage("private-stage https://secret.invalid"), "unknown");
  assert.equal(safeAcceptanceStage(null), "unknown");
});

test("E-01 canvas acceptance uses the canonical asset byteLength field", () => {
  const source = readFileSync(new URL("../scripts/e01-cp288-direct-single-video-canvas.mjs", import.meta.url), "utf8");
  assert.match(source, /asset\.byteLength/);
  assert.doesNotMatch(source, /asset\.size\b/);
});

test("retained-video browser acceptance uses the authenticated asset URL and keeps Blob playback diagnostic", () => {
  const source = readFileSync(new URL("../scripts/e01-cp312-graphical-browser.mjs", import.meta.url), "utf8");
  assert.match(source, /directVideo\.src = assetUrl/);
  assert.match(source, /!observed\.directPlayback\.loaded/);
  assert.match(source, /blobObjectUrlPlayback: observed\.playback/);
  assert.doesNotMatch(source, /!observed\.playback\.loaded/);
});

test("retained-video runner writes provider bytes only behind the explicit temporary retention path", () => {
  const source = readFileSync(new URL("../scripts/e01-cp312-direct-single-video-canvas.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(process\.env\.OPENREEL_E01_RETAINED_MEDIA\) writeFileSync/);
  assert.match(source, /Buffer\.from\(download\.value\)/);
  const launcher = readFileSync(new URL("../scripts/e01-cp312-direct-isolated-launcher.cjs", import.meta.url), "utf8");
  assert.match(launcher, /OPENREEL_E01_RETAINED_MEDIA: "\/tmp\/openreel-cp318-retained\.mp4"/);
  assert.match(launcher, /"\/tmp\/openreel-cp318-retained\.mp4"/);
});

test("two-shot continuity runner freezes the exact exhausted authorization envelope", () => {
  const source = readFileSync(new URL("../scripts/e01-cp320-two-shot-canvas.mjs", import.meta.url), "utf8");
  assert.match(source, /MAX_UNITS = 13_890, MAX_SUBMISSIONS = 2/);
  assert.match(source, /OPENREEL_E01_CP320_EXECUTE: "true"/);
  assert.match(source, /OPENREEL_ARK_MAX_RETRIES: "0"/);
  assert.match(source, /assert\.equal\(submissions, 2\)/);
  assert.match(source, /for \(let index = 0; index < shots\.length; index \+= 1\)/);
  assert.equal((source.match(/submissions \+= 1/g) || []).length, 1);
});

test("two-shot continuity runner retains exactly two temporary outputs and launcher removes both", () => {
  const source = readFileSync(new URL("../scripts/e01-cp320-two-shot-canvas.mjs", import.meta.url), "utf8");
  assert.match(source, /OPENREEL_E01_RETAINED_MEDIA_PREFIX/);
  assert.match(source, /-\$\{index \+ 1\}\.mp4/);
  const launcher = readFileSync(new URL("../scripts/e01-cp320-direct-isolated-launcher.cjs", import.meta.url), "utf8");
  assert.match(launcher, /OPENREEL_E01_MAX_SUBMISSIONS: "2"/);
  assert.match(launcher, /OPENREEL_E01_MAX_UNITS: "13890"/);
  assert.match(launcher, /"\/tmp\/openreel-cp320-shot-1\.mp4"/);
  assert.match(launcher, /"\/tmp\/openreel-cp320-shot-2\.mp4"/);
  assert.match(launcher, /fs\.rmSync\(stateRoot, \{ recursive: true, force: true \}\)/);
});

test("two-shot browser acceptance requires both authenticated direct assets and timeline clips", () => {
  const source = readFileSync(new URL("../scripts/e01-cp320-graphical-browser.mjs", import.meta.url), "utf8");
  assert.match(source, /assert\.equal\(packet\.assetIds\.length, 2\)/);
  assert.match(source, /`\/api\/v1\/projects\/\$\{projectId\}\/assets\/\$\{assetId\}\/content`/);
  assert.match(source, /assert\.equal\(observed\.clipCount, 2\)/);
  assert.match(source, /observed\.outputs\.every\(value => value\.bytes > 0 && value\.playback\.loaded && value\.playback\.duration > 0\)/);
  assert.doesNotMatch(source, /createObjectURL/);
});

test("reference-conditioned runner binds shot one terminal frame to shot two and cleans every temporary byte", () => {
  const source = readFileSync(new URL("../scripts/e01-cp323-reference-two-shot-canvas.mjs", import.meta.url), "utf8");
  assert.match(source, /MAX_UNITS = 13_890, MAX_SUBMISSIONS = 2, MAX_REFERENCE_BYTES = 700_000/);
  assert.match(source, /"-sseof", "-0\.05"/); assert.match(source, /role: "first_frame"/); assert.match(source, /data:image\/jpeg;base64/);
  assert.match(source, /assert\.equal\(submissions, 2\)/); assert.equal((source.match(/submissions \+= 1/g) || []).length, 1);
  const launcher = readFileSync(new URL("../scripts/e01-cp323-direct-isolated-launcher.cjs", import.meta.url), "utf8");
  for (const name of ["openreel-cp323-shot-1.mp4", "openreel-cp323-shot-2.mp4", "openreel-cp323-reference.jpg", "openreel-cp323-browser.json"]) assert.match(launcher, new RegExp(name.replaceAll(".", "\\.")));
  assert.match(launcher, /maximumSubmissions\\?":2/); assert.match(launcher, /automaticRetries\\?":0/); assert.match(launcher, /maximumUnits\\?":13890/);
});
