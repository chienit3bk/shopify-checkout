import {describe, expect, test} from 'vitest';
import type {CutoffConfig} from '../shipping/cutoff';
import {
  type DeliveryDateConfig,
  blocksPoBox,
  dateProblem,
  earliestDeliveryDate,
  isPoBox,
  parseDeliveryDateConfig,
  pickerConstraints,
} from './date';

const cutoff: CutoffConfig = {
  version: 1,
  timezone: 'America/New_York',
  cutoffHour: 14,
  cutoffMinute: 0,
  shipDays: [1, 2, 3, 4, 5],
  holidays: ['2026-11-26', '2026-12-25'],
};
const config: DeliveryDateConfig = {
  version: 1,
  transitDays: 2,
  windowDays: 30,
  attributeKey: 'Delivery date',
  poBoxBlockedMethods: ['Express'],
};
const ny = (local: string) => Date.parse(`${local}-05:00`);

describe('earliestDeliveryDate', () => {
  test('ships today before cut-off → 2 delivery days later', () => {
    expect(earliestDeliveryDate(cutoff, config, ny('2026-11-23T10:00:00'))).toBe('2026-11-25'); // Mon → Wed
  });

  test('Thanksgiving is skipped in transit too', () => {
    // Tue after cut-off ships Wed 25; Thu 26 is a holiday → Fri 27, Mon 30.
    expect(earliestDeliveryDate(cutoff, config, ny('2026-11-24T15:00:00'))).toBe('2026-11-30');
  });
});

describe('dateProblem', () => {
  const earliest = '2026-11-25';
  test('accepts a delivery day inside the window', () => {
    expect(dateProblem(cutoff, config, '2026-12-01', earliest)).toBeNull();
  });
  test('too early, too late, weekend, holiday, garbage', () => {
    expect(dateProblem(cutoff, config, '2026-11-24', earliest)).toBe('too_early');
    expect(dateProblem(cutoff, config, '2026-12-28', earliest)).toBe('too_late');
    expect(dateProblem(cutoff, config, '2026-11-28', earliest)).toBe('not_a_delivery_day');
    expect(dateProblem(cutoff, config, '2026-11-26', earliest)).toBe('not_a_delivery_day');
    expect(dateProblem(cutoff, config, 'next friday', earliest)).toBe('invalid');
  });
});

describe('pickerConstraints', () => {
  test('blocks before the earliest date, after the window, holidays and weekends', () => {
    expect(pickerConstraints(cutoff, config, '2026-11-25')).toEqual({
      disallow: '--2026-11-24,2026-12-26--,2026-11-26,2026-12-25',
      disallowDays: 'saturday,sunday',
      defaultView: '2026-11',
    });
  });
});

describe('PO Box', () => {
  test('detects common spellings, not look-alikes', () => {
    expect(isPoBox('PO Box 123')).toBe(true);
    expect(isPoBox('350 5th Ave', 'P.O. Box 9')).toBe(true);
    expect(isPoBox('Post Office Box 77')).toBe(true);
    expect(isPoBox('12 Boxwood Lane')).toBe(false);
    expect(isPoBox('Pobrecito Rd')).toBe(false);
  });
  test('blocked for Express (also when renamed), allowed for Standard', () => {
    expect(blocksPoBox(config, 'Express — UPS 2nd Day Air')).toBe(true);
    expect(blocksPoBox(config, 'Standard — USPS Ground (3–5 days)')).toBe(false);
  });
});

test('parseDeliveryDateConfig', () => {
  expect(parseDeliveryDateConfig(JSON.stringify(config))).toEqual(config);
  expect(parseDeliveryDateConfig({...config, windowDays: 0})).toBeNull();
});
