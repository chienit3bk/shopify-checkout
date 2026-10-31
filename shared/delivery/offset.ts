/**
 * Carbon-neutral delivery add-on: a one-click service line (its own product).
 * Pure helpers for the checkout block; unit-tested.
 */

export interface OffsetConfig {
  version: 1;
  /** The "Carbon-neutral delivery" variant (a service product, no shipping). */
  variantId: string;
  /** Line attribute that marks the add-on (hidden: leading underscore). */
  attributeKey: string;
}

export interface LineLike {
  id: string;
  quantity: number;
  merchandiseId: string;
  attributes: Array<{key: string; value: string}>;
}

export type OffsetChange =
  | {type: 'addCartLine'; merchandiseId: string; quantity: number; attributes: Array<{key: string; value: string}>}
  | {type: 'removeCartLine'; id: string; quantity: number};

/** The add-on line(s) already in the cart. */
export function offsetLines(config: OffsetConfig, lines: LineLike[]): LineLike[] {
  return lines.filter((line) => line.merchandiseId === config.variantId);
}

/**
 * Changes for the checkbox. Turning it on adds one unit (never a duplicate);
 * turning it off removes every add-on line, including any the buyer added twice.
 */
export function toggleOffset(config: OffsetConfig, lines: LineLike[], on: boolean): OffsetChange[] {
  const existing = offsetLines(config, lines);
  if (on) {
    return existing.length > 0
      ? []
      : [{type: 'addCartLine', merchandiseId: config.variantId, quantity: 1, attributes: [{key: config.attributeKey, value: 'true'}]}];
  }
  return existing.map((line) => ({type: 'removeCartLine', id: line.id, quantity: line.quantity}));
}

/** Only offer the add-on next to physical goods (a cart of just the add-on makes no sense). */
export function shouldOfferOffset(config: OffsetConfig, lines: LineLike[]): boolean {
  return lines.some((line) => line.merchandiseId !== config.variantId);
}

export function parseOffsetConfig(raw: unknown): OffsetConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const c = data as Record<string, any>;
  if (c.version !== 1 || typeof c.variantId !== 'string' || typeof c.attributeKey !== 'string') return null;
  return {version: 1, variantId: c.variantId, attributeKey: c.attributeKey};
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
