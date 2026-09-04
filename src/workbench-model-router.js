const QUALITY_LABELS = Object.freeze({ fast: "快速", quality: "高质量" });

function score(model, preference) {
  const id = `${model.id || ""} ${model.name || ""}`.toLowerCase();
  const local = model.adapterId === "local-deterministic" || model.provider === "local";
  if (preference === "fast") return (local ? 100 : 0) + (/fast|turbo|lite/.test(id) ? 20 : 0) - (/pro|quality/.test(id) ? 5 : 0);
  return (!local ? 50 : 0) + (/pro|quality/.test(id) ? 20 : 0) - (/fast|turbo|lite/.test(id) ? 5 : 0);
}

export function routeWorkbenchModels(models, preference = "fast") {
  if (!QUALITY_LABELS[preference]) throw new TypeError("workbench model preference must be fast or quality");
  const routes = {};
  for (const kind of ["image", "video", "audio"]) {
    const candidates = models.filter(model => model.kind === kind);
    routes[kind] = candidates.map((model, index) => ({ model, index, score: score(model, preference) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.model || null;
  }
  return Object.freeze({ preference, label: QUALITY_LABELS[preference], routes: Object.freeze(routes) });
}

export function workbenchRouteSummary(route) {
  const available = Object.values(route.routes).filter(Boolean).length;
  return available === 3
    ? `${route.label}模式已就绪，生成时将自动选择合适模型。`
    : `${route.label}模式已选择；当前 ${available}/3 类生成能力可用，缺失能力不会发起调用。`;
}
