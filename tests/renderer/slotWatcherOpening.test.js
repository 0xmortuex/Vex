// @vitest-environment jsdom
//
// T3-092, the missing parts: the opening-time countdown and the minute-before notice / pre-open.
// The watcher still polls public pages only and never clicks, fills or books.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { VexSlotWatcher: SW } = require('../../src/renderer/js/slot-watcher.js');

const at = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
let watches, created, ledger, notified;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  created = []; notified = [];
  watches = [{ id: 'w1', url: 'https://randevu.example/slots', title: 'Passport', source: 'slot-watcher' }];
  globalThis.PageWatch = { list: () => watches, add: vi.fn((o) => { const w = { id: 'w' + (watches.length + 1), ...o }; watches.push(w); return w; }), remove: vi.fn(), setPaused: vi.fn() };
  globalThis.TabManager = { createTab: vi.fn((u) => { created.push(u); return 77; }) };
  ledger = { record: vi.fn() };
  globalThis.VexLedger = ledger;
  globalThis.VexAttention = { request: vi.fn(), osNotify: vi.fn(async (o) => { notified.push(o); }) };
  window.showToast = vi.fn();
});

describe('opening times', () => {
  it('are checked: daily and weekly need a time, weekly a day, one-off a future moment', () => {
    expect(SW.cleanOpens(null)).toBeNull();
    expect(SW.cleanOpens({ kind: 'none' })).toBeNull();
    expect(SW.cleanOpens({ kind: 'daily', time: '9:05' })).toEqual({ kind: 'daily', time: '09:05' });
    expect(SW.cleanOpens({ kind: 'weekly', time: '09:00', dow: 1 })).toEqual({ kind: 'weekly', time: '09:00', dow: 1 });
    expect(() => SW.cleanOpens({ kind: 'daily', time: '25:00' })).toThrow(/not a time of day/);
    expect(() => SW.cleanOpens({ kind: 'weekly', time: '09:00', dow: 9 })).toThrow(/day of the week/);
    expect(() => SW.cleanOpens({ kind: 'once', at: Date.now() - 1000 })).toThrow(/future/);
    expect(() => SW.cleanOpens({ kind: 'monthly', time: '09:00' })).toThrow(/every day, every week or one time/);
  });

  it('give the next moment on the clock of this PC', () => {
    const now = at(2026, 10, 14, 8, 0);                                      // a Wednesday, 08:00
    expect(SW.nextOpening({ kind: 'daily', time: '09:00' }, now)).toBe(at(2026, 10, 14, 9, 0));
    expect(SW.nextOpening({ kind: 'daily', time: '07:00' }, now)).toBe(at(2026, 10, 15, 7, 0));
    expect(SW.nextOpening({ kind: 'weekly', time: '09:00', dow: 1 }, now)).toBe(at(2026, 10, 19, 9, 0));   // next Monday
    expect(SW.nextOpening({ kind: 'weekly', time: '09:00', dow: 3 }, now)).toBe(at(2026, 10, 14, 9, 0));   // today
    expect(SW.nextOpening({ kind: 'once', at: now + 5000 }, now)).toBe(now + 5000);
    expect(SW.nextOpening({ kind: 'once', at: now - 600000 }, now)).toBeNull();
    expect(SW.nextOpening(null, now)).toBeNull();
    // a minute late still counts as this opening
    expect(SW.nextOpening({ kind: 'daily', time: '09:00' }, at(2026, 10, 14, 9, 1))).toBe(at(2026, 10, 14, 9, 0));
  });

  it('say how long is left', () => {
    const now = at(2026, 10, 14, 8, 0);
    const e = { opens: { kind: 'daily', time: '11:12' } };
    expect(SW.countdownLine(e, now)).toMatch(/^Opens in 3 h 12 min/);
    expect(SW.countdownLine({ opens: { kind: 'daily', time: '08:00' } }, now)).toBe('Opening now');
    expect(SW.countdownLine({ opens: { kind: 'once', at: now - 9e6 } }, now)).toMatch(/has passed/);
    expect(SW.countdownLine({}, now)).toBe('');
  });
});

describe('saving a page with an opening time', () => {
  beforeEach(() => { SW.setEnabled(true); });
  it('keeps the opening and the pre-open choice with the page, and refuses a bad time', () => {
    const w = SW.add({ label: 'Office', url: 'https://x.example/book', available: 'available', opens: { kind: 'daily', time: '09:00' }, preOpen: true });
    const e = SW.state().pages[w.id];
    expect(e.opens).toEqual({ kind: 'daily', time: '09:00' });
    expect(e.preOpen).toBe(true);
    expect(() => SW.add({ label: 'B', url: 'https://x.example/c', available: 'available', opens: { kind: 'daily', time: 'soon' } })).toThrow(/not a time of day/);
    const w2 = SW.add({ label: 'C', url: 'https://x.example/d', available: 'available', preOpen: true });
    expect(SW.state().pages[w2.id].opens).toBeNull();
    expect(SW.state().pages[w2.id].preOpen).toBe(false);          // nothing to open before
  });
});

describe('a minute before the opening', () => {
  const OPEN = at(2026, 10, 14, 9, 0);
  function setPage(extra = {}) {
    SW.setEnabled(true);
    const st = SW.state();
    st.pages.w1 = { label: 'Passport', available: ['müsait'], none: [], opens: { kind: 'daily', time: '09:00' }, preOpen: false, ...extra };
    SW._save(st);
  }

  it('does nothing before the minute, and tells once inside it', () => {
    setPage();
    expect(SW.tick(OPEN - 5 * 60000)).toEqual([]);
    expect(SW.tick(OPEN - 50000)).toEqual(['w1']);
    expect(window.showToast.mock.calls[0][0]).toBe('Passport: slots open in about a minute');
    expect(notified[0].title).toBe('Vex: Passport: slots open in about a minute');
    expect(SW.tick(OPEN - 20000)).toEqual([]);                    // once for this opening
    expect(created).toEqual([]);                                  // the page is not opened unless asked
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('tells again for the next day', () => {
    setPage();
    SW.tick(OPEN - 30000);
    expect(SW.tick(OPEN + 86400000 - 30000)).toEqual(['w1']);
  });

  it('says "open now" when the minute was missed by a little, and not at all when it was missed by a lot', () => {
    setPage();
    expect(SW.tick(OPEN + 30000)).toEqual(['w1']);
    expect(window.showToast.mock.calls[0][0]).toBe('Passport: slots open now');
    setPage({ preFor: 0 });
    window.showToast.mockClear();
    expect(SW.tick(OPEN + 10 * 60000)).toEqual([]);
  });

  it('opens the page in a tab only when asked, records it, and gives an Undo that closes that tab', () => {
    setPage({ preOpen: true });
    SW.tick(OPEN - 40000);
    expect(created).toEqual(['https://randevu.example/slots']);
    expect(ledger.record).toHaveBeenCalledWith(expect.objectContaining({ feature: 'slot-watcher', undo: { kind: 'slot-preopen-close', tabId: 77 } }));
    expect(ledger.record.mock.calls[0][0].why).toMatch(/Nothing was clicked, filled or booked/);
  });

  it('is silent when switched off, and loud when the watched page has gone', () => {
    setPage();
    SW.setEnabled(false);
    expect(SW.tick(OPEN - 30000)).toEqual([]);
    SW.setEnabled(true);
    watches.length = 0;
    expect(() => SW.tick(OPEN - 30000)).toThrow(/is gone/);
  });

  it('runs on a background job and registers the Undo', () => {
    const jobs = []; const undos = {};
    globalThis.VexJobs = { every: vi.fn((n, ms, fn, o) => jobs.push({ n, ms, o })) };
    globalThis.VexLedger = { record: vi.fn(), registerUndo: (k, fn) => { undos[k] = fn; } };
    SW._wired = false;
    expect(SW.init()).toBe(true);
    expect(jobs[0]).toMatchObject({ n: 'Slot opening countdown', ms: 30000, o: { when: 'background', feature: 'slot-watcher' } });
    globalThis.TabManager.closeTab = vi.fn();
    return undos['slot-preopen-close']({ tabId: 77 }).then((m) => { expect(TabManager.closeTab).toHaveBeenCalledWith(77); expect(m).toMatch(/Closed/); });
  });

  it('never refreshes, clicks, fills or books: the file has no such call', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/js/slot-watcher.js'), 'utf8');
    expect(src).not.toMatch(/executeJavaScript|vexGuestEval|sendInputEvent|\.click\(\)|\bfetch\(|\.reload\(/);
  });
});
