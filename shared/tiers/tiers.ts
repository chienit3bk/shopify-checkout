/**
 * Tiered discounts: volume tiers per SKU ("4+ → 10% off") and spend tiers on the
 * order ("$150+ → 10% off"). Pure, shared by the tiered-discount Function (prices)
 * and the checkout blocks (tier table, "spend $X more" bar). Unit-tested.
 */

export interface VolumeTier {
  minQuantity: number;
  percent: number;
}

export interface SpendTier {
  /** In the config currency. */
  amount: number;
  /** Per-market round amounts, e.g. {EUR: 140}. */
  amounts?: Record<string, number>;
  percent: number;
}

export interface TiersConfig {
  version: 1;
  currencyCode: string;
  volume: {productIds: string[]; tiers: VolumeTier[]; label: string} | null;
  spend: {tiers: SpendTier[]; label: string; excludedProductIds: string[]} | null;
}

export interface Progress<T> {
  current: T | null;
  next: T | null;
}

/** Highest volume tier reached by `quantity`, and the one after it. */
export function volumeProgress(tiers: VolumeTier[], quantity: number): Progress<VolumeTier> {
  const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
  const current = [...sorted].reverse().find((tier) => quantity >= tier.minQuantity) ?? null;
  const next = sorted.find((tier) => quantity < tier.minQuantity) ?? null;
  return {current, next};
}

/** A spend tier's threshold in the cart currency, or null when it can't be known. */
export function spendThreshold(tier: SpendTier, configCurrency: string, currencyCode: string, rate?: number): number | null {
  const explicit = tier.amounts?.[currencyCode];
  if (explicit !== undefined) return explicit;
  if (currencyCode === configCurrency) return tier.amount;
  return rate === undefined ? null : round2(tier.amount * rate);
}

export interface SpendStatus {
  current: (SpendTier & {threshold: number}) | null;
  next: (SpendTier & {threshold: number; remaining: number}) | null;
}

/** Spend tier reached by `subtotal` (cart currency) and how far the next one is. */
export function spendProgress(config: TiersConfig, subtotal: number, currencyCode: string, rate?: number): SpendStatus {
  if (!config.spend) return {current: null, next: null};
  const resolved = config.spend.tiers
    .map((tier) => ({...tier, threshold: spendThreshold(tier, config.currencyCode, currencyCode, rate)}))
    .filter((tier): tier is SpendTier & {threshold: number} => tier.threshold !== null)
    .sort((a, b) => a.threshold - b.threshold);
  const current = [...resolved].reverse().find((tier) => subtotal >= tier.threshold) ?? null;
  const upcoming = resolved.find((tier) => subtotal < tier.threshold);
  return {
    current,
    next: upcoming ? {...upcoming, remaining: round2(upcoming.threshold - subtotal)} : null,
  };
}

export function parseTiersConfig(raw: unknown): TiersConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const c = data as Record<string, any>;
  if (c.version !== 1 || typeof c.currencyCode !== 'string') return null;
  const percent = (p: unknown) => typeof p === 'number' && p > 0 && p <= 100;
  const ids = (list: unknown) => Array.isArray(list) && list.every((id) => typeof id === 'string');

  let volume: TiersConfig['volume'] = null;
  if (c.volume) {
    const v = c.volume;
    const ok =
      ids(v.productIds) &&
      typeof v.label === 'string' &&
      Array.isArray(v.tiers) &&
      v.tiers.length > 0 &&
      v.tiers.every((t: any) => Number.isInteger(t?.minQuantity) && t.minQuantity > 0 && percent(t.percent));
    if (!ok) return null;
    volume = {productIds: v.productIds, tiers: v.tiers, label: v.label};
  }

  let spend: TiersConfig['spend'] = null;
  if (c.spend) {
    const s = c.spend;
    const ok =
      typeof s.label === 'string' &&
      ids(s.excludedProductIds ?? []) &&
      Array.isArray(s.tiers) &&
      s.tiers.length > 0 &&
      s.tiers.every((t: any) => typeof t?.amount === 'number' && t.amount > 0 && percent(t.percent));
    if (!ok) return null;
    spend = {tiers: s.tiers, label: s.label, excludedProductIds: s.excludedProductIds ?? []};
  }
  return {version: 1, currencyCode: c.currencyCode, volume, spend};
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
