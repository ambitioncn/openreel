const RATES = Object.freeze({ fast: 0.018, quality: 0.052 });

export function workbenchTimeline(storyboard = { shots: [] }) {
  let cursor = 0;
  return (storyboard.shots || []).map((shot, index) => {
    const duration = Number(shot.duration) || 0;
    const item = { id: shot.id, order: index + 1, start: cursor, end: cursor + duration, duration, redoRevision: shot.redoRevision || 0 };
    cursor += duration;
    return item;
  });
}

export function workbenchCostHint(storyboard, preference = "fast") {
  if (!(preference in RATES)) throw new TypeError("workbench preference must be fast or quality");
  const seconds = workbenchTimeline(storyboard).reduce((sum, item) => sum + item.duration, 0);
  return Object.freeze({ seconds, estimatedCny: Number((seconds * RATES[preference]).toFixed(2)), currency: "CNY", preference, basis: "preflight estimate only; no paid inference was started" });
}
