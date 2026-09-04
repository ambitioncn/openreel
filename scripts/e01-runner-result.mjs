const TERMINAL_STATES = new Set(["failed", "canceled"]);
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ACCEPTANCE_STAGES = new Set(["initialization", "authentication", "allowance", "project_setup", "submission", "polling", "terminal", "project_snapshot", "asset_metadata", "asset_download", "billing", "timeline"]);

export function safeAcceptanceStage(value) {
  return ACCEPTANCE_STAGES.has(value) ? value : "unknown";
}

export function terminalJobError(job, usage = null) {
  const state = TERMINAL_STATES.has(job?.state) ? job.state : "failed";
  const candidate = typeof job?.error?.code === "string" ? job.error.code : "";
  const code = SAFE_CODE.test(candidate) ? candidate : "ARK_TASK_FAILED";
  const error = new Error("asynchronous generation did not succeed");
  Object.assign(error, {
    code,
    terminalState: state,
    spentUnits: Number.isSafeInteger(usage?.subscription?.spentMicros) ? usage.subscription.spentMicros : null,
    reservedUnits: Number.isSafeInteger(usage?.subscription?.reservedMicros) ? usage.subscription.reservedMicros : null,
    reconciliation: typeof usage?.reconciliation?.consistent === "boolean" ? usage.reconciliation.consistent : null
  });
  return error;
}
