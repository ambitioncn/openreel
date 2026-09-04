import test from "node:test";
import assert from "node:assert/strict";
import { createCommercialProviderOrchestrator } from "../src/commercial-provider-orchestrator.js";

function fixtures(overrides = {}) {
  let serial = 0; const jobs = new Map(), submissions = [], artifacts = [];
  const arkService = { models: () => [{ name: "image-real", capability: "image", currency: "CNY", unitScale: 1_000_000, maxCostMicros: 2_000_000 }, { name: "video-real", capability: "video", currency: "CNY", unitScale: 1_000_000, maxCostMicros: 20_000_000 }], submit: async (principal, request) => { assert.deepEqual(principal, { kind: "account", accountId: "owner" }); submissions.push(request); const id = `job-${++serial}`, job = { id, model: request.model, capability: request.capability, status: request.capability === "video" ? "running" : "succeeded", result: request.capability === "image" ? { url: `https://ark.example/${id}.png` } : null }; jobs.set(id, job); return { ...job }; }, poll: async (principal, id) => { assert.deepEqual(principal, { kind: "account", accountId: "owner" }); const job = jobs.get(id), done = { ...job, status: "succeeded", result: { url: `https://ark.example/${id}.mp4` } }; jobs.set(id, done); return done; }, download: async (principal, id) => { assert.deepEqual(principal, { kind: "account", accountId: "owner" }); return { mimeType: jobs.get(id).capability === "image" ? "image/png" : "video/mp4", bytes: Buffer.from(id) }; } };
  const audioRequests = [], qwenTtsService = { synthesize: async request => { audioRequests.push(request); return { mimeType: "audio/wav", bytes: Buffer.from("wav") }; } };
  const artifactSink = async (principal, asset) => { const manifest = { id: `asset-${artifacts.length + 1}`, kind: asset.kind, shotId: asset.shotId || null, mimeType: asset.mimeType, provider: asset.provider }; artifacts.push({ principal, ...asset, manifest }); return manifest; };
  const compositionSink = async (_principal, composition) => ({ id: "render-1", mimeType: "video/mp4", byteLength: 1024, ...composition.binding });
  const qualityInspector = async (_principal, request) => ({ schema: "openreel-commercial-quality-result/v2", accepted: true, releaseEligible: true, evaluation: { provider: "fixture", model: "free-fixture-v1", usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 0 } }, shots: request.storyboard.map(shot => ({ shotId: shot.id, accepted: true, evidence: "fixture" })), final: { accepted: true, evidence: "fixture" } });
  const masterImageInspector = async () => ({ schema: "openreel-commercial-master-image-quality/v1", accepted: true, model: "fixture-vision", usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 0 }, evidence: { fixture: true } });
  const referenceArtifactSource = async (_principal, request) => request.assetIds.map(id => ({ id, mimeType: "image/png", bytes: Buffer.from("reference") }));
  const sliceVideo = (bytes, start, duration, zoom) => Buffer.from(`${bytes}:${start}:${duration}:${zoom}`);
  return { arkService, qwenTtsService, artifactSink, compositionSink, qualityInspector, masterImageInspector, referenceArtifactSource, sliceVideo, submissions, artifacts, audioRequests, ...overrides };
}

const directorShot = shotId => ({ shotId, ready: true, roleEntityIds: ["product-1"], sceneEntityIds: ["scene-1"], style: "warm premium commercial", continuityEntityUsages: [{ entityId: "product-1", kind: "product", version: 1, referenceAssetIds: ["ref-1"] }, { entityId: "scene-1", kind: "scene", version: 1, referenceAssetIds: ["ref-1"] }], referenceAssetIds: ["ref-1"] });
const input = { projectId: "project-1", projectVersion: 1, storyVersion: 1, storyboardVersion: 1, script: "A compact light for every trip.", storyboard: { shots: [{ id: "s1", prompt: "Product on a clean table", duration: 5 }, { id: "s2", prompt: "Product used outdoors", duration: 5 }] }, director: { schema: "openreel-commercial-director-context/v1", ready: true, shots: [directorShot("s1"), directorShot("s2")] }, production: { voice: "natural", captions: true, music: "light", safeZone: "tiktok" }, models: { image: "image-real", video: "video-real" }, idempotencyKey: "commercial-1", language: "english" };

test("commercial orchestration sends each shot through real image/video interfaces and adds reviewed audio", async () => {
  const f = fixtures(), service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  const result = await service.run({ kind: "account", accountId: "owner" }, input);
  assert.equal(result.status, "qualified"); assert.equal(result.generationStatus, "succeeded"); assert.equal(result.qualificationStatus, "approved"); assert.equal(result.releaseEligible, true); assert.equal(result.shotCount, 2); assert.equal(result.artifacts.length, 5); assert.equal(f.submissions.length, 4);
  assert.deepEqual(result.shots.map(shot => shot.assetIds.length), [2, 2]);
  assert.deepEqual(f.submissions.map(item => item.idempotencyKey), ["commercial-1:shot:0:image", "commercial-1:shot:0:video", "commercial-1:shot:1:image", "commercial-1:shot:1:video"]);
  assert.match(f.submissions[0].input.image, /^data:image\/png;base64,/);
  assert.equal(f.submissions[1].input.content[1].role, "first_frame"); assert.match(f.submissions[1].input.content[1].image_url.url, /^https:\/\/ark\.example\//);
  assert.deepEqual(result.artifacts.map(item => item.kind), ["image", "video", "image", "video", "audio"]); assert.equal(result.budget.perActionLimit, 100);
  assert.deepEqual(f.audioRequests, [{ input: input.script, response_format: "wav", language: "english" }]);
  assert.equal(result.composition.render.mimeType, "video/mp4"); assert.equal(result.composition.plan.timeline.length, 2);
  assert.deepEqual(result.cost, { currency: "CNY", status: "unsettled", settledCny: null, generationSettledCny: null, evaluationSettledCny: 0 });
});

test("commercial orchestration routes first-frame video generation through zero-cost ModelClaw H3", async () => {
  const f = fixtures(), originalModels = f.arkService.models;
  f.arkService.models = () => originalModels().map(item => item.capability === "video" ? { ...item, name: "minimax-h3-fl2va-q5-turbo-v4", provider: "modelclaw-comfyui", costed: false, maxCostMicros: 0, schema: { modes: ["image-to-video"], durations: [5], maxReferences: 1 } } : item);
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  const result = await service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [{ ...input.storyboard.shots[0], prompt: "fictional adult folds and raises a blue cloth across the face", duration: 4 }] }, director: { ...input.director, shots: [input.director.shots[0]] }, models: { image: "image-real", video: "minimax-h3-fl2va-q5-turbo-v4" } });
  const videoRequest = f.submissions.find(item => item.capability === "video");
  assert.equal(videoRequest.input.duration, 5);
  assert.equal(videoRequest.input.ratio, undefined);
  assert.equal(videoRequest.input.content[1].role, "first_frame");
  const imageRequest = f.submissions.find(item => item.capability === "image");
  assert.match(imageRequest.input.prompt, /FIRST FRAME DISCIPLINE:/);
  assert.match(imageRequest.input.prompt, /hands, and key object fully visible and separated/);
  assert.match(imageRequest.input.prompt, /natural, clearly visible face and complete coherent eyes/);
  assert.match(imageRequest.input.prompt, /match the supplied reference image closely/);
  assert.match(imageRequest.input.prompt, /never produce a blank, featureless, masked, blurred, melted, distorted, cropped, or obscured face/);
  assert.match(videoRequest.input.content[0].text, /ONE ACTION:/);
  assert.match(videoRequest.input.content[0].text, /one slow shallow dolly-in only/i);
  assert.match(videoRequest.input.content[0].text, /END ANCHOR:/);
  assert.match(videoRequest.input.content[0].text, /LOCK:/);
  assert.match(videoRequest.input.content[0].text, /NEVER:/);
  assert.doesNotMatch(imageRequest.input.prompt, /\bfolds\b|raises a blue cloth/i);
  assert.doesNotMatch(videoRequest.input.content[0].text, /\bfolds\b|raises a blue cloth/i);
  assert.equal(videoRequest.input.prompt_director.primitive, "dolly_in");
  assert.equal(result.artifacts.find(item => item.kind === "video").provider, "modelclaw-comfyui");
});

test("H3 object-only first frames preserve the no-person contract", async () => {
  const f = fixtures(), originalModels = f.arkService.models;
  f.arkService.models = () => originalModels().map(item => item.capability === "video" ? { ...item, name: "minimax-h3-fl2va-q5-turbo-v4", provider: "modelclaw-comfyui", costed: false, maxCostMicros: 0 } : item);
  const shot = { id: "s1", prompt: "object-only unbranded blue scarf in an empty neutral studio, no people, no faces", duration: 4 };
  await createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 }).run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [shot] }, director: { ...input.director, shots: [input.director.shots[0]] }, models: { image: "image-real", video: "minimax-h3-fl2va-q5-turbo-v4" } });
  const prompt = f.submissions.find(item => item.capability === "image").input.prompt;
  const videoPrompt = f.submissions.find(item => item.capability === "video").input.content[0].text;
  assert.match(prompt, /Do not introduce any person, face, or body part/);
  assert.match(prompt, /exactly one small rigid unbranded product/);
  assert.match(prompt, /stable tabletop/);
  assert.match(prompt, /No cloth, fabric, flexible sheet/);
  assert.doesNotMatch(prompt, /natural, clearly visible face/);
  assert.match(videoPrompt, /ONE ACTION:/);
  assert.match(videoPrompt, /barely perceptible turn/);
  assert.match(videoPrompt, /END ANCHOR:/);
  assert.match(videoPrompt, /same image side/);
  assert.match(videoPrompt, /NEVER: people, faces, hands, floating product/);
});

test("H3 object-only three-shot plan uses one shared master and one timecoded native generation", async () => {
  let inspectedStoryboard;
  const f = fixtures({ qualityInspector: async (_principal, request) => { inspectedStoryboard = request.storyboard; return { schema: "openreel-commercial-quality-result/v2", accepted: true, releaseEligible: true, evaluation: { provider: "fixture", model: "free-fixture-v1", usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 0 } }, shots: request.storyboard.map(shot => ({ shotId: shot.id, accepted: true, evidence: "fixture" })), final: { accepted: true, evidence: "fixture" } }; } }), originalModels = f.arkService.models;
  f.arkService.models = () => originalModels().map(item => item.capability === "video" ? { ...item, name: "minimax-h3-fl2va-q5-turbo-v4", provider: "modelclaw-comfyui", costed: false, maxCostMicros: 0 } : item);
  const shots = [
    { id: "s1", prompt: "object-only locked-off frontal establishing shot; no people, no faces; no object motion", duration: 4 },
    { id: "s2", prompt: "object-only controlled product reveal; no people, no faces", duration: 4 },
    { id: "s3", prompt: "object-only stable hero closing shot; no people, no faces; no object motion", duration: 4 }
  ];
  const directorShots = shots.map((shot, index) => ({ ...input.director.shots[0], shotId: shot.id, referenceAssetIds: ["reference-1"], roleEntityIds: [`role-${index}`], sceneEntityIds: [`scene-${index}`] }));
  await createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 }).run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots }, director: { ...input.director, shots: directorShots }, models: { image: "image-real", video: "minimax-h3-fl2va-q5-turbo-v4" } });
  const images = f.submissions.filter(item => item.capability === "image"), videos = f.submissions.filter(item => item.capability === "video");
  assert.equal(images.length, 1); assert.equal(videos.length, 1);
  assert.match(images[0].input.prompt, /SHARED PRODUCT\/ENVIRONMENT MASTER FRAME/);
  assert.match(images[0].input.prompt, /geometry, glaze\/material finish, handle orientation, color, texture, tabletop, background, lighting/);
  assert.match(images[0].input.prompt, /exactly one full-frame still photograph, never a storyboard/);
  assert.match(images[0].input.prompt, /split screens, multiple panels, collage/);
  for (const shot of shots) assert.doesNotMatch(images[0].input.prompt, new RegExp(shot.prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(videos[0].input.content[0].text, /complete 5\.0 seconds/);
  assert.match(videos[0].input.content[0].text, /camera is completely locked/i);
  assert.match(videos[0].input.content[0].text, /derived only after generation by deterministic time slicing and digital crop/);
  assert.match(videos[0].input.content[0].text, /no words, letters, numbers, captions, labels, split screens, multiple panels/);
  assert.match(videos[0].input.content[0].text, /Never create a close-up, alternate angle, second product/);
  const slices = f.artifacts.filter(item => item.kind === "video");
  assert.deepEqual(slices.map(item => item.stage), ["video-slice-0", "video-slice-1", "video-slice-2"]);
  assert.deepEqual(slices.map(item => item.sourceWindow), [
    { start: 0, end: 0.04, outputDuration: 1.4, digitalZoom: 1, freezeFirstFrame: true },
    { start: 0, end: 0.04, outputDuration: 1.4, digitalZoom: 1.24, freezeFirstFrame: true },
    { start: 0, end: 0.04, outputDuration: 1.4, digitalZoom: 1.1, freezeFirstFrame: true }
  ]);
  assert.match(inspectedStoryboard[0].prompt, /ESTABLISH FALLBACK/);
  assert.match(inspectedStoryboard[1].prompt, /DETAIL FALLBACK/);
  assert.match(inspectedStoryboard[2].prompt, /HERO FALLBACK/);
  assert.ok(inspectedStoryboard.every(shot => /Do not require camera motion, object motion, a new angle, or a later source frame/.test(shot.prompt)));
  assert.equal(new Set(f.artifacts.filter(item => item.kind === "video").map(item => item.providerJobId)).size, 1);
});

test("H3 three-shot mode rejects a bad byte-bound master before video, audio, and composition", async () => {
  let inspected;
  const f = fixtures({ masterImageInspector: async (_principal, value) => { inspected = value; return { schema: "openreel-commercial-master-image-quality/v1", accepted: false, model: "fixture-vision", usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 100_000 }, evidence: { master: { assetId: value.master.assetId } } }; } });
  const originalModels = f.arkService.models;
  f.arkService.models = () => originalModels().map(item => item.capability === "video" ? { ...item, name: "minimax-h3-fl2va-q5-turbo-v4", provider: "modelclaw-comfyui", costed: false, maxCostMicros: 0 } : item);
  const shots = ["establish", "detail", "hero"].map((prompt, index) => ({ id: `s${index + 1}`, prompt, duration: 4 }));
  const directorShots = shots.map(shot => ({ ...input.director.shots[0], shotId: shot.id }));
  await assert.rejects(createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 }).run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots }, director: { ...input.director, shots: directorShots }, models: { image: "image-real", video: "minimax-h3-fl2va-q5-turbo-v4" } }), error => {
    assert.equal(error.code, "COMMERCIAL_MASTER_QUALITY_REJECTED");
    assert.equal(error.details.terminalCost.evaluationSettledCny, 0.1);
    return true;
  });
  assert.equal(f.submissions.filter(item => item.capability === "image").length, 1);
  assert.equal(f.submissions.filter(item => item.capability === "video").length, 0);
  assert.equal(f.audioRequests.length, 0);
  assert.equal(inspected.references.length, 1);
  assert.equal(inspected.master.assetId, "asset-1");
});

test("commercial orchestration reports trusted provider usage as settled CNY and exposes stage progress", async () => {
  const f = fixtures(), stages = [];
  const originalSubmit = f.arkService.submit, originalPoll = f.arkService.poll;
  f.arkService.submit = async (...args) => ({ ...(await originalSubmit(...args)), usage: { costMicros: 1_000_000, unitScale: 1_000_000, currency: "CNY" } });
  f.arkService.poll = async (...args) => ({ ...(await originalPoll(...args)), usage: { costMicros: 2_000_000, unitScale: 1_000_000, currency: "CNY" } });
  f.qwenTtsService.synthesize = async () => ({ mimeType: "audio/wav", bytes: Buffer.from("wav"), usage: { costMicros: 500_000, unitScale: 1_000_000, currency: "CNY" } });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  const result = await service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[0]] } }, { progress: async stage => stages.push(stage) });
  assert.deepEqual(stages, ["images", "videos", "voice", "compose", "quality"]);
  assert.deepEqual(result.cost, { currency: "CNY", status: "settled", settledCny: 3.5, generationSettledCny: 3.5, evaluationSettledCny: 0 });
});

test("explicit zero-metered audio settles terminal cost while unknown audio usage remains fail-closed", async () => {
  const f = fixtures(), originalSubmit = f.arkService.submit, originalPoll = f.arkService.poll;
  f.arkService.submit = async (...args) => ({ ...(await originalSubmit(...args)), usage: { costMicros: 1_000_000, unitScale: 1_000_000, currency: "CNY" } });
  f.arkService.poll = async (...args) => ({ ...(await originalPoll(...args)), usage: { costMicros: 2_000_000, unitScale: 1_000_000, currency: "CNY" } });
  const result = await createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10, audioSettledCny: 0 }).run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[0]] }, director: { ...input.director, shots: [input.director.shots[0]] } });
  assert.deepEqual(result.cost, { currency: "CNY", status: "settled", settledCny: 3, generationSettledCny: 3, evaluationSettledCny: 0 });
  assert.throws(() => createCommercialProviderOrchestrator({ ...fixtures(), audioMaxCostCny: 10, audioSettledCny: 11 }), error => error.code === "COMMERCIAL_CONFIG_INVALID");
});

test("commercial orchestration accepts v2 director evidence and settles perceptual evaluation usage", async () => {
  const qualityInspector = async (_principal, request) => ({ schema: "openreel-commercial-quality-result/v2", accepted: true, releaseEligible: true, evaluation: { provider: "fixture", model: "free-fixture-v1", usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 250_000 } }, shots: request.storyboard.map(shot => ({ shotId: shot.id, accepted: true })), final: { accepted: true } });
  const f = fixtures({ qualityInspector });
  const originalSubmit = f.arkService.submit, originalPoll = f.arkService.poll;
  f.arkService.submit = async (...args) => ({ ...(await originalSubmit(...args)), usage: { costMicros: 1_000_000, unitScale: 1_000_000, currency: "CNY" } });
  f.arkService.poll = async (...args) => ({ ...(await originalPoll(...args)), usage: { costMicros: 2_000_000, unitScale: 1_000_000, currency: "CNY" } });
  f.qwenTtsService.synthesize = async () => ({ mimeType: "audio/wav", bytes: Buffer.from("wav"), usage: { costMicros: 500_000, unitScale: 1_000_000, currency: "CNY" } });
  const result = await createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 }).run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[0]] }, director: { ...input.director, shots: [input.director.shots[0]] } });
  assert.equal(result.quality.schema, "openreel-commercial-quality-result/v2");
  assert.deepEqual(result.cost, { currency: "CNY", status: "settled", settledCny: 3.75, generationSettledCny: 3.5, evaluationSettledCny: 0.25 });
  assert.equal(result.cost.generationSettledCny + result.cost.evaluationSettledCny, result.cost.settledCny);
});

test("commercial orchestration retains recorded generation settlement when quality rejects and one generation usage is unavailable", async () => {
  const qualityInspector = async (_principal, request) => ({ schema: "openreel-commercial-quality-result/v2", accepted: false, releaseEligible: false, evaluation: { provider: "fixture", model: "paid-fixture-v1", usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 250_000 } }, shots: request.storyboard.map(shot => ({ shotId: shot.id, accepted: false })), final: { accepted: false } });
  const f = fixtures({ qualityInspector });
  const originalSubmit = f.arkService.submit, originalPoll = f.arkService.poll;
  f.arkService.submit = async (...args) => ({ ...(await originalSubmit(...args)), usage: { costMicros: 1_000_000, unitScale: 1_000_000, currency: "CNY" } });
  f.arkService.poll = async (...args) => ({ ...(await originalPoll(...args)), usage: { costMicros: 2_000_000, unitScale: 1_000_000, currency: "CNY" } });
  const result = await createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 }).run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[0]] }, director: { ...input.director, shots: [input.director.shots[0]] } });
  assert.equal(result.status, "quality_failed"); assert.equal(result.releaseEligible, false);
  assert.deepEqual(result.cost, { currency: "CNY", status: "unsettled", settledCny: null, generationSettledCny: 3, evaluationSettledCny: 0.25 });
});

test("commercial orchestration fails closed for unavailable or over-limit models before provider calls", async () => {
  const f = fixtures(); f.arkService.models = () => [{ name: "image-real", capability: "image", currency: "CNY", unitScale: 1_000_000, maxCostMicros: 101_000_000 }, { name: "video-real", capability: "video", currency: "CNY", unitScale: 1_000_000, maxCostMicros: 20_000_000 }];
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_COST_LIMIT"); assert.equal(f.submissions.length, 0);
});

test("commercial orchestration rejects disabled generated music before any paid provider stage", async () => {
  const f = fixtures(), service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10, musicService: { enabled: false } });
  const production = { ...input.production, musicGeneration: { enabled: true, confirmed: true, model: "seed-audio-1.0", prompt: "真实背景音乐", durationSeconds: 5 }, musicRightsConfirmation: { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: "2026-08-23T00:00:00.000Z" } };
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, { ...input, production }), error => error.code === "COMMERCIAL_MUSIC_PROVIDER_UNAVAILABLE");
  assert.equal(f.submissions.length, 0); assert.equal(f.audioRequests.length, 0); assert.equal(f.artifacts.length, 0);
});

test("commercial orchestration converts the audited USD ledger ceiling to the CNY authorization limit", async () => {
  const f = fixtures(); f.arkService.models = () => [{ name: "image-real", capability: "image", currency: "USD", unitScale: 10_000, maxCostMicros: 2_778 }, { name: "video-real", capability: "video", currency: "USD", unitScale: 10_000, maxCostMicros: 138_889 }];
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10, cnyPerUsd: 7.2 });
  const result = await service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[0]] } });
  assert.equal(result.status, "qualified"); assert.equal(result.budget.cnyPerUsd, 7.2);
});

test("commercial orchestration validates storyboard bounds and provider assets", async () => {
  const f = fixtures(), service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [] } }), error => error.code === "COMMERCIAL_INPUT_INVALID");
  f.arkService.download = async () => ({ mimeType: "application/json", bytes: Buffer.from("bad") });
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_ASSET_INVALID");
});

test("commercial orchestration rejects missing or non-image director references before provider contact", async () => {
  const missing = fixtures({ referenceArtifactSource: async () => [] });
  await assert.rejects(createCommercialProviderOrchestrator({ ...missing, audioMaxCostCny: 10 }).run({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_REFERENCE_ASSET_INVALID");
  assert.equal(missing.submissions.length, 0);
  const invalid = fixtures({ referenceArtifactSource: async (_principal, request) => request.assetIds.map(id => ({ id, mimeType: "text/plain", bytes: Buffer.from("not-image") })) });
  await assert.rejects(createCommercialProviderOrchestrator({ ...invalid, audioMaxCostCny: 10 }).run({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_REFERENCE_ASSET_INVALID");
  assert.equal(invalid.submissions.length, 0);
});

test("commercial orchestration stops after bounded polling instead of continuing to later paid stages", async () => {
  const f = fixtures(); f.arkService.poll = async (_principal, id) => ({ ...f.arkService.models()[1], id, model: "video-real", capability: "video", status: "running" });
  let audioCalls = 0; f.qwenTtsService.synthesize = async () => { audioCalls += 1; return { mimeType: "audio/wav", bytes: Buffer.from("wav") }; };
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10, maxPolls: 2 });
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, input), error => error.code === "COMMERCIAL_PROVIDER_TIMEOUT"); assert.equal(audioCalls, 0); assert.equal(f.submissions.length, 2);
});

test("commercial orchestration exposes only the retained safe Ark terminal diagnostic", async () => {
  const f = fixtures();
  f.arkService.poll = async (_principal, id) => ({ id, model: "video-real", capability: "video", status: "failed", error: { code: "ARK_TASK_FAILED", message: "Ark task did not complete", details: { providerDiagnostic: { code: "ContentGenerationFailed", message: "capacity unavailable", details: { reason: "capacity" } } } } });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, input), error => {
    assert.equal(error.code, "COMMERCIAL_PROVIDER_FAILED"); assert.deepEqual(error.details.providerDiagnostic, { code: "ContentGenerationFailed", message: "capacity unavailable", details: { reason: "capacity" } }); return true;
  });
  f.arkService.poll = async (_principal, id) => ({ id, model: "video-real", capability: "video", status: "failed", error: { details: { providerDiagnostic: { code: "Rejected", message: "Bearer private-token" } } } });
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, { ...input, idempotencyKey: "commercial-redacted" }), error => { assert.equal(error.details.providerDiagnostic, undefined); return true; });
});

test("shot redo merges owner-scoped historical preserved assets in full storyboard order", async () => {
  const identity = { projectId: "project-1", projectVersion: 0, storyVersion: 1, storyboardVersion: 1 }, preserved = [{ id: "keep-image", kind: "image", shotId: "s1", identity }, { id: "keep-video", kind: "video", shotId: "s1", identity }], compositions = [];
  let inspectedArtifacts;
  const f = fixtures({ preservedArtifactSource: async (_principal, request) => { assert.deepEqual(request.assetIds, ["keep-image", "keep-video"]); return preserved; }, compositionSink: async (_principal, composition) => { compositions.push(composition); return { id: "redo-render", mimeType: "video/mp4" }; }, qualityInspector: async (_principal, request) => { inspectedArtifacts = request.artifacts; return { schema: "openreel-commercial-quality-result/v2", accepted: true, releaseEligible: true, evaluation: { provider: "fixture", model: "free-fixture-v1", usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 0 } }, shots: request.storyboard.map(shot => ({ shotId: shot.id, accepted: true })), final: { accepted: true } }; } });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  const result = await service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[1]] }, redo: { sourceJobId: "source", shotIds: ["s2"], preservedShots: [{ shotId: "s1", assetIds: ["keep-image", "keep-video"] }], compositionStoryboard: input.storyboard } });
  assert.equal(result.composition.render.id, "redo-render"); assert.deepEqual(compositions[0].plan.timeline.map(item => item.shotId), ["s1", "s2"]); assert.deepEqual(compositions[0].sourceArtifacts.slice(0, 2), ["keep-image", "keep-video"]); assert.equal(f.submissions.length, 2);
  assert.deepEqual(inspectedArtifacts.slice(0, 2).map(asset => asset.id), ["keep-image", "keep-video"]); assert.deepEqual(result.shots.find(shot => shot.id === "s1").assetIds, ["keep-image", "keep-video"]); assert.deepEqual(result.preservedArtifacts.map(asset => asset.id), ["keep-image", "keep-video"]);
});

test("bounded redo may regenerate every failed shot and still recomposes and re-evaluates the complete candidate", async () => {
  let inspectedStoryboard, compositions = 0, preservedReads = 0;
  const f = fixtures({
    preservedArtifactSource: async () => { preservedReads += 1; return []; },
    compositionSink: async (_principal, composition) => { compositions += 1; assert.deepEqual(composition.plan.timeline.map(item => item.shotId), ["s1"]); return { id: "full-redo-render", mimeType: "video/mp4" }; },
    qualityInspector: async (_principal, request) => { inspectedStoryboard = request.storyboard; return { schema: "openreel-commercial-quality-result/v2", accepted: true, releaseEligible: true, evaluation: { provider: "fixture", model: "zero-paid-v1", usage: { currency: "CNY", unitScale: 1_000_000, costMicros: 0 } }, shots: [{ shotId: "s1", accepted: true }], final: { accepted: true } }; }
  });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  const oneShot = { ...input, storyboard: { shots: [input.storyboard.shots[0]] }, director: { ...input.director, shots: [input.director.shots[0]] }, redo: { sourceJobId: "rejected-source", shotIds: ["s1"], preservedShots: [], compositionStoryboard: { shots: [input.storyboard.shots[0]] } } };
  const result = await service.run({ kind: "account", accountId: "owner" }, oneShot);
  assert.equal(result.status, "qualified"); assert.equal(result.releaseEligible, true);
  assert.equal(compositions, 1); assert.equal(preservedReads, 1); assert.deepEqual(inspectedStoryboard.map(shot => shot.id), ["s1"]);
  assert.equal(f.submissions.length, 2, "only the selected shot is regenerated once through image and video");
});

test("all-shot redo fails closed unless selected shots exactly cover the composition storyboard", async () => {
  const f = fixtures({ preservedArtifactSource: async () => [] });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[0]] }, director: { ...input.director, shots: [input.director.shots[0]] }, redo: { sourceJobId: "source", shotIds: ["s1"], preservedShots: [], compositionStoryboard: input.storyboard } }), error => error.code === "COMMERCIAL_REDO_INVALID");
  assert.equal(f.submissions.length, 0);
});

test("shot redo fails closed when preserved assets are missing or unrelated", async () => {
  const f = fixtures({ preservedArtifactSource: async () => [{ id: "unrelated", kind: "video", shotId: "other" }] });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[1]] }, redo: { sourceJobId: "source", shotIds: ["s2"], preservedShots: [{ shotId: "s1", assetIds: ["keep-video"] }], compositionStoryboard: input.storyboard } }), error => error.code === "COMMERCIAL_REDO_ASSET_INVALID");
});

test("commercial orchestration binds reviewed caption cards and licensed music before provider calls", async () => {
  const identity = { projectId: "project-1", projectVersion: 1, storyVersion: 1, storyboardVersion: 1 };
  const selected = [
    { id: "caption-1", mimeType: "image/png", metadata: { reviewed: true, identity: { ...identity, shotId: "s1" } } },
    { id: "caption-2", mimeType: "image/png", metadata: { reviewed: true, identity: { ...identity, shotId: "s2" } } },
    { id: "music-1", mimeType: "audio/wav", metadata: { identity: { ...identity, shotId: null }, review: { status: "reviewed", sourceDeclaration: "user upload" } } }
  ], compositions = [];
  const f = fixtures({ productionArtifactSource: async (_principal, request) => { assert.deepEqual(request.assetIds, ["caption-1", "caption-2", "music-1"]); return selected; }, compositionSink: async (_principal, value) => (compositions.push(value), { id: "render" }) });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  await service.run({ kind: "account", accountId: "owner" }, { ...input, production: { ...input.production, captionAssetIds: ["caption-1", "caption-2"], musicAssetId: "music-1", musicRightsConfirmation: { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: "2026-08-22T00:00:00.000Z" } } });
  assert.deepEqual(compositions[0].productionArtifacts, ["caption-1", "caption-2", "music-1"]);
});

test("commercial orchestration preserves reviewed script captions instead of replacing them with visual prompts", async () => {
  const compositions = [], f = fixtures({ compositionSink: async (_principal, value) => (compositions.push(value), { id: "render" }) });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  await service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [{ ...input.storyboard.shots[0], caption: "踩在暖乎乎的细沙上，风刚好吹过来" }] } });
  assert.equal(compositions[0].plan.timeline[0].caption, "踩在暖乎乎的细沙上，风刚好吹过来");
});

test("commercial orchestration rejects selected music without source metadata before provider calls", async () => {
  const f = fixtures({ productionArtifactSource: async () => [{ id: "music-1", mimeType: "audio/wav", metadata: { identity: { projectId: "project-1", projectVersion: 1, storyVersion: 1, storyboardVersion: 1, shotId: null }, review: { status: "reviewed" } } }] });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10 });
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, { ...input, production: { ...input.production, captionAssetIds: [], musicAssetId: "music-1", musicRightsConfirmation: { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: "2026-08-22T00:00:00.000Z" } } }), error => error.code === "COMMERCIAL_PRODUCTION_ASSET_INVALID");
  assert.equal(f.submissions.length, 0);
});

test("commercial orchestration generates one bounded revision-bound music asset before composition", async () => {
  const compositions = [], musicRequests = [];
  const musicService = { enabled: true, generate: async (request, authority) => { musicRequests.push({ request, authority }); return { mimeType: "audio/mpeg", bytes: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]), provider: "volcengine-seedaudio", model: "seed-audio-1.0", providerJobId: "music-job-1", durationSeconds: 5, quote: { currency: "CNY", maximumCostCny: 8 }, calls: 1, retries: 0, usage: { currency: "CNY", costMicros: 8_000_000, unitScale: 1_000_000 } }; } };
  const f = fixtures({ musicService, compositionSink: async (_principal, value) => (compositions.push(value), { id: "music-render", mimeType: "video/mp4" }) });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10, musicMaxCostCny: 10 });
  const production = { ...input.production, musicGeneration: { enabled: true, confirmed: true, model: "seed-audio-1.0", prompt: "轻快温暖的海滩舞蹈纯音乐，无人声", durationSeconds: 5 }, musicRightsConfirmation: { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: "2026-08-23T00:00:00.000Z" } };
  const result = await service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[0]] }, production });
  assert.equal(musicRequests.length, 1);
  assert.deepEqual(musicRequests[0].authority, { authorized: true, maximumCalls: 1, automaticRetries: 0 });
  const retained = f.artifacts.find(asset => asset.stage === "music");
  assert.equal(retained.provider, "volcengine-seedaudio"); assert.equal(retained.model, "seed-audio-1.0"); assert.equal(retained.productionAsset, true); assert.equal(retained.review.generated, true);
  assert.ok(compositions[0].productionArtifacts.includes(retained.manifest.id));
  assert.equal(result.calls.find(call => call.stage === "music").retries, 0);
  assert.equal(result.calls.find(call => call.stage === "music").usage.costMicros, 8_000_000);
  assert.deepEqual(result.cost, { currency: "CNY", status: "unsettled", settledCny: null, generationSettledCny: 8, evaluationSettledCny: 0 });
});

test("commercial orchestration does not compose or fall back when real music fails", async () => {
  let compositions = 0, calls = 0;
  const musicService = { enabled: true, generate: async () => { calls += 1; throw Object.assign(new Error("failed"), { code: "MUSIC_PROVIDER_FAILED", status: 502, details: { retryable: false } }); } };
  const f = fixtures({ musicService, compositionSink: async () => { compositions += 1; return { id: "unexpected" }; } });
  const service = createCommercialProviderOrchestrator({ ...f, audioMaxCostCny: 10, musicMaxCostCny: 10 });
  const production = { ...input.production, musicGeneration: { enabled: true, confirmed: true, model: "seed-audio-1.0", prompt: "真实背景音乐", durationSeconds: 5 }, musicRightsConfirmation: { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: "2026-08-23T00:00:00.000Z" } };
  await assert.rejects(service.run({ kind: "account", accountId: "owner" }, { ...input, storyboard: { shots: [input.storyboard.shots[0]] }, production }), /failed/);
  assert.equal(calls, 1); assert.equal(compositions, 0);
});
