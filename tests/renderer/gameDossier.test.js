// @vitest-environment jsdom
//
// Game dossier (js/game-dossier.js): what is remembered while a game runs, what
// is never remembered, the bounds, promote-to-guide, export, migration, and that
// nothing is recorded while Game mode or the per-game switch is off.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

require('../../src/renderer/js/vex-utils.js');
const { GameSession } = require('../../src/renderer/js/game-session.js');
const { GameDossier } = require('../../src/renderer/js/game-dossier.js');

const ROBLOX = { id: 'g_robloxplayerbeta', name: 'Roblox', exe: 'robloxplayerbeta' };
const T0 = 1_700_000_000_000;
const KEY = 'vex.gameDossier';

let tabs;
let activeTabId;

function tab(id, url, title, extra = {}) {
  const t = { id, url, title, partition: 'persist:main', ...extra };
  tabs.push(t);
  return t;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('vex.gameMode', 'on');
  localStorage.setItem('vex.gameMode.games', JSON.stringify([ROBLOX]));
  localStorage.setItem('vex.gameMode.pages', JSON.stringify({}));
  GameDossier._data = null;
  GameDossier._frozen = false;
  GameDossier._visits = new Map();
  GameDossier._fg = null;
  clearTimeout(GameDossier._timer);
  GameDossier._timer = null;
  document.body.innerHTML = '';
  GameSession.active = true;
  GameSession.gameId = ROBLOX.id;
  GameSession.app = 'Roblox';
  GameSession._guide = null;
  globalThis.GameSession = GameSession;
  window.GameSession = GameSession;
  window.VexProblems = { note: vi.fn() };
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.vexPrompt = vi.fn(async () => null);
  window.VexTabPolicy = { isPrivateWindow: false, canShareTab: (t) => !!t && t.partition === 'persist:main' };
  delete window.Recall;
  delete globalThis.Recall;
  delete window.vex;
  tabs = [];
  activeTabId = 1;
  globalThis.TabManager = { get tabs() { return tabs; }, get activeTabId() { return activeTabId; } };
  localStorage.setItem('vex.gameDossier.on', 'on');
});

const flush = () => { GameDossier.flush(); GameDossier._save(true); };
const stored = () => JSON.parse(localStorage.getItem(KEY));

describe('what is remembered', () => {
  it('records a page, its title, visits and time in front', () => {
    tab(1, 'https://roblox.fandom.com/wiki/Swords', 'Swords | Roblox Wiki');
    expect(GameDossier.onSettled(1, T0)).toBe('recorded');
    GameDossier.onActivated(2, T0 + 90_000);   // another tab comes to the front
    flush();
    const e = stored().games[ROBLOX.id].entries[0];
    expect(e.url).toBe('https://roblox.fandom.com/wiki/Swords');
    expect(e.title).toBe('Swords | Roblox Wiki');
    expect(e.visits).toBe(1);
    expect(e.seconds).toBe(90);
    expect(stored().v).toBe(1);
  });

  it('counts a second visit on the same address and keeps one row', () => {
    const t = tab(1, 'https://wiki.example/a', 'A');
    GameDossier.onSettled(1, T0);
    GameDossier.onSettled(1, T0 + 5000);
    expect(GameDossier.entries(ROBLOX.id)).toHaveLength(1);
    expect(GameDossier.entries(ROBLOX.id)[0].visits).toBe(2);
    expect(t.url).toContain('wiki.example');
  });

  it('caps one stretch in front at 20 minutes (a tab left open while away)', () => {
    tab(1, 'https://wiki.example/long', 'Long');
    GameDossier.onSettled(1, T0);
    GameDossier.onClosed(1, T0 + 5 * 3600_000);
    expect(GameDossier.entries(ROBLOX.id)[0].seconds).toBe(20 * 60);
  });

  it('reads a search from the engine results address', () => {
    expect(GameDossier.searchQueryOf('https://www.google.com/search?q=best+sword+build&hl=en')).toBe('best sword build');
    expect(GameDossier.searchQueryOf('https://duckduckgo.com/?q=maze+map')).toBe('maze map');
    expect(GameDossier.searchQueryOf('https://www.youtube.com/results?search_query=speedrun')).toBe('speedrun');
    expect(GameDossier.searchQueryOf('https://example.com/search?q=nope')).toBe('');
    tab(1, 'https://www.bing.com/search?q=boss+weakness', 'boss weakness - Bing');
    GameDossier.onSettled(1, T0);
    GameDossier.onSettled(1, T0 + 10);
    expect(GameDossier.searches(ROBLOX.id)).toEqual([{ q: 'boss weakness', at: T0 + 10, n: 2 }]);
  });

  it('takes a snippet from Recall only when Recall is on and knows that exact page', async () => {
    window.Recall = { enabled: () => true, isExcluded: () => false };
    globalThis.Recall = window.Recall;
    window.vex = { recallSearch: vi.fn(async () => ({ hits: [{ url: 'https://wiki.example/a', snippet: [['Use the ', false], ['bow', true], [' on bosses', false]] }] })) };
    tab(1, 'https://wiki.example/a', 'Bow guide');
    GameDossier.onSettled(1, T0);
    await vi.waitFor(() => expect(GameDossier.entries(ROBLOX.id)[0].snippet).toBe('Use the bow on bosses'));
    expect(window.vex.recallSearch).toHaveBeenCalledWith('Bow guide', { site: 'wiki.example', limit: 8 });

    // Recall off: no lookup at all.
    window.Recall = { enabled: () => false, isExcluded: () => false };
    globalThis.Recall = window.Recall;
    window.vex.recallSearch.mockClear();
    tab(2, 'https://wiki.example/b', 'B');
    GameDossier.onSettled(2, T0);
    await Promise.resolve();
    expect(window.vex.recallSearch).not.toHaveBeenCalled();
  });
});

describe('what is never remembered', () => {
  const settle = (url, extra, title = 'Some page') => { tabs.length = 0; tab(1, url, title, extra); return GameDossier.onSettled(1, T0); };

  it('private window, private/Tor/burner tab, non-web pages', () => {
    window.VexTabPolicy.isPrivateWindow = true;
    expect(settle('https://wiki.example/a')).toBe('private');
    window.VexTabPolicy.isPrivateWindow = false;
    expect(settle('https://wiki.example/a', { partition: 'otr:tor-1' })).toBe('private-tab');
    expect(settle('file:///C:/notes.txt')).toBe('not-web');
    expect(settle('vex://settings')).toBe('not-web');
    expect(GameDossier.count(ROBLOX.id)).toBe(0);
  });

  it('sign-in, payment, bank, mail and token pages', () => {
    for (const url of [
      'https://accounts.google.com/signin/v2',
      'https://www.paypal.com/myaccount/summary',
      'https://mybank.example/dashboard',
      'https://shop.example/checkout/payment',
      'https://mail.google.com/mail/u/0/',
      'https://wiki.example/page?access_token=abc',
      'https://roblox.com/login',
    ]) expect(settle(url), url).toBe('sensitive');
    expect(settle('https://wiki.example/a', {}, 'Sign in to continue')).toBe('sensitive');
    expect(GameDossier.count(ROBLOX.id)).toBe(0);
  });

  it('a site on the never-remember list or Recall exclusion list, and what was kept goes with it', () => {
    tab(1, 'https://forum.example/thread/1', 'Thread');
    GameDossier.onSettled(1, T0);
    expect(GameDossier.count(ROBLOX.id)).toBe(1);
    expect(GameDossier.addNever('forum.example')).toBe(1);
    expect(GameDossier.count(ROBLOX.id)).toBe(0);
    expect(settle('https://sub.forum.example/x')).toBe('never');
    window.Recall = { enabled: () => false, isExcluded: (u) => u.includes('secret.example') };
    expect(settle('https://secret.example/x')).toBe('recall-excluded');
  });

  it('the start page', () => {
    globalThis.isStartPage = (u) => u.includes('start.html');
    expect(settle('https://start.html.example/start.html')).toBe('start-page');
    delete globalThis.isStartPage;
  });

  it('a navigation to a skipped page ends the earlier visit (nothing is timed on it)', () => {
    tab(1, 'https://wiki.example/a', 'A');
    GameDossier.onSettled(1, T0);
    tabs[0].url = 'https://accounts.google.com/signin';
    expect(GameDossier.onSettled(1, T0 + 1000)).toBe('sensitive');
    GameDossier.flushVisits(T0 + 60_000);
    expect(GameDossier.entries(ROBLOX.id)[0].seconds).toBe(1);
  });
});

describe('only while Game mode runs the game, and the switch is on', () => {
  it('nothing is recorded with Game mode off or no game running', () => {
    GameSession.active = false;
    GameSession.gameId = '';
    tab(1, 'https://wiki.example/a', 'A');
    expect(GameDossier.onSettled(1, T0)).toBe('no-game');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(GameDossier.count(ROBLOX.id)).toBe(0);
  });

  it('is off by default: no global and no per-game switch records nothing', () => {
    localStorage.removeItem('vex.gameDossier.on');
    expect(GameDossier.enabledFor(ROBLOX.id)).toBe(false);
    tab(1, 'https://wiki.example/a', 'A');
    expect(GameDossier.onSettled(1, T0)).toBe('off');
    expect(GameDossier.count(ROBLOX.id)).toBe(0);
  });

  it('the per-game switch beats the global one, both ways', () => {
    localStorage.setItem('vex.gameDossier.games', JSON.stringify({ [ROBLOX.id]: 'off' }));
    tab(1, 'https://wiki.example/a', 'A');
    expect(GameDossier.onSettled(1, T0)).toBe('off');
    localStorage.removeItem('vex.gameDossier.on');
    localStorage.setItem('vex.gameDossier.games', JSON.stringify({ [ROBLOX.id]: 'on' }));
    expect(GameDossier.onSettled(1, T0)).toBe('recorded');
  });

  it('is recorded only for the running game', () => {
    tab(1, 'https://wiki.example/a', 'A');
    GameDossier.onSettled(1, T0);
    expect(Object.keys(GameDossier._load().games)).toEqual([ROBLOX.id]);
  });

  it('the first turn-on explains and waits for yes; a no leaves it off', async () => {
    localStorage.removeItem('vex.gameDossier.on');
    window.vexConfirm = vi.fn(async () => false);
    expect(await GameDossier.setEnabled(null, true)).toBe(false);
    expect(GameDossier.globalOn()).toBe(false);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/never records private windows/i);
    window.vexConfirm = vi.fn(async () => true);
    expect(await GameDossier.setEnabled(ROBLOX.id, true)).toBe(true);
    expect(GameDossier.enabledFor(ROBLOX.id)).toBe(true);
    // Explained once: the next switch does not ask again.
    expect(await GameDossier.setEnabled(null, true)).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('storage bounds', () => {
  it('keeps at most 1,000 pages per game and spares pinned ones', () => {
    for (let i = 0; i < 1100; i++) GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/p' + i, title: 'P' + i }, T0 + i);
    GameDossier.pin(ROBLOX.id, 'https://wiki.example/p0');
    flush();
    const es = stored().games[ROBLOX.id].entries;
    expect(es.length).toBe(1000);
    expect(es.some(e => e.url === 'https://wiki.example/p0' && e.pinned)).toBe(true);
    expect(es.some(e => e.url === 'https://wiki.example/p1099')).toBe(true);
    expect(es.some(e => e.url === 'https://wiki.example/p1')).toBe(false);   // the oldest unpinned went
  });

  it('keeps at most 200 searches per game', () => {
    for (let i = 0; i < 250; i++) GameDossier.recordSearch(ROBLOX.id, 'q' + i, T0 + i);
    flush();
    expect(stored().games[ROBLOX.id].searches.length).toBe(200);
  });

  it('stays under the byte limit by dropping the oldest unpinned pages first', () => {
    const was = GameDossier.MAX_BYTES;
    GameDossier.MAX_BYTES = 20_000;
    try {
      for (let i = 0; i < 100; i++) GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/b' + i, title: 'T'.repeat(150), snippet: 's'.repeat(250) }, T0 + i);
      GameDossier.pin(ROBLOX.id, 'https://wiki.example/b0');
      flush();
      expect(localStorage.getItem(KEY).length).toBeLessThanOrEqual(20_000);
      const urls = stored().games[ROBLOX.id].entries.map(e => e.url);
      expect(urls).toContain('https://wiki.example/b0');
      expect(urls).toContain('https://wiki.example/b99');
      expect(urls).not.toContain('https://wiki.example/b1');
    } finally { GameDossier.MAX_BYTES = was; }
  });

  it('limits pins per game and says so', () => {
    for (let i = 0; i < 101; i++) GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/q' + i, title: 'Q' }, T0 + i);
    for (let i = 0; i < 100; i++) GameDossier.pin(ROBLOX.id, 'https://wiki.example/q' + i);
    expect(() => GameDossier.pin(ROBLOX.id, 'https://wiki.example/q100')).toThrow(/up to 100/);
  });

  it('is file-backed, included in a backup only with browsing history, and never synced', () => {
    const root = path.resolve(__dirname, '../..');
    expect(fs.readFileSync(path.join(root, 'src/renderer/js/storage.js'), 'utf8')).toMatch(/FILE_ONLY_KEYS = new Set\([^)]*'vex\.gameDossier'/);
    expect(fs.readFileSync(path.join(root, 'src/renderer/js/sync-engine.js'), 'utf8')).not.toMatch(/vex\.gameDossier/);
    const { VexBackup } = require('../../src/renderer/js/backup.js');
    expect(VexBackup._isOptional('vex.gameDossier', 'history')).toBe(true);
    expect(VexBackup._blocked('vex.gameDossier')).toBe(false);
    expect(VexBackup._blocked('vex.gameDossier.never')).toBe(false);
  });
});

describe('the guide, the dossier view data and export', () => {
  it('promotes a page into the game\'s guide, once, and says when the guide is full', () => {
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/build', title: 'Best build' }, T0);
    const r = GameDossier.promote(ROBLOX.id, 'https://wiki.example/build');
    expect(r.page.url).toBe('https://wiki.example/build');
    expect(GameSession.pages(ROBLOX.id).map(p => p.url)).toEqual(['https://wiki.example/build']);
    expect(GameDossier.entries(ROBLOX.id)[0].promoted).toBe(true);
    expect(() => GameDossier.promote(ROBLOX.id, 'https://wiki.example/build')).toThrow(/already in/);
    for (let i = 0; i < 11; i++) GameSession.addPage(ROBLOX.id, { url: 'https://g.example/' + i, title: 'g' + i });
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/more', title: 'More' }, T0);
    expect(() => GameDossier.promote(ROBLOX.id, 'https://wiki.example/more')).toThrow(/guide is full/);
  });

  it('groups by day, searches, ranks most used, and clears one or all', () => {
    const day = 86400000;
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/old', title: 'Old sword page' }, T0 - 3 * day);
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/new', title: 'New shield page' }, T0);
    GameDossier.addTime(ROBLOX.id, 'https://wiki.example/old', 600_000);
    const days = GameDossier.byDay(ROBLOX.id);
    expect(days).toHaveLength(2);
    expect(days[0].entries[0].url).toBe('https://wiki.example/new');
    expect(GameDossier.byDay(ROBLOX.id, 'sword').flatMap(d => d.entries).map(e => e.url)).toEqual(['https://wiki.example/old']);
    expect(GameDossier.mostUsed(ROBLOX.id, 1)[0].url).toBe('https://wiki.example/old');
    GameDossier.remove(ROBLOX.id, 'https://wiki.example/old');
    expect(GameDossier.count(ROBLOX.id)).toBe(1);
    GameDossier.clear(ROBLOX.id);
    expect(GameDossier.count(ROBLOX.id)).toBe(0);
  });

  it('exports Markdown with pinned, most used, searches and days', () => {
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/build', title: 'Best [build]', snippet: 'Use the bow.' }, T0);
    GameDossier.pin(ROBLOX.id, 'https://wiki.example/build');
    GameDossier.recordSearch(ROBLOX.id, 'boss weakness', T0);
    const md = GameDossier.toMarkdown(ROBLOX.id, T0);
    expect(md).toMatch(/^# Roblox dossier/);
    expect(md).toContain('## Pinned');
    expect(md).toContain('[Best build](https://wiki.example/build)');
    expect(md).toContain('> Use the bow.');
    expect(md).toContain('## Searches');
    expect(md).toContain('- boss weakness');
    expect(md).toMatch(/## \d{4}-\d{2}-\d{2}/);
    expect(() => { GameDossier.clear(ROBLOX.id); GameDossier.exportMarkdown(ROBLOX.id); }).toThrow(/nothing in this dossier/);
  });

  it('removing a game removes its dossier and its per-game switch', () => {
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/a', title: 'A' }, T0);
    localStorage.setItem('vex.gameDossier.games', JSON.stringify({ [ROBLOX.id]: 'on' }));
    GameSession.removeGame(ROBLOX.id);
    expect(GameDossier.count(ROBLOX.id)).toBe(0);
    expect(JSON.parse(localStorage.getItem('vex.gameDossier.games'))).toEqual({});
  });
});

describe('suggestions with the guide', () => {
  it('are off by default; on, they are recent, most used, not already in the guide, never sensitive', () => {
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/a', title: 'A' }, T0);
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/b', title: 'B' }, T0);
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/old', title: 'Old' }, T0 - 30 * 86400000);
    GameSession.addPage(ROBLOX.id, { url: 'https://wiki.example/b', title: 'B' });
    expect(GameDossier.suggestions(ROBLOX.id, T0)).toEqual([]);
    GameDossier.setSuggest(true);
    expect(GameDossier.suggestions(ROBLOX.id, T0)).toEqual([{ url: 'https://wiki.example/a', title: 'A' }]);
  });
});

describe('migration', () => {
  it('upgrades a file with no version in place', () => {
    localStorage.setItem(KEY, JSON.stringify({ games: { [ROBLOX.id]: { entries: [{ url: 'https://wiki.example/a', title: 'A', last: T0 }, { url: 'javascript:alert(1)', title: 'x' }] } } }));
    expect(GameDossier.migrate()).toBe('upgraded');
    expect(stored().v).toBe(1);
    expect(stored().games[ROBLOX.id].entries.map(e => e.url)).toEqual(['https://wiki.example/a']);
  });

  it('drops an unreadable file and says so', () => {
    localStorage.setItem(KEY, '{nope');
    expect(GameDossier.migrate()).toBe('dropped');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(window.VexProblems.note).toHaveBeenCalled();
  });

  it('leaves a file from a newer Vex exactly as it is and does not write over it', () => {
    const newer = JSON.stringify({ v: 9, games: { x: { entries: [] } }, extra: true });
    localStorage.setItem(KEY, newer);
    expect(GameDossier.migrate()).toBe('newer');
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/a', title: 'A' }, T0);
    GameDossier._save(true);
    expect(localStorage.getItem(KEY)).toBe(newer);
  });
});

describe('the local helper', () => {
  it('asks the local model only, and refuses when Ollama is not set up', async () => {
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/a', title: 'Bow guide', snippet: 'Use the bow' }, T0);
    globalThis.AIRouter = { getOllamaStatus: () => ({ available: false, model: '' }), callAI: vi.fn() };
    globalThis.Ollama = { generate: vi.fn(async () => '- Bows beat bosses') };
    await expect(GameDossier.summarise(ROBLOX.id)).rejects.toThrow(/not set up/);
    globalThis.AIRouter.getOllamaStatus = () => ({ available: true, model: 'qwen:7b' });
    expect(await GameDossier.summarise(ROBLOX.id)).toBe('- Bows beat bosses');
    expect(Ollama.generate.mock.calls[0][0]).toBe('qwen:7b');
    expect(Ollama.generate.mock.calls[0][1]).toContain('Bow guide: Use the bow');
    expect(AIRouter.callAI).not.toHaveBeenCalled();
    delete globalThis.Ollama; delete globalThis.AIRouter;
  });
});

describe('the view', () => {
  it('opens as a dialog with the page, promotes and deletes through buttons', async () => {
    window.TabManager = globalThis.TabManager;
    GameDossier.record(ROBLOX.id, { url: 'https://wiki.example/build', title: 'Best build', snippet: 'Use the bow' }, T0);
    const overlay = GameDossier.openView(ROBLOX.id);
    const dlg = overlay.querySelector('[role=dialog]');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.textContent).toContain('Best build');
    expect(dlg.textContent).toContain('Use the bow');
    [...dlg.querySelectorAll('button')].find(b => b.textContent === 'Add to my guide').click();
    expect(GameSession.pages(ROBLOX.id)).toHaveLength(1);
    [...dlg.querySelectorAll('button')].find(b => b.textContent === 'Delete').click();
    expect(GameDossier.count(ROBLOX.id)).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.gd-dialog')).toBeNull();
  });
});
