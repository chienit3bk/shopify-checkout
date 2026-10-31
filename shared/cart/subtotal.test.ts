import {expect, test} from 'vitest';
import {amountsBeforeDiscounts} from './subtotal';

const line = (total: number, lineDiscounts: number[] = [], gift = false) => ({
  gift,
  cost: {totalAmount: {amount: total}},
  discountAllocations: lineDiscounts.map((amount) => ({discountedAmount: {amount}})),
});

test('adds back line discounts and each line’s share of an order discount (live numbers)', () => {
  // 4 × $24 cleanser −10% volume, $52 night cream, free travel gift; 5% order discount on $138.40.
  const lines = [line(82.08, [9.6]), line(49.4), line(0, [9], true)];
  expect(amountsBeforeDiscounts(138.4, lines, (l) => !l.gift)).toEqual([96, 52, 9]);
});

test('no order discount → totals plus line discounts', () => {
  expect(amountsBeforeDiscounts(61, [line(52), line(9)], () => true)).toEqual([52, 9]);
});

test('lines that cannot receive an order discount get no share', () => {
  // $100 order discount base is only the first line; the sale line paid full price.
  const lines = [line(95), line(42)];
  expect(amountsBeforeDiscounts(142, lines, (_l) => _l === lines[0])).toEqual([100, 42]);
});
