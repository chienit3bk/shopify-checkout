import {describe, expect, test} from 'vitest';
import {
  type CartLike,
  type CartLineLike,
  type GiftConfig,
  eligibleRules,
  freeGiftAllocations,
  matches,
  nextUnlock,
  parseConfig,
  planGiftChanges,
} from './rules';

const SHIRT = 'gid://shopify/Product/1';
const SHOES = 'gid://shopify/Product/2';
const SOCKS = 'gid://shopify/Product/3';
const MUG_VARIANT = 'gid://shopify/ProductVariant/901';
const TOTE_VARIANT = 'gid://shopify/ProductVariant/902';
const CAP_VARIANT = 'gid://shopify/ProductVariant/903';

let lineSeq = 0;
function line(productId: string, quantity: number, subtotal: number, extra: Partial<CartLineLike> = {}): CartLineLike {
  lineSeq += 1;
  return {
    id: `gid://shopify/CartLine/${lineSeq}`,
    productId,
    variantId: `${productId.replace('Product', 'ProductVariant')}01`,
    quantity,
    subtotal,
    giftRuleId: null,
    ...extra,
  };
}

function gift(ruleId: string, variantId: string, quantity = 1): CartLineLike {
  return line('gid://shopify/Product/900', quantity, 0, {giftRuleId: ruleId, variantId});
}

const config: GiftConfig = {
  version: 1,
  currencyCode: 'USD',
  rules: [
    // Common case: tiered spend thresholds, only the best tier applies.
    {id: 'tier-50', title: 'Free mug', giftVariantId: MUG_VARIANT, group: 'spend', priority: 1, condition: {type: 'subtotal_at_least', amount: 50}},
    {id: 'tier-100', title: 'Free tote bag', giftVariantId: TOTE_VARIANT, group: 'spend', priority: 2, condition: {type: 'subtotal_at_least', amount: 100}},
    // Complex case: (2+ shoes AND not a socks order) OR ($150+ AND a shirt in the cart).
    {
      id: 'combo-cap',
      title: 'Free cap',
      giftVariantId: CAP_VARIANT,
      giftQuantity: 1,
      condition: {
        type: 'any',
        conditions: [
          {
            type: 'all',
            conditions: [
              {type: 'product_in_cart', productIds: [SHOES], minQuantity: 2},
              {type: 'not', condition: {type: 'product_in_cart', productIds: [SOCKS]}},
            ],
          },
          {
            type: 'all',
            conditions: [
              {type: 'subtotal_at_least', amount: 150},
              {type: 'product_in_cart', productIds: [SHIRT]},
            ],
          },
        ],
      },
    },
  ],
};

const ids = (rules: {id: string}[]) => rules.map((rule) => rule.id).sort();

describe('matches', () => {
  test('gift lines never count towards a threshold', () => {
    const cart: CartLike = {lines: [line(SHIRT, 1, 40), gift('tier-50', MUG_VARIANT)]};
    expect(matches({type: 'subtotal_at_least', amount: 50}, cart)).toBe(false);
  });

  test('product_in_cart sums quantity across lines of the same product', () => {
    const cart: CartLike = {lines: [line(SHOES, 1, 80), line(SHOES, 1, 80)]};
    expect(matches({type: 'product_in_cart', productIds: [SHOES], minQuantity: 2}, cart)).toBe(true);
  });

  test('total_quantity_at_least ignores gifts', () => {
    const cart: CartLike = {lines: [line(SHIRT, 2, 40), gift('x', MUG_VARIANT, 5)]};
    expect(matches({type: 'total_quantity_at_least', quantity: 3}, cart)).toBe(false);
  });
});

describe('eligibleRules — common cases', () => {
  test('below every threshold: nothing', () => {
    expect(eligibleRules(config, {lines: [line(SHIRT, 1, 30)]})).toEqual([]);
  });

  test('exactly on the threshold qualifies', () => {
    expect(ids(eligibleRules(config, {lines: [line(SHIRT, 1, 50)]}))).toEqual(['tier-50']);
  });

  test('tiers: only the highest tier of a group applies', () => {
    expect(ids(eligibleRules(config, {lines: [line(SHIRT, 1, 120)]}))).toEqual(['tier-100']);
  });
});

describe('eligibleRules — complex rule', () => {
  test('2 shoes and no socks → cap (plus the spend tier)', () => {
    const cart: CartLike = {lines: [line(SHOES, 2, 160)]};
    expect(ids(eligibleRules(config, cart))).toEqual(['combo-cap', 'tier-100']);
  });

  test('2 shoes but socks in the cart → first branch fails, no shirt → no cap', () => {
    const cart: CartLike = {lines: [line(SHOES, 2, 160), line(SOCKS, 1, 10)]};
    expect(ids(eligibleRules(config, cart))).toEqual(['tier-100']);
  });

  test('$150+ with a shirt → cap through the second branch', () => {
    const cart: CartLike = {lines: [line(SHIRT, 1, 30), line(SOCKS, 12, 120)]};
    expect(ids(eligibleRules(config, cart))).toEqual(['combo-cap', 'tier-100']);
  });

  test('$150+ without a shirt → no cap', () => {
    const cart: CartLike = {lines: [line(SOCKS, 15, 150)]};
    expect(ids(eligibleRules(config, cart))).toEqual(['tier-100']);
  });
});

describe('planGiftChanges', () => {
  test('adds the gift when the cart qualifies', () => {
    const changes = planGiftChanges(config, {lines: [line(SHIRT, 1, 60)]});
    expect(changes).toEqual([{type: 'add', ruleId: 'tier-50', variantId: MUG_VARIANT, quantity: 1}]);
  });

  test('swaps tiers: removes the mug and adds the tote when the cart grows', () => {
    const mug = gift('tier-50', MUG_VARIANT);
    const changes = planGiftChanges(config, {lines: [line(SHIRT, 1, 110), mug]});
    expect(changes).toEqual([
      {type: 'remove', lineId: mug.id, quantity: 1},
      {type: 'add', ruleId: 'tier-100', variantId: TOTE_VARIANT, quantity: 1},
    ]);
  });

  test('removes the gift when the cart no longer qualifies', () => {
    const mug = gift('tier-50', MUG_VARIANT);
    expect(planGiftChanges(config, {lines: [line(SHIRT, 1, 20), mug]})).toEqual([
      {type: 'remove', lineId: mug.id, quantity: 1},
    ]);
  });

  test('nothing to do when the cart is already right (no loops)', () => {
    const cart: CartLike = {lines: [line(SHIRT, 1, 60), gift('tier-50', MUG_VARIANT)]};
    expect(planGiftChanges(config, cart)).toEqual([]);
  });

  test('a declined gift is not re-added', () => {
    const changes = planGiftChanges(config, {lines: [line(SHIRT, 1, 60)]}, new Set(['tier-50']));
    expect(changes).toEqual([]);
  });

  test('buyer bumped the gift quantity → trimmed back', () => {
    const mug = gift('tier-50', MUG_VARIANT, 3);
    expect(planGiftChanges(config, {lines: [line(SHIRT, 1, 60), mug]})).toEqual([
      {type: 'update', lineId: mug.id, quantity: 1},
    ]);
  });

  test('duplicate gift lines for one rule → extra line removed', () => {
    const first = gift('tier-50', MUG_VARIANT);
    const second = gift('tier-50', MUG_VARIANT);
    expect(planGiftChanges(config, {lines: [line(SHIRT, 1, 60), first, second]})).toEqual([
      {type: 'remove', lineId: second.id, quantity: 1},
    ]);
  });

  test('config changed the gift variant → old line removed, new one added', () => {
    const stale = gift('tier-50', 'gid://shopify/ProductVariant/old');
    expect(planGiftChanges(config, {lines: [line(SHIRT, 1, 60), stale]})).toEqual([
      {type: 'remove', lineId: stale.id, quantity: 1},
      {type: 'add', ruleId: 'tier-50', variantId: MUG_VARIANT, quantity: 1},
    ]);
  });

  test('gift line for a rule that no longer exists → removed', () => {
    const orphan = gift('deleted-rule', MUG_VARIANT);
    expect(planGiftChanges(config, {lines: [line(SHIRT, 1, 20), orphan]})).toEqual([
      {type: 'remove', lineId: orphan.id, quantity: 1},
    ]);
  });
});

describe('freeGiftAllocations (what the Function makes free)', () => {
  test('eligible gift line is free', () => {
    const mug = gift('tier-50', MUG_VARIANT);
    const result = freeGiftAllocations(config, {lines: [line(SHIRT, 1, 60), mug]});
    expect(result.map(({lineId, quantity}) => ({lineId, quantity}))).toEqual([{lineId: mug.id, quantity: 1}]);
  });

  test('not eligible → nothing is free, even with the attribute set by hand', () => {
    const mug = gift('tier-50', MUG_VARIANT);
    expect(freeGiftAllocations(config, {lines: [line(SHIRT, 1, 10), mug]})).toEqual([]);
  });

  test('attribute on a different (expensive) variant → not free', () => {
    const fake = gift('tier-50', 'gid://shopify/ProductVariant/999');
    expect(freeGiftAllocations(config, {lines: [line(SHIRT, 1, 60), fake]})).toEqual([]);
  });

  test('quantity is capped per rule across lines', () => {
    const a = gift('tier-50', MUG_VARIANT, 2);
    const b = gift('tier-50', MUG_VARIANT, 1);
    const result = freeGiftAllocations(config, {lines: [line(SHIRT, 1, 60), a, b]});
    expect(result.map(({lineId, quantity}) => ({lineId, quantity}))).toEqual([{lineId: a.id, quantity: 1}]);
  });

  test('a lower tier gift is not free once a higher tier is reached', () => {
    const mug = gift('tier-50', MUG_VARIANT);
    expect(freeGiftAllocations(config, {lines: [line(SHIRT, 1, 120), mug]})).toEqual([]);
  });
});

describe('nextUnlock', () => {
  test('shows the closest threshold', () => {
    expect(nextUnlock(config, {lines: [line(SHIRT, 1, 30)]})).toEqual({
      ruleId: 'tier-50',
      title: 'Free mug',
      remaining: 20,
      ratio: 0.6,
    });
  });

  test('after the first tier, points at the next one', () => {
    expect(nextUnlock(config, {lines: [line(SHIRT, 1, 60)]})?.ruleId).toBe('tier-100');
  });

  test('an all() with a threshold shows progress once its other conditions hold', () => {
    const progress = nextUnlock(config, {lines: [line(SHIRT, 1, 120)]});
    expect(progress).toMatchObject({ruleId: 'combo-cap', remaining: 30});
  });

  test('nothing left to unlock', () => {
    expect(nextUnlock(config, {lines: [line(SHIRT, 1, 200)]})).toBeNull();
  });
});

describe('parseConfig', () => {
  test('accepts a JSON string', () => {
    expect(parseConfig(JSON.stringify(config))?.rules).toHaveLength(3);
  });

  test('broken JSON or wrong version → null, checkout keeps working', () => {
    expect(parseConfig('{not json')).toBeNull();
    expect(parseConfig({version: 2, currencyCode: 'USD', rules: []})).toBeNull();
  });

  test('drops malformed rules instead of failing the whole config', () => {
    const parsed = parseConfig({
      version: 1,
      currencyCode: 'USD',
      rules: [config.rules[0], {id: 'bad', title: 'x', giftVariantId: 'v', condition: {type: 'nope'}}],
    });
    expect(parsed?.rules.map((rule) => rule.id)).toEqual(['tier-50']);
  });
});
