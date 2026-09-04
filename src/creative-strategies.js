import { DomainError } from "./core.js";

const STRATEGIES = Object.freeze({
  comedy: Object.freeze({ requiredBeats: Object.freeze(["setup", "escalation", "payoff"]), qualityDimensions: Object.freeze(["hook", "timing", "clarity", "payoff"]), minimumScore: 0.8 }),
  talking_head: Object.freeze({ requiredBeats: Object.freeze(["promise", "proof", "call_to_action"]), qualityDimensions: Object.freeze(["hook", "messageClarity", "credibility", "delivery"]), minimumScore: 0.8 }),
  advertisement: Object.freeze({ requiredBeats: Object.freeze(["problem", "product_truth", "benefit", "call_to_action"]), qualityDimensions: Object.freeze(["hook", "productClarity", "brandFit", "conversionIntent"]), minimumScore: 0.8 }),
  narrative: Object.freeze({ requiredBeats: Object.freeze(["inciting_event", "turn", "resolution"]), qualityDimensions: Object.freeze(["hook", "causality", "characterIntent", "emotionalPayoff"]), minimumScore: 0.8 }),
  tutorial: Object.freeze({ requiredBeats: Object.freeze(["outcome", "steps", "verification"]), qualityDimensions: Object.freeze(["hook", "instructionClarity", "demonstration", "resultProof"]), minimumScore: 0.8 })
});

export function getCreativeStrategy(type) {
  if (typeof type !== "string" || !Object.hasOwn(STRATEGIES, type)) {
    throw new DomainError("CREATIVE_STRATEGY_UNSUPPORTED", "type must be one of comedy, talking_head, advertisement, narrative, tutorial", 422);
  }
  return Object.freeze({ schema: "openreel-creative-strategy/v1", type, ...STRATEGIES[type] });
}

export function listCreativeStrategyTypes() {
  return Object.freeze(Object.keys(STRATEGIES));
}
