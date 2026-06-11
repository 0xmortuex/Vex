import { describe, it, expect } from 'vitest';
import { _similarity } from '../../src/renderer/js/tab-grouper.js';

describe('_similarity', () => {
  describe('null and empty inputs', () => {
    it('returns 0 when first arg is null', () => {
      expect(_similarity(null, 'foo bar')).toBe(0);
    });

    it('returns 0 when second arg is null', () => {
      expect(_similarity('foo bar', null)).toBe(0);
    });

    it('returns 0 when both are null', () => {
      expect(_similarity(null, null)).toBe(0);
    });

    it('returns 0 when both are undefined', () => {
      expect(_similarity(undefined, undefined)).toBe(0);
    });

    it('returns 0 for empty strings (no tokens after split)', () => {
      expect(_similarity('', 'foo bar')).toBe(0);
      expect(_similarity('foo bar', '')).toBe(0);
      expect(_similarity('', '')).toBe(0);
    });

    it('returns 0 for whitespace-only strings (filter drops empty tokens)', () => {
      expect(_similarity('   ', 'foo')).toBe(0);
      expect(_similarity('foo', '\t\n ')).toBe(0);
    });

    it('does not produce NaN for any null/empty combination', () => {
      const cases = [
        [null, null], [undefined, undefined], ['', ''],
        [null, ''], ['', null], [null, '   '], ['   ', ''],
      ];
      for (const [a, b] of cases) {
        expect(Number.isNaN(_similarity(a, b))).toBe(false);
      }
    });
  });

  describe('identical and disjoint strings', () => {
    it('returns 1 for identical multi-token strings', () => {
      expect(_similarity('foo bar baz', 'foo bar baz')).toBe(1);
    });

    it('returns 1 for a single-token string compared with itself', () => {
      expect(_similarity('alpha', 'alpha')).toBe(1);
    });

    it('returns 0 for fully disjoint token sets', () => {
      expect(_similarity('foo bar', 'baz qux')).toBe(0);
    });
  });

  describe('case insensitivity', () => {
    it('treats "Foo Bar" and "foo BAR" as identical', () => {
      expect(_similarity('Foo Bar', 'foo BAR')).toBe(1);
    });

    it('case-insensitive partial overlap behaves correctly', () => {
      // {foo, bar} vs {FOO, baz} → inter=1, union=3 → 1/3
      expect(_similarity('foo bar', 'FOO baz')).toBeCloseTo(1 / 3, 10);
    });
  });

  describe('partial overlap (Jaccard math)', () => {
    it('half-overlap: {a,b} ∩ {b,c} = 1, ∪ = 3 → 1/3', () => {
      expect(_similarity('a b', 'b c')).toBeCloseTo(1 / 3, 10);
    });

    it('two-of-three overlap: {a,b,c} ∩ {b,c,d} = 2, ∪ = 4 → 0.5', () => {
      expect(_similarity('a b c', 'b c d')).toBe(0.5);
    });

    it('superset: {a,b,c} ∩ {a,b} = 2, ∪ = 3 → 2/3', () => {
      expect(_similarity('a b c', 'a b')).toBeCloseTo(2 / 3, 10);
    });
  });

  describe('tokenization details', () => {
    it('collapses repeated tokens (Set dedup): "a a b" ≈ "a b"', () => {
      // Both reduce to {a,b}; identical sets → 1
      expect(_similarity('a a b', 'a b')).toBe(1);
    });

    it('splits on any whitespace run, not just single spaces', () => {
      expect(_similarity('a   b\tc', 'a b c')).toBe(1);
    });

    it('coerces non-string inputs via String() (numbers token-split)', () => {
      // String(123) → "123", whitespace split → {"123"}; ditto for other side
      expect(_similarity(123, 123)).toBe(1);
    });
  });

  describe('return-value bounds', () => {
    it('result is always between 0 and 1 inclusive', () => {
      const samples = [
        ['', ''], ['a', 'a'], ['a b', 'c d'],
        ['a b c', 'b c'], ['Foo BAR baz', 'foo bar'],
        ['the quick brown fox', 'the lazy dog'],
      ];
      for (const [a, b] of samples) {
        const v = _similarity(a, b);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });
  });
});
