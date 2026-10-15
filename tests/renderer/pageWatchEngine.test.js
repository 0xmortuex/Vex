// @vitest-environment jsdom
//
// Page Watcher, the engine: what a check keeps, says and refuses. The rules for
// "changed" are in pageWatchDiff.test.js; this is the part around them — a
// history that stays bounded, a part of a page that went away, a page that is
// down, a page that did not change, and the places a watch must never go.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { PageWatch } = require('../../src/renderer/js/page-watch.js');
const { AgentTools: RealTools } = require('../../src/renderer/js/agent-tools.js');

let page;
const html = (price, extra = '') => `<html><body><nav>Home</nav><main><h1>Card</h1>
  <div class="box"><p class="price">${price}</p><p class="note">Ships in two days with a three year warranty.</p></div>${extra}
  <p>Updated 5 minutes ago at 14:05</p></main></body></html>`;

beforeEach(() => {
  localStorage.clear();
  page = { body: html('$299.00'), status: 200, headers: { etag: '"v1"' } };
  window.vex = {
    notify: vi.fn(),
    apiRequest: vi.fn(async (o) => {
      const inm = o.headers && o.headers['If-None-Match'];
      if (inm && page.headers.etag && inm === page.headers.etag) return { ok: true, status: 304, headers: page.headers, body: '' };
      return { ok: true, status: page.status, headers: { 'content-type': 'text/html', ...page.headers }, body: page.body };
    }),
  };
  // The real reader on top of the fake network, so conditional requests,
  // validators and the text of a page are the real ones.
  globalThis.AgentTools = RealTools;
  globalThis.VexProblems = { note: vi.fn() };
  window.showToast = vi.fn();
});
afterEach(() => { delete globalThis.TabManager; delete globalThis.Ollama; delete globalThis.AIRouter; });

describe('what a change comes with', () => {
  it('says which lines were added and removed, and keeps the history', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card' });
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true, changed: false, why: 'first look' });
    expect(PageWatch.history(w.id)).toHaveLength(1);

    page.body = html('$249.00');
    page.headers = { etag: '"v2"' };
    const r = await PageWatch.checkOne(w.id);
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.diff).toEqual({ added: ['$249.00'], removed: ['$299.00'] });
    expect(r.summary).toMatch(/1 line changed/);
    expect(r.summary).toMatch(/- \$299\.00/);
    expect(r.summary).toMatch(/\+ \$249\.00/);
    expect(PageWatch.history(w.id)).toHaveLength(2);
    expect(window.showToast).toHaveBeenCalledWith('Card changed', 'info', 8000);
    expect(window.vex.notify).toHaveBeenCalledWith('Vex — a page changed', expect.stringContaining('$249.00'));
  });

  it('a page that only moves its clock and its "minutes ago" stays quiet', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card' });
    await PageWatch.checkOne(w.id);
    page.body = html('$299.00').replace('5 minutes ago at 14:05', '31 minutes ago at 14:31');
    page.headers = { etag: '"v2"' };
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true, changed: false });
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('a small change under "low" sensitivity is not told, and counts later', async () => {
    PageWatch.setSettings({ sensitivity: 'low' });
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card' });
    await PageWatch.checkOne(w.id);
    page.body = html('$289.00'); page.headers = { etag: '"v2"' };
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true, changed: false, why: 'minor change' });
    expect(PageWatch.history(w.id)).toHaveLength(1);
    // Two more lines turn up: against the ORIGINAL baseline that is three.
    page.body = html('$289.00', '<p>New driver released</p><p>Stock replenished</p>'); page.headers = { etag: '"v3"' };
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true, changed: true });
  });

  it('kind "regex" keeps what the pattern pulls out and says the new one', async () => {
    page.body = '<html><body><h1>Driver</h1><p>Game Ready version 551.23 WHQL</p></body></html>';
    const w = PageWatch.add({ url: 'https://vendor.example/driver', title: 'Driver', kind: 'regex', pattern: 'version (\\d+\\.\\d+)' });
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true, changed: false });
    expect(PageWatch.list()[0].lastValue).toBe('551.23');
    page.body = page.body.replace('551.23', '552.12'); page.headers = { etag: '"v2"' };
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true, changed: true, from: '551.23', to: '552.12' });
    expect(window.showToast).toHaveBeenCalledWith('Driver is now 552.12 (was 551.23)', 'info', 8000);
  });

  it('a pattern that is not on the page is said, not counted as a change', async () => {
    const w = PageWatch.add({ url: 'https://vendor.example/driver', title: 'Driver', kind: 'regex', pattern: 'build #(\\d+)' });
    expect(await PageWatch.checkOne(w.id)).toEqual({ ok: false, error: 'the pattern was not found on that page' });
  });

  it('a bad pattern is refused when the watch is made', () => {
    expect(() => PageWatch.add({ url: 'https://a.example/', kind: 'regex', pattern: '(' })).toThrow(/not valid/);
    expect(PageWatch.list()).toEqual([]);
  });
});

describe('the part you watched', () => {
  it('is found again by its first words when the selector no longer matches', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card', selector: '.price', anchor: '$299.00' });
    await PageWatch.checkOne(w.id);
    expect(PageWatch.list()[0].lastValue).toBe('$299.00');
    // The page was re-laid-out: the class is gone, the words are not.
    page.body = '<html><body><section><b id="cost">$299.00</b></section></body></html>'; page.headers = { etag: '"v2"' };
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true, changed: false });
  });

  it('that has gone is told once, as gone, and is not a change', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card', selector: '.price', anchor: '$299.00' });
    await PageWatch.checkOne(w.id);
    page.body = '<html><body>Under maintenance</body></html>'; page.headers = { etag: '"v2"' };
    const r = await PageWatch.checkOne(w.id);
    expect(r).toMatchObject({ ok: false, partGone: true });
    expect(r.error).toMatch(/part you watched is gone/);
    await PageWatch.checkOne(w.id);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(PageWatch.list()[0]).toMatchObject({ partGone: true, failures: 2 });
    // And it comes back: the page is as it was and the flags clear.
    page.body = html('$299.00'); page.headers = { etag: '"v3"' };
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true, changed: false });
    expect(PageWatch.list()[0]).toMatchObject({ partGone: false, goneTold: false, failures: 0 });
  });

  it('an invalid selector says so', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card', selector: '..bad[' });
    const r = await PageWatch.checkOne(w.id);
    expect(r.error).toMatch(/not a valid selector/);
  });
});

describe('politeness', () => {
  it('asks the page once and then conditionally; a 304 costs nothing and says nothing', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card' });
    await PageWatch.checkOne(w.id);
    expect(PageWatch.list()[0].etag).toBe('"v1"');
    const r = await PageWatch.checkOne(w.id);
    expect(r).toMatchObject({ ok: true, changed: false, why: 'not modified' });
    const last = window.vex.apiRequest.mock.calls.at(-1)[0];
    expect(last.headers['If-None-Match']).toBe('"v1"');
    expect(last.publicOnly).toBe(true);        // no cookies, no logins
    expect(PageWatch.history(w.id)).toHaveLength(1);
  });

  it('is never more often than the floor, however the watch was made', () => {
    expect(() => PageWatch.add({ url: 'https://a.example/', every: 30000 })).toThrow(/not checked more often/);
  });

  it('waits twice as long after each failure, up to a day', () => {
    const w = { every: 15 * 60000, failures: 0 };
    expect(PageWatch.effectiveEvery(w)).toBe(15 * 60000);
    expect(PageWatch.effectiveEvery({ ...w, failures: 1 })).toBe(15 * 60000);
    expect(PageWatch.effectiveEvery({ ...w, failures: 2 })).toBe(30 * 60000);
    expect(PageWatch.effectiveEvery({ ...w, failures: 3 })).toBe(60 * 60000);
    expect(PageWatch.effectiveEvery({ ...w, failures: 30 })).toBe(24 * 3600000);
  });

  it('checkDue honours the backoff and a pause', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card', every: 15 * 60000 });
    const list = PageWatch.list();
    list[0].failures = 3; list[0].lastCheckedAt = 1000;
    localStorage.setItem(PageWatch.KEY, JSON.stringify(list));
    // 3 failures: 60 minutes. At 30 minutes it is not due; at 61 it is.
    expect(await PageWatch.checkDue(1000 + 30 * 60000)).toEqual([]);
    expect(await PageWatch.checkDue(1000 + 61 * 60000)).toHaveLength(1);
    PageWatch.setPaused(w.id, true);
    expect(await PageWatch.checkDue(1000 + 99 * 3600000)).toEqual([]);
    PageWatch.setPaused(w.id, false);
    expect(await PageWatch.checkDue(Date.now() + 1)).toHaveLength(1);
  });
});

describe('never twice', () => {
  it('two checks of one watch at the same moment are one check and one announcement', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card' });
    await PageWatch.checkOne(w.id);
    page.body = html('$199.00'); page.headers = { etag: '"v2"' };
    const [a, b] = await Promise.all([PageWatch.checkOne(w.id), PageWatch.checkOne(w.id)]);
    expect(a).toEqual(b);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.vex.notify).toHaveBeenCalledTimes(1);
  });

  it('the same new value is not announced again', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card', kind: 'regex', pattern: '(\\$\\d+)', selector: '.price' });
    await PageWatch.checkOne(w.id);
    page.body = html('$199.00'); page.headers = { etag: '"v2"' };
    await PageWatch.checkOne(w.id);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    // Something put the baseline back (a second window saved an older copy):
    const list = PageWatch.list();
    list[0].lastValue = '$299';
    localStorage.setItem(PageWatch.KEY, JSON.stringify(list));
    await PageWatch.checkOne(w.id);
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });
});

describe('what is kept stays small', () => {
  it('keeps the newest snapshots up to the limit in Settings', async () => {
    PageWatch.setSettings({ maxSnapshots: 3 });
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card' });
    for (let i = 0; i < 8; i++) {
      page.body = html('$' + (300 - i)); page.headers = { etag: '"e' + i + '"' };
      await PageWatch.checkOne(w.id);
    }
    const h = PageWatch.history(w.id);
    expect(h).toHaveLength(3);
    expect(h.at(-1).text).toContain('$293');
  });

  it('lowering the limit trims what is already kept', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card' });
    for (let i = 0; i < 6; i++) { page.body = html('$' + (300 - i)); page.headers = { etag: '"e' + i + '"' }; await PageWatch.checkOne(w.id); }
    expect(PageWatch.history(w.id)).toHaveLength(6);
    PageWatch.setSettings({ maxSnapshots: 2 });
    expect(PageWatch.history(w.id)).toHaveLength(2);
  });

  it('stopping a watch forgets its history', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card' });
    await PageWatch.checkOne(w.id);
    PageWatch.remove(w.id);
    expect(PageWatch.history(w.id)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(PageWatch.SNAPS_KEY))).toEqual({});
  });

  it('a hand-edited limit cannot make it unbounded', () => {
    localStorage.setItem(PageWatch.SETTINGS_KEY, JSON.stringify({ maxWatches: 1e9, maxSnapshots: 99999, sensitivity: 'loud' }));
    expect(PageWatch.settings()).toMatchObject({ maxWatches: 100, maxSnapshots: 50, sensitivity: 'normal' });
  });

  it('the number of watches is capped', () => {
    PageWatch.setSettings({ maxWatches: 2 });
    PageWatch.add({ url: 'https://a.example/' });
    PageWatch.add({ url: 'https://b.example/' });
    expect(() => PageWatch.add({ url: 'https://c.example/' })).toThrow(/already watching 2 pages/);
  });
});

describe('the global switch', () => {
  it('off: nothing is made and nothing is checked', async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card' });
    PageWatch.setSettings({ enabled: false });
    expect(() => PageWatch.add({ url: 'https://b.example/' })).toThrow(/switched off/);
    expect(await PageWatch.checkDue(Date.now() + 99 * 3600000)).toEqual([]);
    expect(window.vex.apiRequest).not.toHaveBeenCalled();
    expect(PageWatch.list().map(x => x.id)).toEqual([w.id]);
  });
});

describe('where a watch must never go', () => {
  const tabs = (partition, routed = false) => {
    globalThis.TabManager = {
      tabs: [{ id: 't1', url: 'https://news.example/', title: 'News', partition }], activeTabId: 't1',
      windowMayAsk: (p) => !p || p === 'persist:main',
      mayAskSiteForIcon: () => !routed,
    };
  };

  it.each(['tor:abc', 'persist:container-work', 'private:1', 'persist:proxy-eu'])('a tab in %s cannot be watched', (partition) => {
    tabs(partition);
    expect(() => PageWatch.add({ url: 'https://news.example/', partition })).toThrow(/Tor, a proxy, a container or a private session/);
    expect(PageWatch.list()).toEqual([]);
  });

  it('a site that is routed is not checked from the real connection, hidden tab or not', async () => {
    tabs('persist:main', true);
    const w = PageWatch.add({ url: 'https://news.example/', render: true });
    window.vex.pageWatchRender = vi.fn();
    const r = await PageWatch.checkOne(w.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Tor, a proxy or a container/);
    expect(window.vex.pageWatchRender).not.toHaveBeenCalled();
    expect(window.vex.apiRequest).not.toHaveBeenCalled();
  });

  it('a page on the home network is never read through a hidden tab, nor added by the AI', () => {
    expect(() => PageWatch.add({ url: 'http://192.168.1.1/', byUser: true, render: true })).toThrow(/read directly/);
    expect(() => PageWatch.add({ url: 'http://192.168.1.1/' })).toThrow(/yourself/);
  });

  it('a hidden-tab watch goes through main, with the selector and nothing else', async () => {
    window.vex.pageWatchRender = vi.fn(async () => ({ ok: true, found: true, text: 'Price\n$299.00', title: 'Card' }));
    const w = PageWatch.add({ url: 'https://spa.example/card', selector: '#app .price', render: true });
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: true, changed: false });
    expect(window.vex.pageWatchRender).toHaveBeenCalledWith({ url: 'https://spa.example/card', selector: '#app .price', anchor: '' });
    expect(window.vex.apiRequest).not.toHaveBeenCalled();
    window.vex.pageWatchRender = vi.fn(async () => ({ ok: true, found: false, text: '', title: '' }));
    expect(await PageWatch.checkOne(w.id)).toMatchObject({ ok: false, partGone: true });
  });

  it('a hidden tab that fails says why', async () => {
    window.vex.pageWatchRender = vi.fn(async () => ({ ok: false, error: 'The page took too long to load' }));
    const w = PageWatch.add({ url: 'https://spa.example/card', render: true });
    expect(await PageWatch.checkOne(w.id)).toEqual({ ok: false, error: 'The page took too long to load' });
  });
});

describe('a sentence from the local model, and only the local one', () => {
  const change = async () => {
    const w = PageWatch.add({ url: 'https://shop.example/card', title: 'Card', summarize: true });
    await PageWatch.checkOne(w.id);
    page.body = html('$249.00'); page.headers = { etag: '"v2"' };
    return PageWatch.checkOne(w.id);
  };

  it('is added to the toast when a local model is set up', async () => {
    globalThis.AIRouter = { isOllamaAvailable: () => true, getModel: () => 'qwen3:8b', callAI: vi.fn() };
    globalThis.Ollama = { generate: vi.fn(async () => ' The price dropped from $299 to $249.\n') };
    const r = await change();
    expect(Ollama.generate).toHaveBeenCalledWith('qwen3:8b', expect.stringContaining('$249.00'), expect.objectContaining({ maxTokens: 110 }));
    expect(r.sentence).toBe('The price dropped from $299 to $249.');
    expect(window.showToast).toHaveBeenCalledWith('Card changed — The price dropped from $299 to $249.', 'info', 8000);
    expect(AIRouter.callAI).not.toHaveBeenCalled();     // the router (which may be cloud) is never asked
  });

  it('without a local model there is no sentence and nothing is sent anywhere', async () => {
    globalThis.AIRouter = { isOllamaAvailable: () => false, getModel: () => '', callAI: vi.fn() };
    globalThis.Ollama = { generate: vi.fn() };
    const r = await change();
    expect(Ollama.generate).not.toHaveBeenCalled();
    expect(AIRouter.callAI).not.toHaveBeenCalled();
    expect(r.sentence).toBeUndefined();
    expect(window.showToast).toHaveBeenCalledWith('Card changed', 'info', 8000);
  });

  it('a model that fails is noted and the plain change is still told', async () => {
    globalThis.AIRouter = { isOllamaAvailable: () => true, getModel: () => 'm' };
    globalThis.Ollama = { generate: vi.fn(async () => { throw new Error('model not loaded'); }) };
    await change();
    expect(VexProblems.note).toHaveBeenCalledWith('Page watch', expect.stringMatching(/local model could not/), expect.any(Error));
    expect(window.showToast).toHaveBeenCalledWith('Card changed', 'info', 8000);
  });
});

describe('opening Vex for a watch', () => {
  it('one daily wake-up serves every watch that asked, and goes with the last', async () => {
    const reminders = [];
    window.vex.reminders = {
      list: vi.fn(async () => reminders.slice()),
      create: vi.fn(async (message, at, extra) => { const r = { id: 'r' + reminders.length, message, at, ...extra }; reminders.push(r); return r; }),
      delete: vi.fn(async (id) => { reminders.splice(reminders.findIndex(r => r.id === id), 1); return { ok: true }; }),
    };
    const a = PageWatch.add({ url: 'https://a.example/', wake: true });
    await PageWatch.syncWake();
    const b = PageWatch.add({ url: 'https://b.example/', wake: true });
    await PageWatch.syncWake();
    expect(window.vex.reminders.create).toHaveBeenCalledTimes(1);
    expect(window.vex.reminders.create).toHaveBeenCalledWith(PageWatch.WAKE_MESSAGE, expect.any(Number), { repeat: 'daily' });
    PageWatch.setPaused(a.id, true);
    await PageWatch.syncWake();
    expect(reminders).toHaveLength(1);
    PageWatch.remove(b.id);
    await PageWatch.syncWake();
    expect(reminders).toHaveLength(0);
  });

  it('a wake-up that cannot be set is said, not lost', async () => {
    window.vex.reminders = { list: vi.fn(async () => []), create: vi.fn(async () => { throw new Error('Task Scheduler refused'); }), delete: vi.fn() };
    PageWatch.add({ url: 'https://a.example/', wake: true });
    await PageWatch.syncWake();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/wake-up for watched pages could not be set: Task Scheduler refused/), 'error');
  });
});

describe('a watch from before this version', () => {
  it('still works: no new fields, plain-text baseline, no settings saved', async () => {
    localStorage.setItem(PageWatch.KEY, JSON.stringify([{
      id: 'w_old', url: 'https://shop.example/card', title: 'Old', selector: '.price', kind: 'text', direction: 'any', target: null,
      every: 900000, addedAt: 1, lastCheckedAt: 0, lastValue: '$299.00', lastChangedAt: 0, failures: 0,
    }]));
    expect(PageWatch.settings()).toMatchObject({ enabled: true, maxWatches: 30, maxSnapshots: 20, sensitivity: 'normal' });
    expect(await PageWatch.checkOne('w_old')).toMatchObject({ ok: true, changed: false });
    page.body = html('$279.00'); page.headers = { etag: '"v2"' };
    const r = await PageWatch.checkOne('w_old');
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(PageWatch.history('w_old')).toHaveLength(2);
    expect(PageWatch.list()[0].source).toBeUndefined();   // old records are not rewritten
  });

  it('new watches carry a source for later built-in watches', () => {
    const w = PageWatch.add({ url: 'https://a.example/' });
    expect(w.source).toBe('user');
    expect(PageWatch.add({ url: 'https://b.example/', source: 'radar:steam-news' }).source).toBe('radar:steam-news');
  });
});
