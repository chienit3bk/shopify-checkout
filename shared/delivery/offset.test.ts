import {describe, expect, test} from 'vitest';
import {type OffsetConfig, parseOffsetConfig, shouldOfferOffset, toggleOffset} from './offset';

const config: OffsetConfig = {version: 1, variantId: 'offset', attributeKey: '_carbon_offset'};
const line = (id: string, merchandiseId: string, quantity = 1) => ({id, merchandiseId, quantity, attributes: []});

describe('toggleOffset', () => {
  test('on adds one marked unit; on again adds nothing', () => {
    expect(toggleOffset(config, [line('a', 'serum')], true)).toEqual([
      {type: 'addCartLine', merchandiseId: 'offset', quantity: 1, attributes: [{key: '_carbon_offset', value: 'true'}]},
    ]);
    expect(toggleOffset(config, [line('a', 'serum'), line('b', 'offset')], true)).toEqual([]);
  });

  test('off removes every add-on line', () => {
    expect(toggleOffset(config, [line('a', 'serum'), line('b', 'offset', 2), line('c', 'offset')], false)).toEqual([
      {type: 'removeCartLine', id: 'b', quantity: 2},
      {type: 'removeCartLine', id: 'c', quantity: 1},
    ]);
  });
});

test('only offered next to real products', () => {
  expect(shouldOfferOffset(config, [line('b', 'offset')])).toBe(false);
  expect(shouldOfferOffset(config, [line('a', 'serum'), line('b', 'offset')])).toBe(true);
});

test('parseOffsetConfig', () => {
  expect(parseOffsetConfig(JSON.stringify(config))).toEqual(config);
  expect(parseOffsetConfig({version: 1})).toBeNull();
});
