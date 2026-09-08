import { DomainError } from "./core.js";

function configuredVideoModel(catalog, value, field) {
  const name = String(value || "").trim();
  if (!name) return null;
  const model = catalog.get(name);
  if (!model || model.capability !== "video") throw new DomainError("COMMERCIAL_MODEL_UNAVAILABLE", `${field} must name an available video model`, 503);
  return name;
}

export function commercialVideoModels(models, env = process.env) {
  const videos = models.filter(model => model?.capability === "video");
  const catalog = new Map(videos.map(model => [model.name, model]));
  const legacy = configuredVideoModel(catalog, env.OPENREEL_COMMERCIAL_VIDEO_MODEL, "OPENREEL_COMMERCIAL_VIDEO_MODEL");
  const fallback = videos[0]?.name || null;
  const fast = configuredVideoModel(catalog, env.OPENREEL_COMMERCIAL_FAST_VIDEO_MODEL, "OPENREEL_COMMERCIAL_FAST_VIDEO_MODEL") || legacy || catalog.has("seedance-2-fast") && "seedance-2-fast" || fallback;
  const quality = configuredVideoModel(catalog, env.OPENREEL_COMMERCIAL_QUALITY_VIDEO_MODEL, "OPENREEL_COMMERCIAL_QUALITY_VIDEO_MODEL") || legacy || catalog.has("seedance-2") && "seedance-2" || fast;
  return Object.freeze({ fast, quality });
}

export function commercialVideoModelForQuality(models, quality = "fast") {
  if (!models || !["fast", "quality"].includes(quality)) throw new DomainError("COMMERCIAL_MODEL_UNAVAILABLE", "commercial video quality must be fast or quality", 503);
  return models[quality];
}
