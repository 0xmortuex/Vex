// @vitest-environment jsdom
//
// js/sleep-timer.js: stop playing after N minutes or when the video ends; a fade over the last 15 s; pauses every
// playing element in every awake tab and panel; never wakes a sleeping tab, never plays; ends when cancelled.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { VexSleepTimer: T } = require('../../src/renderer/js/sleep-timer.js');
const { VexMediaControl } = require('../../src/renderer/js/media-control.js');

// A fake page: a few <video> elements whose state the real scripts act on, run with the real script text.
function page(videos) {
  const doc = {
    querySelectorAll: () => videos,
  };
  const run = (code) => new Function('document', 'window', 'return ' + code)(doc, {});
  return { videos, run };
}
const vid = (o = {}) => ({ paused: false, volume: 1, duration: 100, currentTime: 5, pause() { this.paused = true; }, play: vi.fn(), ...o });

let pages, evals, t0;
function install(tabs, extra = {}) {
  pages = new Map();
  evals = [];
  const webviews = new Map();
  for (const t of tabs) {
    if (t.sleeping) continue;
    const p = page(t.videos || []);
    pages.set(t.id, p);
    webviews.set(t.id, { id: t.id, setAudioMuted: vi.fn(), isCurrentlyAudible: () => false });
  }
  globalThis.TabManager = { tabs: tabs.map(({ videos, ...t }) => t), activeTabId: tabs[0].id, getActiveTab() { return this.tabs[0]; }, renderTabUpdate: vi.fn(), wakeTab: vi.fn() };
  globalThis.WebviewManager = { webviews };
  window.VexMediaControl = VexMediaControl;
  window.vexGuestEvalFrames = vi.fn(async (wv, code) => {
    evals.push({ id: wv.id, code });
    const p = pages.get(wv.id);
    return { all: true, results: [{ ok: true, value: p.run(code) }] };
  });
  window.showToast = vi.fn();
  Object.assign(T, extra);
}

beforeEach(() => {
  vi.useFakeTimers();
  t0 = Date.now();
  localStorage.clear();
  T._s = null; T._iv = null; T._faded = new Set(); T._busy = false; T.lastEnd = null;
  document.body.innerHTML = '';
});
afterEach(() => { T._stop(); vi.useRealTimers(); delete globalThis.TabManager; delete globalThis.WebviewManager; });

describe('the pure parts', () => {
  it('fades from 1 to 0 over the last 15 seconds and never leaves 0..1', () => {
    expect(T.fadeFactor(60000)).toBe(1);
    expect(T.fadeFactor(15000)).toBe(1);
    expect(T.fadeFactor(7500)).toBeCloseTo(0.25, 5);
    expect(T.fadeFactor(0)).toBe(0);
    expect(T.fadeFactor(-5)).toBe(0);
    let last = 1;
    for (let ms = 15000; ms >= 0; ms -= 500) { const f = T.fadeFactor(ms); expect(f).toBeLessThanOrEqual(last); last = f; }
    expect(() => T.fadeFactor(NaN)).toThrow();
  });
  it('formats the time left', () => {
    expect(T.format(0)).toBe('0:00');
    expect(T.format(61000)).toBe('1:01');
    expect(T.format(59001)).toBe('1:00');
    expect(T.format(3600000 + 5000)).toBe('1:00:05');
  });
  it('accepts 1 minute to 24 hours and nothing else', () => {
    expect(T.parseMinutes(15)).toBe(15);
    expect(T.parseMinutes('90')).toBe(90);
    for (const bad of [0, -3, 1441, NaN, 'abc', null]) expect(() => T.parseMinutes(bad)).toThrow(/between 1 minute and 24 hours/);
  });
  it('says what it did in whole sentences', () => {
    expect(T.endMessage(0, false)).toBe('Sleep timer: nothing was playing');
    expect(T.endMessage(1, false)).toBe('Sleep timer: paused 1 player');
    expect(T.endMessage(3, true)).toBe('Sleep timer: paused 3 players and muted the tabs');
  });
  it('the page scripts never call play()', () => {
    for (const s of [T.fadeScript(0.5), T.restoreScript(), T.endWatchScript(), T.endPollScript(), T.endUnwatchScript()]) expect(s).not.toMatch(/\.play\s*\(/);
  });
});

describe('counting down', () => {
  it('does nothing until it is started, and starting shows the time left', async () => {
    const v = vid();
    install([{ id: 1, title: 'A', audible: true, videos: [v] }]);
    vi.advanceTimersByTime(120000);
    expect(v.paused).toBe(false);
    expect(T.active()).toBe(false);
    await T.start({ minutes: 30 });
    expect(T.active()).toBe(true);
    expect(T.describe()).toBe('Sleep timer: 30:00 left');
    await vi.advanceTimersByTimeAsync(60000);
    expect(T.describe()).toBe('Sleep timer: 29:00 left');
    expect(v.paused).toBe(false);
  });

  it('at the end pauses every playing player in every awake tab, puts the volume back and stops ticking', async () => {
    const a = vid(), b = vid({ paused: true }), c = vid(), d = vid();
    install([
      { id: 1, title: 'A', audible: true, videos: [a, b] },
      { id: 2, title: 'B', audible: false, videos: [c] },       // playing but not audible (muted): still paused
      { id: 3, title: 'C', sleeping: true, videos: [d] },        // asleep: no page at all
    ]);
    await T.start({ minutes: 1 });
    await vi.advanceTimersByTimeAsync(61000);
    expect(a.paused && c.paused).toBe(true);
    expect(b.paused).toBe(true);
    expect(a.volume).toBe(1);                      // the fade is undone after the pause
    expect(c.volume).toBe(1);
    expect(d.paused).toBe(false);                  // the sleeping tab's page was never reached
    expect(TabManager.wakeTab).not.toHaveBeenCalled();
    expect(evals.some(e => e.id === 3)).toBe(false);
    expect(T.active()).toBe(false);
    expect(T.lastEnd.paused).toBe(2);
    expect(window.showToast).toHaveBeenLastCalledWith('Sleep timer: paused 2 players', 'info');
    const n = evals.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(evals.length).toBe(n);                  // nothing keeps running after it ended
    for (const e of evals) expect(e.code).not.toMatch(/\.play\s*\(/);
  });

  it('turns the sound down step by step in the last 15 seconds, and only before that never', async () => {
    const a = vid();
    install([{ id: 1, title: 'A', audible: true, videos: [a] }]);
    await T.start({ minutes: 1 });
    await vi.advanceTimersByTimeAsync(44000);      // 16 s left
    expect(a.volume).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);       // 14 s left
    expect(a.volume).toBeLessThan(1);
    const v14 = a.volume;
    await vi.advanceTimersByTimeAsync(5000);       // 9 s left
    expect(a.volume).toBeLessThan(v14);
    await vi.advanceTimersByTimeAsync(5000);       // 4 s left
    expect(a.volume).toBeLessThan(0.1);
  });

  it('cancelling during the fade puts the volume back and nothing is paused', async () => {
    const a = vid({ volume: 0.8 });
    install([{ id: 1, title: 'A', audible: true, videos: [a] }]);
    await T.start({ minutes: 1 });
    await vi.advanceTimersByTimeAsync(50000);
    expect(a.volume).toBeLessThan(0.8);
    await T.cancel();
    expect(a.volume).toBe(0.8);
    expect(a.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(a.paused).toBe(false);
    expect(T.active()).toBe(false);
  });

  it('adding time extends the end and ends the fade', async () => {
    const a = vid();
    install([{ id: 1, title: 'A', audible: true, videos: [a] }]);
    await T.start({ minutes: 1 });
    await vi.advanceTimersByTimeAsync(50000);
    expect(a.volume).toBeLessThan(1);
    T.extend(15);
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.volume).toBe(1);
    expect(T.remainingMs()).toBeGreaterThan(14 * 60000);
    await vi.advanceTimersByTimeAsync(20000);
    expect(a.paused).toBe(false);
  });

  it('refuses to extend when there is no timer', () => {
    install([{ id: 1, title: 'A', videos: [] }]);
    expect(() => T.extend(15)).toThrow(/no sleep timer/);
  });

  it('starting a second one replaces the first', async () => {
    install([{ id: 1, title: 'A', audible: true, videos: [vid()] }]);
    await T.start({ minutes: 15 });
    await T.start({ minutes: 90 });
    expect(T.remainingMs()).toBe(90 * 60000);
  });

  it('can also mute the tabs when it stops, only when asked', async () => {
    const a = vid();
    install([{ id: 1, title: 'A', audible: true, videos: [a] }]);
    T.setMuteAtEnd(true);
    await T.start({ minutes: 1 });
    await vi.advanceTimersByTimeAsync(61000);
    expect(WebviewManager.webviews.get(1).setAudioMuted).toHaveBeenCalledWith(true);
    expect(TabManager.tabs[0].muted).toBe(true);
    T.setMuteAtEnd(false);
    install([{ id: 1, title: 'A', audible: true, videos: [vid()] }]);
    await T.start({ minutes: 1 });
    await vi.advanceTimersByTimeAsync(61000);
    expect(WebviewManager.webviews.get(1).setAudioMuted).not.toHaveBeenCalled();
  });

  it('a tab that wakes up during the countdown is simply a tab with a page: the timer never calls wakeTab', async () => {
    install([{ id: 1, title: 'A', audible: true, videos: [vid()] }, { id: 2, title: 'B', sleeping: true }]);
    await T.start({ minutes: 1 });
    await vi.advanceTimersByTimeAsync(61000);
    expect(TabManager.wakeTab).not.toHaveBeenCalled();
  });
});

describe('when this video ends', () => {
  it('watches the front tab and stops everything when its player ends', async () => {
    const a = vid(), other = vid();
    install([{ id: 1, title: 'A', audible: true, videos: [a] }, { id: 2, title: 'B', audible: true, videos: [other] }]);
    // The page script is real: give the fake document the pieces it uses.
    const listeners = {};
    a.addEventListener = (n, f) => { listeners[n] = f; };
    a.removeEventListener = () => {};
    pages.get(1).run = (code) => {
      const win = {};
      const doc = { querySelectorAll: () => [a] };
      return new Function('document', 'window', 'return ' + code)(doc, globalThis.__win || (globalThis.__win = win));
    };
    pages.get(2).run = (code) => new Function('document', 'window', 'return ' + code)({ querySelectorAll: () => [other] }, {});
    globalThis.__win = {};
    await T.start({ untilEnd: true });
    expect(T.describe()).toBe('Sleep timer: stops when this video ends');
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.paused).toBe(false);
    listeners.ended();                              // the player reaches its end
    expect(globalThis.__win.__vexSleepEnded).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(a.paused).toBe(true);
    expect(other.paused).toBe(true);                // the other tab is stopped too
    expect(T.active()).toBe(false);
    delete globalThis.__win;
  });

  it('refuses cleanly when the tab has no player', async () => {
    install([{ id: 1, title: 'A', videos: [] }]);
    await expect(T.start({ untilEnd: true })).rejects.toThrow('This tab has no video or sound to wait for');
    expect(T.active()).toBe(false);
  });

  it('is cancelled if the watched tab is closed', async () => {
    const a = vid();
    install([{ id: 1, title: 'A', audible: true, videos: [a] }]);
    a.addEventListener = () => {}; a.removeEventListener = () => {};
    pages.get(1).run = (code) => new Function('document', 'window', 'return ' + code)({ querySelectorAll: () => [a] }, globalThis.__w2 || (globalThis.__w2 = {}));
    await T.start({ untilEnd: true });
    WebviewManager.webviews.delete(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(T.active()).toBe(false);
    delete globalThis.__w2;
  });
});

describe('showing the time left', () => {
  it('has a chip for the Now Playing card with the time, +15 and Cancel, only while a timer runs', async () => {
    install([{ id: 1, title: 'A', audible: true, videos: [vid()] }]);
    expect(T.chip()).toBe(null);
    await T.start({ minutes: 10 });
    const chip = T.chip();
    document.body.appendChild(chip);
    expect(chip.textContent).toContain('Sleep timer: 10:00 left');
    const buttons = [...chip.querySelectorAll('button')].map(b => b.textContent);
    expect(buttons).toEqual(['+15 min', 'Cancel']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(chip.textContent).toContain('9:59 left');
    chip.querySelectorAll('button')[1].click();
    await vi.advanceTimersByTimeAsync(10);
    expect(T.active()).toBe(false);
  });

  it('the Now Playing card draws the chip and the Ctrl+K command shows the time', async () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/tab-ai-media.js'), 'utf8');
    expect(src).toContain('VexSleepTimer.active() ? window.VexSleepTimer.chip()');
    const cmd = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/command.js'), 'utf8');
    expect(cmd).toMatch(/id: 'sleep-timer', get label\(\)/);
    const lazy = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/renderer/js/lazy-boot.js'), 'utf8');
    expect(lazy).toContain("js/sleep-timer.js");
  });
});
