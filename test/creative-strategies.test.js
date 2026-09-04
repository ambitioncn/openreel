import test from "node:test";
import assert from "node:assert/strict";
import { getCreativeStrategy, listCreativeStrategyTypes } from "../src/creative-strategies.js";

test("defines the five required creative strategy contracts", () => {
  assert.deepEqual(listCreativeStrategyTypes(), ["comedy", "talking_head", "advertisement", "narrative", "tutorial"]);
  for (const type of listCreativeStrategyTypes()) {
    const strategy = getCreativeStrategy(type);
    assert.equal(strategy.schema, "openreel-creative-strategy/v1");
    assert.equal(strategy.type, type);
    assert.ok(strategy.requiredBeats.length >= 3);
    assert.ok(strategy.qualityDimensions.length >= 4);
    assert.ok(Object.isFrozen(strategy));
    assert.ok(Object.isFrozen(strategy.requiredBeats));
  }
});

test("strategy selection fails closed for absent, aliased, and unknown types", () => {
  for (const value of [undefined, "", "ad", "Talking Head", "tutorial "]) {
    assert.throws(() => getCreativeStrategy(value), error => error.code === "CREATIVE_STRATEGY_UNSUPPORTED" && error.status === 422);
  }
});
