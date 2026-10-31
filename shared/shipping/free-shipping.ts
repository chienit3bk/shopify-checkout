/**
 * Free shipping over a threshold — where only the right items count.
 *
 * Built-in rate conditions use the whole cart total. Merchants often need the
 * threshold to ignore some items (sale items, "always ships free" products, gift
 * lines) and to apply to one delivery method only (e.g. free Express over $120).
 * Pure, so the discount Function and the checkout bar share it and it is unit-tested.
 */

export interface FreeShippingConfig {
  version: 1;
  /** ISO currency of `amount`. */
  currencyCode: string;
  /** Threshold in the config currency. */
  amount: number;
  /** Per-market round amounts, e.g. {EUR: 110}. */
  amounts?: Record<string, number>;
  /** Delivery option titles that become free (case-insensitive), e.g. ["Express"]. */
  methods: string[];
  /** Products that don't count towards the threshold (sale items, gift cards…). */
  excludedProductIds: string[];
  /** Shown in checkout and as the discount message, e.g. "Free Express shipping". */
  label: string;
}

export interface ShippingCartLine {
  productId: string;
  /** Line subtotal in the cart currency. */
  subtotal: number;
  /** Gift lines never count (they're free anyway). */
  isGift: boolean;
}

export interface ShippingCart {
  currencyCode: string;
  /** Cart currency units per config-currency unit. Unknown = only explicit `amounts` apply. */
  rate?: number;
  lines: ShippingCartLine[];
}

export interface FreeShippingStatus {
  /** Threshold in the cart currency, or null when it can't be known. */
  threshold: number | null;
  /** Subtotal of the lines that count. */
  qualifying: number;
  /** Amount still missing (0 once unlocked). */
  remaining: number;
  unlocked: boolean;
  /** 0..1 for a progress bar. */
  ratio: number;
  /** Lines left out of the threshold, so the bar can say why. */
  excludedCount: number;
}

export function thresholdIn(config: FreeShippingConfig, cart: ShippingCart): number | null {
  const explicit = config.amounts?.[cart.currencyCode];
  if (explicit !== undefined) return explicit;
  if (cart.currencyCode === config.currencyCode) return config.amount;
  return cart.rate === undefined ? null : round2(config.amount * cart.rate);
}

export function freeShippingStatus(config: FreeShippingConfig, cart: ShippingCart): FreeShippingStatus {
  const excluded = new Set(config.excludedProductIds);
  const counting = cart.lines.filter((line) => !line.isGift && !excluded.has(line.productId));
  const qualifying = round2(counting.reduce((sum, line) => sum + line.subtotal, 0));
  const excludedCount = cart.lines.filter((line) => !line.isGift && excluded.has(line.productId)).length;
  const threshold = thresholdIn(config, cart);

  if (threshold === null) {
    return {threshold, qualifying, remaining: 0, unlocked: false, ratio: 0, excludedCount};
  }
  const unlocked = qualifying >= threshold;
  return {
    threshold,
    qualifying,
    remaining: unlocked ? 0 : round2(threshold - qualifying),
    unlocked,
    ratio: threshold > 0 ? Math.min(1, qualifying / threshold) : 1,
    excludedCount,
  };
}

/**
 * Delivery options the discount applies to, matched by title. A title that starts with the
 * method name also matches ("Express — UPS 2nd Day Air" for "Express"), because a delivery
 * customization may rename options before discounts see them.
 */
export function matchesMethod(config: FreeShippingConfig, title: string | null | undefined): boolean {
  if (!title) return false;
  const actual = title.trim().toLowerCase();
  return config.methods.some((method) => {
    const wanted = method.trim().toLowerCase();
    return actual === wanted || (actual.startsWith(wanted) && !/[a-z0-9]/.test(actual.charAt(wanted.length)));
  });
}

export function parseFreeShippingConfig(raw: unknown): FreeShippingConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const c = data as Record<string, any>;
  if (c.version !== 1 || typeof c.currencyCode !== 'string' || typeof c.label !== 'string') return null;
  if (typeof c.amount !== 'number' || !(c.amount >= 0)) return null;
  if (!Array.isArray(c.methods) || c.methods.length === 0 || !c.methods.every((m: unknown) => typeof m === 'string')) return null;
  if (!Array.isArray(c.excludedProductIds) || !c.excludedProductIds.every((id: unknown) => typeof id === 'string')) return null;
  const amounts =
    c.amounts && typeof c.amounts === 'object' && Object.values(c.amounts).every((a) => typeof a === 'number')
      ? (c.amounts as Record<string, number>)
      : undefined;
  return {
    version: 1,
    currencyCode: c.currencyCode,
    amount: c.amount,
    amounts,
    methods: c.methods,
    excludedProductIds: c.excludedProductIds,
    label: c.label,
  };
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
