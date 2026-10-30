/**
 * Same-day shipping cut-off: "Order within 2h 41m — ships today".
 *
 * Everything is computed in the warehouse's timezone (not the buyer's), skipping
 * non-shipping weekdays and holidays, plus an optional "order by … for Christmas"
 * deadline. Pure, so it is unit-tested with fixed clocks.
 */

export interface CutoffConfig {
  version: 1;
  /** IANA timezone of the warehouse, e.g. America/New_York. */
  timezone: string;
  /** Local cut-off time, 0–23 / 0–59. */
  cutoffHour: number;
  cutoffMinute: number;
  /** ISO weekdays that ship: 1 = Monday … 7 = Sunday. */
  shipDays: number[];
  /** YYYY-MM-DD dates with no shipping. */
  holidays: string[];
  /** Optional seasonal deadline, e.g. last day to order for Christmas delivery. */
  deadline?: {label: string; lastOrderDate: string};
}

export interface CutoffStatus {
  /** True when an order placed now ships today. */
  shipsToday: boolean;
  /** Milliseconds until today's cut-off (0 when it doesn't ship today). */
  msLeft: number;
  /** Local date (YYYY-MM-DD) the order will ship. */
  shipDate: string;
  /** ISO weekday of shipDate (1–7). */
  shipWeekday: number;
  /** Seasonal deadline still ahead, if any. */
  deadline: {label: string; lastOrderDate: string} | null;
}

interface LocalParts {
  date: string; // YYYY-MM-DD
  weekday: number; // 1–7
  hour: number;
  minute: number;
}

/** Wall-clock parts of an instant in a timezone. */
export function localParts(nowMs: number, timezone: string): LocalParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(nowMs))
      .map((part) => [part.type, part.value]),
  );
  const weekdays: Record<string, number> = {Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7};
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays[parts.weekday],
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/**
 * The UTC instant of a wall-clock time in a timezone. Two passes so a DST change
 * between the guess and the answer is corrected.
 */
export function zonedTimeToUtc(date: string, hour: number, minute: number, timezone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const wanted = Date.UTC(y, m - 1, d, hour, minute);
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const local = localParts(guess, timezone);
    const [ly, lm, ld] = local.date.split('-').map(Number);
    const seen = Date.UTC(ly, lm - 1, ld, local.hour, local.minute);
    guess += wanted - seen;
  }
  return guess;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

function shipsOn(config: CutoffConfig, date: string): boolean {
  return config.shipDays.includes(weekdayOf(date)) && !config.holidays.includes(date);
}

export function cutoffStatus(config: CutoffConfig, nowMs: number): CutoffStatus {
  const now = localParts(nowMs, config.timezone);
  const beforeCutoff = now.hour * 60 + now.minute < config.cutoffHour * 60 + config.cutoffMinute;
  const shipsToday = beforeCutoff && shipsOn(config, now.date);

  let shipDate = now.date;
  if (!shipsToday) {
    shipDate = addDays(now.date, 1);
    for (let i = 0; i < 31 && !shipsOn(config, shipDate); i++) shipDate = addDays(shipDate, 1);
  }

  const msLeft = shipsToday
    ? zonedTimeToUtc(now.date, config.cutoffHour, config.cutoffMinute, config.timezone) - nowMs
    : 0;

  const deadline = config.deadline && now.date <= config.deadline.lastOrderDate ? config.deadline : null;

  return {shipsToday, msLeft: Math.max(0, msLeft), shipDate, shipWeekday: weekdayOf(shipDate), deadline};
}

/** "2h 41m" / "41m" for the countdown. */
export function formatLeft(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function parseCutoffConfig(raw: unknown): CutoffConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const c = data as Record<string, any>;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (c.version !== 1 || typeof c.timezone !== 'string') return null;
  if (!Number.isInteger(c.cutoffHour) || c.cutoffHour < 0 || c.cutoffHour > 23) return null;
  if (!Number.isInteger(c.cutoffMinute) || c.cutoffMinute < 0 || c.cutoffMinute > 59) return null;
  if (!Array.isArray(c.shipDays) || !c.shipDays.every((d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7)) return null;
  if (!Array.isArray(c.holidays) || !c.holidays.every((d: unknown) => typeof d === 'string' && date.test(d))) return null;
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: c.timezone});
  } catch {
    return null;
  }
  const deadline =
    c.deadline && typeof c.deadline.label === 'string' && date.test(c.deadline.lastOrderDate)
      ? {label: c.deadline.label, lastOrderDate: c.deadline.lastOrderDate}
      : undefined;
  return {
    version: 1,
    timezone: c.timezone,
    cutoffHour: c.cutoffHour,
    cutoffMinute: c.cutoffMinute,
    shipDays: c.shipDays,
    holidays: c.holidays,
    deadline,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
