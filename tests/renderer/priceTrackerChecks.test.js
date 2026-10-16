// @vitest-environment jsdom
//
// T2-074: a price watch that never changed had ONE history point however many
// times it was checked (the history keeps changes only). Now every check is
// counted and a number/price watch keeps a short series of what it saw.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { PageWatch } = require('../../src/renderer/js/page-watch.js');

let price;
beforeEach(() => {
  localStorage.clear();
  price = '£1,299.99';
  globalThis.AgentTools = {
    readUrl: vi.fn(async () => ({ url: 'https://shop.example/item', title: 'An item', text: 'Price ' + price })),
    _get: vi.fn(async () => ({ ok: true, status: 200, body: '<html><body><span class="price">' + price + '</span></body></html>' })),
  };
  globalThis.VexProblems = { note: vi.fn() };
  window.showToast = vi.fn();
  window.vex = { notify: vi.fn() };
});

const H = 3600 * 1000;

describe('counting checks', () => {
  it('counts every check and keeps one sample per half hour while the value holds', () => {
    const w = { kind: 'number' };
    const t0 = 1e12;
    PageWatch.noteCheck(w, t0, 100);
    PageWatch.noteCheck(w, t0 + 5 * 60000, 100);
    PageWatch.noteCheck(w, t0 + 40 * 60000, 100);
    expect(w.checks).toBe(3);
    expect(w.samples).toEqual([{ at: t0, v: 100 }, { at: t0 + 40 * 60000, v: 100 }]);
  });
  it('a value that moved is sampled at once', () => {
    const w = { kind: 'number' };
    PageWatch.noteCheck(w, 1e12, 100);
    PageWatch.noteCheck(w, 1e12 + 60000, 90);
    expect(w.samples.map(s => s.v)).toEqual([100, 90]);
  });
  it('reads a price out of text for a pattern watch, ignores words, and is bounded', () => {
    const w = { kind: 'regex' };
    PageWatch.noteCheck(w, 1e12, '£1,299.99');
    PageWatch.noteCheck(w, 1e12 + H, 'sold out');
    expect(w.samples).toEqual([{ at: 1e12, v: 1299.99 }]);
    expect(w.checks).toBe(2);
    for (let i = 0; i < 100; i++) PageWatch.noteCheck(w, 2e12 + i * H, i);
    expect(w.samples.length).toBe(PageWatch.MAX_SAMPLES);
  });
  it('a text watch is counted but keeps no series', () => {
    const w = { kind: 'text' };
    PageWatch.noteCheck(w, 1e12, 'x');
    expect(w).toEqual({ kind: 'text', checks: 1 });
  });
});

describe('saying it honestly', () => {
  const now = 1e12;
  it('never changed', () => { expect(PageWatch.checkLine({ checks: 12 }, now)).toBe('12 checks, never changed'); });
  it('last change', () => {
    expect(PageWatch.checkLine({ checks: 1, lastChangedAt: now - 3 * 86400000 }, now)).toBe('1 check, last change 3 days ago');
    expect(PageWatch.checkLine({ checks: 2, lastChangedAt: now - 3600000 }, now)).toBe('2 checks, last change today');
  });
  it('a watch from before counting began is not called "never changed"', () => {
    expect(PageWatch.checkLine({ lastCheckedAt: 5 }, now)).toBe('checked before counting began');
    expect(PageWatch.checkLine({}, now)).toBe('not checked yet');
  });
});

describe('through the real check', () => {
  it('three checks of an unchanged price leave one history point but a count of three and a flat series', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/item', title: 'Item', kind: 'number', byUser: true, every: 15 * 60000 });
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) await PageWatch.checkOne(w.id, t0 + i * 40 * 60000);
    const saved = PageWatch.list().find(x => x.id === w.id);
    expect(saved.checks).toBe(3);
    expect(PageWatch.history(w.id)).toHaveLength(1);
    expect(PageWatch.samples(w.id).map(s => s.v)).toEqual([1299.99, 1299.99, 1299.99]);
    expect(PageWatch.checkLine(saved, t0)).toBe('3 checks, never changed');
  });
});
