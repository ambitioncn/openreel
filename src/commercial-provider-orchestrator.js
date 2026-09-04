import { DomainError } from "./core.js";
import { planCommercialComposition } from "./commercial-composition-quality.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createH3CreativeSpec, compileH3PrimitivePrompt } from "./prompt-director-v2.js";

function text(value, name, max = 4_000) { const normalized = typeof value === "string" ? value.trim() : ""; if (!normalized || [...normalized].length > max) throw new DomainError("COMMERCIAL_INPUT_INVALID", `${name} is required and must be at most ${max} characters`, 422); return normalized; }
function finite(value, name, minimum, maximum) { const number = Number(value); if (!Number.isFinite(number) || number < minimum || number > maximum) throw new DomainError("COMMERCIAL_INPUT_INVALID", `${name} must be between ${minimum} and ${maximum}`, 422); return number; }

function requestContract(input) {
  const script = text(input?.script, "script", 1_000), shots = input?.storyboard?.shots;
  if (!Array.isArray(shots) || !shots.length || shots.length > 12) throw new DomainError("COMMERCIAL_INPUT_INVALID", "storyboard must contain 1-12 shots", 422);
  const storyboard = shots.map((shot, index) => ({ id: text(shot?.id || `shot-${index + 1}`, `storyboard.shots[${index}].id`, 100), prompt: text(shot?.prompt, `storyboard.shots[${index}].prompt`, 2_000), caption: text(shot?.caption || shot?.prompt, `storyboard.shots[${index}].caption`, 2_000), duration: finite(shot?.duration, `storyboard.shots[${index}].duration`, 1, 10) }));
  const models = { image: text(input?.models?.image, "models.image", 100), video: text(input?.models?.video, "models.video", 100) };
  const idempotencyKey = text(input?.idempotencyKey, "idempotencyKey", 200);
  const binding = { projectId: text(input?.projectId, "projectId", 200), projectVersion: finite(input?.projectVersion, "projectVersion", 1, Number.MAX_SAFE_INTEGER), storyVersion: finite(input?.storyVersion, "storyVersion", 1, Number.MAX_SAFE_INTEGER), storyboardVersion: finite(input?.storyboardVersion, "storyboardVersion", 1, Number.MAX_SAFE_INTEGER) };
  const production = input?.production || {};
  if (typeof production.captions !== "boolean" || !["none", "light", "upbeat"].includes(production.music) || !["tiktok", "reels", "shorts"].includes(production.safeZone)) throw new DomainError("COMMERCIAL_INPUT_INVALID", "production settings are invalid", 422);
  let redo = null;
  if (input?.redo) {
    const shotIds = input.redo.shotIds, preservedShots = input.redo.preservedShots, composition = input.redo.compositionStoryboard?.shots;
    if (!Array.isArray(shotIds) || !shotIds.length || !Array.isArray(preservedShots) || !Array.isArray(composition)) throw new DomainError("COMMERCIAL_REDO_INVALID", "redo merge contract is incomplete", 422);
    const compositionStoryboard = composition.map((shot, index) => ({ id: text(shot?.id, `redo.compositionStoryboard.shots[${index}].id`, 100), prompt: text(shot?.prompt, `redo.compositionStoryboard.shots[${index}].prompt`, 2_000), duration: finite(shot?.duration, `redo.compositionStoryboard.shots[${index}].duration`, 1, 10) }));
    const normalizedPreserved = preservedShots.map((shot, index) => ({ shotId: text(shot?.shotId, `redo.preservedShots[${index}].shotId`, 100), assetIds: Array.isArray(shot?.assetIds) ? shot.assetIds.map((assetId, assetIndex) => text(assetId, `redo.preservedShots[${index}].assetIds[${assetIndex}]`, 200)) : [] }));
    const selected = new Set(shotIds), preserved = new Set(normalizedPreserved.map(shot => shot.shotId)), full = compositionStoryboard.map(shot => shot.id);
    if (shotIds.some(shotId => !storyboard.some(shot => shot.id === shotId)) || normalizedPreserved.some(shot => !shot.assetIds.length) || full.length !== selected.size + preserved.size || full.some(shotId => !selected.has(shotId) && !preserved.has(shotId))) throw new DomainError("COMMERCIAL_REDO_INVALID", "redo shots do not partition the composition storyboard", 422);
    redo = { sourceJobId: text(input.redo.sourceJobId, "redo.sourceJobId", 200), shotIds: [...shotIds], preservedShots: normalizedPreserved, compositionStoryboard };
  }
  const captionAssetIds = production.captionAssetIds ?? [];
  if (!Array.isArray(captionAssetIds) || captionAssetIds.some((assetId, index) => text(assetId, `production.captionAssetIds[${index}]`, 200) !== assetId.trim())) throw new DomainError("COMMERCIAL_INPUT_INVALID", "caption asset selection is invalid", 422);
  const musicAssetId = production.musicAssetId == null ? null : text(production.musicAssetId, "production.musicAssetId", 200), musicRightsConfirmation = production.musicRightsConfirmation ?? null;
  const musicGeneration = production.musicGeneration ?? null;
  if (musicGeneration && (musicAssetId || musicGeneration.enabled !== true || musicGeneration.confirmed !== true || musicGeneration.model !== "seed-audio-1.0" || ![5, 10].includes(Number(musicGeneration.durationSeconds)))) throw new DomainError("COMMERCIAL_MUSIC_GENERATION_INVALID", "real music generation selection is invalid", 422);
  if (musicAssetId && (musicRightsConfirmation?.accepted !== true || musicRightsConfirmation?.disclaimerVersion !== "music-rights-v1" || typeof musicRightsConfirmation?.confirmedAt !== "string" || !musicRightsConfirmation.confirmedAt)) throw new DomainError("COMMERCIAL_MUSIC_RIGHTS_CONFIRMATION_REQUIRED", "music use requires an explicit rights-responsibility confirmation", 409);
  if (musicGeneration && (musicRightsConfirmation?.accepted !== true || musicRightsConfirmation?.disclaimerVersion !== "music-rights-v1" || typeof musicRightsConfirmation?.confirmedAt !== "string" || !musicRightsConfirmation.confirmedAt)) throw new DomainError("COMMERCIAL_MUSIC_RIGHTS_CONFIRMATION_REQUIRED", "generated music use requires an explicit rights-responsibility confirmation", 409);
  const directorShots = input?.director?.shots;
  if (input?.director?.schema !== "openreel-commercial-director-context/v1" || !Array.isArray(directorShots) || storyboard.some(shot => !directorShots.some(item => item?.shotId === shot.id))) throw new DomainError("COMMERCIAL_DIRECTOR_BINDING_REQUIRED", "director continuity and reference bindings are required before paid generation", 409);
  const director = { schema: input.director.schema, ready: input.director.ready === true, shots: storyboard.map(shot => {
    const bound = directorShots.find(item => item?.shotId === shot.id);
    if (input.director.ready !== true || bound?.ready !== true || !Array.isArray(bound.roleEntityIds) || !bound.roleEntityIds.length || !Array.isArray(bound.sceneEntityIds) || !bound.sceneEntityIds.length || !text(bound.style, `director.shots.${shot.id}.style`, 500) || !Array.isArray(bound.referenceAssetIds) || !bound.referenceAssetIds.length || !Array.isArray(bound.continuityEntityUsages) || !bound.continuityEntityUsages.length) throw new DomainError("COMMERCIAL_DIRECTOR_BINDING_REQUIRED", `shot ${shot.id} has incomplete director bindings`, 409);
    return structuredClone(bound);
  }) };
  return { script, storyboard, models, idempotencyKey, binding, director, production: { ...production, captionAssetIds: [...new Set(captionAssetIds)], musicAssetId, musicRightsConfirmation, ...(musicGeneration && { musicGeneration: { enabled: true, confirmed: true, model: "seed-audio-1.0", prompt: text(musicGeneration.prompt, "production.musicGeneration.prompt", 500), durationSeconds: Number(musicGeneration.durationSeconds) } }) }, redo, language: input?.language ? text(input.language, "language", 50) : "auto", voice: input?.voice ? text(input.voice, "voice", 100) : production.voice ? text(production.voice, "production.voice", 100) : undefined };
}

function assertAsset(asset, expected, stage) {
  const mimeType = String(asset?.mimeType || "").toLowerCase(), bytes = Buffer.from(asset?.bytes || []);
  if (!expected.includes(mimeType) || !bytes.length) throw new DomainError("COMMERCIAL_ASSET_INVALID", `${stage} returned no validated asset`, 502);
  return { mimeType, bytes };
}

function usageCostCny(usage, cnyPerUsd) {
  const micros = Number(usage?.costMicros), scale = Number(usage?.unitScale);
  const rate = usage?.currency === "CNY" ? 1 : usage?.currency === "USD" ? cnyPerUsd : NaN;
  return Number.isFinite(micros) && micros >= 0 && Number.isFinite(scale) && scale > 0 && Number.isFinite(rate) ? micros / scale * rate : null;
}

function safeArkFailureDiagnostic(job) {
  const diagnostic = job?.error?.details?.providerDiagnostic;
  if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) return null;
  const serialized = JSON.stringify(diagnostic);
  if (serialized.length > 4_096 || /(?:authorization|api[_-]?key|secret|token|credential|password|cookie|https?:\/\/)/i.test(serialized)) return null;
  return structuredClone(diagnostic);
}

function sliceH3Video(bytes, start, duration, zoom = 1, { freezeFirstFrame = false } = {}) {
  const crop = zoom > 1 ? `crop=iw/${zoom}:ih/${zoom}:(iw-iw/${zoom})/2:(ih-ih/${zoom})/2,scale=960:544` : "null";
  const filter = freezeFirstFrame ? `trim=duration=0.04,setpts=PTS-STARTPTS,${crop},tpad=stop_mode=clone:stop_duration=${duration}` : crop;
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(start), "-i", "pipe:0", "-t", String(duration), "-vf", filter, "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"], { input: bytes, encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout?.length) throw new DomainError("COMMERCIAL_SLICE_FAILED", "H3 three-micro-shot slicing failed", 500);
  return result.stdout;
}

export function createCommercialProviderOrchestrator({ arkService, qwenTtsService, musicService = null, artifactSink, compositionSink, qualityInspector, masterImageInspector = null, sliceVideo = sliceH3Video, referenceArtifactSource = null, preservedArtifactSource = null, productionArtifactSource = null, perActionCnyLimit = 100, audioMaxCostCny, audioSettledCny = null, musicMaxCostCny = 10, cnyPerUsd = 7.2, maxPolls = 60, wait = async () => {} } = {}) {
  if (!arkService || !qwenTtsService || typeof artifactSink !== "function" || typeof compositionSink !== "function" || typeof qualityInspector !== "function") throw new DomainError("COMMERCIAL_PROVIDER_UNAVAILABLE", "commercial provider and fail-closed quality dependencies are unavailable", 503);
  finite(perActionCnyLimit, "perActionCnyLimit", 0.01, 100); finite(audioMaxCostCny, "audioMaxCostCny", 0.01, perActionCnyLimit); finite(musicMaxCostCny, "musicMaxCostCny", 0.01, Math.min(10, perActionCnyLimit)); finite(cnyPerUsd, "cnyPerUsd", 0.01, 100);
  if (audioSettledCny !== null && (!Number.isFinite(audioSettledCny) || audioSettledCny < 0 || audioSettledCny > audioMaxCostCny)) throw new DomainError("COMMERCIAL_CONFIG_INVALID", "audioSettledCny must be null or within the reviewed audio cost bound", 503);
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 120 || typeof wait !== "function") throw new DomainError("COMMERCIAL_CONFIG_INVALID", "commercial polling configuration is invalid", 503);
  const catalog = new Map(arkService.models().map(model => [model.name, model]));
  const model = (name, capability) => {
    const item = catalog.get(name), rate = item?.currency === "CNY" ? 1 : item?.currency === "USD" ? cnyPerUsd : NaN, scale = Number(item?.unitScale), maximum = item && Number(item.maxCostMicros) / scale * rate, roundingTolerance = rate / scale;
    if (!item || item.capability !== capability) throw new DomainError("COMMERCIAL_MODEL_UNAVAILABLE", `${capability} model is unavailable`, 422);
    const zeroCost = item.costed === false && Number(item.maxCostMicros) === 0;
    if (!Number.isFinite(maximum) || (!zeroCost && maximum <= 0) || maximum > perActionCnyLimit + roundingTolerance) throw new DomainError("COMMERCIAL_COST_LIMIT", `${capability} model exceeds the authorized per-action CNY limit`, 403);
    return item;
  };
  const completeArk = async (principal, request, expectedMime, calls) => {
    let job = await arkService.submit(principal, request); calls.push({ stage: request.capability, operation: "submit", jobId: job.id, model: job.model, usage: job.usage || null });
    for (let attempt = 0; job.status === "running" && attempt < maxPolls; attempt += 1) { await wait(attempt); job = await arkService.poll(principal, job.id); calls.push({ stage: request.capability, operation: "poll", jobId: job.id, status: job.status }); }
    if (job.status !== "succeeded") { const providerDiagnostic = safeArkFailureDiagnostic(job); throw new DomainError(job.status === "running" ? "COMMERCIAL_PROVIDER_TIMEOUT" : "COMMERCIAL_PROVIDER_FAILED", `${request.capability} generation did not succeed`, 502, { stage: request.capability, status: job.status, ...(providerDiagnostic ? { providerDiagnostic } : {}) }); }
    calls.push({ stage: request.capability, operation: "complete", jobId: job.id, model: job.model, usage: job.usage || null });
    return { job, asset: assertAsset(await arkService.download(principal, job.id), expectedMime, request.capability) };
  };
  return Object.freeze({
    async run(principal, input = {}, { progress = async () => {} } = {}) {
      const request = requestContract(input), imageModel = model(request.models.image, "image"), videoModel = model(request.models.video, "video"), arkPrincipal = { kind: "account", accountId: text(principal?.accountId, "principal.accountId", 200) }, calls = [], artifacts = [];
      const h3Video = videoModel.provider === "modelclaw-comfyui";
      if (h3Video && request.storyboard.some(shot => shot.duration > 5)) throw new DomainError("COMMERCIAL_MODEL_INCOMPATIBLE", "MiniMax H3 commercial shots must be at most 5 seconds", 422);
      if (typeof progress !== "function") throw new DomainError("COMMERCIAL_INPUT_INVALID", "progress must be a function", 422);
      if (request.production.musicGeneration && musicService?.enabled !== true) throw new DomainError("COMMERCIAL_MUSIC_PROVIDER_UNAVAILABLE", "real music provider is disabled", 503);
      const selectedIds = [...request.production.captionAssetIds, ...(request.production.musicAssetId ? [request.production.musicAssetId] : [])];
      let productionArtifacts = [];
      if (selectedIds.length) {
        if (typeof productionArtifactSource !== "function") throw new DomainError("COMMERCIAL_PRODUCTION_ASSET_INVALID", "production asset source is unavailable", 503);
        productionArtifacts = await productionArtifactSource(principal, { ...request.binding, projectId: request.binding.projectId, assetIds: selectedIds });
        const expected = new Set(selectedIds), identity = asset => asset.metadata?.identity || asset.identity, same = value => value?.projectId === request.binding.projectId && value.projectVersion === request.binding.projectVersion && value.storyVersion === request.binding.storyVersion && value.storyboardVersion === request.binding.storyboardVersion;
        const captions = productionArtifacts.filter(asset => request.production.captionAssetIds.includes(asset.id)), music = request.production.musicAssetId ? productionArtifacts.find(asset => asset.id === request.production.musicAssetId) : null;
        if (!Array.isArray(productionArtifacts) || productionArtifacts.length !== expected.size || productionArtifacts.some(asset => !expected.has(asset.id) || !same(identity(asset))) || captions.some(asset => asset.mimeType !== "image/png" || asset.metadata?.reviewed !== true || !request.storyboard.some(shot => shot.id === identity(asset)?.shotId)) || (request.production.captions && captions.length !== request.storyboard.length) || (music && (!["audio/wav", "audio/mpeg"].includes(music.mimeType) || music.metadata?.review?.status !== "reviewed" || !music.metadata.review.sourceDeclaration))) throw new DomainError("COMMERCIAL_PRODUCTION_ASSET_INVALID", "selected captions or music are stale, incomplete, or missing review/source metadata", 409);
      }
      let preservedArtifacts = [];
      if (request.redo) {
        if (typeof preservedArtifactSource !== "function") throw new DomainError("COMMERCIAL_REDO_ASSET_INVALID", "preserved asset source is unavailable", 503);
        const assetIds = request.redo.preservedShots.flatMap(shot => shot.assetIds);
        preservedArtifacts = await preservedArtifactSource(principal, { ...request.binding, sourceJobId: request.redo.sourceJobId, assetIds });
        if (!Array.isArray(preservedArtifacts)) throw new DomainError("COMMERCIAL_REDO_ASSET_INVALID", "preserved assets are missing, stale or unrelated", 409);
        const expected = new Set(assetIds), actual = new Set(preservedArtifacts.map(asset => asset.id)), identity = asset => asset.metadata?.identity || asset.identity;
        const validIdentity = asset => { const value = identity(asset); return value?.projectId === request.binding.projectId && value.storyVersion === request.binding.storyVersion && value.storyboardVersion === request.binding.storyboardVersion; };
        if (actual.size !== expected.size || [...expected].some(assetId => !actual.has(assetId)) || preservedArtifacts.some(asset => !expected.has(asset.id) || !validIdentity(asset)) || request.redo.preservedShots.some(shot => !preservedArtifacts.some(asset => asset.kind === "video" && (asset.shotId || asset.metadata?.shotId || identity(asset)?.shotId) === shot.shotId))) throw new DomainError("COMMERCIAL_REDO_ASSET_INVALID", "preserved assets are missing, stale or unrelated", 409);
      }
      if (typeof referenceArtifactSource !== "function") throw new DomainError("COMMERCIAL_REFERENCE_ASSET_INVALID", "director reference asset source is unavailable", 503);
      const referenceIds = [...new Set(request.director.shots.flatMap(shot => shot.referenceAssetIds))];
      const referenceArtifacts = await referenceArtifactSource(principal, { ...request.binding, assetIds: referenceIds });
      const referenceById = new Map(Array.isArray(referenceArtifacts) ? referenceArtifacts.map(asset => [asset?.id, asset]) : []);
      if (referenceById.size !== referenceIds.length || referenceIds.some(assetId => { const asset = referenceById.get(assetId), bytes = Buffer.from(asset?.bytes || []); return !asset || !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType) || !bytes.length || bytes.length > 10 * 1024 * 1024; })) throw new DomainError("COMMERCIAL_REFERENCE_ASSET_INVALID", "director reference assets are missing, invalid, or too large", 409);
      await progress("images");
      const nativeThreeMicroShot = h3Video && request.storyboard.length === 3;
      let sharedMasterQuality = null;
      if (nativeThreeMicroShot) {
        if (typeof masterImageInspector !== "function") throw new DomainError("COMMERCIAL_MASTER_QUALITY_UNAVAILABLE", "native H3 three-micro-shot mode requires a fail-closed master image inspector", 503);
        const sharedReferenceIds = [...new Set(request.director.shots.flatMap(item => item.referenceAssetIds))];
        if (sharedReferenceIds.length > 3) throw new DomainError("COMMERCIAL_REFERENCE_ASSET_INVALID", "native H3 three-micro-shot mode accepts at most three shared references", 409);
        const sharedReference = referenceById.get(sharedReferenceIds[0]), referenceDataUrl = `data:${sharedReference.mimeType};base64,${Buffer.from(sharedReference.bytes).toString("base64")}`;
        const continuity = [...new Set(request.director.shots.flatMap(item => item.continuityEntityUsages || []).flatMap(item => Object.entries(item.attributes || {}).map(([key, value]) => `${key}=${value}`)))];
        const sharedImagePrompt = `SHARED PRODUCT/ENVIRONMENT MASTER FRAME: create exactly one full-frame still photograph, never a storyboard. Show one immutable product centered on one immutable tabletop in one immutable environment, using one neutral three-quarter product composition. Bind product geometry, glaze/material finish, handle orientation, color, texture, tabletop, background, lighting, reflections and contact shadow. LOCKED CONTINUITY ATTRIBUTES: ${continuity.join("; ")}. Match the supplied product reference while keeping the entire product sharp, unobstructed, physically supported and fully inside frame. No people, hands, text, words, letters, numbers, captions, labels, logos, shot names, timecodes, duplicates, alternate products, topology changes, split screens, multiple panels, collage, borders, frames, contact sheets, UI, inset images or sequential views.`;
        if (request.storyboard.some(shot => sharedImagePrompt.includes(shot.prompt))) throw new DomainError("COMMERCIAL_MASTER_FRAME_CONTRACT_INVALID", "shared master prompt must not contain storyboard shot prompts", 500);
        const image = await completeArk(arkPrincipal, { model: imageModel.name, capability: "image", input: { prompt: sharedImagePrompt, image: referenceDataUrl, size: "2K", response_format: "url" }, idempotencyKey: `${request.idempotencyKey}:shared-master:image` }, ["image/png", "image/jpeg", "image/webp"], calls);
        const masterArtifact = await artifactSink(principal, { ...request.binding, kind: "image", shotId: request.storyboard[0].id, stage: "shared-master-image", provider: "volcengine-ark", model: image.job.model, providerJobId: image.job.id, sharedReferenceIds, continuityBytes: continuity, ...image.asset });
        artifacts.push(masterArtifact);
        await progress("master-quality");
        const masterQuality = await masterImageInspector(arkPrincipal, { evaluationRunId: request.idempotencyKey, binding: request.binding, master: { assetId: masterArtifact.id, mimeType: image.asset.mimeType, bytes: image.asset.bytes }, references: sharedReferenceIds.map(id => ({ assetId: id, mimeType: referenceById.get(id).mimeType, bytes: Buffer.from(referenceById.get(id).bytes) })), continuity });
        if (masterQuality?.schema !== "openreel-commercial-master-image-quality/v1" || typeof masterQuality.accepted !== "boolean" || !masterQuality.usage) throw new DomainError("COMMERCIAL_MASTER_QUALITY_EVIDENCE_INVALID", "master image inspector returned invalid byte-bound evidence", 502);
        calls.push({ stage: "master-quality", operation: "evaluate", model: masterQuality.model, usage: masterQuality.usage, evidence: masterQuality.evidence });
        sharedMasterQuality = masterQuality;
        if (!masterQuality.accepted) {
          const imageCost = usageCostCny(image.job.usage, cnyPerUsd), evaluationCost = usageCostCny(masterQuality.usage, cnyPerUsd), settled = imageCost !== null && evaluationCost !== null;
          throw new DomainError("COMMERCIAL_MASTER_QUALITY_REJECTED", "shared master image failed the reference-bound pre-H3 quality gate", 422, { masterQuality, terminalCost: { currency: "CNY", status: settled ? "settled" : "unsettled", settledCny: settled ? Number((imageCost + evaluationCost).toFixed(6)) : null, generationSettledCny: imageCost, evaluationSettledCny: evaluationCost } });
        }
        const firstFrameUrl = image.job.result?.url;
        if (typeof firstFrameUrl !== "string" || !firstFrameUrl) throw new DomainError("COMMERCIAL_ASSET_INVALID", "shared master image has no provider-bound URL", 502);
        // H3 can become unstable after the opening beat even with a locked prompt.
        // Bind every derived shot to the same early, reference-faithful prefix and
        // create the visual progression only through deterministic crops.
        const windows = [[0, 0.04], [0, 0.04], [0, 0.04]];
        const timedPrompt = `For the complete 5.0 seconds, preserve the supplied master frame as one continuous locked product shot. The exact same single product remains perfectly still, centered, fully visible and physically supported on the exact same tabletop. The camera is completely locked: no cut, transition, zoom, pan, tilt, dolly, reframing or focus pull. Never create a close-up, alternate angle, second product, detached part or background copy. Render one full-frame image at all times with no words, letters, numbers, captions, labels, split screens, multiple panels, collage, borders, frames, picture-in-picture, contact sheets or UI. No morphs, substitutions, duplicates, topology changes, relighting or background changes. Preserve geometry, glaze/material finish, handle orientation, color, texture, tabletop, background, lighting, reflections and contact shadow byte-bound to the supplied master frame. Establish, detail and hero micro-shots will be derived only after generation by deterministic time slicing and digital crop; do not generate those transitions. ${continuity.join("; ")}`;
        await progress("videos", { shotId: null, shotIndex: null, strategy: "single-h3-three-micro-shot" });
        const video = await completeArk(arkPrincipal, { model: videoModel.name, capability: "video", input: { content: [{ type: "text", text: timedPrompt }, { type: "image_url", image_url: { url: firstFrameUrl }, role: "first_frame" }], reference_asset_ids: sharedReferenceIds, duration: 5 }, idempotencyKey: `${request.idempotencyKey}:shared-three-micro-shot:video` }, ["video/mp4"], calls);
        for (const [index, shot] of request.storyboard.entries()) {
          const duration = 1.4, digitalZoom = index === 0 ? 1 : index === 1 ? 1.24 : 1.1;
          artifacts.push(await artifactSink(principal, { ...request.binding, kind: "video", shotId: shot.id, stage: `video-slice-${index}`, provider: "modelclaw-comfyui", model: video.job.model, providerJobId: video.job.id, duration, sourceWindow: { start: windows[index][0], end: windows[index][1], outputDuration: duration, digitalZoom, freezeFirstFrame: true }, sharedGenerationId: video.job.id, sharedSourceSha256: createHash("sha256").update(video.asset.bytes).digest("hex"), continuityBytes: continuity, mimeType: video.asset.mimeType, bytes: sliceVideo(video.asset.bytes, windows[index][0], duration, digitalZoom, { freezeFirstFrame: true }) }));
        }
      }
      if (!nativeThreeMicroShot) for (const [index, shot] of request.storyboard.entries()) {
        const directorShot = request.director.shots.find(item => item.shotId === shot.id);
        const lockedPrompt = `${shot.prompt}\nROLE CONTINUITY: ${directorShot.roleEntityIds.join(", ")}\nSCENE CONTINUITY: ${directorShot.sceneEntityIds.join(", ")}\nSTYLE CONTINUITY: ${directorShot.style}`;
        const objectOnly = /\bobject[- ]only\b|\bno people\b|\bno faces\b/i.test(shot.prompt);
        const h3LockedPrompt = h3Video ? lockedPrompt
          .replace(/\b(fold(?:s|ed|ing)?|twist(?:s|ed|ing)?|flip(?:s|ped|ping)?|wrap(?:s|ped|ping)?|stretch(?:es|ed|ing)?|tear(?:s|ing)?|raise(?:s|d|ing)?)\b/gi, "hold and display")
          .replace(/折叠|翻转|扭转|缠绕|拉伸|撕开|举过脸部|遮住脸/g, "稳定展示") : lockedPrompt;
        const faceDiscipline = objectOnly ? "Do not introduce any person, face, or body part." : "Render the fictional adult with a natural, clearly visible face and complete coherent eyes, eyebrows, nose, mouth, ears, skin texture, and facial contours; match the supplied reference image closely; never produce a blank, featureless, masked, blurred, melted, distorted, cropped, or obscured face.";
        const firstFramePrompt = h3Video ? objectOnly
          ? `${h3LockedPrompt}\nOBJECT-ONLY FIRST FRAME DISCIPLINE: show exactly one small rigid unbranded product centered on a stable tabletop in an empty neutral studio. The complete product must be sharp, unobstructed, fully inside frame, and physically supported by the tabletop. Preserve exact geometry, material, color, scale, lighting, background, and contact shadow. ${faceDiscipline} No cloth, fabric, flexible sheet, hands, motion blur, overlap, suspension, or mid-action pose.`
          : `${h3LockedPrompt}\nFIRST FRAME DISCIPLINE: establish a stable unobstructed starting pose; keep the subject, hands, and key object fully visible and separated; preserve exact object geometry, material, wardrobe, face, lighting, and background; ${faceDiscipline} The object must be a single intact solid surface with no holes, cutouts, openings, tears, or topology changes. Avoid motion blur, cropped hands, overlaps, face obstruction, and mid-action poses.`
          : lockedPrompt;
        const objectOnlyStaticBeat = objectOnly && /\bno object motion\b|\bstable (?:hero |closing |resolved |final)/i.test(shot.prompt);
        const h3MotionPrompt = objectOnly
          ? objectOnlyStaticBeat
            ? `${h3LockedPrompt}\nLOCKED PRODUCT BEAT: preserve the supplied first frame as an intentional stable establishing or closing beat for the full shot. The product remains completely still, physically supported by the tabletop at the exact same location. Keep the camera, tabletop, lighting, background, reflections, and contact shadow stable. Preserve exact product geometry, material, color, scale, handle orientation, and distinguishing features. Do not rotate, translate, tilt, lift, float, deform, open, morph, duplicate, pulse, zoom, pan, cut, introduce people, hands, faces, text, or new elements.`
            : `${h3LockedPrompt}\nCONTROLLED PRODUCT REVEAL: create one clear five-second commercial beat with a beginning, middle, and resolved end. Begin with the product matching the supplied first frame, rotate it slowly and smoothly by a small angle around its vertical axis to reveal its form, then ease to a complete stable stop for the final second. The product remains physically supported by the tabletop at the exact same location. Keep the camera, tabletop, lighting, background, reflections, and contact shadow stable. Preserve exact product geometry, material, color, scale, and distinguishing features. Do not translate, tilt, lift, float, deform, open, morph, duplicate, pulse, zoom, pan, cut, introduce people, hands, faces, text, or new elements.`
          : `${h3LockedPrompt}\nMOTION DISCIPLINE: perform exactly one low-complexity action: hold the object steadily for display, translate it slightly, or lower it slowly; do not fold, twist, flip, wrap, stretch, open, tear, or raise it across the face. Use only small controlled hand movement. Preserve the exact face, body, wardrobe, object silhouette, geometry, material, topology, lighting, and background from the first frame; keep the face, both hands, and the complete key object visible and mutually separated. The object must remain one intact solid surface with no holes, cutouts, openings, tears, shape changes, or topology changes. No sudden motion, morphing, duplication, occlusion, camera movement, camera cuts, or new elements.`;
        const requestedCameraAction = directorShot.cameraAction;
        const h3Primitive = requestedCameraAction === "locked" ? "static_hold" : requestedCameraAction || (objectOnly ? (objectOnlyStaticBeat ? "static_hold" : "micro_turn") : "dolly_in");
        const promptDirector = h3Video ? compileH3PrimitivePrompt(createH3CreativeSpec({ shot: { ...shot, prompt: h3MotionPrompt }, directorShot, objectOnly }), h3Primitive) : null;
        const reference = referenceById.get(directorShot.referenceAssetIds[0]), referenceDataUrl = `data:${reference.mimeType};base64,${Buffer.from(reference.bytes).toString("base64")}`;
        const image = await completeArk(arkPrincipal, { model: imageModel.name, capability: "image", input: { prompt: firstFramePrompt, image: referenceDataUrl, size: "2K", response_format: "url" }, idempotencyKey: `${request.idempotencyKey}:shot:${index}:image` }, ["image/png", "image/jpeg", "image/webp"], calls);
        artifacts.push(await artifactSink(principal, { ...request.binding, kind: "image", shotId: shot.id, stage: "image", provider: "volcengine-ark", model: image.job.model, providerJobId: image.job.id, ...image.asset }));
        const firstFrameUrl = image.job.result?.url;
        if (typeof firstFrameUrl !== "string" || !firstFrameUrl) throw new DomainError("COMMERCIAL_ASSET_INVALID", "image result has no provider-bound first frame URL", 502);
        await progress("videos", { shotId: shot.id, shotIndex: index });
        const videoInput = h3Video
          ? { content: [{ type: "text", text: promptDirector.model_prompt }, { type: "image_url", image_url: { url: firstFrameUrl }, role: "first_frame" }], reference_asset_ids: directorShot.referenceAssetIds, duration: 5, creative_spec: promptDirector.creative_spec, prompt_director: { schema: promptDirector.schema, adapter: promptDirector.adapter, primitive: promptDirector.primitive } }
          : { content: [{ type: "text", text: lockedPrompt }, { type: "image_url", image_url: { url: firstFrameUrl }, role: "first_frame" }], reference_asset_ids: directorShot.referenceAssetIds, ratio: "9:16", duration: shot.duration, generate_audio: false };
        const video = await completeArk(arkPrincipal, { model: videoModel.name, capability: "video", input: videoInput, idempotencyKey: `${request.idempotencyKey}:shot:${index}:video` }, ["video/mp4"], calls);
        artifacts.push(await artifactSink(principal, { ...request.binding, kind: "video", shotId: shot.id, stage: "video", provider: videoModel.provider || "volcengine-ark", model: video.job.model, providerJobId: video.job.id, duration: shot.duration, ...video.asset }));
      }
      const fallbackIntents = [
        "ESTABLISH FALLBACK: judge a stable full-product establishing view derived from the shared early H3 prefix; intentional stillness and a wide crop are the complete beat.",
        "DETAIL FALLBACK: judge a stable digital close crop of the same product pixels from the shared early H3 prefix; intentional stillness and visible material/handle detail are the complete beat.",
        "HERO FALLBACK: judge a stable moderately cropped hero view of the same product pixels from the shared early H3 prefix; intentional stillness and resolved presentation are the complete beat."
      ];
      const effectiveStoryboard = nativeThreeMicroShot ? request.storyboard.map((shot, index) => ({ ...shot, duration: 1.4, prompt: `${fallbackIntents[index]} TIMING CONTRACT: this is an intentionally concise 1.4-second micro-shot, not a standalone camera-motion shot. Do not require camera motion, object motion, a new angle, or a later source frame.` })) : request.storyboard;
      await progress("voice");
      const audioOutput = await qwenTtsService.synthesize({ input: request.script, response_format: "wav", language: request.language, ...(request.voice && request.voice !== "natural" ? { voice: request.voice } : {}) }, { authorized: true });
      const audio = assertAsset(audioOutput, ["audio/wav"], "audio");
      calls.push({ stage: "audio", operation: "synthesize", model: "qwen-tts-tailnet", maximumCostCny: audioMaxCostCny });
      artifacts.push(await artifactSink(principal, { ...request.binding, kind: "audio", stage: "audio", provider: "qwen-tts-tailnet", model: "qwen-tts-tailnet", duration: effectiveStoryboard.reduce((sum, shot) => sum + shot.duration, 0), ...audio }));
      let musicOutput = null;
      if (request.production.musicGeneration) {
        if (!musicService?.generate) throw new DomainError("COMMERCIAL_MUSIC_PROVIDER_UNAVAILABLE", "real music provider is unavailable", 503);
        await progress("music");
        musicOutput = await musicService.generate({ prompt: request.production.musicGeneration.prompt, durationSeconds: request.production.musicGeneration.durationSeconds, idempotencyKey: `${request.idempotencyKey}:music` }, { authorized: true, maximumCalls: 1, automaticRetries: 0 });
        if (musicOutput.quote?.currency !== "CNY" || musicOutput.quote.maximumCostCny > musicMaxCostCny || musicOutput.calls !== 1 || musicOutput.retries !== 0) throw new DomainError("COMMERCIAL_MUSIC_COST_LIMIT", "real music provider exceeded its bounded route", 403);
        const music = assertAsset(musicOutput, ["audio/wav", "audio/mpeg"], "music");
        const musicArtifact = await artifactSink(principal, { ...request.binding, kind: "audio", stage: "music", provider: musicOutput.provider, model: musicOutput.model, providerJobId: musicOutput.providerJobId, duration: musicOutput.durationSeconds, productionAsset: true, review: { status: "reviewed", sourceDeclaration: `provider-generated:${musicOutput.provider}/${musicOutput.model}`, generated: true }, ...music });
        productionArtifacts.push(musicArtifact);
        calls.push({ stage: "music", operation: "generate", model: musicOutput.model, jobId: musicOutput.providerJobId, usage: musicOutput.usage || null, maximumCostCny: musicOutput.quote.maximumCostCny, retries: 0 });
      }
      await progress("compose");
      const compositionStoryboard = request.redo?.compositionStoryboard || effectiveStoryboard;
      const compositionPlan = planCommercialComposition({ ...request.production, storyboard: { shots: compositionStoryboard } });
      const providerCostsBeforeQuality = calls.filter(call => call.operation === "complete").map(call => usageCostCny(call.usage, cnyPerUsd));
      const audioCostBeforeQuality = audioOutput?.usage ? usageCostCny(audioOutput.usage, cnyPerUsd) : audioSettledCny;
      const musicCostBeforeQuality = musicOutput ? usageCostCny(musicOutput.usage, cnyPerUsd) : 0;
      const generationCostsBeforeQuality = [...providerCostsBeforeQuality, audioCostBeforeQuality, musicCostBeforeQuality];
      const recordedGenerationCostsBeforeQuality = generationCostsBeforeQuality.filter(value => value !== null);
      const terminalCostBeforeQuality = { currency: "CNY", status: generationCostsBeforeQuality.every(value => value !== null) ? "settled" : "unsettled", settledCny: generationCostsBeforeQuality.every(value => value !== null) ? Number(recordedGenerationCostsBeforeQuality.reduce((sum, value) => sum + value, 0).toFixed(6)) : null, generationSettledCny: recordedGenerationCostsBeforeQuality.length ? Number(recordedGenerationCostsBeforeQuality.reduce((sum, value) => sum + value, 0).toFixed(6)) : null, evaluationSettledCny: 0 };
      let render;
      try {
        render = await compositionSink(principal, { ...request.binding, plan: compositionPlan, musicRightsConfirmation: request.production.musicRightsConfirmation, sourceArtifacts: [...preservedArtifacts.map(artifact => artifact.id), ...artifacts.map(artifact => artifact.id)], productionArtifacts: productionArtifacts.map(artifact => artifact.id), ...(request.redo && { redo: { sourceJobId: request.redo.sourceJobId, replaceShotIds: request.redo.shotIds, preservedShots: request.redo.preservedShots } }) });
      } catch (error) {
        error.details = { ...(error?.details && typeof error.details === "object" && !Array.isArray(error.details) ? error.details : {}), terminalCost: terminalCostBeforeQuality };
        throw error;
      }
      await progress("quality");
      const qualityArtifacts = [...preservedArtifacts, ...artifacts];
      const quality = await qualityInspector(principal, { evaluationRunId: request.idempotencyKey, binding: request.binding, director: request.director, storyboard: compositionStoryboard, artifacts: qualityArtifacts, render });
      if (quality?.schema !== "openreel-commercial-quality-result/v2" || !Array.isArray(quality.shots) || quality.shots.length !== compositionStoryboard.length || typeof quality.accepted !== "boolean" || typeof quality.releaseEligible !== "boolean" || quality.releaseEligible !== quality.accepted || quality.shots.some(item => !item?.shotId || typeof item.accepted !== "boolean") || !quality.final || typeof quality.final.accepted !== "boolean") throw new DomainError("COMMERCIAL_QUALITY_EVIDENCE_INVALID", "complete shot and final quality evidence is required", 502);
      const providerCosts = calls.filter(call => call.operation === "complete").map(call => usageCostCny(call.usage, cnyPerUsd));
      const audioCost = audioOutput?.usage ? usageCostCny(audioOutput.usage, cnyPerUsd) : audioSettledCny;
      const musicCost = musicOutput ? usageCostCny(musicOutput.usage, cnyPerUsd) : 0, masterEvaluationCosts = calls.filter(call => call.operation === "evaluate").map(call => usageCostCny(call.usage, cnyPerUsd)), finalEvaluationCost = usageCostCny(quality.evaluation?.usage, cnyPerUsd), evaluationCosts = [...masterEvaluationCosts, finalEvaluationCost], evaluationCost = evaluationCosts.every(value => value !== null) ? Number(evaluationCosts.reduce((sum, value) => sum + value, 0).toFixed(6)) : null, allCosts = [...providerCosts, audioCost, musicCost, ...evaluationCosts], settled = allCosts.every(value => value !== null);
      const generationCosts = [...providerCosts, audioCost, musicCost], recordedGenerationCosts = [...providerCosts.filter(value => value !== null), ...(audioCost === null ? [] : [audioCost]), ...(musicOutput && musicCost !== null ? [musicCost] : [])];
      return { schema: "openreel-commercial-provider-run/v1", status: quality.accepted ? "qualified" : "quality_failed", generationStatus: "succeeded", qualificationStatus: quality.accepted ? "approved" : "rejected", releaseEligible: quality.releaseEligible, idempotencyKey: request.idempotencyKey, shotCount: request.storyboard.length, ...(sharedMasterQuality && { masterQuality: sharedMasterQuality }), shots: quality.shots.map(item => ({ id: item.shotId, status: item.accepted ? "succeeded" : "failed", assetIds: qualityArtifacts.filter(asset => (asset.shotId || asset.metadata?.shotId || asset.metadata?.identity?.shotId || asset.identity?.shotId) === item.shotId && ["image", "video"].includes(asset.kind)).map(asset => asset.id), quality: item })), quality, artifacts, preservedArtifacts, productionArtifacts, composition: { plan: compositionPlan, render }, calls, cost: { currency: "CNY", status: settled ? "settled" : "unsettled", settledCny: settled ? Number(allCosts.reduce((sum, value) => sum + value, 0).toFixed(6)) : null, generationSettledCny: recordedGenerationCosts.length ? Number(recordedGenerationCosts.reduce((sum, value) => sum + value, 0).toFixed(6)) : null, evaluationSettledCny: evaluationCost }, budget: { currency: "CNY", perActionLimit: perActionCnyLimit, audioMaximum: audioMaxCostCny, musicMaximum: musicMaxCostCny, cnyPerUsd }, boundary: "Generation success is distinct from qualification and release eligibility; quality is fail-closed." };
    }
  });
}
