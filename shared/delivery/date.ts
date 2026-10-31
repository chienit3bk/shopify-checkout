/**
 * Delivery date picker + PO Box rule, shared by the checkout block and the
 * delivery-validation Function.
 *
 * Delivery days follow the warehouse calendar of the cut-off config (ship days,
 * holidays): the earliest date is the ship date plus `transitDays` delivery days.
 */
import {type CutoffConfig, cutoffStatus} from '../shipping/cutoff';

export interface DeliveryDateConfig {
  version: 1;
  /** Delivery days after the ship date (counted on ship days, skipping holidays). */
  transitDays: number;
  /** How far ahead a buyer may pick, in calendar days after the earliest date. */
  windowDays: number;
  /** Cart attribute that stores the chosen date (shown on the order). */
  attributeKey: string;
  /** Delivery options that can't deliver to a PO Box (title prefix match). */
  poBoxBlockedMethods: string[];
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isDeliveryDay(cutoff: CutoffConfig, date: string): boolean {
  return cutoff.shipDays.includes(isoWeekday(date)) && !cutoff.holidays.includes(date);
}

/** Earliest date from a known ship date: `transitDays` delivery days later. */
export function earliestFromShipDate(cutoff: CutoffConfig, config: DeliveryDateConfig, shipDate: string): string {
  let date = shipDate;
  for (let left = config.transitDays; left > 0; ) {
    date = addDays(date, 1);
    if (isDeliveryDay(cutoff, date)) left -= 1;
  }
  return date;
}

/** Earliest delivery date for an order placed at `nowMs` (warehouse clock, cut-off aware). */
export function earliestDeliveryDate(cutoff: CutoffConfig, config: DeliveryDateConfig, nowMs: number): string {
  return earliestFromShipDate(cutoff, config, cutoffStatus(cutoff, nowMs).shipDate);
}

export function latestDeliveryDate(config: DeliveryDateConfig, earliest: string): string {
  return addDays(earliest, config.windowDays);
}

export type DateProblem = 'invalid' | 'too_early' | 'too_late' | 'not_a_delivery_day';

/** Why a chosen date can't be honoured, or null when it can. */
export function dateProblem(cutoff: CutoffConfig, config: DeliveryDateConfig, date: string, earliest: string): DateProblem | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return 'invalid';
  if (date < earliest) return 'too_early';
  if (date > latestDeliveryDate(config, earliest)) return 'too_late';
  if (!isDeliveryDay(cutoff, date)) return 'not_a_delivery_day';
  return null;
}

/** `s-date-picker` constraints: outside the window, holidays, and non-delivery weekdays. */
export function pickerConstraints(cutoff: CutoffConfig, config: DeliveryDateConfig, earliest: string) {
  const latest = latestDeliveryDate(config, earliest);
  const disallow = [`--${addDays(earliest, -1)}`, `${addDays(latest, 1)}--`, ...cutoff.holidays].join(',');
  const disallowDays = WEEKDAYS.filter((_, i) => !cutoff.shipDays.includes(i + 1)).join(',');
  return {disallow, disallowDays, defaultView: earliest.slice(0, 7)};
}

const PO_BOX = /\b(p\.?\s*o\.?\s*box|post\s+office\s+box|pobox)\b/i;

export function isPoBox(...lines: Array<string | null | undefined>): boolean {
  return lines.some((line) => !!line && PO_BOX.test(line));
}

/** The selected option can't deliver to a PO Box (title starts with a blocked method). */
export function blocksPoBox(config: DeliveryDateConfig, optionTitle: string | null | undefined): boolean {
  if (!optionTitle) return false;
  const title = optionTitle.trim().toLowerCase();
  return config.poBoxBlockedMethods.some((method) => {
    const m = method.trim().toLowerCase();
    return title === m || (title.startsWith(m) && !/[a-z0-9]/.test(title.charAt(m.length)));
  });
}

export function parseDeliveryDateConfig(raw: unknown): DeliveryDateConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const c = data as Record<string, any>;
  if (c.version !== 1 || typeof c.attributeKey !== 'string' || !c.attributeKey) return null;
  if (!Number.isInteger(c.transitDays) || c.transitDays < 0 || !Number.isInteger(c.windowDays) || c.windowDays < 1) return null;
  if (!Array.isArray(c.poBoxBlockedMethods) || !c.poBoxBlockedMethods.every((m: unknown) => typeof m === 'string')) return null;
  return {
    version: 1,
    transitDays: c.transitDays,
    windowDays: c.windowDays,
    attributeKey: c.attributeKey,
    poBoxBlockedMethods: c.poBoxBlockedMethods,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
