import {describe, expect, test} from 'vitest';
import {type TiersConfig, parseTiersConfig, spendProgress, volumeProgress} from './tiers';

const config: TiersConfig = {
  version: 1,
  currencyCode: 'USD',
  volume: {
    productIds: ['mask'],
    tiers: [
      {minQuantity: 4, percent: 10},
      {minQuantity: 2, percent: 5},
      {minQuantity: 6, percent: 15},
    ],
    label: 'Stock up & save',
  },
  spend: {
    tiers: [
      {amount: 100, amounts: {EUR: 90}, percent: 5},
      {amount: 150, amounts: {EUR: 140}, percent: 10},
    ],
    label: 'Spend more, save more',
    excludedProductIds: [],
  },
};

describe('volumeProgress', () => {
  test('current and next tier at each quantity (tiers given out of order)', () => {
    const at = (q: number) => {
      const p = volumeProgress(config.volume!.tiers, q);
      return [p.current?.percent ?? 0, p.next?.minQuantity ?? null];
    };
    expect([1, 2, 3, 4, 5, 6, 9].map(at)).toEqual([
      [0, 2],
      [5, 4],
      [5, 4],
      [10, 6],
      [10, 6],
      [15, null],
      [15, null],
    ]);
  });
});

describe('spendProgress', () => {
  test('below, between and above the tiers', () => {
    expect(spendProgress(config, 80, 'USD')).toMatchObject({current: null, next: {percent: 5, remaining: 20}});
    expect(spendProgress(config, 120, 'USD')).toMatchObject({current: {percent: 5}, next: {percent: 10, remaining: 30}});
    expect(spendProgress(config, 150, 'USD')).toMatchObject({current: {percent: 10}, next: null});
  });

  test('market amounts win; unknown currency without a rate has no tiers', () => {
    expect(spendProgress(config, 95, 'EUR')).toMatchObject({current: {percent: 5}, next: {remaining: 45}});
    expect(spendProgress(config, 500, 'CAD')).toEqual({current: null, next: null});
    expect(spendProgress(config, 140, 'CAD', 1.4)).toMatchObject({current: {percent: 5, threshold: 140}});
  });
});

describe('parseTiersConfig', () => {
  test('accepts the demo config, rejects bad percents and empty tiers', () => {
    expect(parseTiersConfig(JSON.stringify(config))).toEqual(config);
    expect(parseTiersConfig({...config, volume: {...config.volume, tiers: [{minQuantity: 2, percent: 120}]}})).toBeNull();
    expect(parseTiersConfig({...config, spend: {...config.spend, tiers: []}})).toBeNull();
    expect(parseTiersConfig({...config, volume: null, spend: null})).toEqual({...config, volume: null, spend: null});
  });
});
