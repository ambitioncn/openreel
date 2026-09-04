import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createOpenReelServer } from "../server.mjs";
import { createCommercialJobLifecycle, createMemoryCommercialJobStore } from "../src/commercial-job-lifecycle.js";
import { createWorkbenchCommercialService } from "../src/workbench-commercial.js";

const qualifiedRun = () => ({ status: "qualified", releaseEligible: true, quality: { accepted: true } });
import { createMemoryStore } from "../src/core.js";
import { renderTimelineVideo } from "../src/render.js";
import { createFileAgentFilmStore } from "../src/agent-film-store.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const request = async (base, path, options = {}) => { const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...options }); return { status: response.status, body: await response.json() }; };
const sourceVideo = () => renderTimelineVideo({ tracks: [{ kind: "video", clips: [{ assetId: "source", inPoint: 0, outPoint: 1, start: 0 }] }] }, 1).bytes;
const sourceAudio = () => { const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-f", "wav", "pipe:1"], { encoding: null }); assert.equal(result.status, 0); return result.stdout; };
const sourcePng = () => { const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=320x80", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { encoding: null }); assert.equal(result.status, 0); return result.stdout; };
const planningResult = JSON.stringify({ title: "海滩舞蹈", synopsis: "一段全新的海滩舞蹈", hooks: ["迎着海风起舞", "浪花就是节拍", "定格夕阳一刻"], selectedHook: 0, shots: [{ title: "开场", line: "舞蹈开始", visual: "9:16 wide shot of a dancer on a beach", broll: "Waves", duration: 5 }] });
const policySafety = { identityReference: { width: 1024, height: 1024, sha256: "a".repeat(64) }, declarations: { referenceRights: "owned_or_licensed", performer: "fictional_adult", brands: "none", publicFigures: "none" } };
const policyPrompt = "fictional adult performer handles an unbranded cloth in a controlled studio";

test("reviewed production asset upload binds caption and music to the current storyboard revision", () => {
  const store = createMemoryStore(), project = store.createProject({ name: "Production uploads" }), story = store.upsertStory(project.id, { scenes: [{ title: "Beach" }] }), storyboard = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Dance", duration: 1 }] }), current = store.snapshot(project.id), binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version };
  const caption = store.uploadCommercialProductionAsset(project.id, { ...binding, stage: "caption", shotId: storyboard.shots[0].id, captionText: "Beach", mimeType: "image/png", filename: "caption.png", bytes: sourcePng() });
  const music = store.uploadCommercialProductionAsset(project.id, { ...binding, stage: "music", sourceDeclaration: "User-created track", mimeType: "audio/wav", filename: "music.wav", bytes: sourceAudio() });
  assert.equal(caption.metadata.identity.storyboardVersion, storyboard.version); assert.equal(caption.metadata.identity.shotId, storyboard.shots[0].id); assert.equal(caption.metadata.reviewed, true);
  assert.equal(music.metadata.identity.storyboardVersion, storyboard.version); assert.equal(music.metadata.review.status, "reviewed"); assert.equal(music.metadata.review.sourceDeclaration, "User-created track");
  assert.throws(() => store.uploadCommercialProductionAsset(project.id, { ...binding, projectVersion: binding.projectVersion - 1, stage: "music", sourceDeclaration: "old", mimeType: "audio/wav", filename: "old.wav", bytes: sourceAudio() }), error => error.code === "VERSION_CONFLICT");
  assert.throws(() => store.uploadCommercialProductionAsset(project.id, { ...binding, stage: "caption", shotId: storyboard.shots[0].id, captionText: "", mimeType: "image/png", filename: "empty.png", bytes: sourcePng() }), error => error.code === "COMMERCIAL_ASSET_INVALID");
});

test("project refresh repopulates production shot choices before a caption upload", () => {
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /function render\(\) \{\s*renderFinalWorkbench\(\);\s*renderCommercialJob\(\);/);
  assert.match(app, /workbench-caption-shot.*replaceChildren/);
  assert.match(app, /selectedCaptionIds\.has\(asset\.id\)/, "refresh must preserve reviewed caption selections while another production asset uploads");
});

test("commercial execution is monitored independently from the long execute response", () => {
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const startHandler = app.slice(app.indexOf('$("#commercial-start").onclick'), app.indexOf('$("#commercial-retry").onclick'));
  assert.match(app, /function executeCommercialJob\(jobId\)/);
  assert.match(app, /void api\(`\/api\/v1\/projects\/\$\{executionProjectId\}\/commercial\/jobs\/\$\{jobId\}\/execute`[\s\S]*?\.catch\(\(\) => \{\}\)/);
  assert.match(app, /while \(commercialMonitorJobId === jobId\)/);
  assert.match(app, /contentType\.includes\("json"\)/, "HTML proxy errors must not be parsed as JSON");
  assert.doesNotMatch(startHandler, /commercialJob = await api\([^\n]+\/execute/);
});

test("Agent film entry point replays preparation and requires the shared commercial confirmation gate", async t => {
  let planningCalls = 0, providerCalls = 0;
  const arkService = { models: () => [{ name: "seed-2.1-pro", capability: "text" }], submit: async (principal, request) => { assert.deepEqual(principal, { kind: "account", accountId: "local-owner" }); planningCalls += 1; return { id: "agent-plan-1", model: request.model, capability: "text", status: "succeeded", result: { content: planningResult }, usage: { costMicros: 5, currency: "CNY", unitScale: 1_000_000 }, updatedAt: "2026-08-22T00:00:00.000Z" }; } };
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { providerCalls += 1; return qualifiedRun(); } } });
  const server = createOpenReelServer(undefined, undefined, { arkService, commercialLifecycle: lifecycle, commercialEstimate: ({ shotCount }) => ({ estimatedCny: shotCount * 2, models: { image: "seedream", video: "seedance" } }) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Agent film" }) })).body;
  const prepare = { method: "POST", body: JSON.stringify({ action: "prepare", brief: "美女在海滩跳舞", type: "story", duration: 5, projectVersion: project.version, idempotencyKey: "agent-film-1" }) };
  const first = await request(base, `/api/v1/projects/${project.id}/agent-films`, prepare), replay = await request(base, `/api/v1/projects/${project.id}/agent-films`, prepare);
  assert.equal(first.status, 201); assert.equal(first.body.action, "prepared"); assert.equal(first.body.quote.confirmationRequired, true); assert.equal(first.body.quote.paidActionStarted, false);
  assert.equal(replay.body.quote.id, first.body.quote.id); assert.equal(planningCalls, 1); assert.equal(providerCalls, 0);
  const unbound = await request(base, `/api/v1/projects/${project.id}/agent-films`, { method: "POST", body: JSON.stringify({ action: "execute", quoteId: first.body.quote.id, confirmed: true, idempotencyKey: "agent-film-execute-1" }) });
  assert.equal(unbound.status, 409); assert.equal(unbound.body.error.code, "AGENT_FILM_PREPARATION_MISMATCH"); assert.equal(providerCalls, 0);
  const unconfirmed = await request(base, `/api/v1/projects/${project.id}/agent-films`, { method: "POST", body: JSON.stringify({ action: "execute", quoteId: first.body.quote.id, idempotencyKey: "agent-film-execute-1", preparationIdempotencyKey: "agent-film-1" }) });
  assert.equal(unconfirmed.status, 409); assert.equal(providerCalls, 0);
  const preparedProgress = await request(base, `/api/v1/projects/${project.id}/agent-films/agent-film-1/progress`);
  assert.equal(preparedProgress.body.status, "prepared"); assert.equal(preparedProgress.body.execution, null);
  const executed = await request(base, `/api/v1/projects/${project.id}/agent-films`, { method: "POST", body: JSON.stringify({ action: "execute", quoteId: first.body.quote.id, confirmed: true, idempotencyKey: "agent-film-execute-1", preparationIdempotencyKey: "agent-film-1" }) });
  assert.equal(executed.status, 201); assert.equal(executed.body.status, "succeeded"); assert.equal(providerCalls, 1);
  const progress = await request(base, `/api/v1/projects/${project.id}/agent-films/agent-film-1/progress`);
  assert.equal(progress.status, 200); assert.equal(progress.body.schema, "openreel-agent-film-progress/v1"); assert.equal(progress.body.status, "succeeded"); assert.equal(progress.body.execution.id, executed.body.id);
  const executedReplay = await request(base, `/api/v1/projects/${project.id}/agent-films`, { method: "POST", body: JSON.stringify({ action: "execute", quoteId: first.body.quote.id, confirmed: true, idempotencyKey: "agent-film-execute-1", preparationIdempotencyKey: "agent-film-1" }) });
  assert.equal(executedReplay.body.id, executed.body.id); assert.equal(providerCalls, 1);
});

test("Agent film preparation and status replay across server restart", async t => {
  let planningCalls = 0;
  const arkService = { models: () => [{ name: "seed-2.1-pro", capability: "text" }], submit: async () => { planningCalls += 1; return { id: "agent-plan-restart", model: "seed-2.1-pro", status: "succeeded", result: { content: planningResult }, usage: { costMicros: 5, currency: "CNY", unitScale: 1_000_000 } }; } };
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => qualifiedRun() } });
  const store = createMemoryStore(), file = join(mkdtempSync(join(tmpdir(), "openreel-agent-film-")), "runs.json");
  const durableStore = createFileAgentFilmStore(file);
  const options = () => ({ arkService, commercialLifecycle: lifecycle, commercialEstimate: () => ({ estimatedCny: 2, models: { image: "seedream", video: "seedance" } }), agentFilmStore: createFileAgentFilmStore(file) });
  let server = createOpenReelServer(store, undefined, options());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Restart" }) })).body;
  const body = JSON.stringify({ action: "prepare", brief: "美女在海滩跳舞", type: "story", duration: 5, projectVersion: project.version, idempotencyKey: "restart-key" });
  const first = await request(base, `/api/v1/projects/${project.id}/agent-films`, { method: "POST", body });
  await new Promise(resolve => server.close(resolve));
  server = createOpenReelServer(store, undefined, options()); t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}`;
  const status = await request(base, `/api/v1/projects/${project.id}/agent-films/restart-key`);
  const replay = await request(base, `/api/v1/projects/${project.id}/agent-films`, { method: "POST", body });
  assert.equal(status.status, 200); assert.equal(status.body.quote.id, first.body.quote.id);
  assert.equal(replay.body.quote.id, first.body.quote.id); assert.equal(planningCalls, 1);
  assert.equal(durableStore.get("other-owner", project.id, "restart-key"), null);
  assert.equal((await request(base, `/api/v1/projects/${project.id}/agent-films/missing`)).status, 404);
  assert.equal((await request(base, `/api/v1/projects/${project.id}/agent-films/missing/progress`)).status, 404);
});

test("Agent film progress rejects a mismatched preparation before provider execution", async t => {
  let providerCalls = 0;
  const arkService = { models: () => [{ name: "seed-2.1-pro", capability: "text" }], submit: async () => ({ id: "plan", model: "seed-2.1-pro", capability: "text", status: "succeeded", result: { content: planningResult }, usage: { costMicros: 5, currency: "CNY", unitScale: 1_000_000 }, updatedAt: "2026-08-22T00:00:00.000Z" }) };
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { providerCalls += 1; return qualifiedRun(); } } });
  const server = createOpenReelServer(undefined, undefined, { arkService, commercialLifecycle: lifecycle, commercialEstimate: () => ({ estimatedCny: 2, models: { image: "seedream", video: "seedance" } }) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Mismatch" }) })).body;
  const prepared = await request(base, `/api/v1/projects/${project.id}/agent-films`, { method: "POST", body: JSON.stringify({ action: "prepare", brief: "美女在海滩跳舞", type: "story", duration: 5, projectVersion: project.version, idempotencyKey: "right-preparation" }) });
  assert.equal(prepared.status, 201);
  const mismatch = await request(base, `/api/v1/projects/${project.id}/agent-films`, { method: "POST", body: JSON.stringify({ action: "execute", quoteId: prepared.body.quote.id, confirmed: true, idempotencyKey: "execute-mismatch", preparationIdempotencyKey: "missing-preparation" }) });
  assert.equal(mismatch.status, 409); assert.equal(mismatch.body.error.code, "AGENT_FILM_PREPARATION_MISMATCH"); assert.equal(providerCalls, 0);
});

test("commercial workbench requires a bound quote and explicit confirmation before provider execution", async t => {
  let providerCalls = 0;
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async principal => { assert.deepEqual(principal, { kind: "account", accountId: "local-owner" }); providerCalls += 1; return qualifiedRun(); } } });
  const server = createOpenReelServer(undefined, undefined, { enforceCommercialPolicySafety: true, commercialLifecycle: lifecycle, commercialEstimate: ({ shotCount }) => ({ estimatedCny: shotCount * 2, models: { image: "seedream", video: "seedance" } }) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Commercial" }) })).body;
  const story = (await request(base, `/api/v1/projects/${project.id}/story`, { method: "PUT", body: JSON.stringify({ scenes: [{ title: "One", summary: "Dance" }] }) })).body;
  const storyboard = (await request(base, `/api/v1/projects/${project.id}/storyboard`, { method: "PUT", body: JSON.stringify({ shots: [{ sceneId: story.scenes[0].id, prompt: policyPrompt, duration: 5 }] }) })).body;
  const current = (await request(base, `/api/v1/projects/${project.id}`)).body;
  const binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version };
  const rejectedPlaceholder = await request(base, `/api/v1/projects/${project.id}/commercial/quote`, { method: "POST", body: JSON.stringify({ ...binding, ...policySafety, identityReference: { ...policySafety.identityReference, width: 1, height: 1 }, quality: "fast" }) });
  assert.equal(rejectedPlaceholder.status, 422); assert.equal(rejectedPlaceholder.body.error.code, "COMMERCIAL_STORYBOARD_POLICY_PREFLIGHT_INVALID"); assert.equal(providerCalls, 0);
  const rejectedDeclaration = await request(base, `/api/v1/projects/${project.id}/commercial/quote`, { method: "POST", body: JSON.stringify({ ...binding, identityReference: policySafety.identityReference, quality: "fast" }) });
  assert.equal(rejectedDeclaration.status, 422); assert.equal(providerCalls, 0);
  const quote = await request(base, `/api/v1/projects/${project.id}/commercial/quote`, { method: "POST", body: JSON.stringify({ ...binding, ...policySafety, quality: "fast" }) });
  assert.equal(quote.status, 409); assert.equal(quote.body.error.code, "COMMERCIAL_DIRECTOR_BINDING_REQUIRED"); assert.equal(providerCalls, 0);
});

test("production commercial quote rejects incomplete director bindings before estimation or job creation", () => {
  let estimates = 0;
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => qualifiedRun() } });
  const state = { project: { version: 1 }, story: { version: 1, scenes: [{ summary: "Dance" }], production: {} }, storyboard: { version: 1, shots: [{ id: "shot-1", prompt: policyPrompt, duration: 5, continuityEntityUsages: [], referenceAssetIds: [] }] }, assets: [], continuityEntities: [] };
  const service = createWorkbenchCommercialService({ lifecycle, snapshot: () => state, estimate: () => { estimates += 1; return { estimatedCny: 2, models: { image: "seedream", video: "seedance" } }; } });
  assert.throws(() => service.quote({ accountId: "owner" }, "project", { projectVersion: 1, storyVersion: 1, storyboardVersion: 1, requirePolicySafety: true, ...policySafety }), error => error.code === "COMMERCIAL_DIRECTOR_BINDING_REQUIRED" && error.status === 409);
  assert.equal(estimates, 0);
});

test("commercial quote binds generated music selection and its bounded maximum without provider calls", async t => {
  let providerCalls = 0, estimateInput;
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { providerCalls += 1; return qualifiedRun(); } } });
  const server = createOpenReelServer(undefined, undefined, { commercialLifecycle: lifecycle, commercialEstimate: input => { estimateInput = input; return { estimatedCny: 12, models: { image: "seedream", video: "seedance" } }; } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Generated music" }) })).body;
  const story = (await request(base, `/api/v1/projects/${project.id}/story`, { method: "PUT", body: JSON.stringify({ scenes: [{ title: "One", summary: "Dance" }] }) })).body;
  const storyboard = (await request(base, `/api/v1/projects/${project.id}/storyboard`, { method: "PUT", body: JSON.stringify({ shots: [{ sceneId: story.scenes[0].id, prompt: "Beach", duration: 5 }] }) })).body;
  const current = (await request(base, `/api/v1/projects/${project.id}`)).body, musicGeneration = { enabled: true, model: "seed-audio-1.0", prompt: "轻快无歌词配乐", durationSeconds: 5 }, musicRightsConfirmation = { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: "2026-08-23T00:00:00.000Z", sourceDeclaration: "provider-generated music" };
  const quote = await request(base, `/api/v1/projects/${project.id}/commercial/quote`, { method: "POST", body: JSON.stringify({ projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version, musicGeneration, musicRightsConfirmation }) });
  assert.equal(quote.status, 201); assert.equal(quote.body.productionAssets.musicGeneration.confirmed, true); assert.equal(estimateInput.production.musicGeneration.model, "seed-audio-1.0"); assert.equal(providerCalls, 0);
  const created = await request(base, `/api/v1/projects/${project.id}/commercial/jobs`, { method: "POST", body: JSON.stringify({ quoteId: quote.body.id, confirmed: true, idempotencyKey: "music-quote-1" }) });
  assert.equal(created.body.input.production.musicGeneration.prompt, "轻快无歌词配乐"); assert.equal(providerCalls, 0);
});

test("commercial initial and redo quotes include evaluation cost and reject inconsistent totals", async () => {
  const projectStore = createMemoryStore(), project = projectStore.createProject({ name: "Evaluation quote" }, "local-owner"), story = projectStore.upsertStory(project.id, { scenes: [{ title: "One", summary: "Dance" }] }, "local-owner"), storyboard = projectStore.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Dance", duration: 5 }] }, "local-owner"), current = projectStore.snapshot(project.id, "local-owner");
  const jobStore = createMemoryCommercialJobStore([{ schema: "openreel-commercial-job/v1", id: "failed-source", ownerId: "local-owner", idempotencyKey: "source", status: "failed", input: { projectId: project.id, projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version, quality: "fast" }, result: { shots: [{ id: storyboard.shots[0].id, status: "failed" }] } }]);
  const lifecycle = createCommercialJobLifecycle({ store: jobStore, orchestrator: { run: async () => qualifiedRun() } }), estimate = () => ({ estimatedCny: 3, generationEstimatedCny: 2, evaluationEstimatedCny: 1, models: { image: "seedream", video: "seedance" } }), service = createWorkbenchCommercialService({ lifecycle, snapshot: (projectId, ownerId) => projectStore.snapshot(projectId, ownerId), estimate });
  const principal = { accountId: "local-owner" }, binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version };
  const initialCost = service.quote(principal, project.id, binding).cost;
  assert.deepEqual({ ...initialCost, evaluation: undefined }, { currency: "CNY", estimatedCny: 3, generationEstimatedCny: 2, evaluationEstimatedCny: 1, evaluation: undefined, perActionLimitCny: 100 });
  assert.equal(initialCost.evaluation.schema, "openreel-commercial-perceptual-evaluation/v2"); assert.equal(initialCost.evaluation.calls, 2); assert.equal(initialCost.evaluation.shotDimensions.length + initialCost.evaluation.finalDimensions.length, 8); assert.match(initialCost.evaluation.necessity, /actual generated shot bytes/);
  const initial = service.quote(principal, project.id, binding), created = service.confirm(principal, project.id, { quoteId: initial.id, confirmed: true, idempotencyKey: "evaluation-persist" });
  assert.equal(created.cost.generationEstimatedCny, 2); assert.equal(created.cost.evaluationEstimatedCny, 1); assert.equal(created.cost.evaluation.calls, 2); assert.equal(created.input.quoteCost.evaluationEstimatedCny, 1);
  const invalid = createWorkbenchCommercialService({ lifecycle, snapshot: (projectId, ownerId) => projectStore.snapshot(projectId, ownerId), estimate: () => ({ estimatedCny: 3, generationEstimatedCny: 2, evaluationEstimatedCny: 2, models: { image: "seedream", video: "seedance" } }) });
  assert.throws(() => invalid.quote(principal, project.id, binding), error => error.code === "COMMERCIAL_COST_LIMIT");
  projectStore.retainCommercialArtifact(project.id, { ...binding, kind: "image", mimeType: "image/png", bytes: Buffer.from("generated"), shotId: storyboard.shots[0].id, stage: "image", provider: "ark", model: "seedream", providerJobId: "source-image" }, "local-owner");
  const redo = service.redoQuote(principal, project.id, "failed-source"), redoCost = redo.cost; assert.equal(redo.binding.projectVersion, projectStore.snapshot(project.id, "local-owner").project.version); assert.equal(redoCost.evaluationEstimatedCny, 1); assert.equal(redoCost.evaluation.calls, 2);
});

test("initial commercial quote records fresh candidate lineage and rejects prior-job inheritance", () => {
  let providerCalls = 0;
  const projectStore = createMemoryStore(), project = projectStore.createProject({ name: "Fresh candidate" }, "local-owner"), story = projectStore.upsertStory(project.id, { scenes: [{ title: "One", summary: "Dance" }] }, "local-owner"), storyboard = projectStore.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Dance", duration: 5 }] }, "local-owner"), current = projectStore.snapshot(project.id, "local-owner");
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => { providerCalls += 1; return qualifiedRun(); } } }), service = createWorkbenchCommercialService({ lifecycle, snapshot: (projectId, ownerId) => projectStore.snapshot(projectId, ownerId), estimate: () => ({ estimatedCny: 3, generationEstimatedCny: 2, evaluationEstimatedCny: 1, models: { image: "seedream", video: "seedance" } }) });
  const principal = { accountId: "local-owner" }, binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version };
  for (const inherited of [{ sourceJobId: "cp69" }, { redo: {} }, { preservedShotIds: [] }, { preservedAssetIds: [] }]) assert.throws(() => service.quote(principal, project.id, { ...binding, ...inherited }), error => error.code === "COMMERCIAL_FRESH_CANDIDATE_REQUIRED" && error.status === 422);
  const quote = service.quote(principal, project.id, binding);
  assert.deepEqual(quote.candidate, { schema: "openreel-commercial-candidate-lineage/v1", mode: "fresh", sourceJobId: null, inheritedShotIds: [], inheritedAssetIds: [] });
  const job = service.confirm(principal, project.id, { quoteId: quote.id, confirmed: true, idempotencyKey: "fresh-candidate-1" });
  assert.deepEqual(job.input.candidate, quote.candidate); assert.equal(job.input.redo, undefined); assert.equal(providerCalls, 0);
});

test("commercial workbench rejects stale revision binding before creating a job", async t => {
  const lifecycle = createCommercialJobLifecycle({ orchestrator: { run: async () => qualifiedRun() } });
  const server = createOpenReelServer(undefined, undefined, { commercialLifecycle: lifecycle, commercialEstimate: () => ({ estimatedCny: 1, models: { image: "seedream", video: "seedance" } }) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, project = (await request(base, "/api/v1/projects", { method: "POST", body: JSON.stringify({ name: "Stale" }) })).body;
  const story = (await request(base, `/api/v1/projects/${project.id}/story`, { method: "PUT", body: JSON.stringify({ scenes: [{ title: "One" }] }) })).body;
  const storyboard = (await request(base, `/api/v1/projects/${project.id}/storyboard`, { method: "PUT", body: JSON.stringify({ shots: [{ sceneId: story.scenes[0].id, prompt: "One", duration: 5 }] }) })).body;
  const stale = await request(base, `/api/v1/projects/${project.id}/commercial/quote`, { method: "POST", body: JSON.stringify({ projectVersion: project.version, storyVersion: story.version, storyboardVersion: storyboard.version }) });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, "VERSION_CONFLICT");
});

test("shot redo is separately quoted, confirmed and idempotent without replacing successful shots", async t => {
  let providerCalls = 0;
  const sourceDirector = { schema: "openreel-commercial-director-context/v1", ready: true, shots: [{ shotId: "bound-shot", ready: true }] };
  const projectStore = createMemoryStore();
  const project = projectStore.createProject({ name: "Redo" }, "local-owner");
  const story = projectStore.upsertStory(project.id, { scenes: [{ title: "One", summary: "Dance" }] }, "local-owner");
  const storyboard = projectStore.upsertStoryboard(project.id, { shots: [
    { sceneId: story.scenes[0].id, prompt: "Keep", duration: 5 },
    { sceneId: story.scenes[0].id, prompt: "Redo", duration: 5 }
  ] }, "local-owner");
  const current = projectStore.snapshot(project.id, "local-owner"), binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version };
  sourceDirector.shots[0].shotId = storyboard.shots[1].id;
  const jobStore = createMemoryCommercialJobStore([{ schema: "openreel-commercial-job/v1", id: "source-job", ownerId: "local-owner", idempotencyKey: "source", status: "failed", input: { projectId: project.id, ...binding, script: "Dance", storyboard, director: sourceDirector, policySafety, production: story.production, models: { image: "seedream", video: "seedance" }, quality: "fast" }, result: { shots: [{ id: storyboard.shots[0].id, status: "succeeded", assetIds: ["keep-image", "keep-video"] }, { id: storyboard.shots[1].id, status: "failed" }] } }]);
  const lifecycle = createCommercialJobLifecycle({ store: jobStore, orchestrator: { run: async () => { providerCalls += 1; return qualifiedRun(); } } });
  const server = createOpenReelServer(projectStore, undefined, { commercialLifecycle: lifecycle, commercialEstimate: ({ shotCount }) => ({ estimatedCny: shotCount * 2, models: { image: "seedream", video: "seedance" } }) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const quote = await request(base, `/api/v1/projects/${project.id}/commercial/jobs/source-job/redo/quote`, { method: "POST", body: "{}" });
  assert.equal(quote.status, 201); assert.equal(quote.body.cost.estimatedCny, 2); assert.deepEqual(quote.body.shotIds, [storyboard.shots[1].id]); assert.deepEqual(quote.body.preservedShotIds, [storyboard.shots[0].id]); assert.equal(providerCalls, 0);
  const denied = await request(base, `/api/v1/projects/${project.id}/commercial/jobs/source-job/redo/jobs`, { method: "POST", body: JSON.stringify({ quoteId: quote.body.id, idempotencyKey: "redo-1" }) });
  assert.equal(denied.status, 409); assert.equal(providerCalls, 0);
  const options = { method: "POST", body: JSON.stringify({ quoteId: quote.body.id, confirmed: true, idempotencyKey: "redo-1" }) };
  const created = await request(base, `/api/v1/projects/${project.id}/commercial/jobs/source-job/redo/jobs`, options), replay = await request(base, `/api/v1/projects/${project.id}/commercial/jobs/source-job/redo/jobs`, options);
  assert.equal(created.status, 201); assert.equal(replay.body.id, created.body.id); assert.deepEqual(created.body.input.redo.preservedShotIds, [storyboard.shots[0].id]); assert.deepEqual(created.body.input.storyboard.shots.map(shot => shot.id), [storyboard.shots[1].id]); assert.deepEqual(created.body.input.director, sourceDirector); assert.deepEqual(created.body.input.policySafety, policySafety); assert.equal(providerCalls, 0);
  projectStore.upsertStoryboard(project.id, { version: storyboard.version, shots: storyboard.shots }, "local-owner");
  const stale = await request(base, `/api/v1/projects/${project.id}/commercial/jobs/source-job/redo/quote`, { method: "POST", body: "{}" });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, "VERSION_CONFLICT"); assert.equal(providerCalls, 0);
});

test("shot redo preserves historical qualified shots through quality-bound generation assets", async t => {
  const projectStore = createMemoryStore(), project = projectStore.createProject({ name: "Historical redo" }, "local-owner"), story = projectStore.upsertStory(project.id, { scenes: [{ title: "One", summary: "Dance" }] }, "local-owner"), storyboard = projectStore.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Keep", duration: 5 }, { sceneId: story.scenes[0].id, prompt: "Redo", duration: 5 }] }, "local-owner"), current = projectStore.snapshot(project.id, "local-owner"), binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version };
  const source = { schema: "openreel-commercial-job/v1", id: "historical-source", ownerId: "local-owner", idempotencyKey: "historical", status: "failed", input: { projectId: project.id, ...binding, quality: "fast" }, result: { shots: [{ id: storyboard.shots[0].id, status: "succeeded", assetIds: [], quality: { generationAsset: { assetId: "retained-quality-asset", sha256: "a".repeat(64), status: "succeeded" } } }, { id: storyboard.shots[1].id, status: "failed" }] } };
  const lifecycle = createCommercialJobLifecycle({ store: createMemoryCommercialJobStore([source]), orchestrator: { run: async () => qualifiedRun() } }), server = createOpenReelServer(projectStore, undefined, { commercialLifecycle: lifecycle, commercialEstimate: ({ shotCount }) => ({ estimatedCny: shotCount * 2, models: { image: "seedream", video: "seedance" } }) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await request(`http://127.0.0.1:${server.address().port}`, `/api/v1/projects/${project.id}/commercial/jobs/historical-source/redo/quote`, { method: "POST", body: "{}" });
  assert.equal(response.status, 201); assert.deepEqual(response.body.preservedAssetIds, ["retained-quality-asset"]); assert.deepEqual(response.body.preservedShots, [{ shotId: storyboard.shots[0].id, assetIds: ["retained-quality-asset"] }]);
});

test("commercial artifact sink retains bound assets and rejects continuation after storyboard drift", () => {
  const store = createMemoryStore(); store.createUser({ id: "owner", name: "Owner" });
  const project = store.createProject({ name: "Bound" }, "owner"), story = store.upsertStory(project.id, { scenes: [{ title: "One", summary: "Dance" }] }, "owner"), storyboard = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Beach", duration: 5 }] }, "owner"), current = store.snapshot(project.id, "owner");
  const binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version }, shotId = storyboard.shots[0].id;
  const image = store.retainCommercialArtifact(project.id, { ...binding, kind: "image", mimeType: "image/png", bytes: Buffer.from("png"), shotId, stage: "image", provider: "ark", model: "seedream", providerJobId: "image-1" }, "owner");
  const video = store.retainCommercialArtifact(project.id, { ...binding, kind: "video", mimeType: "video/mp4", bytes: Buffer.from("video"), duration: 5, shotId, stage: "video", provider: "ark", model: "seedance", providerJobId: "video-1" }, "owner");
  const reused = store.retainCommercialArtifact(project.id, { ...binding, kind: "image", mimeType: "image/png", bytes: Buffer.from("reused"), shotId, stage: "image-reuse", provider: "reviewed-reuse", model: "retained", providerJobId: "image-reuse-1", reuseOfAssetId: image.id }, "owner");
  const retained = store.snapshot(project.id, "owner"); assert.equal(retained.assets.length, 3); assert.equal(retained.timeline.tracks[0].clips[0].assetId, video.id); assert.equal(image.metadata.identity.storyboardVersion, storyboard.version); assert.equal(image.metadata.identity.origin, "fresh"); assert.equal(reused.metadata.identity.origin, "explicit-reuse"); assert.equal(reused.metadata.reuseOfAssetId, image.id);
  store.upsertStoryboard(project.id, { version: storyboard.version, shots: storyboard.shots.map(shot => ({ ...shot, prompt: "Changed" })) }, "owner");
  assert.throws(() => store.retainCommercialArtifact(project.id, { ...binding, kind: "audio", mimeType: "audio/wav", bytes: Buffer.from("wav"), duration: 5, stage: "audio", provider: "qwen", model: "qwen", providerJobId: "audio-1" }, "owner"), error => error.code === "VERSION_CONFLICT");
});

test("commercial composition produces a playable revision-bound MP4 and rejects stale storyboards", () => {
  const store = createMemoryStore(); store.createUser({ id: "owner", name: "Owner" });
  const project = store.createProject({ name: "Compose" }, "owner"), story = store.upsertStory(project.id, { scenes: [{ title: "One", summary: "Dance" }] }, "owner"), storyboard = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Beach", duration: 1 }] }, "owner"), current = store.snapshot(project.id, "owner");
  const binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version }, shotId = storyboard.shots[0].id;
  const videoBytes = sourceVideo(), audioBytes = sourceAudio();
  const image = store.retainCommercialArtifact(project.id, { ...binding, kind: "image", mimeType: "image/png", bytes: Buffer.from("png"), shotId, stage: "image", provider: "ark", model: "seedream", providerJobId: "image-compose" }, "owner");
  const video = store.retainCommercialArtifact(project.id, { ...binding, kind: "video", mimeType: "video/mp4", bytes: videoBytes, duration: 1, shotId, stage: "video", provider: "ark", model: "seedance", providerJobId: "video-compose" }, "owner");
  const audio = store.retainCommercialArtifact(project.id, { ...binding, kind: "audio", mimeType: "audio/wav", bytes: audioBytes, duration: 1, stage: "audio", provider: "qwen", model: "qwen", providerJobId: "audio-compose" }, "owner");
  const plan = { schema: "openreel-commercial-composition/v1", duration: 1, safeZone: { top: 0.08, right: 0.16, bottom: 0.2, left: 0.08 }, timeline: [{ shotId, start: 0, end: 1, caption: "Beach" }], audio: { voiceGainDb: -3, musicGainDb: -18, speechDuckDb: -9, peakCeilingDbfs: -1, targetLufs: -14 } };
  const render = store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [image.id, video.id, audio.id] }, "owner");
  const content = store.assetContent(project.id, render.asset.id, undefined, "owner");
  assert.equal(render.asset.mimeType, "video/mp4"); assert.ok(content.bytes.length > 1_000); assert.equal(content.bytes.subarray(4, 8).toString("ascii"), "ftyp"); assert.equal(render.asset.metadata.renderer, "ffmpeg-source-media");
  assert.notDeepEqual(content.bytes, renderTimelineVideo({ tracks: [{ kind: "video", clips: [{ assetId: video.id, inPoint: 0, outPoint: 1, start: 0 }] }, { kind: "audio", clips: [{ assetId: audio.id, inPoint: 0, outPoint: 1, start: 0 }] }] }, 1).bytes);
  assert.equal(render.sourceStoryboardVersion, storyboard.version); assert.deepEqual(render.sourceArtifacts, [image.id, video.id, audio.id]);
  const caption = store.retainCommercialArtifact(project.id, { ...binding, kind: "image", mimeType: "image/png", bytes: sourcePng(), shotId, stage: "caption", provider: "review", model: "human", providerJobId: "caption-compose", reviewed: true, captionText: "Beach" }, "owner");
  const music = store.retainCommercialArtifact(project.id, { ...binding, kind: "audio", mimeType: "audio/wav", bytes: sourceAudio(), stage: "music", provider: "upload", model: "user", providerJobId: "music-compose", productionAsset: true, review: { status: "reviewed", sourceDeclaration: "user upload" } }, "owner");
  const avRender = store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [image.id, video.id, audio.id], productionArtifacts: [caption.id, music.id], musicRightsConfirmation: { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: "2026-08-22T00:00:00.000Z" } }, "owner"), avContent = store.assetContent(project.id, avRender.asset.id, undefined, "owner");
  assert.deepEqual(avRender.asset.metadata.sourceArtifacts, [image.id, video.id, audio.id, caption.id, music.id]);
  assert.ok(avContent.bytes.length > 1_000); assert.notEqual(avRender.inputDigest, render.inputDigest); assert.deepEqual(avRender.asset.metadata.identity, render.asset.metadata.identity);
  assert.throws(() => store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [video.id] }, "owner"), error => error.code === "COMMERCIAL_COMPOSITION_INVALID");
  store.upsertStoryboard(project.id, { version: storyboard.version, shots: storyboard.shots }, "owner");
  assert.throws(() => store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [video.id, audio.id] }, "owner"), error => error.code === "VERSION_CONFLICT");
});

test("commercial composition rejects unrelated timeline media instead of rendering old work", () => {
  const store = createMemoryStore(); store.createUser({ id: "owner", name: "Owner" });
  const project = store.createProject({ name: "No stale media" }, "owner"), story = store.upsertStory(project.id, { scenes: [{ title: "One" }] }, "owner"), storyboard = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Current", duration: 1 }] }, "owner"), current = store.snapshot(project.id, "owner");
  const binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version }, shotId = storyboard.shots[0].id;
  const videoBytes = sourceVideo();
  const video = store.retainCommercialArtifact(project.id, { ...binding, kind: "video", mimeType: "video/mp4", bytes: videoBytes, duration: 1, shotId, stage: "video", provider: "ark", model: "seedance", providerJobId: "current-video" }, "owner");
  const audio = store.retainCommercialArtifact(project.id, { ...binding, kind: "audio", mimeType: "audio/wav", bytes: sourceAudio(), duration: 1, stage: "audio", provider: "qwen", model: "qwen", providerJobId: "current-audio" }, "owner");
  store.retainCommercialArtifact(project.id, { ...binding, kind: "video", mimeType: "video/mp4", bytes: videoBytes, duration: 1, shotId, stage: "video-redo", provider: "ark", model: "seedance", providerJobId: "unrelated-video" }, "owner");
  const plan = { schema: "openreel-commercial-composition/v1", duration: 1, timeline: [{ shotId, start: 0, end: 1, caption: "Current" }], audio: {} };
  assert.throws(() => store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [video.id, audio.id] }, "owner"), error => error.code === "VERSION_CONFLICT");
});

test("redo composition creates a new complete timeline and render without modifying the source render", () => {
  const store = createMemoryStore(); store.createUser({ id: "owner", name: "Owner" });
  const project = store.createProject({ name: "Redo compose" }, "owner"), story = store.upsertStory(project.id, { scenes: [{ title: "One" }, { title: "Two" }] }, "owner"), storyboard = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Keep", duration: 1 }, { sceneId: story.scenes[1].id, prompt: "Replace", duration: 1 }] }, "owner"), current = store.snapshot(project.id, "owner");
  const binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version }, bytes = sourceVideo();
  const oldVideos = storyboard.shots.map((shot, index) => store.retainCommercialArtifact(project.id, { ...binding, kind: "video", mimeType: "video/mp4", bytes, duration: 1, shotId: shot.id, stage: `video-${index}`, provider: "ark", model: "seedance", providerJobId: `old-${index}` }, "owner"));
  const oldAudio = store.retainCommercialArtifact(project.id, { ...binding, kind: "audio", mimeType: "audio/wav", bytes: sourceAudio(), duration: 2, stage: "audio-old", provider: "qwen", model: "qwen", providerJobId: "audio-old" }, "owner");
  const plan = { schema: "openreel-commercial-composition/v1", duration: 2, timeline: storyboard.shots.map((shot, index) => ({ shotId: shot.id, start: index, end: index + 1, caption: shot.prompt })), audio: {} };
  const sourceRender = store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [...oldVideos.map(video => video.id), oldAudio.id] }, "owner"), sourceBytes = store.assetContent(project.id, sourceRender.asset.id, undefined, "owner").bytes;
  const replacement = store.retainCommercialArtifact(project.id, { ...binding, kind: "video", mimeType: "video/mp4", bytes, duration: 1, shotId: storyboard.shots[1].id, stage: "video-redo", provider: "ark", model: "seedance", providerJobId: "redo-video" }, "owner");
  const redoAudio = store.retainCommercialArtifact(project.id, { ...binding, kind: "audio", mimeType: "audio/wav", bytes: sourceAudio(), duration: 2, stage: "audio-redo", provider: "qwen", model: "qwen", providerJobId: "redo-audio" }, "owner");
  const redo = store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [oldVideos[0].id, replacement.id, redoAudio.id], redo: { sourceJobId: "source", replaceShotIds: [storyboard.shots[1].id] } }, "owner");
  assert.notEqual(redo.asset.id, sourceRender.asset.id); assert.deepEqual(redo.sourceArtifacts, [oldVideos[0].id, replacement.id, redoAudio.id]); assert.deepEqual(store.snapshot(project.id, "owner").timeline.tracks.flatMap(track => track.clips).map(clip => clip.assetId), [oldVideos[0].id, replacement.id, redoAudio.id]); assert.deepEqual(store.assetContent(project.id, sourceRender.asset.id, undefined, "owner").bytes, sourceBytes);
  assert.throws(() => store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [oldVideos[0].id, oldVideos[1].id, replacement.id, redoAudio.id], redo: { sourceJobId: "source", replaceShotIds: [storyboard.shots[1].id] } }, "owner"), error => error.code === "VERSION_CONFLICT");
});

test("redo composition accepts only explicitly preserved historical project revisions", () => {
  const store = createMemoryStore(); store.createUser({ id: "owner", name: "Owner" });
  const project = store.createProject({ name: "Historical redo" }, "owner"), story = store.upsertStory(project.id, { scenes: [{ title: "Keep" }, { title: "Replace" }] }, "owner"), storyboard = store.upsertStoryboard(project.id, { shots: [{ sceneId: story.scenes[0].id, prompt: "Keep", duration: 1 }, { sceneId: story.scenes[1].id, prompt: "Replace", duration: 1 }] }, "owner"), oldSnapshot = store.snapshot(project.id, "owner");
  const oldBinding = { projectVersion: oldSnapshot.project.version, storyVersion: story.version, storyboardVersion: storyboard.version }, videoBytes = sourceVideo();
  const preserved = store.retainCommercialArtifact(project.id, { ...oldBinding, kind: "video", mimeType: "video/mp4", bytes: videoBytes, duration: 1, shotId: storyboard.shots[0].id, stage: "video-preserved", provider: "ark", model: "seedance", providerJobId: "historical-preserved" }, "owner");
  const afterPreserve = store.snapshot(project.id, "owner");
  store.updateProject(project.id, { version: afterPreserve.project.version, name: "Historical redo v2" }, "owner");
  const current = store.snapshot(project.id, "owner"), binding = { projectVersion: current.project.version, storyVersion: story.version, storyboardVersion: storyboard.version };
  const replacement = store.retainCommercialArtifact(project.id, { ...binding, kind: "video", mimeType: "video/mp4", bytes: videoBytes, duration: 1, shotId: storyboard.shots[1].id, stage: "video-replacement", provider: "ark", model: "seedance", providerJobId: "current-replacement" }, "owner");
  const audio = store.retainCommercialArtifact(project.id, { ...binding, kind: "audio", mimeType: "audio/wav", bytes: sourceAudio(), duration: 2, stage: "audio-redo", provider: "qwen", model: "qwen", providerJobId: "current-audio" }, "owner");
  const plan = { schema: "openreel-commercial-composition/v1", duration: 2, timeline: storyboard.shots.map((shot, index) => ({ shotId: shot.id, start: index, end: index + 1, caption: shot.prompt })), audio: {} };
  assert.throws(() => store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [preserved.id, replacement.id, audio.id], redo: { sourceJobId: "source", replaceShotIds: [storyboard.shots[1].id] } }, "owner"), error => error.code === "VERSION_CONFLICT");
  const render = store.composeCommercialProject(project.id, { ...binding, plan, sourceArtifacts: [preserved.id, replacement.id, audio.id], redo: { sourceJobId: "source", replaceShotIds: [storyboard.shots[1].id], preservedShots: [{ shotId: storyboard.shots[0].id, assetIds: [preserved.id] }] } }, "owner");
  assert.deepEqual(render.sourceArtifacts, [preserved.id, replacement.id, audio.id]);
  assert.deepEqual(store.snapshot(project.id, "owner").timeline.tracks.flatMap(track => track.clips).map(clip => clip.assetId), [preserved.id, replacement.id, audio.id]);
});
