const TIERS = Object.freeze(["free", "starter", "premium", "luxury", "supreme"]);
const KINDS = new Set(["general", "model_specific"]);
const PERIODS = new Set(["week", "month"]);
const ownRecord = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain record`);
  return value;
};
const exactKeys = (value, keys, label) => {
  const actual = Reflect.ownKeys(value);
  if (actual.some(key => typeof key !== "string") || actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new TypeError(`${label} fields are invalid`);
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${label}.${key} must be an enumerable data property`);
  }
};
const string = (value, label, max = 128) => {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > max) throw new TypeError(`${label} is invalid`);
  return value.trim();
};
const integer = (value, label, min, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${label} is invalid`);
  return value;
};

export function normalizeCreditProduct(input) {
  ownRecord(input, "credit product");
  exactKeys(input, ["id", "kind", "model", "minimumTier", "basePoints", "bonusBasisPoints", "priceMicros", "currency", "unitScale", "validForDays", "purchaseLimit"], "credit product");
  const id = string(input.id, "credit product id", 64);
  if (!KINDS.has(input.kind)) throw new TypeError("credit product kind is invalid");
  const model = input.kind === "model_specific" ? string(input.model, "credit product model", 128) : null;
  if (input.kind === "general" && input.model !== null) throw new TypeError("general credit products cannot bind a model");
  if (!TIERS.includes(input.minimumTier)) throw new TypeError("credit product minimumTier is invalid");
  if (input.currency !== "CNY" || input.unitScale !== 1_000_000) throw new TypeError("credit product money metadata is invalid");
  let purchaseLimit = null;
  if (input.purchaseLimit !== null) {
    ownRecord(input.purchaseLimit, "credit product purchaseLimit");
    exactKeys(input.purchaseLimit, ["count", "period"], "credit product purchaseLimit");
    if (!PERIODS.has(input.purchaseLimit.period)) throw new TypeError("credit product purchaseLimit period is invalid");
    purchaseLimit = Object.freeze({ count: integer(input.purchaseLimit.count, "credit product purchaseLimit count", 1, 1000), period: input.purchaseLimit.period });
  }
  return Object.freeze({
    id,
    kind: input.kind,
    model,
    minimumTier: input.minimumTier,
    basePoints: integer(input.basePoints, "credit product basePoints", 1),
    bonusBasisPoints: integer(input.bonusBasisPoints, "credit product bonusBasisPoints", 0, 100_000),
    priceMicros: integer(input.priceMicros, "credit product priceMicros", 1),
    currency: input.currency,
    unitScale: input.unitScale,
    validForDays: integer(input.validForDays, "credit product validForDays", 1, 3650),
    purchaseLimit
  });
}

export function quoteCreditProduct(input, { membershipTier, priorPurchasesInPeriod = 0 } = {}) {
  const product = normalizeCreditProduct(input);
  if (!TIERS.includes(membershipTier)) throw new TypeError("membershipTier is invalid");
  if (TIERS.indexOf(membershipTier) < TIERS.indexOf(product.minimumTier)) throw Object.assign(new Error("membership tier does not qualify for this credit product"), { code: "MEMBERSHIP_REQUIRED" });
  const prior = integer(priorPurchasesInPeriod, "priorPurchasesInPeriod", 0);
  if (product.purchaseLimit && prior >= product.purchaseLimit.count) throw Object.assign(new Error("credit product purchase limit reached"), { code: "PURCHASE_LIMIT_REACHED" });
  const bonusPoints = Math.floor(product.basePoints * product.bonusBasisPoints / 10_000);
  if (!Number.isSafeInteger(bonusPoints) || !Number.isSafeInteger(product.basePoints + bonusPoints)) throw new TypeError("credit product point total exceeds safe integer precision");
  return Object.freeze({
    schema: "openreel-credit-product-quote/v1",
    productId: product.id,
    kind: product.kind,
    model: product.model,
    basePoints: product.basePoints,
    bonusPoints,
    totalPoints: product.basePoints + bonusPoints,
    validForDays: product.validForDays,
    priceMicros: product.priceMicros,
    currency: product.currency,
    unitScale: product.unitScale,
    executable: false,
    paymentConnected: false,
    requiresHumanGate: true
  });
}
