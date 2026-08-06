const CNY_MICROS = 1_000_000;
const MARKUP_NUMERATOR = 3;
const MARKUP_DENOMINATOR = 2;

function saleMicros(costCny) {
  return Math.ceil(costCny * CNY_MICROS * MARKUP_NUMERATOR / MARKUP_DENOMINATOR);
}

function perMillion(costCny) {
  return saleMicros(costCny);
}

function perUnit(costCny) {
  return saleMicros(costCny) * 1_000_000;
}

// Source: https://www.volcengine.com/docs/82379/1544106?lang=zh
// Verified 2026-08-06. The highest official rate is used where one model has
// request-dependent tiers, so a provider call cannot be undercharged.
export const VOLCENGINE_PRICING = Object.freeze({
  version: "volcengine-2026-08-01-markup-1.5",
  sourceUrl: "https://www.volcengine.com/docs/82379/1544106?lang=zh",
  markup: 1.5,
  models: Object.freeze({
    "seedance-2-fast": Object.freeze({ maxCostMicros: 5 * CNY_MICROS, inputMicrosPerMillion: 0, outputMicrosPerMillion: perMillion(37), costBasis: "CNY 37/million tokens without video input; production request ceiling CNY 5" }),
    "seedance-2": Object.freeze({ maxCostMicros: 100 * CNY_MICROS, inputMicrosPerMillion: 0, outputMicrosPerMillion: perMillion(46), costBasis: "CNY 46/million tokens without video input" }),
    "seedream-5-lite": Object.freeze({ maxCostMicros: 2 * CNY_MICROS, inputMicrosPerMillion: 0, outputMicrosPerMillion: perUnit(0.22), costBasis: "CNY 0.22/image" }),
    "seedream-5-pro": Object.freeze({ maxCostMicros: 2 * CNY_MICROS, inputMicrosPerMillion: 0, outputMicrosPerMillion: perUnit(0.30), costBasis: "CNY 0.30/image minimum" }),
    "seed-2.1-turbo": Object.freeze({ maxCostMicros: 50 * CNY_MICROS, inputMicrosPerMillion: perMillion(3), outputMicrosPerMillion: perMillion(15), costBasis: "CNY 3/15 per million input/output tokens" }),
    "seed-2.1-pro": Object.freeze({ maxCostMicros: 50 * CNY_MICROS, inputMicrosPerMillion: perMillion(6), outputMicrosPerMillion: perMillion(30), costBasis: "CNY 6/30 per million input/output tokens" }),
    "embedding-vision": Object.freeze({ maxCostMicros: 2 * CNY_MICROS, inputMicrosPerMillion: perMillion(1.8), outputMicrosPerMillion: 0, costBasis: "CNY 1.8/million image tokens (highest modality rate)" })
  })
});

export function volcenginePrice(model) {
  return VOLCENGINE_PRICING.models[model] || null;
}
