import { describe, expect, it } from 'vitest';
import {
  AFFILIATE_CODE_PATTERN,
  buildShareUrl,
  hashVisitorToken,
  isValidAffiliateCode,
} from './attribution';

describe('attribution', () => {
  describe('AFFILIATE_CODE_PATTERN', () => {
    it.each([
      ['hello', true],
      ['acme-2026', true],
      ['a_b_c', true],
      ['ab', false], // too short
      ['a'.repeat(33), false], // too long
      ['Foo', false], // uppercase
      ['hi there', false], // space
      ['code!', false], // special char
    ])('matches %s → %s', (code, expected) => {
      expect(AFFILIATE_CODE_PATTERN.test(code)).toBe(expected);
    });
  });

  describe('isValidAffiliateCode', () => {
    it('narrows the type', () => {
      const maybe: string | null = 'foo-bar';
      if (isValidAffiliateCode(maybe)) {
        // TS now knows maybe is string
        expect(maybe.toUpperCase()).toBe('FOO-BAR');
      }
    });

    it('returns false for null/undefined', () => {
      expect(isValidAffiliateCode(null)).toBe(false);
      expect(isValidAffiliateCode(undefined)).toBe(false);
      expect(isValidAffiliateCode('')).toBe(false);
    });
  });

  describe('hashVisitorToken', () => {
    it('produces a 64-char hex string', async () => {
      const hash = await hashVisitorToken('11111111-2222-3333-4444-555555555555');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic', async () => {
      const a = await hashVisitorToken('abc');
      const b = await hashVisitorToken('abc');
      expect(a).toBe(b);
    });

    it('differs by input', async () => {
      const a = await hashVisitorToken('abc');
      const b = await hashVisitorToken('abd');
      expect(a).not.toBe(b);
    });
  });

  describe('buildShareUrl', () => {
    it('builds a default /r/{code} URL', () => {
      const url = buildShareUrl('https://proteinoutfitters.com', 'acme-2026');
      expect(url).toBe('https://proteinoutfitters.com/r/acme-2026');
    });

    it('appends ?to= when provided', () => {
      const url = buildShareUrl('https://proteinoutfitters.com', 'acme-2026', {
        to: '/p/2nd-ave-sausage-company',
      });
      expect(url).toBe(
        'https://proteinoutfitters.com/r/acme-2026?to=%2Fp%2F2nd-ave-sausage-company',
      );
    });
  });
});
