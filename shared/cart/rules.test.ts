import {describe, expect, test} from 'vitest';
import {type CartRulesConfig, casePackOptions, parseCartRules, violations} from './rules';

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
const b2b = (lines: ReturnType<typeof line>[], isFirstOrder = false) => ({currencyCode: 'EUR', isB2B: true, isFirstOrder, lines});

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
      {type: 'min_subtotal', minimum: 25, subtotal: 19, currencyCode: 'USD', firstOrder: false},
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

test('minimum uses the subtotal the buyer sees (after item discounts), minus gifts and services', () => {
  // 3 masks with one free (B2G1) + a free gift + the offset add-on: buyer sees $97.50 subtotal.
  const lines = [line('clay', 2, 64), line('clay', 1, 0), line('gift', 1, 0, true), line('offset', 1, 1.5)];
  const strict: CartRulesConfig = {version: 1, excludedProductIds: ['offset'], rules: [{type: 'min_subtotal', amount: 100, currencyCode: 'USD'}]};
  expect(violations(strict, {currencyCode: 'USD', subtotal: 65.5, lines})).toEqual([
    {type: 'min_subtotal', minimum: 100, subtotal: 64, currencyCode: 'USD', firstOrder: false},
  ]);
});

describe('B2B rules', () => {
  const wholesale: CartRulesConfig = {
    version: 1,
    excludedProductIds: ['offset'],
    rules: [
      {buyer: 'b2b', type: 'min_quantity', min: 3},
      {buyer: 'b2b', type: 'case_pack', productIds: ['patches'], size: 6},
      {buyer: 'b2b', type: 'min_subtotal', amount: 300, firstOrderAmount: 500, currencyCode: 'EUR'},
      {buyer: 'retail', type: 'max_quantity', productIds: ['serum'], max: 3, label: 'Retail limit'},
    ],
  };

  test('retail buyers skip B2B rules; B2B buyers skip retail rules', () => {
    expect(violations(wholesale, cart([line('serum', 1, 48)]))).toEqual([]);
    expect(violations(wholesale, b2b([line('serum', 10, 480)]))).toEqual([]);
    expect(violations(wholesale, cart([line('serum', 4, 192)]))).toHaveLength(1);
  });

  test('minimum quantity applies to every product (summed across lines) except excluded services', () => {
    expect(violations(wholesale, b2b([line('serum', 2, 96), line('serum', 1, 48), line('clay', 2, 64), line('offset', 1, 1.5), line('lip', 10, 190)]))).toEqual([
      {type: 'min_quantity', title: 'clay', min: 3, quantity: 2},
    ]);
  });

  test('case packs: any multiple of the size passes', () => {
    expect(violations(wholesale, b2b([line('patches', 12, 300)]))).toEqual([]);
    expect(violations(wholesale, b2b([line('patches', 8, 320)]))).toEqual([{type: 'case_pack', title: 'patches', size: 6, quantity: 8}]);
    expect(casePackOptions(6, 8)).toEqual({lower: 6, upper: 12});
    expect(casePackOptions(6, 4)).toEqual({lower: 0, upper: 6});
  });

  test('first order has the higher minimum; repeat orders the regular one', () => {
    const lines = [line('serum', 9, 432)];
    expect(violations(wholesale, b2b(lines, true))).toEqual([
      {type: 'min_subtotal', minimum: 500, subtotal: 432, currencyCode: 'EUR', firstOrder: true},
    ]);
    expect(violations(wholesale, b2b(lines, false))).toEqual([]);
  });
});

test('parseCartRules drops malformed rules', () => {
  const parsed = parseCartRules({...config, rules: [...config.rules, {type: 'max_quantity', productIds: ['x'], max: 0, label: 'x'}, {type: 'incompatible', productIds: ['x'], label: 'x'}]});
  expect(parsed?.rules).toEqual(config.rules);
  const b2bRules = parseCartRules({
    version: 1,
    rules: [
      {buyer: 'wholesale', type: 'min_quantity', min: 3},
      {type: 'case_pack', productIds: ['x'], size: 1},
      {type: 'min_quantity', min: 2.5},
      {type: 'min_subtotal', amount: 300, firstOrderAmount: -1, currencyCode: 'EUR'},
      {buyer: 'b2b', type: 'min_quantity', min: 3},
    ],
  });
  expect(b2bRules?.rules).toEqual([{buyer: 'b2b', type: 'min_quantity', min: 3}]);
});
