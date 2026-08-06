export const USD_SCALE = 10_000;
export const CNY_PER_USD = 7.20;
const MARKUP_NUMERATOR = 3;
const MARKUP_DENOMINATOR = 2;

function saleUnits(costCny) {
  const cnyCents = Math.round(costCny * 100);
  return Math.ceil(cnyCents * USD_SCALE * MARKUP_NUMERATOR / (720 * MARKUP_DENOMINATOR));
}

function perMillion(costCny) {
  return saleUnits(costCny);
}

function perUnit(costCny) {
  return saleUnits(costCny) * 1_000_000;
}

function ceiling(costCny) { return Math.ceil(Math.round(costCny * 100) * USD_SCALE / 720); }

// Source: https://www.volcengine.com/docs/82379/1544106?lang=zh
// Verified 2026-08-06. The highest official rate is used where one model has
// request-dependent tiers, so a provider call cannot be undercharged.
export const VOLCENGINE_PRICING = Object.freeze({
  version: "volcengine-2026-08-06-usd-7.20-markup-1.5",
  sourceUrl: "https://www.volcengine.com/docs/82379/1544106?lang=zh",
  markup: 1.5,
  currency: "USD",
  unitScale: USD_SCALE,
  cnyPerUsd: CNY_PER_USD,
  models: Object.freeze({
    "seedance-2-fast": Object.freeze({ maxCostMicros: ceiling(5), inputMicrosPerMillion: 0, outputMicrosPerMillion: perMillion(37), costBasis: "CNY 37/million tokens converted at 7.20 CNY/USD; request ceiling CNY 5" }),
    "seedance-2": Object.freeze({ maxCostMicros: ceiling(100), inputMicrosPerMillion: 0, outputMicrosPerMillion: perMillion(46), costBasis: "CNY 46/million tokens converted at 7.20 CNY/USD" }),
    "seedream-5-lite": Object.freeze({ maxCostMicros: ceiling(2), inputMicrosPerMillion: 0, outputMicrosPerMillion: perUnit(0.22), costBasis: "CNY 0.22/image converted at 7.20 CNY/USD" }),
    "seedream-5-pro": Object.freeze({ maxCostMicros: ceiling(2), inputMicrosPerMillion: 0, outputMicrosPerMillion: perUnit(0.30), costBasis: "CNY 0.30/image converted at 7.20 CNY/USD" }),
    "seed-2.1-turbo": Object.freeze({ maxCostMicros: ceiling(50), inputMicrosPerMillion: perMillion(3), outputMicrosPerMillion: perMillion(15), costBasis: "CNY 3/15 per million tokens converted at 7.20 CNY/USD" }),
    "seed-2.1-pro": Object.freeze({ maxCostMicros: ceiling(50), inputMicrosPerMillion: perMillion(6), outputMicrosPerMillion: perMillion(30), costBasis: "CNY 6/30 per million tokens converted at 7.20 CNY/USD" }),
    "embedding-vision": Object.freeze({ maxCostMicros: ceiling(2), inputMicrosPerMillion: perMillion(1.8), outputMicrosPerMillion: 0, costBasis: "CNY 1.8/million image tokens converted at 7.20 CNY/USD" })
  })
});

export function volcenginePrice(model) {
  return VOLCENGINE_PRICING.models[model] || null;
}
