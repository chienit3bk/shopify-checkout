/**
 * Buy X get Y on the same SKU: "buy 2 lip oils, the 3rd is free".
 *
 * The discount applies to part of a line's quantity (1 of 3 units), not the whole
 * line. Shared by the discount Function (which units are free) and the checkout
 * nudge ("Add 1 more — it's free"). Pure, so it is unit-tested.
 */

export interface BogoConfig {
  version: 1;
  /** Units the buyer pays for in each group, e.g. 2. */
  buy: number;
  /** Free units per group, e.g. 1. */
  get: number;
  /** Products the offer applies to (each SKU counts on its own). */
  productIds: string[];
  /** Discount message, e.g. "Buy 2, get 1 free". */
  label: string;
  /** Free units per line at most (0 = no cap). */
  maxFreePerLine?: number;
}

/** Free units in a line of `quantity`: one `get` per full `buy + get` group. */
export function freeUnits(config: BogoConfig, quantity: number): number {
  const group = config.buy + config.get;
  const free = Math.floor(Math.max(0, quantity) / group) * config.get;
  return config.maxFreePerLine ? Math.min(free, config.maxFreePerLine) : free;
}

/**
 * Units to add so the next free unit kicks in — only when the buyer already has a
 * full "buy" part of a group (2 in the cart → "add 1 more, it's free"). Null otherwise.
 */
export function unitsToNextFree(config: BogoConfig, quantity: number): number | null {
  const group = config.buy + config.get;
  const inGroup = quantity % group;
  if (inGroup < config.buy) return null;
  if (config.maxFreePerLine && freeUnits(config, quantity) >= config.maxFreePerLine) return null;
  return group - inGroup;
}

export function appliesTo(config: BogoConfig, productId: string, isGift: boolean): boolean {
  return !isGift && config.productIds.includes(productId);
}

export function parseBogoConfig(raw: unknown): BogoConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const c = data as Record<string, any>;
  const positiveInt = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
  if (c.version !== 1 || !positiveInt(c.buy) || !positiveInt(c.get) || typeof c.label !== 'string') return null;
  if (!Array.isArray(c.productIds) || !c.productIds.every((id: unknown) => typeof id === 'string')) return null;
  if (c.maxFreePerLine !== undefined && !(Number.isInteger(c.maxFreePerLine) && c.maxFreePerLine >= 0)) return null;
  return {version: 1, buy: c.buy, get: c.get, productIds: c.productIds, label: c.label, maxFreePerLine: c.maxFreePerLine};
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
