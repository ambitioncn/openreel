const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

export function storyboardBatchView(batch) {
  if (!batch) return { summary: "No storyboard batch started.", jobs: [], canAdvance: false, canCancel: false, canRetry: false };
  const jobs = batch.jobs.map(job => ({ id: job.id, order: job.storyboardOrder + 1, state: job.state, prompt: job.prompt }));
  const finished = jobs.filter(job => TERMINAL.has(job.state)).length;
  return {
    summary: `${batch.state} · ${finished}/${jobs.length} shots finished · cost ${batch.cost.currency} ${(batch.cost.amount / batch.cost.unitScale).toFixed(4)} (${batch.cost.basis})`,
    jobs,
    canAdvance: !["failed", "succeeded"].includes(batch.state),
    canCancel: !["failed", "succeeded"].includes(batch.state) && batch.jobs.some(job => ["queued", "running"].includes(job.state)),
    canRetry: batch.jobs.some(job => ["failed", "canceled"].includes(job.state))
  };
}

export function activeStoryboardJob(batch) {
  return batch?.jobs.find(job => ["running", "queued"].includes(job.state)) || null;
}

export function retryableStoryboardJob(batch) {
  return batch?.jobs.find(job => ["failed", "canceled"].includes(job.state)) || null;
}
