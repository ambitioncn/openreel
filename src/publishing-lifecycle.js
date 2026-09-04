import { createHash } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "./core.js";

const clone = value => structuredClone(value);
const TERMINAL = new Set(["published", "cancelled"]);
const RECOVERABLE = new Set(["queued", "validating", "uploading", "processing", "publishing", "cancelling", "unknown_remote"]);
const TRANSITIONS = Object.freeze({
  queued: ["validating", "cancelling"], validating: ["awaiting_confirmation", "failed", "cancelling"],
  awaiting_confirmation: ["uploading", "cancelling"], uploading: ["processing", "failed", "unknown_remote", "cancelling"],
  processing: ["publishing", "published", "failed", "unknown_remote", "cancelling"], publishing: ["published", "failed", "unknown_remote", "cancelling"],
  failed: ["queued", "unknown_remote"], cancelling: ["cancelled", "unknown_remote"], unknown_remote: ["processing", "publishing", "published", "failed", "cancelled"],
  published: [], cancelled: []
});

function required(value, field, max = 500) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new DomainError("PUBLISHING_JOB_INVALID", `${field} is required`, 422);
  return normalized;
}

function intentIdentity(input) {
  const canonical = [input.tenantId, input.platform, input.accountId, input.assetSha256, input.intentKey].map((value, index) => required(value, ["tenantId", "platform", "accountId", "assetSha256", "intentKey"][index])).join("\0");
  return createHash("sha256").update(canonical).digest("hex");
}

export function classifyPublishingFailure(error) {
  if (error?.remoteOutcomeUnknown === true) return { category: "unknown_remote", retryable: false, ambiguous: true };
  if (error?.category === "auth" || [401, 403].includes(error?.status)) return { category: "auth", retryable: false, ambiguous: false };
  if (error?.category === "quota" || error?.status === 429) return { category: "quota", retryable: true, ambiguous: false };
  if (["policy", "permanent"].includes(error?.category) || (error?.status >= 400 && error?.status < 500)) return { category: error?.category || "permanent", retryable: false, ambiguous: false };
  if (error?.category === "transient" || [502, 503, 504].includes(error?.status)) return { category: "transient", retryable: true, ambiguous: false };
  return { category: "unknown_remote", retryable: false, ambiguous: true };
}

export function createMemoryPublishingJobStore(seed = []) {
  const jobs = new Map(seed.map(job => [job.id, clone(job)]));
  const intents = new Map(seed.map(job => [job.intentIdentity, job.id]));
  return Object.freeze({
    get: id => clone(jobs.get(id) || null),
    getByIntent: identity => clone(jobs.get(intents.get(identity)) || null),
    create(job) {
      const replay = this.getByIntent(job.intentIdentity);
      if (replay) return replay;
      jobs.set(job.id, clone(job)); intents.set(job.intentIdentity, job.id); return clone(job);
    },
    compareAndSwap(job, expectedVersion) {
      const current = jobs.get(job.id);
      if (!current) throw new DomainError("PUBLISHING_JOB_NOT_FOUND", "publishing job not found", 404);
      if (current.version !== expectedVersion) throw new DomainError("PUBLISHING_JOB_CONFLICT", "publishing job was changed concurrently", 409);
      jobs.set(job.id, clone(job)); return clone(job);
    },
    listRecoverable: () => [...jobs.values()].filter(job => RECOVERABLE.has(job.state)).map(clone)
  });
}

export function createFilePublishingJobStore(file) {
  required(file, "file", 4_000);
  mkdirSync(dirname(file), { recursive: true, mode: 0o750 });
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new DomainError("PUBLISHING_JOB_STORE_CORRUPT", "publishing job store is unreadable", 500); state = { schema: "openreel-publishing-job-store/v1", jobs: [] }; }
  if (state?.schema !== "openreel-publishing-job-store/v1" || !Array.isArray(state.jobs)) throw new DomainError("PUBLISHING_JOB_STORE_CORRUPT", "publishing job store has an invalid schema", 500);
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
    getByIntent: identity => clone(state.jobs.find(job => job.intentIdentity === identity) || null),
    create(job) { const replay = this.getByIntent(job.intentIdentity); if (replay) return replay; state.jobs.push(clone(job)); persist(); return clone(job); },
    compareAndSwap(job, expectedVersion) { const index = state.jobs.findIndex(item => item.id === job.id); if (index < 0) throw new DomainError("PUBLISHING_JOB_NOT_FOUND", "publishing job not found", 404); if (state.jobs[index].version !== expectedVersion) throw new DomainError("PUBLISHING_JOB_CONFLICT", "publishing job was changed concurrently", 409); state.jobs[index] = clone(job); persist(); return clone(job); },
    listRecoverable: () => state.jobs.filter(job => RECOVERABLE.has(job.state)).map(clone)
  });
}

export function createPublishingLifecycle({ adapter, validate, store = createMemoryPublishingJobStore(), id = () => crypto.randomUUID(), now = () => new Date().toISOString(), random = Math.random, maxAttempts = 4, baseRetryMs = 1_000 } = {}) {
  if (!adapter?.upload || !adapter?.publish || !adapter?.reconcile || typeof validate !== "function") throw new DomainError("PUBLISHING_JOB_UNAVAILABLE", "publishing lifecycle dependencies are unavailable", 503);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || !Number.isFinite(baseRetryMs) || baseRetryMs < 1) throw new DomainError("PUBLISHING_JOB_CONFIG_INVALID", "publishing retry configuration is invalid", 503);

  const owned = (principal, jobId) => {
    const tenantId = required(principal?.tenantId, "principal.tenantId"), job = store.get(required(jobId, "jobId"));
    if (!job || job.tenantId !== tenantId) throw new DomainError("PUBLISHING_JOB_NOT_FOUND", "publishing job not found", 404);
    return job;
  };
  const actor = principal => required(principal?.accountId, "principal.accountId");
  const save = (job, state, event, details = {}) => {
    if (!TRANSITIONS[job.state]?.includes(state)) throw new DomainError("PUBLISHING_STATE_INVALID", `illegal publishing transition ${job.state} -> ${state}`, 409);
    const timestamp = now(), next = { ...job, ...details, state, version: job.version + 1, updatedAt: timestamp, history: [...job.history, { from: job.state, to: state, event, actorId: details.actorId || "system", at: timestamp }] };
    delete next.actorId;
    return store.compareAndSwap(next, job.version);
  };
  const failure = (job, error) => {
    const classification = classifyPublishingFailure(error);
    if (classification.ambiguous) return save(job, "unknown_remote", "remote_outcome_unknown", { error: { code: error?.code || "PUBLISHING_REMOTE_UNKNOWN", category: classification.category }, retryable: false });
    const retryAfterMs = Number.isFinite(error?.retryAfterMs) ? Math.max(0, error.retryAfterMs) : Math.round(baseRetryMs * (2 ** Math.max(0, job.attempts - 1)) * (0.5 + random()));
    return save(job, "failed", "remote_failure", { error: { code: error?.code || "PUBLISHING_REMOTE_FAILED", category: classification.category }, retryable: classification.retryable && job.attempts < maxAttempts, retryAt: classification.retryable ? new Date(Date.parse(now()) + retryAfterMs).toISOString() : null });
  };

  async function advance(principal, jobId) {
    let job = owned(principal, jobId);
    if (TERMINAL.has(job.state) || ["failed", "awaiting_confirmation", "unknown_remote"].includes(job.state)) return clone(job);
    if (job.state === "queued") job = save(job, "validating", "validation_started");
    if (job.state === "validating") {
      try { const result = await validate({ ...clone(job.input), tenantId: job.tenantId }); if (result?.accepted !== true) throw Object.assign(new Error("preflight rejected"), { category: "permanent", code: "PUBLISHING_PREFLIGHT_REJECTED" }); return clone(save(job, "awaiting_confirmation", "validation_passed", { preflight: clone(result) })); }
      catch (error) { return clone(failure(job, error)); }
    }
    if (job.state === "cancelling") {
      try { if (adapter.cancel) await adapter.cancel(clone(job)); return clone(save(job, "cancelled", "cancellation_completed")); }
      catch (error) { return clone(save(job, "unknown_remote", "cancellation_outcome_unknown", { error: { code: error?.code || "PUBLISHING_CANCEL_UNKNOWN", category: "unknown_remote" } })); }
    }
    const remoteAttempt = ["uploading", "publishing"].includes(job.state);
    if (remoteAttempt && job.attempts >= maxAttempts) return clone(save(job, "failed", "retry_exhausted", { retryable: false, error: { code: "PUBLISHING_RETRY_EXHAUSTED", category: "permanent" } }));
    const attempted = remoteAttempt ? store.compareAndSwap({ ...job, attempts: job.attempts + 1, version: job.version + 1, updatedAt: now() }, job.version) : job;
    try {
      if (attempted.state === "uploading") {
        const remote = await adapter.upload(clone(attempted), { idempotencyKey: `${attempted.intentIdentity}:upload` });
        return clone(save(attempted, "processing", "upload_accepted", { remote: { ...attempted.remote, ...clone(remote) }, error: null }));
      }
      if (attempted.state === "processing") {
        const result = await adapter.reconcile(clone(attempted));
        if (result?.status === "processing") return clone(attempted);
        if (result?.status === "published") return clone(save(attempted, "published", "reconciled_published", { remote: { ...attempted.remote, ...clone(result) }, finishedAt: now() }));
        if (result?.status !== "ready") throw Object.assign(new Error("unrecognized remote processing state"), { remoteOutcomeUnknown: true });
        return clone(save(attempted, "publishing", "processing_completed", { remote: { ...attempted.remote, ...clone(result) } }));
      }
      if (attempted.state === "publishing") {
        const remote = await adapter.publish(clone(attempted), { idempotencyKey: `${attempted.intentIdentity}:publish` });
        return clone(save(attempted, "published", "publish_confirmed", { remote: { ...attempted.remote, ...clone(remote) }, error: null, finishedAt: now() }));
      }
      return clone(attempted);
    } catch (error) { return clone(failure(store.get(attempted.id), error)); }
  }

  return Object.freeze({
    create(principal, input = {}) {
      const tenantId = required(principal?.tenantId, "principal.tenantId"), identity = intentIdentity({ ...input, tenantId }), replay = store.getByIntent(identity);
      if (replay) return clone(replay);
      const timestamp = now();
      return clone(store.create({ schema: "openreel-publishing-job/v1", id: id(), tenantId, platform: required(input.platform, "platform"), accountId: required(input.accountId, "accountId"), intentIdentity: identity, state: "queued", version: 1, attempts: 0, maxAttempts, retryable: false, retryAt: null, input: clone(input), preflight: null, remote: {}, error: null, createdAt: timestamp, updatedAt: timestamp, finishedAt: null, history: [{ from: null, to: "queued", event: "intent_created", actorId: actor(principal), at: timestamp }] }));
    },
    get: (principal, jobId) => clone(owned(principal, jobId)),
    advance,
    confirm(principal, jobId) { const job = owned(principal, jobId); if (job.state !== "awaiting_confirmation") throw new DomainError("PUBLISHING_CONFIRMATION_INVALID", "job is not awaiting confirmation", 409); return clone(save(job, "uploading", "owner_confirmed", { actorId: actor(principal) })); },
    cancel(principal, jobId) { const job = owned(principal, jobId); if (TERMINAL.has(job.state)) return clone(job); if (!TRANSITIONS[job.state]?.includes("cancelling")) throw new DomainError("PUBLISHING_CANCEL_INVALID", "job cannot be cancelled in its current state", 409); return clone(save(job, "cancelling", "cancellation_requested", { actorId: actor(principal) })); },
    retry(principal, jobId) { const job = owned(principal, jobId); if (job.state !== "failed" || !job.retryable || job.attempts >= maxAttempts) throw new DomainError("PUBLISHING_JOB_NOT_RETRYABLE", "publishing job is not retryable", 409); return clone(save(job, "queued", "manual_retry_requested", { actorId: actor(principal), error: null, retryable: false, retryAt: null })); },
    async reconcile(principal, jobId) { const job = owned(principal, jobId); if (job.state !== "unknown_remote") throw new DomainError("PUBLISHING_RECONCILE_INVALID", "job has no ambiguous remote outcome", 409); const result = await adapter.reconcile(clone(job)); if (result?.status === "published") return clone(save(job, "published", "reconciled_published", { remote: { ...job.remote, ...clone(result) }, error: null, finishedAt: now() })); if (result?.status === "processing") return clone(save(job, "processing", "reconciled_processing", { remote: { ...job.remote, ...clone(result) }, error: null })); if (result?.status === "ready") return clone(save(job, "publishing", "reconciled_ready", { remote: { ...job.remote, ...clone(result) }, error: null })); if (result?.status === "cancelled" || result?.status === "not_found") return clone(save(job, result.status === "cancelled" ? "cancelled" : "failed", `reconciled_${result.status}`, { retryable: false, error: result.status === "not_found" ? { code: "PUBLISHING_REMOTE_NOT_FOUND", category: "permanent" } : null, finishedAt: now() })); return clone(job); },
    recover() { return store.listRecoverable().map(job => clone(job)); }
  });
}
