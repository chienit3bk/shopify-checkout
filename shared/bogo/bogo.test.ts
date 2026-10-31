import {describe, expect, test} from 'vitest';
import {type BogoConfig, appliesTo, freeUnits, parseBogoConfig, unitsToNextFree} from './bogo';

const config: BogoConfig = {version: 1, buy: 2, get: 1, productIds: ['lip'], label: 'Buy 2, get 1 free'};

describe('freeUnits', () => {
  test('one free unit per full group of 3', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((q) => freeUnits(config, q))).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
  });

  test('buy 3 get 2', () => {
    expect(freeUnits({...config, buy: 3, get: 2}, 10)).toBe(4);
  });

  test('cap per line', () => {
    expect(freeUnits({...config, maxFreePerLine: 1}, 9)).toBe(1);
  });
});

describe('unitsToNextFree', () => {
  test('nudges only when the paid part of a group is complete', () => {
    expect([1, 2, 3, 4, 5].map((q) => unitsToNextFree(config, q))).toEqual([null, 1, null, null, 1]);
  });

  test('no nudge once the cap is reached', () => {
    expect(unitsToNextFree({...config, maxFreePerLine: 1}, 5)).toBeNull();
  });
});

describe('appliesTo / parseBogoConfig', () => {
  test('only listed products, never gift lines', () => {
    expect(appliesTo(config, 'lip', false)).toBe(true);
    expect(appliesTo(config, 'lip', true)).toBe(false);
    expect(appliesTo(config, 'mask', false)).toBe(false);
  });

  test('rejects zero or fractional quantities', () => {
    expect(parseBogoConfig(JSON.stringify(config))).toEqual({...config, maxFreePerLine: undefined});
    expect(parseBogoConfig({...config, get: 0})).toBeNull();
    expect(parseBogoConfig({...config, buy: 1.5})).toBeNull();
  });
});
