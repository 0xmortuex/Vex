// @vitest-environment jsdom
// Audit (2026-10): the second alternative of prices() was O(n^2) on a long run of
// digits (MAX_TEXT is 60000), so one hostile listing could freeze the page.
import { describe, it, expect } from 'vitest';
import { machineFactor, ceiling } from '../helpers/machineSpeed.js';

const M = require('../../src/renderer/js/marketplace-signs.js').VexMarketplaceSigns;

describe('marketplace signs: price reading stays linear', () => {
  it('a 60000-digit run finishes in well under 100 ms', () => {
    const text = '1'.repeat(M.MAX_TEXT);
    const before = machineFactor();   // a loaded CI runner is several times slower than a PC: the 100 ms ceiling scales with it (the quadratic bug took seconds)
    const t0 = performance.now();
    const found = M.prices(text);
    const ms = performance.now() - t0;
    expect(found).toEqual([]);
    expect(ms).toBeLessThan(ceiling(100, before));
  });

  it('the same run through analyze() is just as quick', () => {
    const before = machineFactor();
    const t0 = performance.now();
    M.analyze('9'.repeat(M.MAX_TEXT + 500));
    expect(performance.now() - t0).toBeLessThan(ceiling(100, before));
  });

  it('still reads ordinary prices on either side of the symbol', () => {
    expect(M.prices('Now 1.250,50 TL and $19.99 or 12,5 €').map(p => p.n)).toEqual([1250.5, 19.99, 12.5]);
  });
});
