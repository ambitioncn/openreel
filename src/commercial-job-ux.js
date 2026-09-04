import { DomainError } from "./core.js";

const STAGES = Object.freeze(["prepare", "images", "videos", "voice", "compose", "quality"]);
const COPY = Object.freeze({
  COMMERCIAL_PROVIDER_FAILED: "云端生成暂时失败，请稍后重试失败的部分。",
  COMMERCIAL_RETRY_EXHAUSTED: "自动重试已结束，请调整失败镜头后再重做。",
  COMMERCIAL_JOB_NOT_RETRYABLE: "当前任务不能自动重试，请检查失败镜头。"
});

const money = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(Number(value).toFixed(2)) : 0;
const retainedAssetIds = shot => Array.isArray(shot?.assetIds) && shot.assetIds.length
  ? shot.assetIds
  : [shot?.assetId, shot?.quality?.generationAsset?.assetId, shot?.quality?.evidence?.assetId].filter(Boolean).slice(0, 1);

export function commercialJobView(job = {}) {
  const current = Math.max(0, STAGES.indexOf(job.stage));
  const terminal = ["succeeded", "failed", "canceled"].includes(job.status);
  const completed = job.status === "succeeded" ? STAGES.length : current;
  const estimate = money(job.cost?.estimatedCny);
  const settled = job.cost?.status === "settled" ? money(job.cost.settledCny) : null;
  const failedShotIds = Object.freeze([...(job.result?.shots || [])].filter(shot => shot.status === "failed").map(shot => shot.id));
  return Object.freeze({
    schema: "openreel-commercial-job-ux/v1",
    status: job.status || "queued",
    progress: Object.freeze({ completed, total: STAGES.length, percent: Math.round(completed / STAGES.length * 100), terminal }),
    message: job.status === "failed" ? (COPY[job.error?.code] || "成片未完成，请重做失败的部分。") : job.status === "succeeded" ? "成片已完成，可以预览和下载。" : `正在完成第 ${completed + 1}/${STAGES.length} 步，请保持页面打开。`,
    cost: Object.freeze({ estimatedCny: estimate, settledCny: settled, currency: "CNY", label: settled === null ? `预估 ¥${estimate.toFixed(2)}，尚未最终结算` : `实际 ¥${settled.toFixed(2)}` }),
    actions: Object.freeze({ canRetry: job.status === "failed" && job.retryable === true, canRedoFailedShots: failedShotIds.length > 0, failedShotIds })
  });
}

export function planFailedShotRedo(job = {}) {
  if (job.status !== "failed") throw new DomainError("COMMERCIAL_REDO_INVALID", "only failed jobs can be partially redone", 409);
  const shots = job.result?.shots;
  if (!Array.isArray(shots)) throw new DomainError("COMMERCIAL_REDO_INVALID", "failed shot evidence is required", 422);
  const failed = shots.filter(shot => shot.status === "failed");
  if (!failed.length) throw new DomainError("COMMERCIAL_REDO_INVALID", "no failed shots are available to redo", 409);
  const preserved = shots.filter(shot => shot.status === "succeeded");
  if (preserved.some(shot => !retainedAssetIds(shot).length)) throw new DomainError("COMMERCIAL_REDO_INVALID", "successful shots require retained immutable assets", 422);
  return Object.freeze({
    schema: "openreel-commercial-redo-plan/v1",
    sourceJobId: job.id,
    shotIds: Object.freeze(failed.map(shot => shot.id)),
    preservedShotIds: Object.freeze(preserved.map(shot => shot.id)),
    preservedAssets: Object.freeze(preserved.map(shot => Object.freeze({ shotId: shot.id, assetIds: Object.freeze([...retainedAssetIds(shot)]) }))),
    reasons: Object.freeze(Object.fromEntries(failed.map(shot => [shot.id, Object.freeze([...(shot.quality?.creativeFailures || []), ...(shot.quality?.technicalFailures || [])])]))),
    paidActionStarted: false,
    confirmationRequired: true
  });
}
