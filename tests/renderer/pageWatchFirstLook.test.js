// @vitest-environment jsdom
//
// "watch this page for changes" typed into Ctrl+K (or said to the AI) added the
// watch but did not look at the page: lastCheckedAt stayed 0 and there was no
// baseline until the 15-minute check, while "Watch This Page" looked at once
// (release check, 2026-10-12). Every way of adding a watch now takes the first
// look straight away, through the same code, with the same routing and
// home-network rules.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

window.VexPrivateAddress = require('../../src/renderer/js/private-address.js');
const { PageWatch } = require('../../src/renderer/js/page-watch.js');
const { VexQuickCommands } = require('../../src/renderer/js/quick-commands.js');

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

let routed;
beforeEach(() => {
  localStorage.clear();
  routed = false;
  globalThis.AgentTools = {
    UA: 'test',
    readUrl: vi.fn(async () => ({ text: 'Tickets are not on sale' })),
    _get: vi.fn(async () => ({ ok: true, status: 200, body: '<p>x</p>' })),
    htmlToText: (b) => ({ text: String(b).replace(/<[^>]+>/g, ' ').trim() }),
  };
  globalThis.VexProblems = { note: vi.fn() };
  globalThis.GitHubWatch = { parse: () => null };
  window.showToast = vi.fn();
  window.vex = {
    notify: vi.fn(),
    apiRequest: vi.fn(async () => ({ ok: true, status: 200, headers: { 'content-type': 'text/html' }, body: '<p>Devices online: 7</p>' })),
  };
  globalThis.TabManager = {
    mayAskSiteForIcon: () => !routed,
    tabs: [{ id: 't', url: 'https://tickets.example/show', title: 'Show' }],
    activeTabId: 't',
  };
});
afterEach(() => { delete globalThis.TabManager; delete globalThis.GitHubWatch; });

const quickWatch = (text) => VexQuickCommands.results(text).find(r => r.id === 'quick-watch');

describe('Ctrl+K "watch this page for changes"', () => {
  it('takes the first look at once: the baseline is set and the watch shows as checked', async () => {
    quickWatch('watch this page for changes').action();
    await flush();
    const [w] = PageWatch.list();
    expect(AgentTools.readUrl).toHaveBeenCalledWith('https://tickets.example/show', expect.anything());
    expect(w.lastCheckedAt).toBeGreaterThan(0);
    expect(w.lastValue).toMatch(/^Tickets are not on sale/);
  });

  it('a routed site is still never read from the real connection; the failed first look is said', async () => {
    routed = true;
    quickWatch('watch this page for changes').action();
    await flush();
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
    expect(PageWatch.list()[0].lastError).toMatch(/Tor, a proxy or a container/);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/first look failed: .*Tor, a proxy or a container/), 'error');
  });

  it('a page open in a Tor, private or container tab is refused, and nothing is fetched', async () => {
    TabManager.tabs[0].partition = 'persist:container-work';
    TabManager.windowMayAsk = () => false;
    expect(() => quickWatch('watch this page for changes').action()).toThrow(/Tor, a proxy, a container or a private session/);
    await flush();
    expect(PageWatch.list()).toEqual([]);
    expect(AgentTools.readUrl).not.toHaveBeenCalled();
  });

  it('a home-network page the user watches is looked at from this computer', async () => {
    TabManager.tabs[0] = { id: 't', url: 'http://192.168.1.1/', title: 'Router' };
    quickWatch('watch this page for changes').action();
    await flush();
    const [w] = PageWatch.list();
    expect(w.local).toBe(true);
    expect(w.lastValue).toMatch(/Devices online: 7/);
    expect(window.vex.apiRequest.mock.calls.every(([o]) => !o.publicOnly)).toBe(true);
  });
});

describe('the AI agent path (watchCurrent without byUser)', () => {
  it('takes the first look too', async () => {
    const r = PageWatch.watchCurrent('drops under 300');
    await r.first;
    expect(PageWatch.list()[0].lastCheckedAt).toBeGreaterThan(0);
  });

  it('still cannot watch a home-network address, so nothing is fetched', () => {
    TabManager.tabs[0] = { id: 't', url: 'http://192.168.1.1/', title: 'Router' };
    expect(() => PageWatch.watchCurrent('changes')).toThrow(/only when you add the watch yourself/);
    expect(window.vex.apiRequest).not.toHaveBeenCalled();
  });

  it('a watch undone before its first look finishes stays gone', async () => {
    let release;
    AgentTools.readUrl.mockImplementation(() => new Promise((res) => { release = res; }));
    const r = PageWatch.watchCurrent('changes');
    PageWatch.remove(r.watch.id);
    release({ text: 'x' });
    await expect(r.first).resolves.toMatchObject({ ok: false });
    expect(PageWatch.list()).toEqual([]);
  });
});

describe('two watches added back to back', () => {
  it('both survive: the first one’s look does not save over the second', async () => {
    const releases = [];
    AgentTools.readUrl.mockImplementation(() => new Promise((res) => { releases.push(res); }));
    const a = PageWatch.watchCurrent('changes', { url: 'https://a.example/', title: 'A', byUser: true });
    const b = PageWatch.watchCurrent('changes', { url: 'https://b.example/', title: 'B', byUser: true });
    releases.forEach((res, i) => res({ text: 'page ' + i }));
    await Promise.all([a.first, b.first]);
    const list = PageWatch.list();
    expect(list.map(w => w.title)).toEqual(['A', 'B']);
    expect(list.every(w => w.lastCheckedAt > 0)).toBe(true);
  });
});

describe('one code path', () => {
  it('Watch This Page, watchCurrent and the "watch part of this page" command all use firstLook', () => {
    const pw = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/page-watch.js'), 'utf8');
    const cmd = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/command.js'), 'utf8');
    const body = (name) => pw.slice(pw.indexOf('\n  ' + name + '('), pw.indexOf('\n  },', pw.indexOf('\n  ' + name + '(')));
    expect(body('watchCurrent')).toMatch(/this\.firstLook\(/);
    expect(pw.slice(pw.indexOf('\n  async watchPage('), pw.indexOf('\n  },', pw.indexOf('\n  async watchPage(')))).toMatch(/this\.firstLook\(/);
    expect(cmd).toMatch(/PageWatch\.firstLook\(w\)/);
    expect(cmd).not.toMatch(/PageWatch\.checkOne\(w\.id\)/);
  });
});
