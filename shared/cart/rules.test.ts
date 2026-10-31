import {describe, expect, test} from 'vitest';
import {type CartRulesConfig, parseCartRules, violations} from './rules';

const config: CartRulesConfig = {
  version: 1,
  excludedProductIds: ['offset'],
  rules: [
    {type: 'max_quantity', productIds: ['serum'], max: 3, label: 'BFCM limit'},
    {type: 'min_subtotal', amount: 25, amounts: {EUR: 25}, currencyCode: 'USD'},
    {type: 'incompatible', productIds: ['clay', 'charcoal'], label: 'One mask per order'},
  ],
};
const line = (productId: string, quantity: number, subtotal: number, isGift = false) => ({
  productId,
  title: productId,
  quantity,
  subtotal,
  isGift,
});
const cart = (lines: ReturnType<typeof line>[], currencyCode = 'USD', rate?: number) => ({currencyCode, rate, lines});

describe('violations', () => {
  test('a normal cart passes', () => {
    expect(violations(config, cart([line('serum', 2, 96), line('clay', 1, 32)]))).toEqual([]);
  });

  test('max quantity counts the product across lines', () => {
    expect(violations(config, cart([line('serum', 2, 96), line('serum', 2, 96)]))).toEqual([
      {type: 'max_quantity', title: 'serum', max: 3, quantity: 4},
    ]);
  });

  test('minimum ignores gifts and excluded services; empty carts are not flagged', () => {
    expect(violations(config, cart([line('lip', 1, 19), line('offset', 1, 1.5), line('gift', 1, 9, true)]))).toEqual([
      {type: 'min_subtotal', minimum: 25, subtotal: 19, currencyCode: 'USD'},
    ]);
    expect(violations(config, cart([]))).toEqual([]);
  });

  test('market amount wins; unknown currency without a rate is not enforced', () => {
    expect(violations(config, cart([line('lip', 1, 24)], 'EUR'))).toHaveLength(1);
    expect(violations(config, cart([line('lip', 1, 24)], 'CAD'))).toEqual([]);
    expect(violations(config, cart([line('lip', 1, 30)], 'CAD', 1.4))).toHaveLength(1);
  });

  test('incompatible products, but a gift line never triggers it', () => {
    expect(violations(config, cart([line('clay', 1, 32), line('charcoal', 1, 28)]))).toEqual([
      {type: 'incompatible', titles: ['clay', 'charcoal'], label: 'One mask per order'},
    ]);
    expect(violations(config, cart([line('clay', 1, 32), line('charcoal', 1, 0, true)]))).toEqual([]);
  });
});

test('parseCartRules drops malformed rules', () => {
  const parsed = parseCartRules({...config, rules: [...config.rules, {type: 'max_quantity', productIds: ['x'], max: 0, label: 'x'}, {type: 'incompatible', productIds: ['x'], label: 'x'}]});
  expect(parsed?.rules).toEqual(config.rules);
});
