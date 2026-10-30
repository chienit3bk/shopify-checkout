/**
 * Free-gift funnel: which gift nudges buyers see, which they unlock, which they
 * remove, and whether orders that kept a gift are bigger.
 *
 * The checkout extension publishes the events (`analytics.publish`), the app's web
 * pixel folds them into this state. Pure, so it is unit-tested without a browser.
 */

export const GIFT_EVENT_PREFIX = 'free_gift:';
export const GIFT_EVENTS = ['progress_viewed', 'unlocked', 'declined'] as const;
export type GiftEventName = (typeof GIFT_EVENTS)[number];

/** Payload of every `free_gift:*` event. */
export interface GiftEventData {
  ruleId: string;
  /** Amount still missing for the gift (progress_viewed only). */
  remaining?: number;
  currencyCode?: string;
}

export interface RuleStats {
  progressViews: number;
  unlocks: number;
  declines: number;
  /** Orders placed with this gift still in the cart. */
  orders: number;
}

export interface RevenueStats {
  ordersWithGift: number;
  revenueWithGift: number;
  ordersWithout: number;
  revenueWithout: number;
}

export interface FunnelState {
  version: 1;
  rules: Record<string, RuleStats>;
  /** Per currency, so EUR and USD totals are never added together. */
  revenue: Record<string, RevenueStats>;
}

export interface OrderLike {
  subtotal: number;
  currencyCode: string;
  lines: Array<{properties: Array<{key: string; value: string}>}>;
}

export function emptyFunnel(): FunnelState {
  return {version: 1, rules: {}, revenue: {}};
}

const emptyRule = (): RuleStats => ({progressViews: 0, unlocks: 0, declines: 0, orders: 0});
const emptyRevenue = (): RevenueStats => ({ordersWithGift: 0, revenueWithGift: 0, ordersWithout: 0, revenueWithout: 0});

const COUNTER: Record<GiftEventName, keyof RuleStats> = {
  progress_viewed: 'progressViews',
  unlocked: 'unlocks',
  declined: 'declines',
};

export function isGiftEventData(data: unknown): data is GiftEventData {
  return typeof data === 'object' && data !== null && typeof (data as GiftEventData).ruleId === 'string' && (data as GiftEventData).ruleId !== '';
}

export function recordGiftEvent(state: FunnelState, name: GiftEventName, data: GiftEventData): FunnelState {
  const rule = {...(state.rules[data.ruleId] ?? emptyRule())};
  rule[COUNTER[name]] += 1;
  return {...state, rules: {...state.rules, [data.ruleId]: rule}};
}

/** Gift lines carry the rule id in a line property (the same attribute the extension sets). */
export function recordOrder(state: FunnelState, order: OrderLike, giftKey: string): FunnelState {
  const giftRuleIds = new Set(
    order.lines.flatMap((line) => line.properties.filter((p) => p.key === giftKey && p.value).map((p) => p.value)),
  );
  const rules = {...state.rules};
  for (const ruleId of giftRuleIds) {
    rules[ruleId] = {...(rules[ruleId] ?? emptyRule()), orders: (rules[ruleId]?.orders ?? 0) + 1};
  }
  const revenue = {...(state.revenue[order.currencyCode] ?? emptyRevenue())};
  if (giftRuleIds.size > 0) {
    revenue.ordersWithGift += 1;
    revenue.revenueWithGift = round2(revenue.revenueWithGift + order.subtotal);
  } else {
    revenue.ordersWithout += 1;
    revenue.revenueWithout = round2(revenue.revenueWithout + order.subtotal);
  }
  return {...state, rules, revenue: {...state.revenue, [order.currencyCode]: revenue}};
}

export interface RuleSummary extends RuleStats {
  ruleId: string;
  /** Share of unlocked gifts the buyer kept (didn't remove). */
  keepRate: number | null;
}

export interface FunnelSummary {
  rules: RuleSummary[];
  aov: Record<string, {withGift: number | null; without: number | null}>;
}

export function summarize(state: FunnelState): FunnelSummary {
  const rules = Object.entries(state.rules)
    .map(([ruleId, stats]) => ({
      ruleId,
      ...stats,
      keepRate: stats.unlocks > 0 ? round2(Math.max(0, stats.unlocks - stats.declines) / stats.unlocks) : null,
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const aov = Object.fromEntries(
    Object.entries(state.revenue).map(([currency, r]) => [
      currency,
      {
        withGift: r.ordersWithGift ? round2(r.revenueWithGift / r.ordersWithGift) : null,
        without: r.ordersWithout ? round2(r.revenueWithout / r.ordersWithout) : null,
      },
    ]),
  );
  return {rules, aov};
}

/** Whatever is in storage → a valid state (garbage or an old shape starts fresh). */
export function parseFunnel(raw: unknown): FunnelState {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return emptyFunnel();
  const s = data as Partial<FunnelState>;
  if (s.version !== 1 || typeof s.rules !== 'object' || s.rules === null || typeof s.revenue !== 'object' || s.revenue === null) {
    return emptyFunnel();
  }
  const rules: Record<string, RuleStats> = {};
  for (const [id, r] of Object.entries(s.rules)) {
    rules[id] = {
      progressViews: count(r?.progressViews),
      unlocks: count(r?.unlocks),
      declines: count(r?.declines),
      orders: count(r?.orders),
    };
  }
  const revenue: Record<string, RevenueStats> = {};
  for (const [currency, r] of Object.entries(s.revenue)) {
    revenue[currency] = {
      ordersWithGift: count(r?.ordersWithGift),
      revenueWithGift: amount(r?.revenueWithGift),
      ordersWithout: count(r?.ordersWithout),
      revenueWithout: amount(r?.revenueWithout),
    };
  }
  return {version: 1, rules, revenue};
}

const count = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : 0);
const amount = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
