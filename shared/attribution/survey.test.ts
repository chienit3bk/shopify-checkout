import {describe, expect, test} from 'vitest';
import {MAX_DETAIL_LENGTH, fromStoredValue, isSource, toStoredValue} from './survey';

describe('toStoredValue', () => {
  test('a listed source is stored as its id', () => {
    expect(toStoredValue('instagram')).toBe('instagram');
  });

  test('a detail is ignored for listed sources', () => {
    expect(toStoredValue('google', 'searched for serum')).toBe('google');
  });

  test('"other" keeps the buyer words, trimmed to one line', () => {
    expect(toStoredValue('other', '  a   beauty\nmagazine ')).toBe('other: a beauty magazine');
  });

  test('"other" without words is just "other"', () => {
    expect(toStoredValue('other', '   ')).toBe('other');
  });

  test('long answers are capped', () => {
    expect(toStoredValue('other', 'x'.repeat(500))).toBe(`other: ${'x'.repeat(MAX_DETAIL_LENGTH)}`);
  });
});

describe('fromStoredValue', () => {
  test('round-trips listed sources and "other"', () => {
    expect(fromStoredValue('tiktok')).toEqual({source: 'tiktok', detail: ''});
    expect(fromStoredValue('other: a magazine')).toEqual({source: 'other', detail: 'a magazine'});
  });

  test('empty or unknown values give no selection', () => {
    expect(fromStoredValue(undefined)).toEqual({source: null, detail: ''});
    expect(fromStoredValue('radio')).toEqual({source: null, detail: ''});
  });
});

describe('isSource', () => {
  test('only listed ids', () => {
    expect(isSource('friend')).toBe(true);
    expect(isSource('Friend')).toBe(false);
    expect(isSource(3)).toBe(false);
  });
});
