import { DomainError } from "./core.js";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ACTIVE = new Set(["queued", "running"]);
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);
const DIRECTOR_STAGES = Object.freeze(["creative", "script", "visual_bible", "dynamic_storyboard", "formal_generation", "post_production", "automatic_qc"]);
const clone = value => structuredClone(value);

function safeProviderDiagnostic(error) {
  if (["ARK_PROVIDER_ERROR", "ARK_PROVIDER_AUTH"].includes(error?.code)) {
    const details = error?.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) return { provider: "volcengine-ark", category: "unknown" };
    const upstreamStatus = Number.isInteger(details.upstreamStatus) && details.upstreamStatus >= 400 && details.upstreamStatus <= 599 ? details.upstreamStatus : null;
    const providerCode = typeof details.providerCode === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(details.providerCode) ? details.providerCode : null;
    const providerParam = typeof details.providerParam === "string" && /^[A-Za-z0-9_.[\]-]{1,120}$/.test(details.providerParam) ? details.providerParam : null;
    const providerRequestIdHash = typeof details.providerRequestIdHash === "string" && /^[a-f0-9]{16}$/.test(details.providerRequestIdHash) ? details.providerRequestIdHash : null;
    return { provider: "volcengine-ark", category: upstreamStatus ? "http" : "transport", ...(upstreamStatus ? { upstreamStatus } : {}), ...(providerCode ? { providerCode } : {}), ...(providerParam ? { providerParam } : {}), ...(providerRequestIdHash ? { providerRequestIdHash } : {}) };
  }
  if (error?.code !== "QWEN_TTS_PROVIDER_ERROR") return null;
  const status = error?.details?.upstreamStatus;
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return { provider: "qwen-tts-tailnet", category: "http", upstreamStatus: status };
  }
  const rawCode = error?.details?.causeCode;
  const causeCode = typeof rawCode === "string" && /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : null;
  return { provider: "qwen-tts-tailnet", category: "transport", ...(causeCode ? { causeCode } : {}) };
}

function safeTerminalCost(error) {
  const cost = error?.details?.terminalCost;
  if (!cost || cost.currency !== "CNY" || !["settled", "unsettled"].includes(cost.status)) return null;
  const fields = ["settledCny", "generationSettledCny", "evaluationSettledCny"];
  if (fields.some(field => cost[field] !== null && (!Number.isFinite(cost[field]) || cost[field] < 0 || cost[field] > 100))) return null;
  if (cost.status === "settled" && !Number.isFinite(cost.settledCny)) return null;
  return { currency: "CNY", status: cost.status, settledCny: cost.settledCny ?? null, generationSettledCny: cost.generationSettledCny ?? null, evaluationSettledCny: cost.evaluationSettledCny ?? null };
}

function requiredText(value, name, max = 200) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new DomainError("COMMERCIAL_JOB_INVALID", `${name} is required`, 422);
  return normalized;
}

export function createMemoryCommercialJobStore(seed = []) {
  const jobs = new Map(seed.map(job => [job.id, clone(job)]));
  return Object.freeze({
    get: id => jobs.has(id) ? clone(jobs.get(id)) : null,
    listOwned: ownerId => [...jobs.values()].filter(job => job.ownerId === ownerId).map(clone),
    getByIdempotency: (ownerId, key) => clone([...jobs.values()].find(job => job.ownerId === ownerId && job.idempotencyKey === key) || null),
    create(job) {
      const replay = this.getByIdempotency(job.ownerId, job.idempotencyKey);
      if (replay) return replay;
      jobs.set(job.id, clone(job));
      return clone(job);
    },
    update(job) {
      if (!jobs.has(job.id)) throw new DomainError("COMMERCIAL_JOB_NOT_FOUND", "commercial job not found", 404);
      jobs.set(job.id, clone(job));
      return clone(job);
    },
    listRecoverable: () => [...jobs.values()].filter(job => ACTIVE.has(job.status)).map(clone)
  });
}

export function createFileCommercialJobStore(file) {
  requiredText(file, "file", 4_000);
  mkdirSync(dirname(file), { recursive: true, mode: 0o750 });
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new DomainError("COMMERCIAL_JOB_STORE_CORRUPT", "commercial job store is unreadable", 500); state = { schema: "openreel-commercial-job-store/v1", jobs: [] }; }
  if (state?.schema !== "openreel-commercial-job-store/v1" || !Array.isArray(state.jobs)) throw new DomainError("COMMERCIAL_JOB_STORE_CORRUPT", "commercial job store has an invalid schema", 500);
  const persist = () => {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state)}\n`, { flag: "wx", mode: 0o640 });
    const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, file);
    const dirFd = openSync(dirname(file), "r"); try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  };
  const find = id => state.jobs.find(job => job.id === id);
  return Object.freeze({
    get: id => clone(find(id) || null),
    listOwned: ownerId => state.jobs.filter(job => job.ownerId === ownerId).map(clone),
    getByIdempotency: (ownerId, key) => clone(state.jobs.find(job => job.ownerId === ownerId && job.idempotencyKey === key) || null),
    create(job) {
      const replay = this.getByIdempotency(job.ownerId, job.idempotencyKey);
      if (replay) return replay;
      state.jobs.push(clone(job)); persist(); return clone(job);
    },
    update(job) {
      const index = state.jobs.findIndex(item => item.id === job.id);
      if (index < 0) throw new DomainError("COMMERCIAL_JOB_NOT_FOUND", "commercial job not found", 404);
      state.jobs[index] = clone(job); persist(); return clone(job);
    },
    listRecoverable: () => state.jobs.filter(job => ACTIVE.has(job.status)).map(clone)
  });
}

export function createCommercialJobLifecycle({ orchestrator, store = createMemoryCommercialJobStore(), id = () => crypto.randomUUID(), now = () => new Date().toISOString(), maxAttempts = 3 } = {}) {
  if (!orchestrator?.run || !store?.get || !store?.create || !store?.update || !store?.getByIdempotency || !store?.listRecoverable) throw new DomainError("COMMERCIAL_JOB_UNAVAILABLE", "commercial job lifecycle dependencies are unavailable", 503);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new DomainError("COMMERCIAL_JOB_CONFIG_INVALID", "maxAttempts must be between 1 and 5", 503);

  const owner = principal => requiredText(principal?.accountId, "principal.accountId");
  const visible = job => clone(job);
  const owned = (principal, jobId) => {
    const job = store.get(requiredText(jobId, "jobId"));
    if (!job || job.ownerId !== owner(principal)) throw new DomainError("COMMERCIAL_JOB_NOT_FOUND", "commercial job not found", 404);
    return job;
  };
  const save = job => store.update({ ...job, updatedAt: now() });
  const stageEvidence = (job, stage, status, detail = null) => ({ schema: "openreel-commercial-stage-evidence/v1", jobId: job.id, stage, status, detail: detail == null ? null : clone(detail), recordedAt: now() });
  const setDirectorStage = (job, stage, status, detail = null) => ({ ...job, director: { ...job.director, currentStage: status === "accepted" && stage === "automatic_qc" ? null : stage, stages: job.director.stages.map(item => item.id === stage ? { ...item, status, evidence: stageEvidence(job, stage, status, detail) } : item) } });

  async function execute(principal, jobId) {
    let job = owned(principal, jobId);
    if (TERMINAL.has(job.status)) return visible(job);
    if (job.cancelRequested) return visible(save({ ...job, status: "canceled", finishedAt: now() }));
    if (job.attempts >= maxAttempts) return visible(save({ ...job, status: "failed", error: { code: "COMMERCIAL_RETRY_EXHAUSTED", message: "commercial job retry limit reached" }, finishedAt: now() }));
    job = save({ ...job, status: "running", attempts: job.attempts + 1, startedAt: job.startedAt || now(), error: null });
    try {
      // The original key is intentionally stable across recovery and retry. Provider stages
      // derive their keys from it, so replay cannot reserve or purchase the same action twice.
      const progress = async (stage, detail = null) => {
        job = owned(principal, jobId);
        let next = { ...job, stage, stageDetail: detail };
        if (["images", "videos", "voice"].includes(stage) && job.director.currentStage === "formal_generation") next = setDirectorStage(next, "formal_generation", "running", { providerStage: stage, ...detail });
        if (stage === "compose") { next = setDirectorStage(next, "formal_generation", "accepted", { generated: true }); next = setDirectorStage(next, "post_production", "running", detail); next.director.currentStage = "post_production"; }
        if (stage === "quality") { next = setDirectorStage(next, "post_production", "accepted", { renderCreated: true }); next = setDirectorStage(next, "automatic_qc", "running", detail); next.director.currentStage = "automatic_qc"; }
        job = save(next);
      };
      const result = await orchestrator.run(principal, { ...job.input, idempotencyKey: job.idempotencyKey }, { progress });
      job = owned(principal, jobId);
      if (job.cancelRequested) return visible(save({ ...job, status: "canceled", result: null, finishedAt: now() }));
      const accepted = result?.status === "qualified" && result?.quality?.accepted === true && result?.releaseEligible === true;
      const finalJob = setDirectorStage(job, "automatic_qc", accepted ? "accepted" : "rejected", { qualificationStatus: result?.qualificationStatus || "not_qualified", releaseEligible: result?.releaseEligible === true, quality: result?.quality || null });
      finalJob.director.status = accepted ? "qualified" : "rejected";
      return visible(save({ ...finalJob, status: accepted ? "succeeded" : "failed", retryable: false, result, error: accepted ? null : { code: "COMMERCIAL_QUALITY_REJECTED", message: "generation completed but quality rejected the result" }, cost: { ...job.cost, ...(result?.cost || {}), estimatedCny: job.cost?.estimatedCny ?? null }, finishedAt: now() }));
    } catch (error) {
      job = owned(principal, jobId);
      const retryable = error?.details?.retryable === false ? false : error?.details?.retryable === true || [429, 502, 503, 504].includes(error?.status);
      const providerDiagnostic = safeProviderDiagnostic(error);
      const diagnostic = error?.details?.rendererDiagnostic && error?.details?.stderrSha256 ? { rendererDiagnostic: error.details.rendererDiagnostic, stderrSha256: error.details.stderrSha256 } : typeof error?.details?.qualityDiagnostic === "string" ? { qualityDiagnostic: error.details.qualityDiagnostic } : providerDiagnostic ? { providerDiagnostic } : {};
      const terminalCost = safeTerminalCost(error);
      return visible(save({ ...job, status: "failed", retryable: retryable && job.attempts < maxAttempts, error: { code: error?.code || "COMMERCIAL_PROVIDER_FAILED", message: "commercial generation failed", ...diagnostic }, cost: { ...job.cost, ...(terminalCost || { status: "unsettled" }) }, finishedAt: now() }));
    }
  }

  return Object.freeze({
    create(principal, input = {}) {
      const ownerId = owner(principal), idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
      const replay = store.getByIdempotency(ownerId, idempotencyKey);
      if (replay) return visible(replay);
      const timestamp = now();
      const jobId = id();
      const stages = DIRECTOR_STAGES.map((stage, index) => ({ id: stage, status: index < 4 ? "accepted" : index === 4 ? "awaiting_execution" : "pending", evidence: index < 4 ? { schema: "openreel-commercial-stage-evidence/v1", jobId, stage, status: "accepted", detail: { binding: clone(input.director || null) }, recordedAt: timestamp } : null }));
      return visible(store.create({ schema: "openreel-commercial-job/v1", id: jobId, ownerId, idempotencyKey, status: "queued", stage: "prepare", stageDetail: null, director: { schema: "openreel-commercial-director-workflow/v1", currentStage: "formal_generation", status: "in_progress", stages }, attempts: 0, maxAttempts, cancelRequested: false, retryable: false, cost: { currency: "CNY", status: "quoted", estimatedCny: Number.isFinite(input.estimatedCostCny) ? input.estimatedCostCny : null, ...(Number.isFinite(input.quoteCost?.generationEstimatedCny) ? { generationEstimatedCny: input.quoteCost.generationEstimatedCny } : {}), ...(Number.isFinite(input.quoteCost?.evaluationEstimatedCny) ? { evaluationEstimatedCny: input.quoteCost.evaluationEstimatedCny } : {}), ...(input.quoteCost?.evaluation ? { evaluation: clone(input.quoteCost.evaluation) } : {}), settledCny: null }, input: clone(input), result: null, error: null, createdAt: timestamp, updatedAt: timestamp, startedAt: null, finishedAt: null }));
    },
    get: (principal, jobId) => visible(owned(principal, jobId)),
    execute,
    cancel(principal, jobId) {
      const job = owned(principal, jobId);
      if (TERMINAL.has(job.status)) return visible(job);
      return visible(save({ ...job, cancelRequested: true, ...(job.status === "queued" ? { status: "canceled", finishedAt: now() } : {}) }));
    },
    retry(principal, jobId) {
      const job = owned(principal, jobId);
      if (job.status !== "failed" || !job.retryable || job.attempts >= maxAttempts) throw new DomainError("COMMERCIAL_JOB_NOT_RETRYABLE", "commercial job is not retryable", 409);
      return visible(save({ ...job, status: "queued", retryable: false, error: null, cost: { ...job.cost, status: "quoted" }, finishedAt: null }));
    },
    recover() {
      return store.listRecoverable().map(job => visible(store.update({ ...job, status: job.cancelRequested ? "canceled" : "queued", ...(job.cancelRequested ? { finishedAt: now() } : {}), updatedAt: now() })));
    }
  });
}
