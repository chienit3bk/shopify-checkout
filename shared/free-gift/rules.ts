/**
 * Free-gift rules engine.
 *
 * Pure and dependency-free so the same code runs in three places:
 *   - the checkout UI extension (decides which gift lines to add/remove),
 *   - the discount Function (re-checks eligibility server-side and makes the gift free),
 *   - unit tests.
 *
 * Cart amounts are in the buyer's (presentment) currency. A spend threshold
 * resolves per currency: an explicit market amount (`amounts.EUR = 70`) wins;
 * otherwise the shop-currency `amount` is converted with the cart's `rate`.
 * The Function always knows the rate (`presentmentCurrencyRate`); the UI
 * extension only knows it when the buyer pays in the config currency, so it
 * stays idle in currencies the config doesn't cover (see `supportsCurrency`).
 */

/** Cart line attribute that marks a line as a gift. Value = rule id. Hidden in checkout (leading underscore). */
export const GIFT_ATTRIBUTE_KEY = '_free_gift';

export type Condition =
  | {
      type: 'subtotal_at_least';
      /** In the config (shop) currency. */
      amount: number;
      /** Per-market overrides, e.g. {EUR: 70}: round local prices instead of converted ones. */
      amounts?: Record<string, number>;
    }
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
  /**
   * Gift picker: the buyer chooses one of these variants (2+ entries). Picker gifts are
   * never added automatically — the buyer's choice is the gift line in the cart.
   */
  giftOptions?: string[];
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
  /** Line subtotal in the cart currency. */
  subtotal: number;
  /** Rule id from the gift attribute, or null for a normal line. */
  giftRuleId: string | null;
}

export interface CartLike {
  lines: CartLineLike[];
  /** Cart (presentment) currency. Defaults to the config currency. */
  currencyCode?: string;
  /** Cart currency units per config-currency unit. Unknown = only explicit `amounts` apply. */
  rate?: number;
}

export type CartChange =
  | {type: 'add'; ruleId: string; variantId: string; quantity: number}
  | {type: 'remove'; lineId: string; quantity: number}
  | {type: 'update'; lineId: string; quantity: number};

export interface Progress {
  ruleId: string;
  title: string;
  /** Amount still needed to unlock the rule, in the cart currency. */
  remaining: number;
  /** 0..1, for a progress bar. */
  ratio: number;
}

/** Variants a rule may give: the picker options, or its single gift. */
export function giftVariants(rule: GiftRule): string[] {
  return rule.giftOptions && rule.giftOptions.length > 0 ? rule.giftOptions : [rule.giftVariantId];
}

/** A rule where the buyer picks the gift (so it is never auto-added). */
export function isPickerRule(rule: GiftRule): boolean {
  return (rule.giftOptions?.length ?? 0) > 1;
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
    case 'subtotal_at_least': {
      const threshold = thresholdFor(condition, cart);
      return threshold !== null && cartSubtotal(cart) >= threshold;
    }
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

/** A spend threshold in the cart currency, or null when it can't be known (no rate, no override). */
export function thresholdFor(
  condition: Extract<Condition, {type: 'subtotal_at_least'}>,
  cart: CartLike,
): number | null {
  const explicit = cart.currencyCode ? condition.amounts?.[cart.currencyCode] : undefined;
  if (explicit !== undefined) return explicit;
  const rate = cart.currencyCode === undefined ? 1 : cart.rate;
  return rate === undefined ? null : round2(condition.amount * rate);
}

/**
 * Whether every spend threshold can be resolved in this currency without an
 * exchange rate — i.e. the UI extension can act safely.
 */
export function supportsCurrency(config: GiftConfig, currencyCode: string): boolean {
  if (currencyCode === config.currencyCode) return true;
  const covered = (condition: Condition): boolean => {
    switch (condition.type) {
      case 'subtotal_at_least':
        return condition.amounts?.[currencyCode] !== undefined;
      case 'all':
      case 'any':
        return condition.conditions.every(covered);
      case 'not':
        return covered(condition.condition);
      default:
        return true;
    }
  };
  return config.rules.every((rule) => covered(rule.condition));
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

    // Unknown rule, no longer eligible, a duplicate line, or a variant the rule doesn't give.
    if (!rule || kept.has(rule.id) || !giftVariants(rule).includes(line.variantId)) {
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
    if (kept.has(rule.id) || declinedRuleIds.has(rule.id) || isPickerRule(rule)) continue;
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
    if (!rule || !giftVariants(rule).includes(line.variantId)) continue;

    const left = (rule.giftQuantity ?? 1) - (used.get(rule.id) ?? 0);
    const quantity = Math.min(left, line.quantity);
    if (quantity <= 0) continue;
    used.set(rule.id, (used.get(rule.id) ?? 0) + quantity);
    allocations.push({lineId: line.id, quantity, rule});
  }
  return allocations;
}

/**
 * The buyer picks `variantId` for a picker rule: swap whatever gift line the rule has
 * for the chosen one. No changes when the rule isn't eligible or the variant isn't offered.
 */
export function chooseGift(config: GiftConfig, cart: CartLike, ruleId: string, variantId: string): CartChange[] {
  const rule = eligibleRules(config, cart).find((candidate) => candidate.id === ruleId);
  if (!rule || !giftVariants(rule).includes(variantId)) return [];
  const current = cart.lines.filter((line) => line.giftRuleId === ruleId);
  if (current.length === 1 && current[0].variantId === variantId) return [];
  return [
    ...current.map((line): CartChange => ({type: 'remove', lineId: line.id, quantity: line.quantity})),
    {type: 'add', ruleId, variantId, quantity: rule.giftQuantity ?? 1},
  ];
}

export type InvalidGiftReason = 'not_eligible' | 'not_offered' | 'too_many';

/**
 * Gift lines that would not be free: the rule doesn't apply (or no longer exists), the
 * variant isn't one the rule gives, or there are more units than the rule allows.
 * Same allocation as the discount Function, so "invalid" means "would be charged".
 */
export function invalidGiftLines(
  config: GiftConfig,
  cart: CartLike,
): {lineId: string; ruleId: string; reason: InvalidGiftReason}[] {
  const eligible = new Map(eligibleRules(config, cart).map((rule) => [rule.id, rule]));
  const allocated = new Map(freeGiftAllocations(config, cart).map((a) => [a.lineId, a.quantity]));
  const invalid: {lineId: string; ruleId: string; reason: InvalidGiftReason}[] = [];

  for (const line of cart.lines) {
    if (line.giftRuleId === null) continue;
    if ((allocated.get(line.id) ?? 0) >= line.quantity) continue;
    const rule = eligible.get(line.giftRuleId);
    const reason: InvalidGiftReason = !rule
      ? 'not_eligible'
      : !giftVariants(rule).includes(line.variantId)
        ? 'not_offered'
        : 'too_many';
    invalid.push({lineId: line.id, ruleId: line.giftRuleId, reason});
  }
  return invalid;
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
      return thresholdFor(condition, cart);
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
      (rule.giftOptions === undefined ||
        (Array.isArray(rule.giftOptions) && rule.giftOptions.every((id: unknown) => typeof id === 'string'))) &&
      isCondition(rule.condition),
  );
  return {version: 1, currencyCode: data.currencyCode, rules};
}

function isCondition(value: unknown): value is Condition {
  if (!isObject(value)) return false;
  switch (value.type) {
    case 'subtotal_at_least':
      return (
        typeof value.amount === 'number' &&
        (value.amounts === undefined ||
          (isObject(value.amounts) && Object.values(value.amounts).every((amount) => typeof amount === 'number')))
      );
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
