/**
 * "How did you hear about us?" asked in checkout and stored on the order.
 *
 * The answer goes to a cart metafield; an order metafield definition with the
 * `cart_to_order_copyable` capability (shopify.app.toml) copies it onto the order,
 * so merchants see it in the admin and can filter/export it — no backend needed.
 * (The thank-you page can't write to the order, which is why the question lives in checkout.)
 */

/** App-owned namespace; key matches the order metafield definition in shopify.app.toml. */
export const ATTRIBUTION_NAMESPACE = '$app';
export const ATTRIBUTION_KEY = 'attribution';
export const MAX_DETAIL_LENGTH = 80;

export const SOURCES = ['instagram', 'tiktok', 'google', 'friend', 'podcast', 'other'] as const;
export type Source = (typeof SOURCES)[number];

export function isSource(value: unknown): value is Source {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value);
}

/**
 * The stored value: the source id, plus the buyer's words for "other"
 * ("other: a magazine"). Trimmed, single line, capped so the metafield stays tidy.
 */
export function toStoredValue(source: Source, detail = ''): string {
  if (source !== 'other') return source;
  const clean = detail.replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL_LENGTH);
  return clean ? `other: ${clean}` : 'other';
}

/** Reads a stored value back into the form state (e.g. after a page reload). */
export function fromStoredValue(value: string | undefined | null): {source: Source | null; detail: string} {
  if (!value) return {source: null, detail: ''};
  if (value.startsWith('other')) return {source: 'other', detail: value.replace(/^other:?\s*/, '')};
  return {source: isSource(value) ? value : null, detail: ''};
}
