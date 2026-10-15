// @vitest-environment jsdom
//
// Patch radar (js/patch-radar.js): a game's patch notes page is watched by the
// page watcher's own engine, tells the user "New patch notes for <game>", and
// says nothing while the game runs (it waits and is told when the game ends).
import { describe, it, expect, vi, beforeEach } from 'vitest';

window.VexPrivateAddress = require('../../src/renderer/js/private-address.js');
const { AgentTools } = require('../../src/renderer/js/agent-tools.js');
const { PageWatchDiff } = require('../../src/renderer/js/page-watch-diff.js');
const { PageWatch } = require('../../src/renderer/js/page-watch.js');
const { PatchRadar } = require('../../src/renderer/js/patch-radar.js');

const feed = (title) => '<?xml version="1.0"?><rss version="2.0"><channel><title>Steam News</title><item><title><![CDATA[' + title + ']]></title><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate></item><item><title>Older post</title></item></channel></rss>';
const LONG_PAGE = '<html><body><main>' + '<p>Patch notes for the game, balance changes and fixes.</p>'.repeat(10) + '</main></body></html>';
const SPA = '<html><body><div id="app"></div><script>boot()</script></body></html>';

let body, game;
beforeEach(() => {
  localStorage.clear();
  window.PageWatchDiff = PageWatchDiff;
  globalThis.PageWatchDiff = PageWatchDiff;
  globalThis.AgentTools = AgentTools;
  globalThis.PageWatch = PageWatch;
  globalThis.PatchRadar = PatchRadar;
  globalThis.VexProblems = { note: vi.fn() };
  window.showToast = vi.fn();
  window.vex = {
    notify: vi.fn(),
    apiRequest: vi.fn(async () => ({ ok: true, status: 200, headers: { 'content-type': 'text/xml' }, body })),
  };
  game = { id: 'g_foo', name: 'Foo Quest', exe: 'foo' };
  globalThis.GameSession = { active: false, games: () => [game] };
  globalThis.TabManager = { mayAskSiteForIcon: () => true };
  body = feed('Patch 1.0 notes');
});

describe('adding a patch notes page', () => {
  it('turns a number into the Steam news feed address, and anything else into a web address', () => {
    expect(PatchRadar.resolveInput('1245620')).toEqual({ url: 'https://store.steampowered.com/feeds/news/app/1245620/', template: 'steam-news' });
    expect(PatchRadar.resolveInput('example.com/patches').url).toBe('https://example.com/patches');
    expect(() => PatchRadar.resolveInput('javascript:alert(1)')).toThrow(/web page/);
    expect(() => PatchRadar.resolveInput('  ')).toThrow(/address/);
  });

  it('watches nothing and requests nothing until it is confirmed', async () => {
    const ask = vi.fn(async () => false);
    const r = await PatchRadar.confirmAndAdd('g_foo', 'https://news.example/feed.xml', { ask });
    expect(r).toBeNull();
    expect(PageWatch.list()).toHaveLength(0);
    expect(PatchRadar.pages('g_foo')).toHaveLength(0);
    expect(ask.mock.calls[0][0].preview.latest).toBe('Patch 1.0 notes');
  });

  it('adds a feed as a page watch from the radar: regex, raw, every 6 hours, baseline set at once', async () => {
    const w = await PatchRadar.confirmAndAdd('g_foo', 'https://news.example/feed.xml', { ask: async () => true });
    expect(w.source).toBe('radar:patch-notes');
    expect(w.kind).toBe('regex');
    expect(w.raw).toBe(true);
    expect(w.every).toBe(6 * 3600000);
    const [p] = PatchRadar.pages('g_foo');
    expect(p.latest).toBe('Patch 1.0 notes');
    expect(p.unseen).toBe(false);          // the first look is a baseline, not news
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('refuses the same page twice for one game, and a fourth page', async () => {
    await PatchRadar.confirmAndAdd('g_foo', 'https://news.example/feed.xml', { ask: async () => true });
    await expect(PatchRadar.confirmAndAdd('g_foo', 'https://news.example/feed.xml', { ask: async () => true })).rejects.toThrow(/already/);
    await PatchRadar.confirmAndAdd('g_foo', 'https://news.example/b.xml', { ask: async () => true });
    await PatchRadar.confirmAndAdd('g_foo', 'https://news.example/c.xml', { ask: async () => true });
    await expect(PatchRadar.confirmAndAdd('g_foo', 'https://news.example/d.xml', { ask: async () => true })).rejects.toThrow(/3 patch notes pages/);
  });

  it('says honestly that a page needing JavaScript sees nothing, and only uses the hidden tab when told to', async () => {
    body = SPA;
    window.vex.apiRequest.mockImplementation(async () => ({ ok: true, status: 200, headers: { 'content-type': 'text/html' }, body }));
    await expect(PatchRadar.confirmAndAdd('g_foo', 'https://spa.example/patches', { ask: async () => false })).rejects.toThrow(/JavaScript/);
    expect(PageWatch.list()).toHaveLength(0);
    window.vex.pageWatchRender = vi.fn(async () => ({ ok: true, text: 'Patch 2 notes line', found: true }));
    const w = await PatchRadar.confirmAndAdd('g_foo', 'https://spa.example/patches', { ask: async () => true });
    expect(w.render).toBe(true);
  });

  it('an ordinary readable page becomes a whole-page watch', async () => {
    body = LONG_PAGE;
    window.vex.apiRequest.mockImplementation(async () => ({ ok: true, status: 200, headers: { 'content-type': 'text/html' }, body }));
    const w = await PatchRadar.confirmAndAdd('g_foo', 'https://site.example/patches', { ask: async () => true });
    expect(w.kind).toBe('text');
    expect(w.raw).toBe(false);
  });

  it('removing the game stops its watches', async () => {
    await PatchRadar.confirmAndAdd('g_foo', 'https://news.example/feed.xml', { ask: async () => true });
    PatchRadar.forgetGame('g_foo');
    expect(PageWatch.list()).toHaveLength(0);
    expect(PatchRadar.pages('g_foo')).toHaveLength(0);
  });
});

describe('a new patch', () => {
  async function watched() {
    const w = await PatchRadar.confirmAndAdd('g_foo', 'https://news.example/feed.xml', { ask: async () => true });
    body = feed('Patch 1.1 notes');
    return w;
  }

  it('is told as "New patch notes for <game>" with an unseen count and the newest title', async () => {
    const w = await watched();
    const r = await PageWatch.checkOne(w.id, Date.now());
    expect(r.changed).toBe(true);
    expect(window.showToast).toHaveBeenCalledWith('New patch notes for Foo Quest — Patch 1.1 notes', 'info', 8000);
    expect(window.vex.notify).toHaveBeenCalledTimes(1);
    expect(PatchRadar.unseenCount('g_foo')).toBe(1);
    expect(PatchRadar.pages('g_foo')[0].latest).toBe('Patch 1.1 notes');
    PatchRadar.markSeen('g_foo');
    expect(PatchRadar.unseenCount('g_foo')).toBe(0);
  });

  it('is not shown while the game runs, and is told once when it ends', async () => {
    const w = await watched();
    GameSession.active = true;
    await PageWatch.checkOne(w.id, Date.now());
    expect(window.showToast).not.toHaveBeenCalled();
    expect(window.vex.notify).not.toHaveBeenCalled();
    expect(PatchRadar.queue()).toHaveLength(1);
    expect(PatchRadar.unseenCount('g_foo')).toBe(1);       // the count is there, only the noise waits
    expect(PatchRadar.flush()).toBe(0);                     // still gaming
    GameSession.active = false;
    expect(PatchRadar.flush()).toBe(1);
    expect(window.showToast).toHaveBeenCalledWith('New patch notes for Foo Quest — Patch 1.1 notes', 'info', 8000);
    expect(PatchRadar.queue()).toHaveLength(0);
    expect(PatchRadar.flush()).toBe(0);                     // never twice
  });

  it('two patches during one game are one line each game, not a pile', async () => {
    const w = await watched();
    GameSession.active = true;
    await PageWatch.checkOne(w.id, Date.now());
    body = feed('Patch 1.2 notes');
    await PageWatch.checkOne(w.id, Date.now());
    expect(PatchRadar.queue()).toHaveLength(2);
    GameSession.active = false;
    PatchRadar.flush();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][0]).toBe('New patch notes for Foo Quest');
  });

  it('a game removed while news waited says nothing', async () => {
    const w = await watched();
    GameSession.active = true;
    await PageWatch.checkOne(w.id, Date.now());
    GameSession.games = () => [];
    GameSession.active = false;
    PatchRadar.flush();
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('an ordinary user watch is still announced the old way', async () => {
    window.vex.apiRequest.mockImplementation(async () => ({ ok: true, status: 200, headers: { 'content-type': 'text/html' }, body: LONG_PAGE }));
    const w = PageWatch.add({ url: 'https://shop.example/', title: 'Shop', byUser: true });
    await PageWatch.checkOne(w.id, 1000);
    window.vex.apiRequest.mockImplementation(async () => ({ ok: true, status: 200, headers: { 'content-type': 'text/html' }, body: LONG_PAGE.replace('balance', 'rebalanced and extended') }));
    await PageWatch.checkOne(w.id, 2000);
    expect(window.showToast.mock.calls.some(c => /Shop changed/.test(c[0]))).toBe(true);
  });
});
