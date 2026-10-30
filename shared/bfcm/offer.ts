/**
 * BFCM checkout offer: a time-boxed, one-click upsell with a discount.
 *
 * Same split as the free gift: the checkout extension shows the countdown and adds
 * the offer line (tagged with an attribute); the discount Function re-checks the
 * campaign window, the variant and the quantity before discounting it.
 */

/** Cart line attribute marking a line as an accepted offer. Value = offer id. */
export const OFFER_ATTRIBUTE_KEY = '_bfcm_offer';

export interface Offer {
  id: string;
  /** Discount message shown on the line, e.g. "Black Friday add-on −25%". */
  title: string;
  variantId: string;
  /** 1–100. */
  percentOff: number;
  /** Discounted units per order. Defaults to 1. */
  maxQuantity?: number;
}

export interface OfferConfig {
  version: 1;
  /** Campaign name shown above the countdown. */
  campaign: string;
  /** First and last day of the sale in the shop's timezone, YYYY-MM-DD (the Function's clock). */
  startDate: string;
  endDate: string;
  /** Exact end with offset, for the buyer-facing countdown, e.g. 2026-12-01T23:59:59-05:00. */
  endsAt: string;
  offers: Offer[];
}

export interface OfferLine {
  id: string;
  variantId: string;
  quantity: number;
  /** Offer id from the attribute, or null for a normal line. */
  offerId: string | null;
}

/** Whether the campaign runs on this shop-local date (YYYY-MM-DD compares as text). */
export function isLive(config: OfferConfig, today: string): boolean {
  return today >= config.startDate && today <= config.endDate;
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once the end time has passed. */
  ended: boolean;
}

export function countdown(config: OfferConfig, nowMs: number): Countdown {
  const left = Math.max(0, Date.parse(config.endsAt) - nowMs);
  const total = Math.floor(left / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    ended: left === 0,
  };
}

/** Offers the buyer can still add: not already in the cart. */
export function availableOffers(config: OfferConfig, lines: OfferLine[]): Offer[] {
  const taken = new Set(lines.map((line) => line.offerId).filter(Boolean));
  return config.offers.filter((offer) => !taken.has(offer.id));
}

/**
 * What the Function discounts: only during the campaign, only lines tagged with a
 * known offer on that offer's variant, capped at `maxQuantity` units per offer.
 */
export function offerAllocations(
  config: OfferConfig,
  today: string,
  lines: OfferLine[],
): {lineId: string; quantity: number; offer: Offer}[] {
  if (!isLive(config, today)) return [];
  const offers = new Map(config.offers.map((offer) => [offer.id, offer]));
  const used = new Map<string, number>();
  const allocations: {lineId: string; quantity: number; offer: Offer}[] = [];

  for (const line of lines) {
    const offer = line.offerId ? offers.get(line.offerId) : undefined;
    if (!offer || offer.variantId !== line.variantId) continue;
    const left = (offer.maxQuantity ?? 1) - (used.get(offer.id) ?? 0);
    const quantity = Math.min(left, line.quantity);
    if (quantity <= 0) continue;
    used.set(offer.id, (used.get(offer.id) ?? 0) + quantity);
    allocations.push({lineId: line.id, quantity, offer});
  }
  return allocations;
}

/** Parses and sanity-checks a config; null instead of throwing so checkout never breaks. */
export function parseOfferConfig(raw: unknown): OfferConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!isObject(data) || data.version !== 1) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof data.startDate !== 'string' || !date.test(data.startDate)) return null;
  if (typeof data.endDate !== 'string' || !date.test(data.endDate)) return null;
  if (typeof data.endsAt !== 'string' || Number.isNaN(Date.parse(data.endsAt))) return null;
  if (!Array.isArray(data.offers)) return null;

  const offers = data.offers.filter(
    (offer): offer is Offer =>
      isObject(offer) &&
      typeof offer.id === 'string' &&
      typeof offer.title === 'string' &&
      typeof offer.variantId === 'string' &&
      typeof offer.percentOff === 'number' &&
      offer.percentOff > 0 &&
      offer.percentOff <= 100,
  );
  return {
    version: 1,
    campaign: typeof data.campaign === 'string' ? data.campaign : 'Black Friday',
    startDate: data.startDate,
    endDate: data.endDate,
    endsAt: data.endsAt,
    offers,
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
