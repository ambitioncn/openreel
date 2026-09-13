import { DomainError } from "./core.js";
import { planFailedShotRedo } from "./commercial-job-ux.js";
import { qualifyCommercialStoryboardPolicySafety } from "./commercial-storyboard-preflight.js";
import { COMMERCIAL_FINAL_DIMENSIONS, COMMERCIAL_PERCEPTUAL_SCHEMA, COMMERCIAL_SHOT_DIMENSIONS } from "./ark-commercial-perceptual-evaluator.js";

const text = (value, name, max = 200) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new DomainError("COMMERCIAL_INPUT_INVALID", `${name} is required`, 422);
  return normalized;
};

function binding(snapshot, input) {
  if (!snapshot?.story || !snapshot?.storyboard) throw new DomainError("COMMERCIAL_INPUT_INVALID", "story and storyboard are required", 409);
  const expected = {
    projectVersion: Number(input.projectVersion),
    storyVersion: Number(input.storyVersion),
    storyboardVersion: Number(input.storyboardVersion)
  };
  if (!Object.values(expected).every(Number.isInteger)) throw new DomainError("COMMERCIAL_BINDING_INVALID", "project, story and storyboard versions are required", 422);
  if (snapshot.project.version !== expected.projectVersion || snapshot.story.version !== expected.storyVersion || snapshot.storyboard.version !== expected.storyboardVersion) throw new DomainError("VERSION_CONFLICT", "commercial generation binding is stale", 409);
  return expected;
}

function redoBinding(snapshot, input) {
  if (!snapshot?.story || !snapshot?.storyboard) throw new DomainError("COMMERCIAL_INPUT_INVALID", "story and storyboard are required", 409);
  const storyVersion = Number(input.storyVersion), storyboardVersion = Number(input.storyboardVersion);
  if (![storyVersion, storyboardVersion].every(Number.isInteger)) throw new DomainError("COMMERCIAL_BINDING_INVALID", "story and storyboard versions are required", 422);
  if (snapshot.story.version !== storyVersion || snapshot.storyboard.version !== storyboardVersion) throw new DomainError("VERSION_CONFLICT", "commercial generation binding is stale", 409);
  return { projectVersion: snapshot.project.version, storyVersion, storyboardVersion };
}

function selectedProductionAssets(state, input = {}) {
  const captionAssetIds = input.captionAssetIds ?? [];
  if (!Array.isArray(captionAssetIds) || captionAssetIds.some(value => typeof value !== "string" || !value.trim())) throw new DomainError("COMMERCIAL_ASSET_SELECTION_INVALID", "captionAssetIds must be an array of asset ids", 422);
  const musicAssetId = input.musicAssetId == null || input.musicAssetId === "" ? null : text(input.musicAssetId, "musicAssetId");
  const selected = [...new Set([...captionAssetIds, ...(musicAssetId ? [musicAssetId] : [])])];
  const assets = new Map((state.assets || []).map(asset => [asset.id, asset]));
  if (selected.some(assetId => !assets.has(assetId))) throw new DomainError("COMMERCIAL_ASSET_SELECTION_INVALID", "selected production asset is outside the current project", 409);
  const confirmation = input.musicRightsConfirmation;
  const generation = input.musicGeneration ?? null;
  if (generation && (musicAssetId || generation.enabled !== true || generation.model !== "seed-audio-1.0" || ![5, 10].includes(Number(generation.durationSeconds)))) throw new DomainError("COMMERCIAL_MUSIC_GENERATION_INVALID", "real music generation selection is invalid", 422);
  if (musicAssetId && (confirmation?.accepted !== true || confirmation?.disclaimerVersion !== "music-rights-v1" || !Number.isFinite(Date.parse(confirmation?.confirmedAt)))) throw new DomainError("COMMERCIAL_MUSIC_RIGHTS_CONFIRMATION_REQUIRED", "confirm responsibility for necessary music rights", 409);
  if (generation && (confirmation?.accepted !== true || confirmation?.disclaimerVersion !== "music-rights-v1" || !Number.isFinite(Date.parse(confirmation?.confirmedAt)))) throw new DomainError("COMMERCIAL_MUSIC_RIGHTS_CONFIRMATION_REQUIRED", "confirm responsibility for generated music use", 409);
  return { captionAssetIds: [...new Set(captionAssetIds)], musicAssetId, musicRightsConfirmation: musicAssetId || generation ? { accepted: true, disclaimerVersion: "music-rights-v1", confirmedAt: new Date(confirmation.confirmedAt).toISOString(), sourceDeclaration: typeof confirmation.sourceDeclaration === "string" ? confirmation.sourceDeclaration.trim() : "" } : null, ...(generation && { musicGeneration: { enabled: true, confirmed: true, model: "seed-audio-1.0", prompt: text(generation.prompt, "musicGeneration.prompt", 500), durationSeconds: Number(generation.durationSeconds) } }) };
}

function generationMode(value) {
  if (value == null || value === "") return "text_to_video";
  if (!["text_to_video", "reference_consistency"].includes(value)) throw new DomainError("COMMERCIAL_INPUT_INVALID", "generationMode must be text_to_video or reference_consistency", 422);
  return value;
}

function directorContext(state, mode) {
  const entities = new Map((state.continuityEntities || []).map(entity => [entity.id, entity]));
  const shots = state.storyboard.shots.map((shot, index) => {
    const usages = (shot.continuityEntityUsages || []).map(usage => ({
      entityId: text(usage.entityId, `storyboard.shots[${index}].continuityEntityUsages.entityId`, 100),
      kind: text(usage.kind, `storyboard.shots[${index}].continuityEntityUsages.kind`, 30),
      version: Number(usage.version),
      referenceAssetIds: [...new Set(usage.referenceAssetIds || [])]
    }));
    const referenced = [...new Set(shot.referenceAssetIds || [])];
    const bound = usages.map(usage => entities.get(usage.entityId)).filter(Boolean);
    const hasRole = bound.some(entity => ["character", "product"].includes(entity.kind));
    const hasScene = bound.some(entity => entity.kind === "scene");
    const style = typeof shot.styleContinuity === "string" ? shot.styleContinuity.trim() : typeof state.story?.style === "string" ? state.story.style.trim() : "";
    const referenceReady = hasRole && hasScene && Boolean(style) && referenced.length > 0 && usages.every(usage => Number.isSafeInteger(usage.version) && usage.version > 0 && usage.referenceAssetIds.length > 0);
    const ready = mode === "text_to_video" ? Boolean(shot.prompt?.trim()) : referenceReady;
    return { shotId: shot.id, ready, roleEntityIds: mode === "text_to_video" ? [] : bound.filter(entity => ["character", "product"].includes(entity.kind)).map(entity => entity.id), sceneEntityIds: mode === "text_to_video" ? [] : bound.filter(entity => entity.kind === "scene").map(entity => entity.id), style: style || "Follow the storyboard prompt with a coherent visual style.", continuityEntityUsages: mode === "text_to_video" ? [] : usages, referenceAssetIds: mode === "text_to_video" ? [] : referenced };
  });
  return { schema: "openreel-commercial-director-context/v1", mode, ready: shots.every(shot => shot.ready), shots };
}

function quotedCost(cost, message, shotCount) {
  const estimatedCny = Number(cost?.estimatedCny), generationEstimatedCny = Number(cost?.generationEstimatedCny ?? estimatedCny), evaluationEstimatedCny = Number(cost?.evaluationEstimatedCny ?? 0);
  if (![estimatedCny, generationEstimatedCny, evaluationEstimatedCny].every(value => Number.isFinite(value) && value >= 0) || Number((generationEstimatedCny + evaluationEstimatedCny).toFixed(6)) !== Number(estimatedCny.toFixed(6)) || estimatedCny > 100) throw new DomainError("COMMERCIAL_COST_LIMIT", message, 403);
  const evaluationCalls = shotCount + 1, maximumCostCnyPerCall = evaluationCalls ? evaluationEstimatedCny / evaluationCalls : 0;
  return { currency: "CNY", estimatedCny: Number(estimatedCny.toFixed(2)), generationEstimatedCny: Number(generationEstimatedCny.toFixed(2)), evaluationEstimatedCny: Number(evaluationEstimatedCny.toFixed(2)), evaluation: { schema: COMMERCIAL_PERCEPTUAL_SCHEMA, shotDimensions: [...COMMERCIAL_SHOT_DIMENSIONS], finalDimensions: [...COMMERCIAL_FINAL_DIMENSIONS], calls: evaluationCalls, maximumCostCnyPerCall: Number(maximumCostCnyPerCall.toFixed(6)), necessity: "qualify actual generated shot bytes and the composed render before release eligibility" }, perActionLimitCny: 100 };
}

export function createWorkbenchCommercialService({ lifecycle, snapshot, estimate, policyPreflight = qualifyCommercialStoryboardPolicySafety, id = () => crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  if (!lifecycle?.create || !lifecycle?.get || !lifecycle?.execute || !lifecycle?.retry || !lifecycle?.cancel || typeof snapshot !== "function" || typeof estimate !== "function") throw new DomainError("COMMERCIAL_WORKBENCH_UNAVAILABLE", "commercial workbench dependencies are unavailable", 503);
  const quotes = new Map();
  const principalId = principal => text(principal?.accountId, "principal.accountId");
  const current = (principal, projectId) => snapshot(text(projectId, "projectId"), principalId(principal));
  const ownedQuote = (principal, quoteId) => {
    const quote = quotes.get(text(quoteId, "quoteId"));
    if (!quote || quote.ownerId !== principalId(principal)) throw new DomainError("COMMERCIAL_QUOTE_NOT_FOUND", "commercial quote not found", 404);
    return quote;
  };
  const ownedJob = (principal, projectId, jobId) => {
    const job = lifecycle.get(principal, text(jobId, "jobId"));
    if (job.input?.projectId !== text(projectId, "projectId")) throw new DomainError("COMMERCIAL_JOB_NOT_FOUND", "commercial job not found", 404);
    return job;
  };
  return Object.freeze({
    quote(principal, projectId, input = {}) {
      if (input.sourceJobId != null || input.redo != null || input.preservedShotIds != null || input.preservedAssetIds != null) throw new DomainError("COMMERCIAL_FRESH_CANDIDATE_REQUIRED", "initial commercial quotes cannot inherit or replay a prior job", 422);
      const state = current(principal, projectId), versions = binding(state, input), quality = ["fast", "quality"].includes(input.quality) ? input.quality : "fast", mode = generationMode(input.generationMode);
      const policySafety = mode === "reference_consistency" && input.requirePolicySafety === true ? policyPreflight({ identityReference: input.identityReference, declarations: input.declarations, storyboard: state.storyboard }) : null;
      const productionAssets = selectedProductionAssets(state, input), director = directorContext(state, mode);
      if (director.ready !== true) throw new DomainError("COMMERCIAL_DIRECTOR_BINDING_REQUIRED", mode === "reference_consistency" ? "complete director continuity and reference bindings before requesting a commercial quote" : "every storyboard shot needs a prompt before requesting a commercial quote", 409);
      const cost = estimate({ quality, shotCount: state.storyboard.shots.length, duration: state.storyboard.shots.reduce((sum, shot) => sum + shot.duration, 0), production: { ...state.story.production, ...productionAssets } });
      const boundedCost = quotedCost(cost, "commercial quote exceeds the authorized per-action CNY limit", state.storyboard.shots.length);
      if (!cost?.models?.image || !cost?.models?.video) throw new DomainError("COMMERCIAL_MODEL_UNAVAILABLE", "commercial quote has no reviewed image/video models", 503);
      const candidate = { schema: "openreel-commercial-candidate-lineage/v1", mode: "fresh", generationMode: mode, sourceJobId: null, inheritedShotIds: [], inheritedAssetIds: [] };
      const quote = { schema: "openreel-commercial-quote/v1", id: id(), ownerId: principalId(principal), projectId, quality, generationMode: mode, candidate, models: { image: cost.models.image, video: cost.models.video }, binding: versions, productionAssets, director, ...(policySafety && { policySafety }), cost: boundedCost, confirmationRequired: true, paidActionStarted: false, createdAt: now() };
      quotes.set(quote.id, quote);
      return structuredClone(quote);
    },
    confirm(principal, projectId, input = {}) {
      if (input.confirmed !== true) throw new DomainError("COMMERCIAL_CONFIRMATION_REQUIRED", "explicit quote confirmation is required", 409);
      const quote = ownedQuote(principal, input.quoteId);
      if (quote.projectId !== projectId) throw new DomainError("COMMERCIAL_QUOTE_NOT_FOUND", "commercial quote not found", 404);
      const state = current(principal, projectId); binding(state, quote.binding);
      const script = state.story.scenes.map(scene => scene.summary).filter(Boolean).join("\n");
      const storyboard = { ...state.storyboard, shots: state.storyboard.shots.map((shot, index) => ({ ...shot, caption: state.story.scenes[index]?.summary })) };
      return lifecycle.create(principal, { projectId, ...quote.binding, quoteId: quote.id, quoteCost: quote.cost, estimatedCostCny: quote.cost.estimatedCny, generationMode: quote.generationMode, candidate: quote.candidate, script, storyboard, director: quote.director, ...(quote.policySafety && { policySafety: quote.policySafety }), production: { ...state.story.production, ...quote.productionAssets }, models: quote.models, quality: quote.quality, idempotencyKey: text(input.idempotencyKey, "idempotencyKey") });
    },
    redoQuote(principal, projectId, sourceJobId) {
      const source = lifecycle.get(principal, text(sourceJobId, "sourceJobId"));
      if (source.input?.projectId !== projectId) throw new DomainError("COMMERCIAL_JOB_NOT_FOUND", "commercial job not found", 404);
      const state = current(principal, projectId), versions = redoBinding(state, source.input || {}), plan = planFailedShotRedo(source);
      const byId = new Map(state.storyboard.shots.map(shot => [shot.id, shot]));
      if (![...plan.shotIds, ...plan.preservedShotIds].every(shotId => byId.has(shotId))) throw new DomainError("VERSION_CONFLICT", "commercial redo shots do not match the current storyboard", 409);
      const cost = estimate({ quality: source.input.quality || "fast", shotCount: plan.shotIds.length, duration: plan.shotIds.reduce((sum, shotId) => sum + byId.get(shotId).duration, 0), production: state.story.production });
      const boundedCost = quotedCost(cost, "commercial redo quote exceeds the authorized per-action CNY limit", plan.shotIds.length);
      if (!cost?.models?.image || !cost?.models?.video) throw new DomainError("COMMERCIAL_MODEL_UNAVAILABLE", "commercial redo quote has no reviewed image/video models", 503);
      const preservedShots = plan.preservedAssets.map(shot => ({ shotId: shot.shotId, assetIds: [...shot.assetIds] }));
      const mode = generationMode(source.input.generationMode || source.input.director?.mode || (source.input.policySafety ? "reference_consistency" : "text_to_video"));
      const quote = { schema: "openreel-commercial-redo-quote/v1", id: id(), ownerId: principalId(principal), projectId, sourceJobId: source.id, shotIds: plan.shotIds, reasons: plan.reasons, preservedShotIds: plan.preservedShotIds, preservedAssetIds: preservedShots.flatMap(shot => shot.assetIds), preservedShots, models: { image: cost.models.image, video: cost.models.video }, quality: source.input.quality || "fast", generationMode: mode, binding: versions, director: source.input.director, ...(source.input.policySafety && { policySafety: source.input.policySafety }), cost: boundedCost, confirmationRequired: true, paidActionStarted: false, createdAt: now() };
      quotes.set(quote.id, quote);
      return structuredClone(quote);
    },
    confirmRedo(principal, projectId, sourceJobId, input = {}) {
      if (input.confirmed !== true) throw new DomainError("COMMERCIAL_CONFIRMATION_REQUIRED", "explicit redo quote confirmation is required", 409);
      const quote = ownedQuote(principal, input.quoteId);
      if (quote.schema !== "openreel-commercial-redo-quote/v1" || quote.projectId !== projectId || quote.sourceJobId !== sourceJobId) throw new DomainError("COMMERCIAL_QUOTE_NOT_FOUND", "commercial redo quote not found", 404);
      const state = current(principal, projectId); binding(state, quote.binding);
      const selected = new Set(quote.shotIds), storyboard = { ...state.storyboard, shots: state.storyboard.shots.filter(shot => selected.has(shot.id)) };
      return lifecycle.create(principal, { projectId, ...quote.binding, quoteId: quote.id, quoteCost: quote.cost, estimatedCostCny: quote.cost.estimatedCny, generationMode: quote.generationMode, script: state.story.scenes.map(scene => scene.summary).filter(Boolean).join("\n"), storyboard, director: quote.director, ...(quote.policySafety && { policySafety: quote.policySafety }), production: state.story.production, models: quote.models, quality: quote.quality, redo: { schema: "openreel-commercial-redo/v1", sourceJobId, shotIds: quote.shotIds, preservedShotIds: quote.preservedShotIds, preservedAssetIds: quote.preservedAssetIds, preservedShots: quote.preservedShots, compositionStoryboard: state.storyboard }, idempotencyKey: text(input.idempotencyKey, "idempotencyKey") });
    },
    get: (principal, projectId, jobId) => ownedJob(principal, projectId, jobId),
    execute: (principal, projectId, jobId) => (ownedJob(principal, projectId, jobId), lifecycle.execute(principal, jobId)),
    retry: (principal, projectId, jobId) => (ownedJob(principal, projectId, jobId), lifecycle.retry(principal, jobId)),
    cancel: (principal, projectId, jobId) => (ownedJob(principal, projectId, jobId), lifecycle.cancel(principal, jobId))
  });
}
