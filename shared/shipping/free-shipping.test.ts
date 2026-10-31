import {describe, expect, test} from 'vitest';
import {
  type FreeShippingConfig,
  type ShippingCart,
  freeShippingStatus,
  matchesMethod,
  parseFreeShippingConfig,
} from './free-shipping';

const SALE = 'gid://shopify/Product/sale';
const SERUM = 'gid://shopify/Product/serum';
const config: FreeShippingConfig = {
  version: 1,
  currencyCode: 'USD',
  amount: 120,
  amounts: {EUR: 110},
  methods: ['Express'],
  excludedProductIds: [SALE],
  label: 'Free Express shipping',
};

const cart = (lines: ShippingCart['lines'], currencyCode = 'USD', rate?: number): ShippingCart => ({currencyCode, rate, lines});
const line = (productId: string, subtotal: number, isGift = false) => ({productId, subtotal, isGift});

describe('freeShippingStatus', () => {
  test('counts only eligible lines towards the threshold', () => {
    const s = freeShippingStatus(config, cart([line(SERUM, 96), line(SALE, 31.5)]));
    expect(s).toMatchObject({qualifying: 96, remaining: 24, unlocked: false, excludedCount: 1});
  });

  test('unlocks at exactly the threshold', () => {
    expect(freeShippingStatus(config, cart([line(SERUM, 120)]))).toMatchObject({unlocked: true, remaining: 0, ratio: 1});
  });

  test('gift lines never count and are not reported as excluded', () => {
    const s = freeShippingStatus(config, cart([line(SERUM, 100), line('gid://shopify/Product/gift', 30, true)]));
    expect(s).toMatchObject({qualifying: 100, unlocked: false, excludedCount: 0});
  });

  test('per-market amount wins; other currencies convert with the rate; unknown rate → no threshold', () => {
    expect(freeShippingStatus(config, cart([line(SERUM, 110)], 'EUR')).unlocked).toBe(true);
    expect(freeShippingStatus(config, cart([line(SERUM, 150)], 'CAD', 1.4)).threshold).toBe(168);
    expect(freeShippingStatus(config, cart([line(SERUM, 500)], 'CAD'))).toMatchObject({threshold: null, unlocked: false});
  });
});

describe('matchesMethod', () => {
  test('matches by title, case-insensitive, nothing else', () => {
    expect(matchesMethod(config, ' express ')).toBe(true);
    expect(matchesMethod(config, 'Standard')).toBe(false);
    expect(matchesMethod(config, null)).toBe(false);
  });
});

describe('parseFreeShippingConfig', () => {
  test('accepts the demo shape and rejects missing methods', () => {
    expect(parseFreeShippingConfig(JSON.stringify(config))).toEqual(config);
    expect(parseFreeShippingConfig({...config, methods: []})).toBeNull();
    expect(parseFreeShippingConfig({...config, amount: -1})).toBeNull();
  });
});
