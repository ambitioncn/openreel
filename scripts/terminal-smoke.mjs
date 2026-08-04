import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatform } from "../src/platform.js";

const mode = process.argv[2], file = join(mkdtempSync(join(tmpdir(), `openreel-${mode}-`)), "platform.json");
let platform = createPlatform({ file });
const make = (email, password = "smoke-pass-123") => { platform.register({ email, password }); return platform.login({ email, password }).token; };
const owner = make("owner@smoke.test"), team = platform.createTeam(owner, { name: "Smoke team" });
const workflow = { schema: "openreel-workflow/v1", template: "smoke", version: 1, nodes: [{ id: "story", type: "script" }, { id: "frame", type: "image" }, { id: "reel", type: "video" }] };

if (mode === "import") {
  const a = platform.importWorkflow(owner, team.id, workflow), b = platform.importWorkflow(owner, team.id, workflow); assert.equal(a.id, b.id); assert.throws(() => platform.importWorkflow(owner, team.id, { ...workflow, version: 0 }), e => e.code === "INVALID_WORKFLOW");
} else if (mode === "budget") {
  const q = platform.quote(owner, team.id, { kind: "video", units: 2 }), r = platform.reserve(owner, team.id, { kind: "video", units: 2, idempotencyKey: "smoke" }); assert.equal(q.amount, 80); assert.equal(platform.reserve(owner, team.id, { kind: "video", units: 2, idempotencyKey: "smoke" }).id, r.id); platform.settle(owner, team.id, r.id, { actualAmount: 75 }); assert.throws(() => platform.reserve(owner, team.id, { kind: "video", units: 1000 }), e => e.code === "INSUFFICIENT_BUDGET");
} else if (mode === "auth") {
  const member = make("member@smoke.test"), invite = platform.invite(owner, team.id, { email: "member@smoke.test", role: "viewer" }); platform.acceptInvite(member, invite.id); assert.throws(() => platform.reserve(member, team.id, { kind: "image" }), e => e.code === "FORBIDDEN"); assert.throws(() => platform.authenticate("invalid"), e => e.code === "UNAUTHENTICATED");
} else if (mode === "tenant") {
  const other = make("other@smoke.test"), otherTeam = platform.createTeam(other, { name: "Other" }); platform.objects.put(team.tenantId, "key", "A"); platform.objects.put(otherTeam.tenantId, "key", "B"); assert.equal(platform.objects.get(team.tenantId, "key"), "A"); const imported = platform.importWorkflow(owner, team.id, workflow); assert.throws(() => platform.planAutomation(other, otherTeam.id, { intent: "cross", workflowId: imported.id }), e => e.code === "FORBIDDEN");
} else if (mode === "workflow") {
  const imported = platform.importWorkflow(owner, team.id, workflow), plan = platform.planAutomation(owner, team.id, { intent: "Preserve character identity", workflowId: imported.id }), first = platform.runAutomation(owner, team.id, plan, "smoke-run"), replay = platform.runAutomation(owner, team.id, plan, "smoke-run"); assert.equal(first.id, replay.id); assert.equal(first.intent, plan.intent); assert.equal(first.status, "succeeded"); assert.equal(first.cost, 30);
} else throw new Error(`unknown terminal smoke: ${mode}`);

platform = createPlatform({ file });
assert.ok(platform.login({ email: "owner@smoke.test", password: "smoke-pass-123" }).token);
console.log(JSON.stringify({ smoke: mode, status: "passed", persisted: true }));
