import {describe, expect, test} from 'vitest';
import {
  type OfferConfig,
  type OfferLine,
  availableOffers,
  countdown,
  isLive,
  offerAllocations,
  parseOfferConfig,
} from './offer';

const OIL = 'gid://shopify/ProductVariant/1';
const MASK = 'gid://shopify/ProductVariant/2';

const config: OfferConfig = {
  version: 1,
  campaign: 'Black Friday',
  startDate: '2026-11-23',
  endDate: '2026-11-30',
  endsAt: '2026-11-30T23:59:59-05:00',
  offers: [
    {id: 'oil-25', title: 'Black Friday add-on −25%', variantId: OIL, percentOff: 25},
    {id: 'mask-30', title: 'Black Friday add-on −30%', variantId: MASK, percentOff: 30, maxQuantity: 2},
  ],
};

let seq = 0;
const line = (variantId: string, quantity: number, offerId: string | null = null): OfferLine => ({
  id: `gid://shopify/CartLine/${++seq}`,
  variantId,
  quantity,
  offerId,
});

describe('campaign window', () => {
  test('first and last day are inclusive', () => {
    expect(isLive(config, '2026-11-23')).toBe(true);
    expect(isLive(config, '2026-11-30')).toBe(true);
  });

  test('outside the window → not live', () => {
    expect(isLive(config, '2026-11-22')).toBe(false);
    expect(isLive(config, '2026-12-01')).toBe(false);
  });
});

describe('countdown', () => {
  test('splits the time left', () => {
    const now = Date.parse('2026-11-28T21:58:58-05:00'); // 2d 02h 01m 01s before the end
    expect(countdown(config, now)).toEqual({days: 2, hours: 2, minutes: 1, seconds: 1, ended: false});
  });

  test('never negative after the end', () => {
    expect(countdown(config, Date.parse('2026-12-02T00:00:00-05:00'))).toMatchObject({days: 0, seconds: 0, ended: true});
  });
});

describe('availableOffers', () => {
  test('hides an offer that is already in the cart', () => {
    const offers = availableOffers(config, [line(OIL, 1, 'oil-25')]);
    expect(offers.map((offer) => offer.id)).toEqual(['mask-30']);
  });
});

describe('offerAllocations (what the Function discounts)', () => {
  test('discounts the tagged line during the campaign', () => {
    const oil = line(OIL, 1, 'oil-25');
    expect(offerAllocations(config, '2026-11-27', [oil]).map((a) => [a.lineId, a.quantity])).toEqual([[oil.id, 1]]);
  });

  test('nothing outside the campaign window', () => {
    expect(offerAllocations(config, '2026-12-01', [line(OIL, 1, 'oil-25')])).toEqual([]);
  });

  test('attribute on another (pricier) variant → no discount', () => {
    expect(offerAllocations(config, '2026-11-27', [line('gid://shopify/ProductVariant/999', 1, 'oil-25')])).toEqual([]);
  });

  test('unknown offer id → no discount', () => {
    expect(offerAllocations(config, '2026-11-27', [line(OIL, 1, 'made-up')])).toEqual([]);
  });

  test('quantity is capped per offer across lines', () => {
    const a = line(MASK, 3, 'mask-30');
    const b = line(MASK, 1, 'mask-30');
    const result = offerAllocations(config, '2026-11-27', [a, b]);
    expect(result.map((r) => [r.lineId, r.quantity])).toEqual([[a.id, 2]]);
  });

  test('untagged lines of the offer product are not discounted', () => {
    expect(offerAllocations(config, '2026-11-27', [line(OIL, 1)])).toEqual([]);
  });
});

describe('parseOfferConfig', () => {
  test('accepts a JSON string', () => {
    expect(parseOfferConfig(JSON.stringify(config))?.offers).toHaveLength(2);
  });

  test('rejects bad dates or broken JSON', () => {
    expect(parseOfferConfig('{nope')).toBeNull();
    expect(parseOfferConfig({...config, startDate: '27/11/2026'})).toBeNull();
    expect(parseOfferConfig({...config, endsAt: 'soon'})).toBeNull();
  });

  test('drops offers with an invalid percentage', () => {
    const parsed = parseOfferConfig({...config, offers: [...config.offers, {id: 'x', title: 'x', variantId: OIL, percentOff: 150}]});
    expect(parsed?.offers.map((offer) => offer.id)).toEqual(['oil-25', 'mask-30']);
  });
});
