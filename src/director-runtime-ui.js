const STAGE = Object.freeze({ idle: "awaiting_director_workflow", quoted: "formal_generation", queued: "formal_generation", running: "formal_generation", succeeded: "post_production", failed: "formal_generation", canceled: "formal_generation" });
const PERCEPTUAL_LABELS = Object.freeze({ visual_identity_consistency: "人物视觉身份一致性", performance_naturalness: "表演自然度" });

function perceptualEvidence(quality) {
  return Object.freeze((quality?.shots || []).flatMap(shot => Object.entries(PERCEPTUAL_LABELS).map(([dimension, label]) => {
    const check = shot.creativeChecks?.find(item => item.dimension === dimension);
    return Object.freeze({ shotId: shot.shotId, dimension, label, score: Number.isFinite(check?.score) ? check.score : null, accepted: !shot.creativeFailures?.includes(dimension), evidence: check?.evidence ? Object.freeze({ assetId: check.evidence.assetId, sha256: check.evidence.sha256, observed: check.evidence.observed }) : null });
  })));
}

export function directorRuntimeUiState(quote, job) {
  const state = job?.status || (quote ? "quoted" : "idle");
  const attempts = Number.isSafeInteger(job?.attempts) ? job.attempts : 0;
  const maxAttempts = Number.isSafeInteger(job?.maxAttempts) ? job.maxAttempts : 0;
  const costSource = quote?.cost || job?.cost || job?.input?.cost || {};
  const estimatedCny = Number.isFinite(costSource.estimatedCny) ? costSource.estimatedCny : 0;
  const quality = job?.result?.quality || null, workflow = job?.director || null;
  const qualificationStatus = job?.result?.qualificationStatus || (quality ? quality.accepted ? "approved" : "rejected" : "not_qualified");
  const releaseEligible = job?.result?.releaseEligible === true && qualificationStatus === "approved";
  return Object.freeze({
    schema: "openreel-director-runtime-ui/v1",
    stage: STAGE[state] || "formal_generation",
    evidence: workflow?.stages ? workflow.stages.filter(item => item.evidence).map(item => `${item.id}:${item.status}`).join(",") : job?.id ? `generation-job:${job.id}` : quote?.id ? `generation-quote:${quote.id}` : "missing",
    generationStatus: ["succeeded", "failed", "canceled"].includes(state) ? state : state === "idle" || state === "quoted" ? "not_started" : state,
    qualificationStatus,
    releaseEligible,
    gate: quote && !job ? quote.director?.ready === false ? "continuity_and_reference_binding_required" : "explicit_generation_confirmation_required" : job ? releaseEligible ? "qualified_for_release_preflight" : "director_quality_review_required" : "director_workflow_required",
    cost: Object.freeze({ estimatedCny, generationEstimatedCny: Number.isFinite(costSource.generationEstimatedCny) ? costSource.generationEstimatedCny : null, evaluationEstimatedCny: Number.isFinite(costSource.evaluationEstimatedCny) ? costSource.evaluationEstimatedCny : null, paidActionExecuted: Boolean(job) }),
    retry: Object.freeze({ attempts, maxAttempts, exhausted: maxAttempts > 0 && attempts >= maxAttempts }),
    workflow,
    quality,
    perceptualEvidence: perceptualEvidence(quality),
    failures: Object.freeze({ shots: Object.freeze((quality?.shots || []).flatMap(shot => [...(shot.creativeFailures || []), ...(shot.technicalFailures || [])].map(dimension => `${shot.shotId}:${dimension}`))), final: Object.freeze([...(quality?.final?.directorFailures || []), ...(quality?.final?.technicalFailures || [])]) }),
    rework: Object.freeze({ failedShotIds: Object.freeze((job?.result?.shots || []).filter(shot => shot.status === "failed").map(shot => shot.id)), localOnly: true })
  });
}

export function directorPerceptualUiRows(state) {
  if (!state.perceptualEvidence.length) return Object.freeze([{ label: "人物视觉身份一致性 / 表演自然度", detail: "等待实际视频字节质量评估", accepted: false }]);
  return Object.freeze(state.perceptualEvidence.map(item => Object.freeze({ label: `镜头 ${item.shotId} · ${item.label}`, detail: item.evidence ? `分数 ${item.score?.toFixed(2) ?? "缺失"} · 证据 ${item.evidence.assetId} · SHA-256 ${item.evidence.sha256}` : `分数 ${item.score?.toFixed(2) ?? "缺失"} · 字节证据缺失`, accepted: item.accepted && item.score !== null && Boolean(item.evidence) })));
}

export function directorRuntimeUiSummary(state) {
  const split = state.cost.evaluationEstimatedCny === null ? "" : `（生成 ¥${state.cost.generationEstimatedCny.toFixed(2)} + 评估 ¥${state.cost.evaluationEstimatedCny.toFixed(2)}）`;
  const failures = [...state.failures.shots, ...state.failures.final].length ? ` · 失败 ${[...state.failures.shots, ...state.failures.final].join(",")}` : "";
  return `阶段 ${state.stage} · 证据 ${state.evidence} · 生成 ${state.generationStatus} · 质量 ${state.qualificationStatus} · 发布资格 ${state.releaseEligible ? "允许" : "禁止"} · 门禁 ${state.gate} · 费用上限 ¥${state.cost.estimatedCny.toFixed(2)}${split}${failures} · 重试 ${state.retry.attempts}/${state.retry.maxAttempts || "未设置"}`;
}
