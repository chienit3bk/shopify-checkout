/**
 * Cart rules a merchant can't express in Shopify settings: max quantity per product,
 * minimum order value per market, and products that can't be bought together — plus the B2B
 * set: minimum quantity per product, case packs, and a higher minimum on the first order.
 * Pure, used by the cart-rules Validation Function and unit tests.
 */

/** Who a rule applies to. B2B = buying for a company location; omitted = everyone. */
export type BuyerScope = 'b2b' | 'retail';

export type CartRule = {buyer?: BuyerScope} & (
  | {type: 'max_quantity'; productIds: string[]; max: number; label: string}
  | {
      type: 'min_subtotal';
      amount: number;
      amounts?: Record<string, number>;
      currencyCode: string;
      /** Minimum for a buyer's first order (same currency rules), e.g. €500 first, €300 after. */
      firstOrderAmount?: number;
      firstOrderAmounts?: Record<string, number>;
    }
  | {type: 'incompatible'; productIds: string[]; label: string}
  /** No productIds = every product (except excluded ones). */
  | {type: 'min_quantity'; productIds?: string[]; min: number}
  | {type: 'case_pack'; productIds: string[]; size: number}
);

export interface CartRulesConfig {
  version: 1;
  rules: CartRule[];
  /** Never count towards the minimum (services, gift lines are excluded anyway). */
  excludedProductIds: string[];
}

export interface RuleLine {
  productId: string;
  title: string;
  quantity: number;
  /** Line amount after item discounts (a "buy 2 get 1" free unit is 0). */
  subtotal: number;
  isGift: boolean;
}

export interface RuleCart {
  currencyCode: string;
  /**
   * The "Subtotal" the buyer sees (after item discounts, before order discounts). When set, the
   * minimum is this minus gift and excluded lines; otherwise the sum of the counted lines.
   */
  subtotal?: number;
  /** Buying for a company location (B2B checkout). */
  isB2B?: boolean;
  /** No earlier orders (the company location's, or the customer's). Unknown → false. */
  isFirstOrder?: boolean;
  /** Cart currency per config currency; unknown → only explicit market amounts apply. */
  rate?: number;
  lines: RuleLine[];
}

export type Violation =
  | {type: 'max_quantity'; title: string; max: number; quantity: number}
  | {type: 'min_subtotal'; minimum: number; subtotal: number; currencyCode: string; firstOrder: boolean}
  | {type: 'incompatible'; titles: string[]; label: string}
  | {type: 'min_quantity'; title: string; min: number; quantity: number}
  | {type: 'case_pack'; title: string; size: number; quantity: number};

/** Every rule the cart breaks, in config order. Gift lines never count. */
export function violations(config: CartRulesConfig, cart: RuleCart): Violation[] {
  const paid = cart.lines.filter((line) => !line.isGift);
  const excluded = new Set(config.excludedProductIds);
  const out: Violation[] = [];

  for (const rule of config.rules) {
    if (rule.buyer && rule.buyer !== (cart.isB2B ? 'b2b' : 'retail')) continue;

    if (rule.type === 'max_quantity') {
      for (const {title, quantity} of perProduct(paid.filter((l) => rule.productIds.includes(l.productId)))) {
        if (quantity > rule.max) out.push({type: 'max_quantity', title, max: rule.max, quantity});
      }
    } else if (rule.type === 'min_quantity') {
      const covered = paid.filter((l) => (rule.productIds ? rule.productIds.includes(l.productId) : !excluded.has(l.productId)));
      for (const {title, quantity} of perProduct(covered)) {
        if (quantity < rule.min) out.push({type: 'min_quantity', title, min: rule.min, quantity});
      }
    } else if (rule.type === 'case_pack') {
      for (const {title, quantity} of perProduct(paid.filter((l) => rule.productIds.includes(l.productId)))) {
        if (quantity % rule.size !== 0) out.push({type: 'case_pack', title, size: rule.size, quantity});
      }
    } else if (rule.type === 'min_subtotal') {
      const firstOrder = Boolean(cart.isFirstOrder) && rule.firstOrderAmount !== undefined;
      const minimum = firstOrder
        ? amountIn(rule.firstOrderAmount!, rule.firstOrderAmounts, rule.currencyCode, cart)
        : amountIn(rule.amount, rule.amounts, rule.currencyCode, cart);
      if (minimum === null) continue;
      const notCounted = cart.lines.filter((l) => l.isGift || excluded.has(l.productId)).reduce((sum, l) => sum + l.subtotal, 0);
      const counted = paid.filter((l) => !excluded.has(l.productId)).reduce((sum, l) => sum + l.subtotal, 0);
      const subtotal = round2(cart.subtotal !== undefined ? cart.subtotal - notCounted : counted);
      if (paid.length > 0 && subtotal < minimum) {
        out.push({type: 'min_subtotal', minimum, subtotal, currencyCode: cart.currencyCode, firstOrder});
      }
    } else {
      const present = new Map<string, string>();
      for (const line of paid) if (rule.productIds.includes(line.productId)) present.set(line.productId, line.title);
      if (present.size > 1) out.push({type: 'incompatible', titles: [...present.values()], label: rule.label});
    }
  }
  return out;
}

/** Quantity per product, added up across split lines (a discount can split one product in two). */
function perProduct(lines: RuleLine[]): Array<{title: string; quantity: number}> {
  const totals = new Map<string, {title: string; quantity: number}>();
  for (const line of lines) {
    const entry = totals.get(line.productId) ?? {title: line.title, quantity: 0};
    entry.quantity += line.quantity;
    totals.set(line.productId, entry);
  }
  return [...totals.values()];
}

/** Round market amount if set, the config amount in its own currency, else converted; unknown → null. */
function amountIn(amount: number, amounts: Record<string, number> | undefined, currencyCode: string, cart: RuleCart): number | null {
  const explicit = amounts?.[cart.currencyCode];
  if (explicit !== undefined) return explicit;
  if (cart.currencyCode === currencyCode) return amount;
  return cart.rate !== undefined ? round2(amount * cart.rate) : null;
}

/** Smallest valid case-pack quantities around `quantity` (lower is 0 when below one case). */
export function casePackOptions(size: number, quantity: number): {lower: number; upper: number} {
  const lower = Math.floor(quantity / size) * size;
  return {lower, upper: lower + size};
}

export function parseCartRules(raw: unknown): CartRulesConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const c = data as Record<string, any>;
  if (c.version !== 1 || !Array.isArray(c.rules)) return null;
  const ids = (list: unknown) => Array.isArray(list) && list.length > 0 && list.every((id) => typeof id === 'string');
  const count = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
  const money = (n: unknown) => typeof n === 'number' && n > 0;
  const rules = c.rules.filter((r: any): r is CartRule => {
    if (!r) return false;
    if (r.buyer !== undefined && r.buyer !== 'b2b' && r.buyer !== 'retail') return false;
    if (r.type === 'min_quantity') return (r.productIds === undefined || ids(r.productIds)) && count(r.min);
    if (r.type === 'case_pack') return ids(r.productIds) && count(r.size) && r.size > 1;
    if (r.type === 'max_quantity') return ids(r.productIds) && Number.isInteger(r.max) && r.max > 0 && typeof r.label === 'string';
    if (r.type === 'min_subtotal') return money(r.amount) && typeof r.currencyCode === 'string' && (r.firstOrderAmount === undefined || money(r.firstOrderAmount));
    if (r.type === 'incompatible') return ids(r.productIds) && r.productIds.length > 1 && typeof r.label === 'string';
    return false;
  });
  const excludedProductIds = Array.isArray(c.excludedProductIds)
    ? c.excludedProductIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];
  return {version: 1, rules, excludedProductIds};
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
