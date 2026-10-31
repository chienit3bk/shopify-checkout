/**
 * Cart rules a merchant can't express in Shopify settings: max quantity per product,
 * minimum order value per market, and products that can't be bought together.
 * Pure, used by the cart-rules Validation Function and unit tests.
 */

export type CartRule =
  | {type: 'max_quantity'; productIds: string[]; max: number; label: string}
  | {type: 'min_subtotal'; amount: number; amounts?: Record<string, number>; currencyCode: string}
  | {type: 'incompatible'; productIds: string[]; label: string};

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
  subtotal: number;
  isGift: boolean;
}

export interface RuleCart {
  currencyCode: string;
  /** Cart currency per config currency; unknown → only explicit market amounts apply. */
  rate?: number;
  lines: RuleLine[];
}

export type Violation =
  | {type: 'max_quantity'; title: string; max: number; quantity: number}
  | {type: 'min_subtotal'; minimum: number; subtotal: number; currencyCode: string}
  | {type: 'incompatible'; titles: string[]; label: string};

/** Every rule the cart breaks, in config order. Gift lines never count. */
export function violations(config: CartRulesConfig, cart: RuleCart): Violation[] {
  const paid = cart.lines.filter((line) => !line.isGift);
  const out: Violation[] = [];

  for (const rule of config.rules) {
    if (rule.type === 'max_quantity') {
      const perProduct = new Map<string, {title: string; quantity: number}>();
      for (const line of paid.filter((l) => rule.productIds.includes(l.productId))) {
        const entry = perProduct.get(line.productId) ?? {title: line.title, quantity: 0};
        entry.quantity += line.quantity;
        perProduct.set(line.productId, entry);
      }
      for (const {title, quantity} of perProduct.values()) {
        if (quantity > rule.max) out.push({type: 'max_quantity', title, max: rule.max, quantity});
      }
    } else if (rule.type === 'min_subtotal') {
      const minimum =
        rule.amounts?.[cart.currencyCode] ??
        (cart.currencyCode === rule.currencyCode ? rule.amount : cart.rate !== undefined ? round2(rule.amount * cart.rate) : null);
      if (minimum === null) continue;
      const excluded = new Set(config.excludedProductIds);
      const subtotal = round2(paid.filter((l) => !excluded.has(l.productId)).reduce((sum, l) => sum + l.subtotal, 0));
      if (paid.length > 0 && subtotal < minimum) {
        out.push({type: 'min_subtotal', minimum, subtotal, currencyCode: cart.currencyCode});
      }
    } else {
      const present = new Map<string, string>();
      for (const line of paid) if (rule.productIds.includes(line.productId)) present.set(line.productId, line.title);
      if (present.size > 1) out.push({type: 'incompatible', titles: [...present.values()], label: rule.label});
    }
  }
  return out;
}

export function parseCartRules(raw: unknown): CartRulesConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const c = data as Record<string, any>;
  if (c.version !== 1 || !Array.isArray(c.rules)) return null;
  const ids = (list: unknown) => Array.isArray(list) && list.length > 0 && list.every((id) => typeof id === 'string');
  const rules = c.rules.filter((r: any): r is CartRule => {
    if (!r) return false;
    if (r.type === 'max_quantity') return ids(r.productIds) && Number.isInteger(r.max) && r.max > 0 && typeof r.label === 'string';
    if (r.type === 'min_subtotal') return typeof r.amount === 'number' && r.amount > 0 && typeof r.currencyCode === 'string';
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
