// @vitest-environment jsdom
//
// Session-timeout warning (js/session-timeout.js): the timer is a pure state machine with an injected clock, tested here
// with vitest's fake timers; the window's side (which tabs get a timer, what the keep-alive may do) is tested with stand-ins.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { VexSessionTimeout: V } = require('../../src/renderer/js/session-timeout.js');
const MIN = 60 * 1000;
const flushPromises = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
// Time passes a minute at a time with the promises settled in between, as it does in the window (a request answers in between).
const pass = async (ms) => { for (let left = ms; left > 0; left -= MIN) { vi.advanceTimersByTime(Math.min(MIN, left)); await flushPromises(); } };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

function make(over = {}) {
  const calls = { warn: [], expire: 0, recover: 0, keep: 0, stopped: [] };
  const timer = V.createTimer({
    timeoutMs: 20 * MIN,
    onWarn: (x) => calls.warn.push(x.leftMs),
    onExpire: () => { calls.expire++; },
    onRecover: () => { calls.recover++; },
    onKeepAlive: async () => { calls.keep++; return true; },
    onKeepAliveStopped: (why) => calls.stopped.push(why),
    ...over,
  });
  return { timer, calls };
}

describe('warn-only timer (the default)', () => {
  it('warns two minutes before the timeout and expires at it', () => {
    const { timer, calls } = make();
    vi.advanceTimersByTime(17 * MIN + 59 * 1000);
    expect(calls.warn).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(calls.warn).toEqual([2 * MIN]);
    expect(timer.phase()).toBe('warned');
    expect(timer.leftMs()).toBe(2 * MIN);
    vi.advanceTimersByTime(2 * MIN);
    expect(calls.expire).toBe(1);
    expect(timer.phase()).toBe('expired');
    // Once each: nothing more happens by itself.
    vi.advanceTimersByTime(60 * MIN);
    expect(calls.warn.length).toBe(1);
    expect(calls.expire).toBe(1);
    expect(calls.keep).toBe(0);
  });

  it('real activity starts the count again, and says so if it had warned', () => {
    const { timer, calls } = make();
    vi.advanceTimersByTime(10 * MIN);
    timer.activity();
    vi.advanceTimersByTime(17 * MIN);
    expect(calls.warn).toEqual([]);
    vi.advanceTimersByTime(1 * MIN);
    expect(calls.warn.length).toBe(1);
    timer.activity();
    expect(calls.recover).toBe(1);
    expect(timer.phase()).toBe('ok');
    vi.advanceTimersByTime(19 * MIN);
    expect(calls.expire).toBe(0);
    vi.advanceTimersByTime(1 * MIN);
    expect(calls.expire).toBe(1);
  });

  it('activity after the timeout brings it back to counting', () => {
    const { timer, calls } = make();
    vi.advanceTimersByTime(21 * MIN);
    expect(calls.expire).toBe(1);
    timer.activity();
    expect(timer.phase()).toBe('ok');
    vi.advanceTimersByTime(18 * MIN);
    expect(calls.warn.length).toBe(2);
  });

  it('a page load from the site counts as the site hearing from the tab', () => {
    const { timer, calls } = make();
    vi.advanceTimersByTime(15 * MIN);
    timer.contact();
    vi.advanceTimersByTime(17 * MIN);
    expect(calls.warn).toEqual([]);
    vi.advanceTimersByTime(MIN);
    expect(calls.warn.length).toBe(1);
  });

  it('a very short timeout warns half-way, not before it started', () => {
    const { calls } = make({ timeoutMs: 60 * 1000 });
    vi.advanceTimersByTime(29 * 1000);
    expect(calls.warn).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(calls.warn).toEqual([30 * 1000]);
  });

  it('stop() ends every timer', () => {
    const { timer, calls } = make();
    timer.stop();
    vi.advanceTimersByTime(60 * MIN);
    expect(calls.warn).toEqual([]);
    expect(calls.expire).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a timeout under a second', () => {
    expect(() => V.createTimer({ timeoutMs: 10, onWarn() {}, onExpire() {} })).toThrow(/at least a second/);
  });

  it('with the default clock it runs on real timers too', () => {
    const { timer } = make();
    expect(vi.getTimerCount()).toBe(1);
    timer.stop();
  });
});

describe('keep-alive (its own opt-in)', () => {
  it('asks every few minutes while the person is working, and the warning never comes', async () => {
    const { timer, calls } = make({ keepAlive: true });
    expect(V.keepEveryFor(20 * MIN)).toBe(9 * MIN);
    for (let i = 0; i < 3; i++) {
      timer.activity();
      vi.advanceTimersByTime(9 * MIN);
      await flushPromises();
    }
    expect(calls.keep).toBe(3);
    expect(calls.warn).toEqual([]);
    expect(timer.keepingAlive()).toBe(true);
  });

  it('keeps going while activity keeps coming in, however long the work lasts', async () => {
    const { timer, calls } = make({ keepAlive: true });
    for (let i = 0; i < 16; i++) { await pass(9 * MIN); if (i % 2) timer.activity(); }
    expect(calls.warn).toEqual([]);
    expect(calls.expire).toBe(0);
    expect(calls.keep).toBeGreaterThan(10);
  });

  it('stops after 30 minutes without real activity, says so, and then the warning runs as usual', async () => {
    const { timer, calls } = make({ keepAlive: true });
    await pass(30 * MIN);
    const sentBefore = calls.keep;
    expect(sentBefore).toBeGreaterThan(0);
    expect(calls.stopped).toEqual([]);
    await pass(10 * MIN);
    expect(calls.stopped).toEqual(['idle']);
    expect(timer.keepingAlive()).toBe(false);
    expect(calls.keep).toBe(sentBefore);   // not one more after the 30 minutes
    await pass(60 * MIN);
    expect(calls.keep).toBe(sentBefore);
    expect(calls.warn.length).toBe(1);
    expect(calls.expire).toBe(1);
    // The person comes back: it starts again.
    timer.activity();
    expect(timer.keepingAlive()).toBe(true);
    await pass(9 * MIN);
    expect(calls.keep).toBe(sentBefore + 1);
  });

  it('never sends a request when the last activity was 30 minutes ago or more', async () => {
    const sentAt = [];
    const start = Date.now();
    const { timer } = make({ keepAlive: true, onKeepAlive: async () => { sentAt.push(Date.now() - start); return true; } });
    await pass(3 * 60 * MIN);
    expect(sentAt.length).toBeGreaterThan(0);
    expect(Math.max(...sentAt)).toBeLessThan(30 * MIN);
    timer.stop();
  });

  it('stops for good when the site answers with a redirect (it has signed you out), and says so once', async () => {
    const { timer, calls } = make({ keepAlive: true, onKeepAlive: async () => false });
    vi.advanceTimersByTime(9 * MIN);
    await flushPromises();
    expect(calls.stopped).toEqual(['refused']);
    expect(timer.keepingAlive()).toBe(false);
    vi.advanceTimersByTime(2 * 60 * MIN);
    await flushPromises();
    expect(calls.stopped).toEqual(['refused']);
  });

  it('a request that throws also stops it, and the error is passed on', async () => {
    const seen = [];
    const { calls } = make({ keepAlive: true, onKeepAlive: async () => { throw new Error('tab gone'); }, onKeepAliveStopped: (why, err) => seen.push([why, err && err.message]) });
    vi.advanceTimersByTime(9 * MIN);
    await flushPromises();
    expect(seen).toEqual([['refused', 'tab gone']]);
    expect(calls.keep).toBe(0);
  });

  it('is off until switched on, and setKeepAlive(false) stops it', async () => {
    const { timer, calls } = make();
    vi.advanceTimersByTime(9 * MIN);
    await flushPromises();
    expect(calls.keep).toBe(0);
    timer.setKeepAlive(true);
    timer.activity();
    vi.advanceTimersByTime(9 * MIN);
    await flushPromises();
    expect(calls.keep).toBe(1);
    timer.setKeepAlive(false);
    timer.activity();
    vi.advanceTimersByTime(9 * MIN);
    await flushPromises();
    expect(calls.keep).toBe(1);
  });

  it('a short timeout still asks before the warning', () => {
    for (const t of [60, 90, 120, 180, 300]) {
      const timeout = t * 1000;
      expect(V.keepEveryFor(timeout)).toBeLessThan(timeout - V.warnMsFor(timeout));
    }
  });
});

describe('where it may run', () => {
  it('not in a private window, a Tor tab, the Tor route or a tab that keeps nothing', () => {
    expect(V.keepAliveAllowed({ partition: 'persist:main', privateWindow: false })).toBe(true);
    expect(V.keepAliveAllowed({ partition: 'persist:container-work', privateWindow: false })).toBe(true);
    expect(V.keepAliveAllowed({ partition: 'persist:main', privateWindow: true })).toBe(false);
    expect(V.keepAliveAllowed({ partition: 'private:1', privateWindow: false })).toBe(false);
    expect(V.keepAliveAllowed({ partition: 'tor-12', privateWindow: false })).toBe(false);
    expect(V.keepAliveAllowed({ partition: 'persist:route-tor', privateWindow: false })).toBe(false);
    expect(V.keepAliveAllowed({ partition: 'burner-3', privateWindow: false })).toBe(false);
    expect(V.keepAliveAllowed({ partition: 'otr-4', privateWindow: false })).toBe(false);
  });

  it('the request is a HEAD of the page’s own address with its own cookies and nothing else', () => {
    const script = V.keepAliveScript();
    expect(script).toContain("method: 'HEAD'");
    expect(script).toContain("credentials: 'same-origin'");
    expect(script).toContain('location.href.split(\'#\')[0]');
    expect(script).not.toMatch(/https?:\/\//);
    expect(script).not.toContain('body');
  });
});

describe('the window’s side', () => {
  let tabs, wvs, rules, toasts, activityCb, execAnswer, execCalls;
  const urlOf = { a: 'https://edevlet.example/portal', b: 'https://shop.example/' };

  beforeEach(() => {
    tabs = [{ id: 'a', url: urlOf.a, partition: 'persist:main' }, { id: 'b', url: urlOf.b, partition: 'persist:main' }];
    execAnswer = 200; execCalls = [];
    wvs = new Map(tabs.map((t, i) => [t.id, { getURL: () => t.url, getWebContentsId: () => 100 + i, executeJavaScript: vi.fn(async (code) => { execCalls.push(code); return execAnswer; }) }]));
    rules = { 'edevlet.example': { sessionMin: 20 } };
    toasts = [];
    activityCb = null;
    globalThis.TabManager = { tabs, activeTabId: 'a', switchTab: vi.fn() };
    globalThis.WebviewManager = { webviews: wvs };
    globalThis.SiteRulesUI = { forUrl: (u) => { const h = new URL(u).hostname; return rules[h] || null; } };
    window.VexTabPolicy = { isPrivateWindow: false };
    window.vex = { onTabActivity: (cb) => { activityCb = cb; } };
    window.showToast = vi.fn((m, t, d, o) => { toasts.push({ m, o }); });
    document.body.innerHTML = '';
    V._tabs.forEach(e => e.timer.stop()); V._tabs.clear(); V._bound = false;
    if (V._tick) { V._tick.stop(); V._tick = null; }
    // js/jobs.js, as a plain interval for the test.
    globalThis.VexJobs = { every: (name, ms, fn) => { const h = setInterval(fn, ms); return { stop: () => clearInterval(h) }; } };
  });

  it('gives a timer to a tab on a site with a timeout, and to no other', () => {
    V.sync();
    expect([...V._tabs.keys()]).toEqual(['a']);
    expect(V._tabs.get('a').minutes).toBe(20);
  });

  it('drops the timer of a tab that closed, and of a site whose rule was removed', () => {
    V.sync();
    tabs.splice(0, 1);
    V.sync();
    expect(V._tabs.size).toBe(0);
    tabs.push({ id: 'a', url: urlOf.a, partition: 'persist:main' });
    V.sync();
    expect(V._tabs.size).toBe(1);
    delete rules['edevlet.example'];
    V.sync();
    expect(V._tabs.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('warns with a toast and a badge, and a still-here button that sends the one request', async () => {
    V.sync();
    vi.advanceTimersByTime(18 * MIN);
    expect(toasts.length).toBe(1);
    expect(toasts[0].m).toMatch(/edevlet\.example may sign you out in about 2 minutes/);
    expect(document.getElementById('vex-session-badge').textContent).toMatch(/edevlet\.example: signs out in 2:00/);
    const still = toasts[0].o.actions.find(a => /still here/.test(a.label));
    expect(still).toBeTruthy();
    still.run();
    await flushPromises();
    expect(execCalls.length).toBe(1);
    expect(execCalls[0]).toContain("method: 'HEAD'");
    expect(document.getElementById('vex-session-badge')).toBe(null);   // the site heard from the tab: counting again
  });

  it('says when the time has passed', () => {
    V.sync();
    vi.advanceTimersByTime(20 * MIN);
    expect(toasts.map(t => t.m).some(m => /probably signed you out/.test(m))).toBe(true);
    expect(document.getElementById('vex-session-badge').textContent).toMatch(/probably signed out/);
    vi.advanceTimersByTime(5 * 1000);
    expect(document.getElementById('vex-session-badge')).not.toBe(null);
  });

  it('an activity report for the page resets the tab’s count (and only that tab’s)', () => {
    V.init();
    vi.advanceTimersByTime(15 * MIN);
    activityCb({ pageId: 100 });
    vi.advanceTimersByTime(4 * MIN);
    expect(toasts).toEqual([]);   // would have warned at 18 minutes
    vi.advanceTimersByTime(14 * MIN + 1000);
    expect(toasts.length).toBe(1);
    activityCb({ pageId: 999 });  // a page that is not one of ours: ignored
  });

  it('does not send a keep-alive unless the site asked for it', async () => {
    V.sync();
    vi.advanceTimersByTime(60 * MIN);
    await flushPromises();
    expect(execCalls).toEqual([]);
  });

  it('sends it when asked for, from a normal tab, and never from a tab that keeps nothing or a private window', async () => {
    rules['edevlet.example'] = { sessionMin: 20, keepAlive: true };
    V.sync();
    expect(V._tabs.get('a').timer.keepingAlive()).toBe(true);
    vi.advanceTimersByTime(9 * MIN);
    await flushPromises();
    expect(execCalls.length).toBe(1);
    tabs[0].partition = 'burner-1';
    V.sync();
    expect(V._tabs.get('a').timer.keepingAlive()).toBe(false);
    tabs[0].partition = 'persist:main';
    window.VexTabPolicy.isPrivateWindow = true;
    V.sync();
    expect(V._tabs.get('a').timer.keepingAlive()).toBe(false);
  });

  it('a redirect answer stops it and tells the person once', async () => {
    rules['edevlet.example'] = { sessionMin: 20, keepAlive: true };
    execAnswer = 'redirect';
    V.sync();
    vi.advanceTimersByTime(9 * MIN);
    await flushPromises();
    expect(toasts.filter(t => /answered with a redirect/.test(t.m)).length).toBe(1);
    vi.advanceTimersByTime(60 * MIN);
    await flushPromises();
    expect(execCalls.length).toBe(1);
  });

  it('a tab that has moved to another site is not asked from', async () => {
    rules['edevlet.example'] = { sessionMin: 20, keepAlive: true };
    V.sync();
    const entry = V._tabs.get('a');
    tabs[0].url = 'https://elsewhere.example/';
    wvs.get('a').getURL = () => 'https://elsewhere.example/';
    await expect(V._keepAlive(entry)).rejects.toThrow(/no longer on/);
    expect(execCalls).toEqual([]);
  });
});
