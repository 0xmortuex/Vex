// T3-046: the reset timers on a page of their own in the second-screen window (main/second-screen.js).
import { describe, it, expect, vi } from 'vitest';

const vm = require('vm');
const ss = require('../../src/main/second-screen.js');

const d1 = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const d2 = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };

function makeWindow() {
  const loaded = [];
  class Win {
    constructor(o) { this.o = o; this.webContents = { setWindowOpenHandler() {}, on() {}, setZoomFactor() {} }; }
    isDestroyed() { return false; } setTitle(t) { this.title = t; } loadURL(u) { loaded.push(u); return Promise.resolve(); } on() {} getBounds() { return {}; } isMinimized() { return false; } destroy() {}
  }
  const session = { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {} }) };
  const screen = { getAllDisplays: () => [d1, d2], getPrimaryDisplay: () => d1, getDisplayMatching: () => d2 };
  return { loaded, w: ss.createSecondScreen({ BrowserWindow: Win, screen, session, readState: () => ({}), writeState() {}, isGameRunning: () => false }) };
}

describe('cleanTimers', () => {
  it('keeps name, next moment and period, and refuses the rest', () => {
    expect(ss.cleanTimers(undefined)).toEqual([]);
    expect(ss.cleanTimers([{ name: ' Daily reset ', at: 5, every: 86400000, extra: 'x' }])).toEqual([{ name: 'Daily reset', at: 5, every: 86400000 }]);
    expect(() => ss.cleanTimers('x')).toThrow(/list/);
    expect(() => ss.cleanTimers([{ name: '', at: 5, every: 0 }])).toThrow(/no name/);
    expect(() => ss.cleanTimers([{ name: 'a', at: NaN, every: 0 }])).toThrow(/no moment/);
    expect(() => ss.cleanTimers([{ name: 'a', at: 5, every: 1000 }])).toThrow(/repeats/);
    expect(() => ss.cleanTimers(Array.from({ length: 25 }, () => ({ name: 'a', at: 5, every: 0 })))).toThrow(/up to 24/);
  });
});

describe('the timers page', () => {
  it('puts a name in as data, never as markup, and allows no other load', () => {
    const html = ss.timersHtml([{ name: '</script><img src=x onerror=alert(1)>', at: 1, every: 0 }]);
    expect(html).not.toContain('</script><img');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<(img|iframe|link|object|embed)\b/i);
  });

  it('counts down in the window: a daily timer rolls forward, a one-off that is over says so', () => {
    const now = Date.UTC(2026, 9, 17, 12, 0, 0);
    const html = ss.timersHtml([
      { name: 'Daily', at: now - 3 * 86400000 + 3600000, every: 86400000 },   // next one is in 1 h
      { name: 'Season', at: now - 1000, every: 0 },                            // over
      { name: 'Weekly', at: now + 2 * 86400000, every: 604800000 },
    ]);
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    const rows = [];
    const el = () => ({ children: [], className: '', textContent: '', append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); } });
    const list = el();
    list.appendChild = (li) => { rows.push(li.children.map(c => c.textContent)); };
    const document = { getElementById: () => list, createElement: () => el() };
    vm.runInNewContext(script, { document, Date: class extends Date { static now() { return now; } }, setInterval: () => 0, Math });
    expect(rows).toEqual([['Daily', '1 h 0 min'], ['Weekly', '2 d 0 h'], ['Season', 'has passed']]);
  });
});

describe('the window', () => {
  it('opens a timers page after the guide pages, loaded from data of its own, never from a network address', () => {
    const { w, loaded } = makeWindow();
    const st = w.open({ pages: [{ title: 'g', url: 'https://x.test' }], timers: [{ name: 'Daily', at: 9, every: 86400000 }] });
    expect(st.count).toBe(2);
    expect(loaded[0]).toBe('https://x.test/');
    w.act('next');
    expect(loaded[1]).toMatch(/^data:text\/html;charset=utf-8,/);
    expect(w.state().title).toContain('Reset timers (2/2)');
  });

  it('opens on timers alone when there is no guide page, and refuses when there is nothing at all', () => {
    const { w, loaded } = makeWindow();
    expect(w.open({ pages: [], timers: [{ name: 'Daily', at: 9, every: 0 }] }).count).toBe(1);
    expect(loaded[0]).toMatch(/^data:text\/html/);
    expect(() => makeWindow().w.open({ pages: [] })).toThrow(/no page to show/);
    expect(() => makeWindow().w.open({ pages: [{ url: 'file:///c:/x' }] })).toThrow(/Only http and https/);
  });
});

describe('the renderer side', () => {
  it('lists the next moment of each timer and its period, and sends them only when switched on', () => {
    vi.resetModules();
    globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
    const { VexGameTimers } = require('../../src/renderer/js/game-timers.js');
    const now = Date.UTC(2026, 9, 17, 12, 0, 0);
    const store = {};
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    VexGameTimers.add({ name: 'Daily reset', kind: 'daily', time: '18:00', tz: 'utc' });
    VexGameTimers.add({ name: 'Weekly', kind: 'weekly', dow: 2, time: '00:00', tz: 'utc' });
    VexGameTimers.add({ name: 'Old', kind: 'once', tz: 'utc', at: now - 1000 });
    const list = VexGameTimers.secondScreenTimers(now);
    expect(list.map(t => [t.name, t.every])).toEqual([['Daily reset', 86400000], ['Weekly', 604800000]]);
    expect(list[0].at).toBe(Date.UTC(2026, 9, 17, 18, 0, 0));
    expect(VexGameTimers.onSecondScreen()).toBe(false);
    VexGameTimers.setSecondScreen(true);
    expect(VexGameTimers.onSecondScreen()).toBe(true);
  });
});

describe('the request is checked before main sees it', () => {
  const { validatePayload } = require('../../src/main/ipc-policy.js');
  const ok = (arg) => { try { validatePayload('secondscreen:open', [arg]); return true; } catch { return false; } };
  it('accepts timers alone or with pages, and refuses a bad timer or an empty request', () => {
    const t = { name: 'Daily', at: 9, every: 86400000 };
    expect(ok({ pages: [], timers: [t] })).toBe(true);
    expect(ok({ pages: [{ url: 'https://x.test' }], timers: [t] })).toBe(true);
    expect(ok({ pages: [] })).toBe(false);
    expect(ok({ pages: [], timers: [] })).toBe(false);
    expect(ok({ pages: [], timers: [{ ...t, every: 5 }] })).toBe(false);
    expect(ok({ pages: [], timers: [{ ...t, name: 'x'.repeat(61) }] })).toBe(false);
  });
});
