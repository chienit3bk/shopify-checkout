import {describe, expect, test} from 'vitest';
import {emptyFunnel, isGiftEventData, parseFunnel, recordGiftEvent, recordOrder, summarize} from './gift-funnel';

const GIFT = '_free_gift';
const order = (subtotal: number, giftRuleIds: string[] = [], currencyCode = 'USD') => ({
  subtotal,
  currencyCode,
  lines: [
    {properties: []},
    ...giftRuleIds.map((ruleId) => ({properties: [{key: GIFT, value: ruleId}]})),
  ],
});

describe('recordGiftEvent', () => {
  test('counts each event per rule without touching other rules', () => {
    let s = emptyFunnel();
    s = recordGiftEvent(s, 'progress_viewed', {ruleId: 'bag'});
    s = recordGiftEvent(s, 'progress_viewed', {ruleId: 'bag'});
    s = recordGiftEvent(s, 'unlocked', {ruleId: 'travel'});
    s = recordGiftEvent(s, 'declined', {ruleId: 'travel'});
    expect(s.rules).toEqual({
      bag: {progressViews: 2, unlocks: 0, declines: 0, orders: 0},
      travel: {progressViews: 0, unlocks: 1, declines: 1, orders: 0},
    });
  });

  test('is immutable', () => {
    const s = emptyFunnel();
    recordGiftEvent(s, 'unlocked', {ruleId: 'bag'});
    expect(s.rules).toEqual({});
  });
});

describe('recordOrder', () => {
  test('attributes an order to each gift still in it, once per rule', () => {
    const s = recordOrder(emptyFunnel(), order(89, ['travel', 'travel', 'routine']), GIFT);
    expect(s.rules.travel.orders).toBe(1);
    expect(s.rules.routine.orders).toBe(1);
    expect(s.revenue.USD).toEqual({ordersWithGift: 1, revenueWithGift: 89, ordersWithout: 0, revenueWithout: 0});
  });

  test('orders without a gift line go to the "without" bucket', () => {
    const s = recordOrder(emptyFunnel(), order(52.5), GIFT);
    expect(s.rules).toEqual({});
    expect(s.revenue.USD).toMatchObject({ordersWithout: 1, revenueWithout: 52.5});
  });

  test('keeps currencies apart', () => {
    let s = recordOrder(emptyFunnel(), order(100, ['bag']), GIFT);
    s = recordOrder(s, order(90, ['bag'], 'EUR'), GIFT);
    expect(Object.keys(s.revenue).sort()).toEqual(['EUR', 'USD']);
    expect(s.revenue.EUR.revenueWithGift).toBe(90);
  });
});

describe('summarize', () => {
  test('keep rate and AOV with vs without a gift', () => {
    let s = emptyFunnel();
    for (let i = 0; i < 4; i++) s = recordGiftEvent(s, 'unlocked', {ruleId: 'travel'});
    s = recordGiftEvent(s, 'declined', {ruleId: 'travel'});
    s = recordOrder(s, order(89, ['travel']), GIFT);
    s = recordOrder(s, order(101, ['travel']), GIFT);
    s = recordOrder(s, order(48), GIFT);
    const summary = summarize(s);
    expect(summary.rules[0]).toMatchObject({ruleId: 'travel', keepRate: 0.75, orders: 2});
    expect(summary.aov.USD).toEqual({withGift: 95, without: 48});
  });

  test('no unlocks → keep rate unknown, not 0%', () => {
    const s = recordGiftEvent(emptyFunnel(), 'progress_viewed', {ruleId: 'bag'});
    expect(summarize(s).rules[0].keepRate).toBeNull();
  });
});

describe('parseFunnel / isGiftEventData', () => {
  test('round-trips through JSON and repairs bad counters', () => {
    const s = recordOrder(recordGiftEvent(emptyFunnel(), 'unlocked', {ruleId: 'bag'}), order(80, ['bag']), GIFT);
    expect(parseFunnel(JSON.stringify(s))).toEqual(s);
    expect(parseFunnel({version: 1, rules: {bag: {unlocks: -3, orders: 'x'}}, revenue: {}}).rules.bag).toEqual({
      progressViews: 0,
      unlocks: 0,
      declines: 0,
      orders: 0,
    });
  });

  test('garbage starts fresh', () => {
    expect(parseFunnel('not json')).toEqual(emptyFunnel());
    expect(parseFunnel(null)).toEqual(emptyFunnel());
    expect(parseFunnel({version: 2, rules: {}, revenue: {}})).toEqual(emptyFunnel());
  });

  test('event payload needs a rule id', () => {
    expect(isGiftEventData({ruleId: 'bag'})).toBe(true);
    expect(isGiftEventData({ruleId: ''})).toBe(false);
    expect(isGiftEventData(null)).toBe(false);
  });
});
