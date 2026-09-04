import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("repository governance separates source, evidence, runtime and credential overlays", () => {
  const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  for (const entry of [".artifacts/", "artifacts/", "runtime/", "*.compact", "deploy/*.env", "deploy/*-credential.conf"]) assert.match(ignore, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const policy = readFileSync(new URL("../docs/repository-governance.md", import.meta.url), "utf8");
  for (const phrase of ["clean Git commit", "release-manifest.json", "/opt/openreel/current", "rollback.releaseId", "Phoenix is a legacy rollback site"]) assert.match(policy, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("acceptance evidence index is explicit and secret-safe by policy", () => {
  const index = JSON.parse(readFileSync(new URL("../docs/evidence/index.json", import.meta.url), "utf8"));
  assert.equal(index.schema, "openreel-acceptance-evidence-index/v1");
  assert.equal(index.policy.forbidSecrets, true);
  assert.equal(index.policy.forbidExpiringProviderUrls, true);
});

test("Beijing proxy candidate preserves derper and isolates internal operations", () => {
  const config = readFileSync(new URL("../deploy/nginx-openreel-beijing.conf", import.meta.url), "utf8");
  assert.match(config, /listen 4173 ssl/);
  assert.match(config, /server_name openreel\.io www\.openreel\.io/);
  assert.match(config, /proxy_pass http:\/\/127\.0\.0\.1:4273/);
  assert.match(config, /location = \/metrics \{ return 404; \}/);
  assert.match(config, /location = \/health\/ready \{ return 404; \}/);
  assert.doesNotMatch(config, /listen (80|443)/);
});
