/**
 * Free-gift rules engine.
 *
 * Pure and dependency-free so the same code runs in three places:
 *   - the checkout UI extension (decides which gift lines to add/remove),
 *   - the discount Function (re-checks eligibility server-side and makes the gift free),
 *   - unit tests.
 *
 * Amounts in a config are in the shop's currency. Callers pass a cart whose
 * amounts are already in that currency (the Function converts with
 * `presentmentCurrencyRate`; the UI extension only acts when the checkout
 * currency matches the config currency).
 */

/** Cart line attribute that marks a line as a gift. Value = rule id. Hidden in checkout (leading underscore). */
export const GIFT_ATTRIBUTE_KEY = '_free_gift';

export type Condition =
  | {type: 'subtotal_at_least'; amount: number}
  | {type: 'total_quantity_at_least'; quantity: number}
  | {type: 'product_in_cart'; productIds: string[]; minQuantity?: number}
  | {type: 'all'; conditions: Condition[]}
  | {type: 'any'; conditions: Condition[]}
  | {type: 'not'; condition: Condition};

export interface GiftRule {
  id: string;
  /** Shown to the buyer, e.g. "Free tote bag". */
  title: string;
  giftVariantId: string;
  /** Units given for free. Defaults to 1. */
  giftQuantity?: number;
  condition: Condition;
  /**
   * Rules sharing a group are tiers: only the eligible rule with the highest
   * priority in the group is applied (e.g. $50 → mug, $100 → tote: at $120 the
   * buyer gets the tote only). Rules without a group are independent.
   */
  group?: string;
  /** Higher wins inside a group. Defaults to 0. */
  priority?: number;
}

export interface GiftConfig {
  version: 1;
  /** ISO currency of every amount in the config, e.g. "USD". */
  currencyCode: string;
  rules: GiftRule[];
}

export interface CartLineLike {
  id: string;
  productId: string;
  variantId: string;
  quantity: number;
  /** Line subtotal in the config currency. */
  subtotal: number;
  /** Rule id from the gift attribute, or null for a normal line. */
  giftRuleId: string | null;
}

export interface CartLike {
  lines: CartLineLike[];
}

export type CartChange =
  | {type: 'add'; ruleId: string; variantId: string; quantity: number}
  | {type: 'remove'; lineId: string; quantity: number}
  | {type: 'update'; lineId: string; quantity: number};

export interface Progress {
  ruleId: string;
  title: string;
  /** Amount still needed to unlock the rule, in the config currency. */
  remaining: number;
  /** 0..1, for a progress bar. */
  ratio: number;
}

/** Lines the buyer pays for. Gift lines never count towards a threshold. */
function paidLines(cart: CartLike): CartLineLike[] {
  return cart.lines.filter((line) => line.giftRuleId === null);
}

export function cartSubtotal(cart: CartLike): number {
  return round2(paidLines(cart).reduce((sum, line) => sum + line.subtotal, 0));
}

export function matches(condition: Condition, cart: CartLike): boolean {
  const lines = paidLines(cart);
  switch (condition.type) {
    case 'subtotal_at_least':
      return cartSubtotal(cart) >= condition.amount;
    case 'total_quantity_at_least':
      return lines.reduce((sum, line) => sum + line.quantity, 0) >= condition.quantity;
    case 'product_in_cart': {
      const wanted = new Set(condition.productIds);
      const quantity = lines
        .filter((line) => wanted.has(line.productId))
        .reduce((sum, line) => sum + line.quantity, 0);
      return quantity >= (condition.minQuantity ?? 1);
    }
    case 'all':
      return condition.conditions.every((child) => matches(child, cart));
    case 'any':
      return condition.conditions.some((child) => matches(child, cart));
    case 'not':
      return !matches(condition.condition, cart);
  }
}

/** Rules the cart qualifies for, after resolving tier groups. */
export function eligibleRules(config: GiftConfig, cart: CartLike): GiftRule[] {
  const qualifying = config.rules.filter((rule) => matches(rule.condition, cart));
  const bestPerGroup = new Map<string, GiftRule>();
  const ungrouped: GiftRule[] = [];

  for (const rule of qualifying) {
    if (!rule.group) {
      ungrouped.push(rule);
      continue;
    }
    const current = bestPerGroup.get(rule.group);
    if (!current || (rule.priority ?? 0) > (current.priority ?? 0)) {
      bestPerGroup.set(rule.group, rule);
    }
  }
  return [...ungrouped, ...bestPerGroup.values()];
}

/**
 * The changes that bring the cart's gift lines in line with the rules:
 * add missing gifts, drop gifts that no longer qualify, trim extra units.
 * Rules in `declinedRuleIds` (the buyer removed that gift) are never re-added.
 */
export function planGiftChanges(
  config: GiftConfig,
  cart: CartLike,
  declinedRuleIds: ReadonlySet<string> = new Set(),
): CartChange[] {
  const eligible = new Map(eligibleRules(config, cart).map((rule) => [rule.id, rule]));
  const changes: CartChange[] = [];
  const kept = new Set<string>();

  for (const line of cart.lines) {
    if (line.giftRuleId === null) continue;
    const rule = eligible.get(line.giftRuleId);

    // Unknown rule, no longer eligible, a duplicate line, or the config now points at another variant.
    if (!rule || kept.has(rule.id) || rule.giftVariantId !== line.variantId) {
      changes.push({type: 'remove', lineId: line.id, quantity: line.quantity});
      continue;
    }
    kept.add(rule.id);
    const allowed = rule.giftQuantity ?? 1;
    if (line.quantity !== allowed) {
      changes.push({type: 'update', lineId: line.id, quantity: allowed});
    }
  }

  for (const rule of eligible.values()) {
    if (kept.has(rule.id) || declinedRuleIds.has(rule.id)) continue;
    changes.push({
      type: 'add',
      ruleId: rule.id,
      variantId: rule.giftVariantId,
      quantity: rule.giftQuantity ?? 1,
    });
  }
  return changes;
}

/**
 * Units of each gift line the Function may make free: only eligible rules,
 * only the configured variant, capped at `giftQuantity` per rule across lines.
 */
export function freeGiftAllocations(
  config: GiftConfig,
  cart: CartLike,
): {lineId: string; quantity: number; rule: GiftRule}[] {
  const eligible = new Map(eligibleRules(config, cart).map((rule) => [rule.id, rule]));
  const used = new Map<string, number>();
  const allocations: {lineId: string; quantity: number; rule: GiftRule}[] = [];

  for (const line of cart.lines) {
    if (line.giftRuleId === null) continue;
    const rule = eligible.get(line.giftRuleId);
    if (!rule || rule.giftVariantId !== line.variantId) continue;

    const left = (rule.giftQuantity ?? 1) - (used.get(rule.id) ?? 0);
    const quantity = Math.min(left, line.quantity);
    if (quantity <= 0) continue;
    used.set(rule.id, (used.get(rule.id) ?? 0) + quantity);
    allocations.push({lineId: line.id, quantity, rule});
  }
  return allocations;
}

/**
 * The closest gift the buyer has not unlocked yet, for a "spend $X more" message.
 * Only rules that spending more can unlock show progress.
 */
export function nextUnlock(config: GiftConfig, cart: CartLike): Progress | null {
  const eligibleIds = new Set(eligibleRules(config, cart).map((rule) => rule.id));
  const subtotal = cartSubtotal(cart);
  let best: Progress | null = null;

  for (const rule of config.rules) {
    if (eligibleIds.has(rule.id)) continue;
    const threshold = subtotalThreshold(rule.condition, cart);
    if (threshold === null || threshold <= subtotal) continue;

    const remaining = round2(threshold - subtotal);
    if (!best || remaining < best.remaining) {
      best = {ruleId: rule.id, title: rule.title, remaining, ratio: subtotal / threshold};
    }
  }
  return best;
}

/**
 * The subtotal at which the condition becomes true if the buyer only spends
 * more (nothing else changes). `-Infinity` = no spend needed, `null` = spending
 * alone can't unlock it (e.g. a required product is missing).
 */
function subtotalThreshold(condition: Condition, cart: CartLike): number | null {
  switch (condition.type) {
    case 'subtotal_at_least':
      return condition.amount;
    case 'all': {
      const needs = condition.conditions.map((child) => subtotalThreshold(child, cart));
      return needs.some((need) => need === null) ? null : Math.max(-Infinity, ...(needs as number[]));
    }
    case 'any': {
      const needs = condition.conditions
        .map((child) => subtotalThreshold(child, cart))
        .filter((need): need is number => need !== null);
      return needs.length ? Math.min(...needs) : null;
    }
    default:
      return matches(condition, cart) ? -Infinity : null;
  }
}

/** Parses and sanity-checks a config. Returns null instead of throwing so checkout never breaks. */
export function parseConfig(raw: unknown): GiftConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!isObject(data) || data.version !== 1 || typeof data.currencyCode !== 'string') return null;
  if (!Array.isArray(data.rules)) return null;

  const rules = data.rules.filter(
    (rule): rule is GiftRule =>
      isObject(rule) &&
      typeof rule.id === 'string' &&
      typeof rule.title === 'string' &&
      typeof rule.giftVariantId === 'string' &&
      isCondition(rule.condition),
  );
  return {version: 1, currencyCode: data.currencyCode, rules};
}

function isCondition(value: unknown): value is Condition {
  if (!isObject(value)) return false;
  switch (value.type) {
    case 'subtotal_at_least':
      return typeof value.amount === 'number';
    case 'total_quantity_at_least':
      return typeof value.quantity === 'number';
    case 'product_in_cart':
      return Array.isArray(value.productIds) && value.productIds.every((id) => typeof id === 'string');
    case 'all':
    case 'any':
      return Array.isArray(value.conditions) && value.conditions.every(isCondition);
    case 'not':
      return isCondition(value.condition);
    default:
      return false;
  }
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
