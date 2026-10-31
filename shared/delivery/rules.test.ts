import {describe, expect, test} from 'vitest';
import {type DeliveryRulesConfig, cartWeightKg, deliveryOperations, parseDeliveryRules} from './rules';

const config: DeliveryRulesConfig = {
  version: 1,
  rules: [
    {action: 'hide', methods: ['Express'], when: {minWeightKg: 1}},
    {action: 'rename', methods: ['Standard'], title: 'Standard — USPS Ground (3–5 days)', when: {countries: ['US']}},
    {action: 'rename', methods: ['Express'], title: 'Express — UPS 2nd Day Air', when: {countries: ['US']}},
    {action: 'move', methods: ['Express'], index: 0, when: {countries: ['US'], minSubtotal: 100}},
  ],
};
const options = [
  {handle: 'std', title: 'Standard'},
  {handle: 'exp', title: 'Express'},
];
const ctx = (weightKg: number, countryCode: string | null = 'US', subtotal = 50) => ({weightKg, countryCode, subtotal});

describe('cartWeightKg', () => {
  test('sums quantity × weight across units', () => {
    expect(
      cartWeightKg([
        {quantity: 4, weight: 300, weightUnit: 'GRAMS'},
        {quantity: 1, weight: 1, weightUnit: 'POUNDS'},
        {quantity: 2, weight: null, weightUnit: 'KILOGRAMS'},
      ]),
    ).toBe(1.654);
  });
});

describe('deliveryOperations', () => {
  test('light US cart: both renamed, nothing hidden', () => {
    expect(deliveryOperations(config, options, ctx(0.4))).toEqual([
      {type: 'rename', handle: 'std', title: 'Standard — USPS Ground (3–5 days)'},
      {type: 'rename', handle: 'exp', title: 'Express — UPS 2nd Day Air'},
    ]);
  });

  test('heavy cart: Express hidden and never renamed or moved', () => {
    expect(deliveryOperations(config, options, ctx(1.2, 'US', 180))).toEqual([
      {type: 'hide', handle: 'exp'},
      {type: 'rename', handle: 'std', title: 'Standard — USPS Ground (3–5 days)'},
    ]);
  });

  test('US order over $100: Express moved to the top', () => {
    expect(deliveryOperations(config, options, ctx(0.5, 'US', 120))).toContainEqual({type: 'move', handle: 'exp', index: 0});
  });

  test('other countries keep the original names', () => {
    expect(deliveryOperations(config, options, ctx(0.5, 'CA', 120))).toEqual([]);
    expect(deliveryOperations(config, options, ctx(0.5, null, 120))).toEqual([]);
  });
});

describe('parseDeliveryRules', () => {
  test('drops malformed rules, keeps the rest', () => {
    const parsed = parseDeliveryRules({
      version: 1,
      rules: [...config.rules, {action: 'move', methods: ['Express'], index: -1}, {action: 'rename', methods: [], title: 'x'}],
    });
    expect(parsed?.rules).toEqual(config.rules);
    expect(parseDeliveryRules('nope')).toBeNull();
  });
});
