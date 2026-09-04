import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DomainError } from "./core.js";

export const FEEDBACK_CATEGORIES = Object.freeze(["generation", "editing", "export", "publishing", "reliability", "other"]);

export function createProductFeedbackStore({ file = null, now = () => new Date().toISOString(), id = randomUUID } = {}) {
  let state = { schema: "openreel-product-feedback/v1", feedback: [] };
  if (file && existsSync(file)) {
    state = JSON.parse(readFileSync(file, "utf8"));
    if (state.schema !== "openreel-product-feedback/v1" || !Array.isArray(state.feedback)) throw new Error("invalid product feedback store");
  }
  const persist = () => {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  };
  return {
    record(actorId, input = {}) {
      const category = String(input.category || "").trim(), rating = Number(input.rating), comment = String(input.comment || "").trim();
      if (!FEEDBACK_CATEGORIES.includes(category)) throw new DomainError("INVALID_FEEDBACK", "feedback category is invalid", 400, { allowed: FEEDBACK_CATEGORIES });
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new DomainError("INVALID_FEEDBACK", "feedback rating must be an integer from 1 to 5", 400);
      if (comment.length > 1000) throw new DomainError("INVALID_FEEDBACK", "feedback comment must be at most 1000 characters", 400);
      const item = { id: id(), actorId, category, rating, comment: comment || null, createdAt: now() };
      state.feedback.push(item); persist();
      return { id: item.id, category, rating, createdAt: item.createdAt };
    },
    summary() {
      const categories = Object.fromEntries(FEEDBACK_CATEGORIES.map(category => [category, { count: 0, ratingTotal: 0 }]));
      for (const item of state.feedback) { categories[item.category].count += 1; categories[item.category].ratingTotal += item.rating; }
      return { total: state.feedback.length, categories: Object.fromEntries(Object.entries(categories).map(([category, value]) => [category, { count: value.count, averageRating: value.count ? value.ratingTotal / value.count : null }])) };
    }
  };
}
