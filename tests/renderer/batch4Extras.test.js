// @vitest-environment jsdom
//
// Batch 4: local AI memory, "does it matter" sentence for a watched page,
// the weekly world page, offline pages, Year in Vex and the badge layer.
// Nothing here touches a network, a worker or the real profile.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexExtras } = require('../../src/renderer/js/vex-extras.js');
const { AIMemory } = require('../../src/renderer/js/ai-memory.js');
const { PageWatchExplain } = require('../../src/renderer/js/page-watch-explain.js');
const { VexWeeklyWorld } = require('../../src/renderer/js/weekly-world.js');
const { VexOfflinePages } = require('../../src/renderer/js/offline-pages.js');
const { VexYearInVex } = require('../../src/renderer/js/year-in-vex.js');
const { VexBadges } = require('../../src/renderer/js/achievement-badges.js');

const DAY = 24 * 3600000;

beforeEach(() => {
  localStorage.clear();
  globalThis.window.showToast = vi.fn();
  document.body.innerHTML = '';
  AIMemory.data = { enabled: false, includeCloud: false, facts: [] };
  VexBadges._started = false;
});
afterEach(() => { vi.restoreAllMocks(); delete globalThis.CommandBar; });

// ---------------------------------------------------------------- AI memory
describe('AI memory: off by default, local first', () => {
  it('is off, and not included for the cloud, on a fresh profile', async () => {
    vi.resetModules();
    const { AIMemory: fresh } = await import('../../src/renderer/js/ai-memory.js');
    fresh.init();   // nothing saved
    expect(fresh.data.enabled).toBe(false);
    expect(fresh.data.includeCloud).toBe(false);
    expect(fresh.historyMessage('local')).toBeNull();
  });

  it('a profile saved before the cloud tick existed keeps its local choice but sends nothing to the cloud', () => {
    localStorage.setItem('vex.aiMemory', JSON.stringify({ enabled: true, facts: [{ id: 'm1', text: 'I use pnpm', at: 1 }] }));
    AIMemory.init();
    expect(AIMemory.data.enabled).toBe(true);
    expect(AIMemory.historyMessage('local')).not.toBeNull();
    expect(AIMemory.historyMessage('cloud')).toBeNull();
  });

  it('cloud needs memory on AND the cloud tick', () => {
    AIMemory.add('I prefer short answers');
    expect(AIMemory.historyMessage('local')).toBeNull();      // off
    AIMemory.setEnabled(true);
    expect(AIMemory.historyMessage('ondevice')).not.toBeNull();
    expect(AIMemory.historyMessage('cloud')).toBeNull();
    AIMemory.setIncludeCloud(true);
    expect(AIMemory.historyMessage('cloud').vexMemory).toBe(true);
    AIMemory.setEnabled(false);
    expect(AIMemory.historyMessage('cloud')).toBeNull();
  });

  it('is plain text one fact per line, editable, and clear() empties it', () => {
    AIMemory.add('first fact'); AIMemory.add('second fact');
    const ids = AIMemory.list().map(f => f.id);
    expect(AIMemory.asText().split('\n')).toEqual(['second fact', 'first fact']);
    AIMemory.setFromText('second fact\n\n  third fact  \nsecond FACT\n');
    expect(AIMemory.list().map(f => f.text)).toEqual(['second fact', 'third fact']);
    expect(ids).toContain(AIMemory.list()[0].id);              // unchanged line kept its id
    AIMemory.clear();
    expect(AIMemory.list()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('vex.aiMemory')).facts).toEqual([]);
  });

  it('stays in the existing synced key, not a new one', () => {
    expect(AIMemory.KEY).toBe('vex.aiMemory');
  });
});

describe('the router never lets memory reach the cloud unticked', () => {
  async function run(allow) {
    vi.resetModules();
    const { AIRouter } = await import('../../src/renderer/js/ai-router.js');
    let sent = null;
    globalThis.window.VexConfig = {
      aiWorkerUrl: () => 'https://worker.invalid/ai',
      fetchAI: vi.fn(async (_u, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ result: 'ok' }) }; }),
    };
    globalThis.AIMemory = { allowsBackend: () => allow };
    AIRouter.setForceCloud(true);
    const history = [{ role: 'system', content: 'MEM', vexMemory: true }, { role: 'user', content: 'hi' }];
    const out = await AIRouter.callAI('chat', { message: 'hello', conversationHistory: history });
    delete globalThis.AIMemory;
    delete globalThis.window.VexConfig;
    return { out, sent };
  }
  it('strips it when the cloud tick is off', async () => {
    const { out, sent } = await run(false);
    expect(out.backend).toBe('cloud');
    expect(sent.conversationHistory.map(m => m.content)).toEqual(['hi']);
  });
  it('keeps it when ticked', async () => {
    const { sent } = await run(true);
    expect(sent.conversationHistory.map(m => m.content)).toEqual(['MEM', 'hi']);
  });
});

// ------------------------------------------------------- explain a page diff
describe('PageWatchExplain', () => {
  const diff = { removed: ['Price $299.00'], added: ['Price $249.00', 'Sale ends Friday'] };

  it('asks what changed and whether it matters, with the changed lines', () => {
    const p = PageWatchExplain.requestText({ title: 'GPU Shop' }, diff);
    expect(p).toContain('GPU Shop');
    expect(p).toContain('- Price $299.00');
    expect(p).toContain('+ Sale ends Friday');
    expect(p).toMatch(/whether it probably matters/);
  });

  it('uses only the generate function it is handed, and cleans the answer', async () => {
    const generate = vi.fn(async () => '  The price fell from $299 to $249.\n It matters if you were waiting to buy.  ');
    const s = await PageWatchExplain.explain({ title: 'x' }, diff, { generate, model: 'llama3' });
    expect(s).toBe('The price fell from $299 to $249. It matters if you were waiting to buy.');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toBe('llama3');
  });

  it('with no local model there is no sentence and no call', async () => {
    const generate = vi.fn();
    expect(await PageWatchExplain.explain({}, diff, { generate, model: '' })).toBe('');
    expect(generate).not.toHaveBeenCalled();
  });

  it('refuses to run without a generate function (no hidden cloud default)', async () => {
    await expect(PageWatchExplain.explain({}, diff, { model: 'm' })).rejects.toThrow(/No local model function/);
  });

  it('explains the last two kept snapshots', async () => {
    const snaps = { w1: [{ at: 1, text: 'Intro\nPrice $299.00' }, { at: 2, text: 'Intro\nPrice $249.00' }] };
    const generate = vi.fn(async () => 'Cheaper now.');
    const r = await PageWatchExplain.explainStored('w1', { generate, model: 'm', snaps, watches: [{ id: 'w1', title: 'Shop' }] });
    expect(r.sentence).toBe('Cheaper now.');
    expect(r.diff.added).toEqual(['Price $249.00']);
    expect(await PageWatchExplain.explainStored('none', { generate, model: 'm', snaps })).toBeNull();
  });
});

// -------------------------------------------------------------- weekly world
describe('VexWeeklyWorld', () => {
  const now = Date.parse('2026-10-16T12:00:00');
  const watches = [
    { id: 'a', title: 'Blog', url: 'https://b.test/', kind: 'text', lastChangedAt: now - 2 * DAY, lastSummary: 'A new post.' },
    { id: 'b', title: 'Game patch notes', url: 'https://g.test/', kind: 'regex', source: 'radar:patch-notes', lastChangedAt: now - DAY, lastValue: '1.2.3' },
    { id: 'c', title: 'Old', url: 'https://o.test/', kind: 'text', lastChangedAt: now - 20 * DAY },
  ];
  const prices = {
    'https://shop.test/p': { name: 'Keyboard', currency: 'EUR', points: [{ day: '2026-10-01', cents: 10000 }, { day: '2026-10-14', cents: 8000 }] },
    'https://shop.test/q': { name: 'Mouse', currency: 'EUR', points: [{ day: '2026-10-14', cents: 5000 }] },
  };

  it('splits pages from releases and drops what is older than a week', () => {
    const c = VexWeeklyWorld.collect(now, { watches, prices, log: [] });
    expect(c.pages.map(p => p.text)).toEqual(['Blog']);
    expect(c.releases.map(p => p.text)).toEqual(['Game patch notes']);
    expect(c.pages[0].sub).toContain('A new post.');
    expect(c.releases[0].sub).toContain('now 1.2.3');
  });

  it('lists a price that moved over the week and ignores one that did not', () => {
    const c = VexWeeklyWorld.collect(now, { watches: [], prices, log: [], format: (c) => String(c / 100) });
    expect(c.prices).toHaveLength(1);
    expect(c.prices[0].text).toBe('Keyboard');
    expect(c.prices[0].sub).toBe('100 to 80 (down 20)');
  });

  it('logs repository announcements itself and counts them in the week', () => {
    VexWeeklyWorld._listening = false;
    VexWeeklyWorld.init();
    document.dispatchEvent(new CustomEvent('vex:github-watch', { detail: { text: 'New release of a/b: v2', url: 'https://github.com/a/b' } }));
    document.dispatchEvent(new CustomEvent('vex:github-watch', { detail: { text: 'New release of a/b: v2', url: 'https://github.com/a/b' } }));
    const c = VexWeeklyWorld.collect(Date.now(), { watches: [], prices: {} });
    expect(c.repos).toHaveLength(1);
    expect(c.repos[0].text).toBe('New release of a/b: v2');
  });

  it('is a brief-ready section and obeys its switch', () => {
    const b = VexWeeklyWorld.build(now, { watches, prices, log: [] });
    expect(b.id).toBe('weekly-world');
    expect(b.lines.length).toBeGreaterThan(0);
    expect(typeof VexWeeklyWorld.isEnabled()).toBe('boolean');
    expect(VexWeeklyWorld.isEnabled()).toBe(true);
    VexExtras.set('weeklyWorld', false);
    expect(VexWeeklyWorld.isEnabled()).toBe(false);
  });

  it('names a source it could not read instead of hiding it', () => {
    const c = VexWeeklyWorld.collect(now, { watches: null, prices: {}, log: [{ bad: 1 }] });
    expect(Array.isArray(c.errors)).toBe(true);
  });
});

// ------------------------------------------------------------ offline pages
describe('VexOfflinePages', () => {
  function stubBrowser({ existing = null, url = 'https://news.test/a' } = {}) {
    globalThis.WebviewManager = { getActiveWebview: () => ({ getURL: () => url }) };
    globalThis.ArchiveLibrary = {
      archiveActive: vi.fn(async () => ({ id: 'arch1', title: 'A story', bytes: 2048 })),
      openCopy: vi.fn(async () => {}),
    };
    globalThis.window.vex = {
      pageArchiveFind: vi.fn(async () => ({ ok: true, entry: existing })),
      pageArchiveRemove: vi.fn(async () => ({ ok: true })),
    };
  }
  afterEach(() => { delete globalThis.WebviewManager; delete globalThis.ArchiveLibrary; delete globalThis.window.vex; });

  it('makes a copy in the archive store and remembers that it did', async () => {
    stubBrowser();
    const rec = await VexOfflinePages.markActive();
    expect(globalThis.ArchiveLibrary.archiveActive).toHaveBeenCalledTimes(1);
    expect(rec).toMatchObject({ url: 'https://news.test/a', id: 'arch1', owned: true });
    expect(VexOfflinePages.isOffline('https://news.test/a#section')).toBe(true);
    await expect(VexOfflinePages.markActive()).rejects.toThrow(/already available offline/);
  });

  it('un-marking removes only a copy it made itself', async () => {
    stubBrowser();
    await VexOfflinePages.markActive();
    await VexOfflinePages.unmark('https://news.test/a');
    expect(globalThis.window.vex.pageArchiveRemove).toHaveBeenCalledWith('arch1');

    stubBrowser({ existing: { id: 'mine', title: 'Kept by me', bytes: 1 }, url: 'https://news.test/b' });
    const rec = await VexOfflinePages.markActive();
    expect(rec.owned).toBe(false);
    expect(globalThis.ArchiveLibrary.archiveActive).not.toHaveBeenCalled();
    await VexOfflinePages.unmark('https://news.test/b');
    expect(globalThis.window.vex.pageArchiveRemove).not.toHaveBeenCalled();
  });

  it('refuses a page that is not a web page and passes on the archive refusal', async () => {
    stubBrowser({ url: 'vex://settings' });
    await expect(VexOfflinePages.markActive()).rejects.toThrow(/Only a web page/);
    stubBrowser();
    globalThis.ArchiveLibrary.archiveActive = vi.fn(async () => { throw new Error('Private, Tor and routed tabs are never archived'); });
    await expect(VexOfflinePages.markActive()).rejects.toThrow(/never archived/);
    expect(VexOfflinePages.list()).toEqual([]);
  });

  it('builds its brief section with no network at all', () => {
    const fetchSpy = vi.fn(() => { throw new Error('network used'); });
    globalThis.fetch = fetchSpy;
    localStorage.setItem('vex.offline.pages', JSON.stringify([{ url: 'https://x.test/', title: 'X', id: 'i1', at: Date.now() }]));
    const b = VexOfflinePages.build(Date.now(), { online: false });
    expect(b.id).toBe('offline-ready');
    expect(b.online).toBe(false);
    expect(b.lines[0]).toMatchObject({ text: 'X', offlineId: 'i1' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens a marked copy through the archive viewer', async () => {
    stubBrowser();
    await VexOfflinePages.markActive();
    await VexOfflinePages.open('https://news.test/a');
    expect(globalThis.ArchiveLibrary.openCopy).toHaveBeenCalledWith('arch1');
  });
});

// ------------------------------------------------------------- Year in Vex
describe('VexYearInVex', () => {
  const y = 2026;
  const at = (m, d) => new Date(y, m - 1, d, 12).toISOString();
  const deps = {
    history: [
      { url: 'https://www.a.test/1', visitedAt: at(3, 1) },
      { url: 'https://a.test/2', visitedAt: at(4, 1) },
      { url: 'https://b.test/', visitedAt: at(5, 1) },
      { url: 'https://old.test/', visitedAt: new Date(2024, 1, 1).toISOString() },
      { url: 'https://secret.test/', visitedAt: at(6, 1), ownSession: true },
    ],
    readLater: [{ at: new Date(y, 1, 1).getTime(), read: true }, { at: new Date(y, 2, 1).getTime(), read: false }],
    notes: [{ createdAt: at(2, 2) }, { createdAt: new Date(2020, 1, 1).toISOString() }],
    toolHistory: { 'json-format': [{ at: new Date(y, 0, 5).getTime() }, { at: new Date(2019, 0, 1).getTime() }] },
    projects: [{ at: new Date(y, 3, 1).getTime() }],
    watches: [{ addedAt: new Date(y, 1, 1).getTime(), lastChangedAt: new Date(y, 8, 1).getTime() }],
    github: [{ addedAt: new Date(y, 1, 1).getTime() }],
    prices: { k: { points: [{ day: y + '-02-01', cents: 100 }] } },
    offline: [{ at: new Date(y, 4, 4).getTime() }],
    habits: [{ name: 'Read', done: [y + '-01-01', y + '-01-02', '2025-12-31'] }],
  };

  it('counts only this year, merges www, and leaves own-session visits out', () => {
    const c = VexYearInVex.collect(y, deps);
    expect(c.read.visits).toBe(3);
    expect(c.read.sites).toBe(2);
    expect(c.read.topSites[0]).toEqual({ host: 'a.test', n: 2 });
    expect(c.read.saved).toBe(2);
    expect(c.read.finished).toBe(1);
    expect(c.built).toMatchObject({ notes: 1, toolResults: 1, projects: 1 });
    expect(c.watched).toMatchObject({ pages: 1, changed: 1, repos: 1, products: 1, offline: 1 });
    expect(c.habits).toMatchObject({ days: 2, best: { name: 'Read', days: 2 } });
    expect(c.errors).toEqual([]);
  });

  it('is enabled in December and early January, for the year that ended in January', () => {
    expect(VexYearInVex.isEnabled(new Date(2026, 11, 20))).toBe(true);
    expect(VexYearInVex.isEnabled(new Date(2027, 0, 5))).toBe(true);
    expect(VexYearInVex.isEnabled(new Date(2027, 0, 20))).toBe(false);
    expect(VexYearInVex.isEnabled(new Date(2026, 5, 1))).toBe(false);
    expect(VexYearInVex.yearFor(new Date(2027, 0, 5))).toBe(2026);
  });

  it('builds a brief section and a page with no network and no share control', () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const b = VexYearInVex.build(new Date(2026, 11, 20), deps);
    expect(b.id).toBe('year-in-vex');
    expect(b.lines.length).toBeGreaterThan(0);
    const page = VexYearInVex.open(new Date(2026, 11, 20), deps);
    expect(page.textContent).toMatch(/nothing was uploaded/);
    expect(page.querySelector('[data-share], .share')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------- badges
describe('VexBadges', () => {
  it('is off until switched on, and never shares', () => {
    expect(VexBadges.isEnabled()).toBe(false);
    VexExtras.set('badges', true);
    expect(VexBadges.isEnabled()).toBe(true);
    expect(JSON.stringify(Object.keys(VexBadges))).not.toMatch(/share|upload|send/i);
  });

  it('earns each level once and announces it', () => {
    const seen = [];
    document.addEventListener('vex:badge-earned', (e) => seen.push(e.detail.id), { once: false });
    expect(VexBadges.observe({ goal: 'inbox', streak: 2 })).toEqual([]);
    expect(VexBadges.observe({ goal: 'inbox', streak: 8 }).map(b => b.id)).toEqual(['inbox:3', 'inbox:7']);
    expect(VexBadges.observe({ goal: 'inbox', streak: 9 })).toEqual([]);
    expect(seen).toEqual(['inbox:3', 'inbox:7']);
    expect(VexBadges.earned().map(b => b.id).sort()).toEqual(['inbox:3', 'inbox:7']);
  });

  it('rejects a malformed update loudly', () => {
    expect(() => VexBadges.observe({ goal: '', streak: 3 })).toThrow(/needs a goal/);
    expect(() => VexBadges.observe({ goal: 'tabs', streak: 'many' })).toThrow(/number of days/);
  });

  it('listens for the streak event only while enabled', () => {
    VexBadges.start();
    document.dispatchEvent(new CustomEvent('vex:streak-updated', { detail: { goal: 'focus', streak: 7 } }));
    expect(VexBadges.earned()).toEqual([]);
    VexExtras.set('badges', true);
    document.dispatchEvent(new CustomEvent('vex:streak-updated', { detail: { goal: 'focus', streak: 7 } }));
    expect(VexBadges.earned().map(b => b.id).sort()).toEqual(['focus:3', 'focus:7']);
  });

  it('reads the streak module without writing to it or duplicating its counters', () => {
    const calls = [];
    const mod = {
      days: () => ({}),
      goals: () => ({ tabs: 15, focus: 25 }),
      streak: (_d, goal) => { calls.push(goal); return goal === 'tabs' ? 30 : 0; },
    };
    const won = VexBadges.pull(new Date(2026, 9, 16), mod);
    expect(calls).toEqual(['inbox', 'tabs', 'focus']);
    expect(won.map(b => b.id)).toEqual(['tabs:3', 'tabs:7', 'tabs:30']);
    expect(localStorage.getItem('vex.brief.streaks')).toBeNull();
    expect(VexBadges.pull(new Date(), null)).toEqual([]);
  });

  it('counts a day without late-night browsing only when Vex was used that day', () => {
    const k = (d) => VexBadges.dayKey(d);
    const now = new Date(2026, 9, 16, 15);
    const days = {
      [k(new Date(2026, 9, 16))]: { seen: true, late: false },
      [k(new Date(2026, 9, 15))]: { seen: true, late: false },
      [k(new Date(2026, 9, 14))]: { seen: true, late: true },
      [k(new Date(2026, 9, 13))]: { seen: true, late: false },
    };
    expect(VexBadges.lateNightStreak(days, now)).toBe(2);
    days[k(new Date(2026, 9, 16))] = { seen: true, late: true };
    expect(VexBadges.lateNightStreak(days, now)).toBe(0);
    expect(VexBadges.lateNightStreak({}, now)).toBe(0);
  });

  it('marks a visit at 02:30 as late and one at 14:00 as not', () => {
    expect(VexBadges.noteActivity(new Date(2026, 9, 16, 14))).toMatchObject({ seen: true, late: false });
    expect(VexBadges.noteActivity(new Date(2026, 9, 16, 2, 30)).late).toBe(true);
  });
});

// --------------------------------------------------------------- shared bits
describe('VexExtras', () => {
  it('builds one Settings group at runtime and persists a toggle', () => {
    document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"><div class="setting-group"><div id="ai-memory-panel-content"></div></div></div></div>';
    VexExtras._toggles = [];
    VexExtras.registerToggle({ key: 'demoA', label: 'Demo A', hint: 'hint', def: false });
    VexExtras.registerToggle({ key: 'demoB', label: 'Demo B', def: true });
    const group = document.getElementById('vex-extras-settings');
    expect(group).not.toBeNull();
    expect(group.previousElementSibling.querySelector('#ai-memory-panel-content')).not.toBeNull();
    const boxes = group.querySelectorAll('input[type=checkbox]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));
    expect(VexExtras.get('demoA', false)).toBe(true);
    // a second group is never created
    VexExtras.mountSettings();
    expect(document.querySelectorAll('#vex-extras-settings')).toHaveLength(1);
  });

  it('adds commands to the command bar list once', () => {
    globalThis.CommandBar = { commands: [] };
    VexExtras._commands = [];
    VexExtras.registerCommand({ id: 'demo-cmd', label: 'Demo', action() {} });
    VexExtras.registerCommand({ id: 'demo-cmd', label: 'Demo', action() {} });
    expect(globalThis.CommandBar.commands.filter(c => c.id === 'demo-cmd')).toHaveLength(1);
    expect(() => VexExtras.registerCommand({ id: 'x' })).toThrow(/needs an id and an action/);
  });

  it('sets page text as text, never as markup', () => {
    const page = VexExtras.openReport({
      id: 'vex-test-report', title: '<img src=x onerror=alert(1)>', sections: [{ title: 'S', rows: [{ text: '<b>bold</b>', sub: '<i>x</i>' }] }],
    });
    expect(page.querySelector('img')).toBeNull();
    expect(page.querySelector('b')).toBeNull();
    expect(page.textContent).toContain('<b>bold</b>');
  });

  it('refuses unreadable stored settings instead of overwriting them', () => {
    localStorage.setItem('vex.extras', '{not json');
    expect(() => VexExtras.get('a', 1)).toThrow(/could not be read/);
    expect(() => VexExtras.set('a', 1)).toThrow(/could not be read/);
  });
});
