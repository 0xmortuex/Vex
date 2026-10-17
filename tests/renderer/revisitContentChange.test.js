// @vitest-environment jsdom
//
// T3-025, Wave 5: a page that is opened often is suggested for watching only when it has looked
// different on at least two of the visits.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
const NOW = new Date(2026, 9, 16, 12, 0).getTime();
const HOUR = 3600 * 1000;
const URL1 = 'https://shop.example/item/9';

let R, suggest, notes, says;

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  suggest = vi.fn(() => true);
  notes = vi.fn();
  globalThis.VexAttention = { suggest };
  globalThis.VexProblems = { note: notes };
  globalThis.PageWatch = { list: () => [], isLocal: () => false, refusalFor: () => '', _steady: (t) => String(t).replace(/\b\d{1,2}:\d{2}\b/g, '').replace(/\s+/g, ' ').trim() };
  globalThis.TabManager = { tabs: [{ id: 't', title: 'Item', partition: null, url: URL1 }] };
  globalThis.WebviewManager = { webviews: new Map([['t', {}]]) };
  window.VexTabPolicy = { canRestore: () => true, canReadWebview: () => true };
  says = [];
  window.vexGuestEval = vi.fn(async () => says.shift());
  ({ VexRevisit: R } = fresh(JS + 'revisit-watch.js'));
  R.SETTLE_MS = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
});

const LONG = (s) => 'Price and stock of the item, ' + s + ', plus the usual long description of the page.';

async function visits(n, text) {
  for (let i = 0; i < n; i++) {
    vi.setSystemTime(NOW + i * HOUR);
    says.push(typeof text === 'function' ? text(i) : text);
    const r = R.onNavigated({ tabId: 't', url: URL1 });
    await r.settled;
  }
}

describe('only a page that changes is suggested', () => {
  it('suggests after five opens when the page looked different', async () => {
    await visits(5, (i) => LONG('price ' + (10 + i)));
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0].body).toMatch(/looked different on 5 of those visits/);
  });
  it('does not suggest a page that looked the same on every visit, and keeps asking on the next ones', async () => {
    await visits(5, LONG('always the same'));
    expect(suggest).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('vex.revisit'))['shop.example/item/9'].suggestedAt).toBe(0);
    says.push(LONG('now it changed'));
    vi.setSystemTime(NOW + 6 * HOUR);
    await R.onNavigated({ tabId: 't', url: URL1 }).settled;
    expect(suggest).toHaveBeenCalledTimes(1);
  });
  it('does not count a changing clock as a change', async () => {
    await visits(5, (i) => LONG('same') + ' updated at 1' + i + ':0' + i);
    expect(suggest).not.toHaveBeenCalled();
  });
  it('keeps only fingerprints, never the words, and at most six', async () => {
    await visits(8, (i) => LONG('price ' + i));
    const rec = JSON.parse(localStorage.getItem('vex.revisit'))['shop.example/item/9'];
    expect(rec.sigs.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(rec)).not.toContain('Price and stock');
    expect(rec.sigs[0].h).toMatch(/^[0-9a-f]+-\d+$/);
  });
  it('a reload inside twenty minutes is not a visit and reads nothing', async () => {
    vi.setSystemTime(NOW);
    says.push(LONG('a'));
    await R.onNavigated({ tabId: 't', url: URL1 }).settled;
    vi.setSystemTime(NOW + 60000);
    const r = R.onNavigated({ tabId: 't', url: URL1 });
    expect(r.settled).toBeUndefined();
    expect(window.vexGuestEval).toHaveBeenCalledTimes(1);
  });
});

describe('what cannot be read', () => {
  it('a page that cannot be read is not suggested, and the reason is noted', async () => {
    window.vexGuestEval = vi.fn(async () => { throw new Error('the page did not answer'); });
    for (let i = 0; i < 5; i++) { vi.setSystemTime(NOW + i * HOUR); await R.onNavigated({ tabId: 't', url: URL1 }).settled; }
    expect(suggest).not.toHaveBeenCalled();
    expect(notes).toHaveBeenCalled();
    expect(notes.mock.calls[0][1]).toMatch(/Could not read a page/);
  });
  it('a page with almost no words has no fingerprint', () => {
    expect(R.fingerprint('Hi')).toBe('');
    expect(R.fingerprint(LONG('x'))).not.toBe('');
  });
  it('a tab that is not read (private) is not read', async () => {
    window.VexTabPolicy.canReadWebview = () => false;
    for (let i = 0; i < 5; i++) { vi.setSystemTime(NOW + i * HOUR); await R.onNavigated({ tabId: 't', url: URL1 }).settled; }
    expect(window.vexGuestEval).not.toHaveBeenCalled();
    expect(suggest).not.toHaveBeenCalled();
  });
  it('a tab that moved on before the page settled is left alone', async () => {
    vi.setSystemTime(NOW);
    const r = R.onNavigated({ tabId: 't', url: URL1 });
    TabManager.tabs[0].url = 'https://other.example/page';
    expect(await r.settled).toBe(false);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
});
