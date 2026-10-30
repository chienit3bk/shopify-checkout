import {describe, expect, test} from 'vitest';
import {parseReferralConfig, shareUrl} from './referral';

describe('parseReferralConfig', () => {
  test('accepts a valid config (object or JSON string)', () => {
    const config = {version: 1, code: 'FRIENDS15', percentOff: 15};
    expect(parseReferralConfig(config)).toEqual(config);
    expect(parseReferralConfig(JSON.stringify(config))).toEqual(config);
  });

  test('rejects codes that would break the share link', () => {
    expect(parseReferralConfig({version: 1, code: 'FRIENDS 15', percentOff: 15})).toBeNull();
    expect(parseReferralConfig({version: 1, code: '../x', percentOff: 15})).toBeNull();
  });

  test('rejects impossible percentages and broken JSON', () => {
    expect(parseReferralConfig({version: 1, code: 'FRIENDS15', percentOff: 0})).toBeNull();
    expect(parseReferralConfig({version: 1, code: 'FRIENDS15', percentOff: 120})).toBeNull();
    expect(parseReferralConfig('{oops')).toBeNull();
  });
});

describe('shareUrl', () => {
  test('applies the code and lands on the home page', () => {
    expect(shareUrl('https://solvane.example/', 'FRIENDS15')).toBe(
      'https://solvane.example/discount/FRIENDS15?redirect=%2F',
    );
  });
});
