import {describe, expect, test} from 'vitest';
import {type CutoffConfig, cutoffStatus, formatLeft, parseCutoffConfig, zonedTimeToUtc} from './cutoff';

const config: CutoffConfig = {
  version: 1,
  timezone: 'America/New_York',
  cutoffHour: 14,
  cutoffMinute: 0,
  shipDays: [1, 2, 3, 4, 5],
  holidays: ['2026-11-26', '2026-12-25'],
  deadline: {label: 'Christmas', lastOrderDate: '2026-12-18'},
};

// Instants written in New York time (EST, UTC−5 in November/December).
const ny = (local: string) => Date.parse(`${local}-05:00`);

describe('cutoffStatus', () => {
  test('weekday before cut-off ships today, with time left', () => {
    const s = cutoffStatus(config, ny('2026-11-24T11:19:00')); // Tue
    expect(s).toMatchObject({shipsToday: true, shipDate: '2026-11-24'});
    expect(formatLeft(s.msLeft)).toBe('2h 41m');
  });

  test('after cut-off ships the next shipping day', () => {
    expect(cutoffStatus(config, ny('2026-11-24T14:00:00'))).toMatchObject({shipsToday: false, shipDate: '2026-11-25'});
  });

  test('Friday afternoon → Monday', () => {
    expect(cutoffStatus(config, ny('2026-11-20T16:00:00'))).toMatchObject({shipDate: '2026-11-23', shipWeekday: 1});
  });

  test('Thanksgiving is skipped: Wednesday evening → Friday', () => {
    expect(cutoffStatus(config, ny('2026-11-25T18:00:00'))).toMatchObject({shipDate: '2026-11-27', shipWeekday: 5});
  });

  test('on a holiday morning nothing ships today', () => {
    expect(cutoffStatus(config, ny('2026-11-26T09:00:00'))).toMatchObject({shipsToday: false, shipDate: '2026-11-27'});
  });

  test('Saturday → Monday', () => {
    expect(cutoffStatus(config, ny('2026-11-28T10:00:00'))).toMatchObject({shipsToday: false, shipDate: '2026-11-30'});
  });

  test('uses the warehouse clock, not UTC: 23:30 New York is already tomorrow in UTC', () => {
    // 2026-11-24 23:30 EST = 2026-11-25 04:30 UTC — still Tuesday evening at the warehouse.
    expect(cutoffStatus(config, ny('2026-11-24T23:30:00'))).toMatchObject({shipsToday: false, shipDate: '2026-11-25'});
  });

  test('seasonal deadline shows until its last day, then disappears', () => {
    expect(cutoffStatus(config, ny('2026-12-18T20:00:00')).deadline?.label).toBe('Christmas');
    expect(cutoffStatus(config, ny('2026-12-19T08:00:00')).deadline).toBeNull();
  });
});

describe('zonedTimeToUtc', () => {
  test('handles both sides of the DST change', () => {
    expect(new Date(zonedTimeToUtc('2026-07-01', 14, 0, 'America/New_York')).toISOString()).toBe('2026-07-01T18:00:00.000Z');
    expect(new Date(zonedTimeToUtc('2026-12-01', 14, 0, 'America/New_York')).toISOString()).toBe('2026-12-01T19:00:00.000Z');
  });
});

describe('formatLeft', () => {
  test('rounds up to the minute', () => {
    expect(formatLeft(30_000)).toBe('1m');
    expect(formatLeft(3_600_000)).toBe('1h 0m');
  });
});

describe('parseCutoffConfig', () => {
  test('accepts the demo config', () => {
    expect(parseCutoffConfig(JSON.stringify(config))).toEqual(config);
  });

  test('rejects bad timezone, hours and weekdays', () => {
    expect(parseCutoffConfig({...config, timezone: 'Mars/Olympus'})).toBeNull();
    expect(parseCutoffConfig({...config, cutoffHour: 24})).toBeNull();
    expect(parseCutoffConfig({...config, shipDays: [0, 8]})).toBeNull();
  });
});
