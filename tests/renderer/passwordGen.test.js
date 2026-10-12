// js/password-gen.js — the one password generator in Vex.
import { afterEach, describe, expect, it, vi } from 'vitest';
import G from '../../src/renderer/js/password-gen.js';

afterEach(() => { vi.restoreAllMocks(); });

// Feeds getRandomValues a fixed sequence of 32-bit values.
function scriptedRandom(values) {
  const queue = values.slice();
  return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (!queue.length) throw new Error('scripted random ran out');
      arr[i] = queue.shift();
    }
    return arr;
  });
}

describe('randomBelow: no modulo bias', () => {
  it('throws a draw from the uneven tail away and draws again', () => {
    // n = 3: 2^32 = 3 * 1431655765 + 1, so the limit is 4294967295 and only
    // 4294967295 itself is rejected. Plain `x % 3` would have returned 0 for it.
    const spy = scriptedRandom([4294967295, 7]);
    expect(G.randomBelow(3)).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('keeps a draw below the limit', () => {
    scriptedRandom([5]);
    expect(G.randomBelow(3)).toBe(2);
  });

  it('is uniform over many draws', () => {
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 70000; i++) counts[G.randomBelow(7)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(600);
  });

  it('refuses a nonsense range', () => {
    expect(() => G.randomBelow(0)).toThrow();
    expect(() => G.randomBelow(1.5)).toThrow();
  });

  it('refuses to run without a secure random source (no Math.random fallback)', () => {
    vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue(undefined);
    expect(() => G.randomBelow(10)).toThrow(/secure random/);
  });
});

describe('generate', () => {
  it('makes the asked length and has every chosen kind of character', () => {
    for (let i = 0; i < 200; i++) {
      const { password } = G.generate({ length: 8 });
      expect(password).toHaveLength(8);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('uses only the chosen sets and leaves out lookalikes on request', () => {
    for (let i = 0; i < 100; i++) {
      expect(G.generate({ length: 30, upper: false, digits: false, symbols: false }).password).toMatch(/^[a-z]{30}$/);
      expect(G.generate({ length: 40, avoidAmbiguous: true }).password).not.toMatch(/[0O1lI|]/);
    }
  });

  it('clamps the length and refuses an impossible request', () => {
    expect(G.generate({ length: 2 }).password).toHaveLength(4);
    expect(G.generate({ length: 9999 }).password).toHaveLength(128);
    expect(() => G.generate({ lower: false, upper: false, digits: false, symbols: false })).toThrow(/at least one/);
  });

  it('reports the real entropy, counting only passwords that hold every kind', () => {
    // Brute force for a tiny case: classes "ab" and "1", length 3.
    // All strings over {a,b,1}: 27; those with no "1": 8; with no a/b: 1 → 18.
    expect(G.charEntropy(['ab', '1'], 3)).toBeCloseTo(Math.log2(18), 10);
    // One class: exactly length * log2(pool).
    expect(G.charEntropy(['abcdefghijklmnopqrstuvwxyz'], 10)).toBeCloseTo(10 * Math.log2(26), 10);
    const r = G.generate({ length: 20 });
    expect(r.bits).toBeGreaterThan(125);
    expect(r.bits).toBeLessThan(20 * Math.log2(85));
  });
});

describe('passphrase', () => {
  it('joins the asked number of distinct-list words', () => {
    expect(new Set(G.WORDS).size).toBe(G.WORDS.length);
    const r = G.passphrase({ words: 5, separator: '.' });
    const words = r.password.split('.');
    expect(words).toHaveLength(5);
    for (const w of words) expect(G.WORDS).toContain(w);
    expect(r.bits).toBeCloseTo(5 * Math.log2(G.WORDS.length), 10);
  });

  it('capitalises and adds a digit when asked, and counts the digit', () => {
    const r = G.passphrase({ words: 4, separator: ' ', capitalize: true, number: true });
    const parts = r.password.split(' ');
    expect(parts).toHaveLength(5);
    for (const w of parts.slice(0, 4)) expect(w).toMatch(/^[A-Z][a-z]+$/);
    expect(parts[4]).toMatch(/^[0-9]$/);
    expect(r.bits).toBeCloseTo(4 * Math.log2(G.WORDS.length) + Math.log2(10), 10);
  });

  it('ignores a separator it does not offer', () => {
    expect(G.passphrase({ words: 3, separator: '<b>' }).password.split('-')).toHaveLength(3);
  });
});

describe('strength', () => {
  it('rates by entropy', () => {
    expect(G.strength(30).label).toBe('Weak');
    expect(G.strength(60).label).toBe('Fair');
    expect(G.strength(80).label).toBe('Strong');
    expect(G.strength(128).label).toBe('Very strong');
    expect(G.strength(2000).offline).toBe('longer than the universe has existed');
    expect(G.strength(0).offline).toBe('instantly');
  });
});

describe('forField: the suggestion for a site', () => {
  it('is 20 characters of the symbols sites accept', () => {
    const r = G.forField({});
    expect(r.password).toHaveLength(20);
    const allowed = new RegExp('^[A-Za-z0-9' + G.SITE_SYMBOLS.replace(/[-\\\]^]/g, '\\$&') + ']+$');
    expect(r.password).toMatch(allowed);
  });

  it('fits the field’s maxlength and minlength', () => {
    expect(G.forField({ maxLength: 12 }).password).toHaveLength(12);
    expect(G.forField({ minLength: 32 }).password).toHaveLength(32);
  });

  it('offers nothing for a field too short to hold a strong password', () => {
    expect(G.forField({ maxLength: 6 })).toBeNull();
  });
});
