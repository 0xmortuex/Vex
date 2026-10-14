// @vitest-environment jsdom
//
// Game mode (js/game-session.js): the state machine, what waits and comes
// back, the game's guide panel, the saved choices — and that while a game runs
// nothing is written to the profile.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const { GameSession } = require('../../src/renderer/js/game-session.js');
const { GameMode } = require('../../src/renderer/js/game-mode.js');
const { SidebarManager } = require('../../src/renderer/js/sidebar.js');

const ROBLOX = { id: 'g_robloxplayerbeta', name: 'Roblox', exe: 'robloxplayerbeta' };
const START = { game: true, app: 'Roblox', id: ROBLOX.id, listed: true, fullscreen: false };
const STOP = { game: false, app: '', id: '', listed: false, fullscreen: false };

let stateCb;
let setItem;

function setUp({ mode = 'on', games = [ROBLOX], pages = {} } = {}) {
  localStorage.clear();
  if (mode) localStorage.setItem('vex.gameMode', mode);
  if (games) localStorage.setItem('vex.gameMode.games', JSON.stringify(games));
  localStorage.setItem('vex.gameMode.pages', JSON.stringify(pages));
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-reduce-motion');
  document.body.className = '';
  document.body.innerHTML = `
    <div id="game-mode-chip" hidden><span class="game-mode-chip-icon"></span><span class="game-mode-chip-label">Game mode on</span><button id="game-mode-off" type="button">Turn off for now</button></div>
    <div id="icon-sidebar"><button class="sidebar-icon" data-panel="notes" title="Notes"></button><div class="sidebar-spacer"></div></div>
    <div id="panels-container"><div class="panel" id="panel-notes"></div></div>`;
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() };
  window.vexConfirm = vi.fn(async () => true);
  window.vexPrompt = vi.fn(async () => null);
  window.VexTabPolicy = { isPrivateWindow: false };
  stateCb = null;
  window.vex = {
    onGameState: vi.fn((cb) => { stateCb = cb; }),
    gameState: vi.fn(async () => STOP),
    gameModeSession: vi.fn(async () => ({})),
    gameModeGames: vi.fn(async () => ({})),
  };
  GameSession.active = false; GameSession.app = ''; GameSession.gameId = '';
  GameSession._suspended = false; GameSession._asked = false; GameSession._last = null;
  GameSession._guide = null; GameSession._calm = false; GameSession._wired = false;
  GameMode.gaming = false; GameMode._gamingReport = null;
  globalThis.TabManager = { tabs: [], activeTabId: 1, getActiveTab: () => ({ id: 1, url: 'https://wiki.example/roblox/build', title: 'Build guide' }), sleepTab: vi.fn(), isCapturing: () => false, mayAskSiteForIcon: () => false };
  document.hasFocus = () => true;
  globalThis.GameSession = GameSession;
  globalThis.SidebarManager = SidebarManager;
  SidebarManager.activePanel = null; SidebarManager.sidePanel = null;
  for (const k of Object.keys(SidebarManager.panelConfigs)) if (k.startsWith('gameguide_')) delete SidebarManager.panelConfigs[k];
  vi.spyOn(SidebarManager, 'showPanel').mockImplementation((n) => { SidebarManager.activePanel = n; SidebarManager.sidePanel = null; });
  vi.spyOn(SidebarManager, 'openBeside').mockImplementation((n) => { SidebarManager.sidePanel = n; });
  vi.spyOn(SidebarManager, 'hideActivePanel').mockImplementation(() => { SidebarManager.activePanel = null; SidebarManager.sidePanel = null; });
  vi.spyOn(SidebarManager, 'closeBeside').mockImplementation(() => { SidebarManager.sidePanel = null; });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.SleepConsent;
});

describe('the saved choice', () => {
  it('a profile that never saw Game mode asks, and is off until it answers', () => {
    localStorage.clear();
    expect(GameSession.mode()).toBe('ask');
    expect(GameSession.enabled()).toBe(false);
    expect(GameSession.sleepAllowed()).toBe(false);
  });

  it('on and off are remembered; nothing else is accepted', () => {
    localStorage.clear();
    GameSession.setMode('on');
    expect(GameSession.mode()).toBe('on');
    GameSession.setMode('off');
    expect(GameSession.mode()).toBe('off');
    expect(() => GameSession.setMode('ask')).toThrow(/on or off/);
    localStorage.setItem('vex.gameMode', 'maybe');
    expect(GameSession.mode()).toBe('ask');
  });
});

describe('settings migration', () => {
  it('leaves the existing Gaming switches exactly as they are', () => {
    localStorage.clear();
    localStorage.setItem('vex.game.sleepTabs', 'off');
    localStorage.setItem('vex.game.holdAi', 'on');
    localStorage.setItem('vex.sleepConsent', 'never');
    expect(GameSession.migrate()).toEqual([]);
    expect(localStorage.getItem('vex.game.sleepTabs')).toBe('off');
    expect(localStorage.getItem('vex.game.holdAi')).toBe('on');
    expect(localStorage.getItem('vex.sleepConsent')).toBe('never');
    expect(localStorage.getItem('vex.gameMode')).toBeNull();     // nothing is invented
  });

  it('drops an unreadable list and an unknown mode, and says so; keeps what is good', () => {
    localStorage.clear();
    localStorage.setItem('vex.gameMode.games', '{not json');
    localStorage.setItem('vex.gameMode.pages', JSON.stringify({ g_x: [{ url: 'https://a.example/', title: 'A' }] }));
    localStorage.setItem('vex.gameMode', 'sometimes');
    const dropped = GameSession.migrate();
    expect(dropped.sort()).toEqual(['vex.gameMode', 'vex.gameMode.games']);
    expect(localStorage.getItem('vex.gameMode.pages')).not.toBeNull();
    expect(GameSession.games()).toEqual([]);
    expect(GameSession.mode()).toBe('ask');
  });

  it('a list of the wrong shape is dropped too', () => {
    localStorage.clear();
    localStorage.setItem('vex.gameMode.games', JSON.stringify({ a: 1 }));
    localStorage.setItem('vex.gameMode.pages', JSON.stringify([1, 2]));
    expect(GameSession.migrate().sort()).toEqual(['vex.gameMode.games', 'vex.gameMode.pages']);
  });
});

describe('the game list and the guide pages', () => {
  it('adds a game by program name, once; the name defaults to the program', () => {
    localStorage.clear();
    const g = GameSession.addGame({ name: '', exe: 'C:\\Games\\FooClient.EXE' });
    expect(g).toMatchObject({ exe: 'fooclient', name: 'fooclient' });
    expect(() => GameSession.addGame({ name: 'Again', exe: 'fooclient.exe' })).toThrow(/already in the list/);
    expect(() => GameSession.addGame({ name: 'x', exe: '   ' })).toThrow(/program name/);
    expect(window.vex.gameModeGames).toHaveBeenCalled();
  });

  it('the list reaches main with the switch: watched unless the answer is no', async () => {
    setUp({ mode: 'on' });
    await GameSession.syncWatch();
    expect(window.vex.gameModeGames).toHaveBeenLastCalledWith([ROBLOX], true);
    GameSession.setMode('off');
    expect(window.vex.gameModeGames).toHaveBeenLastCalledWith([ROBLOX], false);
    setUp({ mode: null });
    await GameSession.syncWatch();
    expect(window.vex.gameModeGames).toHaveBeenLastCalledWith([ROBLOX], true);   // asking needs to notice the game
  });

  it('saves only web pages, no duplicates, a limited number', () => {
    setUp();
    expect(() => GameSession.addPage(ROBLOX.id, { url: 'file:///C:/secret.txt', title: 'x' })).toThrow(/web page/);
    expect(() => GameSession.addPage(ROBLOX.id, { url: 'javascript:alert(1)', title: 'x' })).toThrow(/web page/);
    GameSession.addPage(ROBLOX.id, { url: 'https://wiki.example/a', title: 'A' });
    expect(() => GameSession.addPage(ROBLOX.id, { url: 'https://wiki.example/a', title: 'A' })).toThrow(/already in/);
    for (let i = 0; i < GameSession.MAX_PAGES - 1; i++) GameSession.addPage(ROBLOX.id, { url: 'https://wiki.example/p' + i, title: 'P' });
    expect(() => GameSession.addPage(ROBLOX.id, { url: 'https://wiki.example/over', title: 'P' })).toThrow(/full/);
    expect(() => GameSession.addPage('g_nobody', { url: 'https://a.example/', title: 'A' })).toThrow(/not in the list/);
  });

  it('removing a game removes its pages', () => {
    setUp({ pages: { [ROBLOX.id]: [{ url: 'https://wiki.example/a', title: 'A' }] } });
    GameSession.removeGame(ROBLOX.id);
    expect(GameSession.games()).toEqual([]);
    expect(GameSession.pagesByGame()[ROBLOX.id]).toBeUndefined();
  });

  it('Ctrl+K names the game when there is one to name', async () => {
    setUp({ games: [ROBLOX, { id: 'g_two', name: 'Two', exe: 'two' }] });
    expect(GameSession.addPageLabel()).toBe('Add this page to a game’s guide');
    setUp({ games: [ROBLOX] });
    expect(GameSession.addPageLabel()).toBe('Add this page to Roblox’s guide');
    const r = await GameSession.addCurrentPage();
    expect(r.page.url).toBe('https://wiki.example/roblox/build');
    expect(GameSession.pages(ROBLOX.id)).toHaveLength(1);
    expect(window.showToast).toHaveBeenCalledWith('Added to Roblox’s guide');
  });

  it('with several games and none running, it asks which; an unknown answer is an error', async () => {
    setUp({ games: [ROBLOX, { id: 'g_two', name: 'Two', exe: 'two' }] });
    window.vexPrompt = vi.fn(async () => 'two');
    const r = await GameSession.addCurrentPage();
    expect(r.game.id).toBe('g_two');
    window.vexPrompt = vi.fn(async () => 'nothing');
    await expect(GameSession.addCurrentPage()).rejects.toThrow(/No game called/);
    window.vexPrompt = vi.fn(async () => null);
    expect(await GameSession.addCurrentPage()).toBeNull();      // cancelled
  });

  it('no game yet: says where to add one', async () => {
    setUp({ games: [] });
    await expect(GameSession.addCurrentPage()).rejects.toThrow(/Add a game first/);
  });
});

describe('the state machine', () => {
  it('a game starting turns Game mode on: chip, calm, priority, holds — and its end turns it all off', () => {
    setUp();
    expect(GameSession.onState(START)).toBe('running');
    expect(GameSession.active).toBe(true);
    expect(document.getElementById('game-mode-chip').hidden).toBe(false);
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(true);
    expect(document.body.classList.contains('vex-game-mode')).toBe(true);
    expect(window.vex.gameModeSession).toHaveBeenCalledWith({ on: true, app: 'Roblox', holds: GameSession.HOLDS });
    for (const k of GameSession.HOLDS) expect(GameSession.holds(k)).toBe(true);

    expect(GameSession.onState(STOP)).toBe('idle');
    expect(GameSession.active).toBe(false);
    expect(document.getElementById('game-mode-chip').hidden).toBe(true);
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(false);
    expect(document.body.classList.contains('vex-game-mode')).toBe(false);
    expect(window.vex.gameModeSession).toHaveBeenLastCalledWith({ on: false });
    for (const k of GameSession.HOLDS) expect(GameSession.holds(k)).toBe(false);
  });

  it('a game that was never listed (a full-screen game) starts it too', () => {
    setUp({ games: [] });
    expect(GameSession.onState({ game: true, app: 'SomeGame', fullscreen: true, listed: false, id: '' })).toBe('running');
    expect(GameSession.app).toBe('SomeGame');
    expect(GameSession.gameId).toBe('');
  });

  it('start while running: the same state again does nothing twice', () => {
    setUp();
    GameSession.onState(START);
    GameSession.onState(START);
    GameSession.onState({ ...START, app: 'Roblox Player' });
    expect(window.vex.gameModeSession).toHaveBeenCalledTimes(1);
    expect(GameSession.app).toBe('Roblox Player');
  });

  it('Vex started with the game already running: it finds it at launch', async () => {
    setUp();
    window.vex.gameState = vi.fn(async () => START);
    await GameSession.init();
    expect(window.vex.gameModeGames).toHaveBeenCalled();
    expect(GameSession.active).toBe(true);
  });

  it('after a crash or a reload: a leftover session in main is ended first, and nothing starts if no game is there', async () => {
    setUp();
    window.vex.gameState = vi.fn(async () => STOP);
    const order = [];
    window.vex.gameModeSession = vi.fn(async (p) => { order.push(p.on ? 'begin' : 'end'); });
    await GameSession.init();
    expect(order).toEqual(['end']);
    expect(GameSession.active).toBe(false);
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(false);
  });

  it('a reload mid-game ends the leftover session, then begins again because the game is still there', async () => {
    setUp();
    window.vex.gameState = vi.fn(async () => START);
    const order = [];
    window.vex.gameModeSession = vi.fn(async (p) => { order.push(p.on ? 'begin' : 'end'); });
    await GameSession.init();
    expect(order).toEqual(['end', 'begin']);
  });

  it('answered no: a game starting changes nothing at all', () => {
    setUp({ mode: 'off' });
    expect(GameSession.onState(START)).toBe('off');
    expect(GameSession.active).toBe(false);
    expect(window.vex.gameModeSession).not.toHaveBeenCalled();
    expect(document.getElementById('game-mode-chip').hidden).toBe(true);
  });

  it('turning it on while a game is already running starts it now; off puts it back now', () => {
    setUp({ mode: 'off' });
    GameSession.onState(START);
    GameSession.setMode('on');
    expect(GameSession.active).toBe(true);
    GameSession.setMode('off');
    expect(GameSession.active).toBe(false);
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(false);
  });

  it('a private window never starts it', () => {
    setUp();
    window.VexTabPolicy = { isPrivateWindow: true };
    GameSession.onState(START);
    expect(GameSession.active).toBe(false);
    expect(window.vex.gameModeSession).not.toHaveBeenCalled();
  });

  it('Reduce motion the user chose is theirs: on stays on after the game, and is never written', () => {
    setUp();
    document.documentElement.setAttribute('data-reduce-motion', '');
    GameSession.onState(START);
    GameSession.onState(STOP);
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(true);
    expect(localStorage.getItem('vex.reduceMotion')).toBeNull();
  });

  it('the older gaming code is told, and again at the end', () => {
    setUp();
    const start = vi.spyOn(GameMode, 'onGameStart').mockImplementation(async () => ({}));
    const end = vi.spyOn(GameMode, 'onGameEnd').mockImplementation(() => null);
    GameSession.onState(START);
    expect(start).toHaveBeenCalledWith('Roblox');
    GameSession.onState(STOP);
    expect(end).toHaveBeenCalled();
  });
});

describe('Turn off for now', () => {
  it('puts everything back at once and stays off until this game ends', () => {
    setUp();
    const end = vi.spyOn(GameMode, 'onGameEnd').mockImplementation(() => null);
    vi.spyOn(GameMode, 'onGameStart').mockImplementation(async () => ({}));
    GameSession.onState(START);
    document.getElementById('game-mode-off').click();
    expect(GameSession.active).toBe(false);
    expect(end).toHaveBeenCalled();
    expect(document.getElementById('game-mode-chip').hidden).toBe(true);
    expect(window.vex.gameModeSession).toHaveBeenLastCalledWith({ on: false });
    // The game reports itself again (a launcher renamed it): still off.
    expect(GameSession.onState({ ...START, app: 'Roblox Player' })).toBe('off-for-now');
    expect(GameSession.legacyWants({ ...START })).toBe(false);
    expect(GameSession.sleepAllowed()).toBe(false);
    // It ends; the next game starts Game mode again.
    GameSession.onState(STOP);
    expect(GameSession.onState(START)).toBe('running');
  });

  it('is not saved: the switch is still on', () => {
    setUp();
    GameSession.onState(START);
    GameSession.turnOffForNow();
    expect(GameSession.mode()).toBe('on');
  });
});

describe('the first game: ask once, remember the answer', () => {
  it('asks when Vex is in front; yes turns it on and starts it', async () => {
    setUp({ mode: null });
    GameSession.onState(START);
    expect(GameSession.active).toBe(false);
    await vi.waitFor(() => expect(window.vexConfirm).toHaveBeenCalled());
    await vi.waitFor(() => expect(GameSession.mode()).toBe('on'));
    expect(GameSession.active).toBe(true);
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/never touches the game/);
  });

  it('no is remembered and never asked again', async () => {
    setUp({ mode: null });
    window.vexConfirm = vi.fn(async () => false);
    GameSession.onState(START);
    await vi.waitFor(() => expect(GameSession.mode()).toBe('off'));
    GameSession.onState(STOP);
    GameSession.onState(START);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(GameSession.active).toBe(false);
  });

  it('asks once per game, however many times the state is reported', async () => {
    setUp({ mode: null });
    window.vexConfirm = vi.fn(() => new Promise(() => {}));        // never answered
    GameSession.onState(START); GameSession.onState(START); GameSession.onState(START);
    await new Promise(r => setTimeout(r, 5));
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('what waits during a game and what comes back', () => {
  it('Vex Sync and the history index are told to catch up when the game ends', () => {
    setUp();
    window.SyncEngine = { resumeAfterGame: vi.fn() };
    window.HistoryIndexer = { resume: vi.fn() };
    GameSession.onState(START);
    expect(window.SyncEngine.resumeAfterGame).not.toHaveBeenCalled();
    GameSession.onState(STOP);
    expect(window.SyncEngine.resumeAfterGame).toHaveBeenCalledTimes(1);
    expect(window.HistoryIndexer.resume).toHaveBeenCalledTimes(1);
    delete window.SyncEngine; delete window.HistoryIndexer;
  });

  it('the legacy gaming code may sleep tabs on Game mode\'s say-so, but never a pinned tab', async () => {
    setUp();
    globalThis.SleepConsent = { modeFor: () => 'never', offerAfterGame: () => false, renderSettingsState: () => {} };
    GameMode.gaming = false;
    const tabs = [
      { id: 1, title: 'front' }, { id: 2, title: 'idle' }, { id: 3, title: 'pinned', pinned: true },
      { id: 4, title: 'music', audible: true },
    ];
    globalThis.TabManager = {
      tabs, activeTabId: 1, isCapturing: () => false,
      sleepTab: vi.fn(async (id) => { tabs.find(t => t.id === id).sleeping = true; }),
    };
    delete globalThis.ModelManager;
    await GameMode.onGameStart('Roblox');
    expect(TabManager.sleepTab.mock.calls.map(c => c[0])).toEqual([2]);
  });

  it('without Game mode on, "never" still means never', async () => {
    setUp({ mode: 'off' });
    globalThis.SleepConsent = { modeFor: () => 'never', offerAfterGame: () => false, renderSettingsState: () => {} };
    globalThis.TabManager = { tabs: [{ id: 1 }, { id: 2 }], activeTabId: 1, isCapturing: () => false, sleepTab: vi.fn() };
    delete globalThis.ModelManager;
    const r = await GameMode.onGameStart('Roblox');
    expect(TabManager.sleepTab).not.toHaveBeenCalled();
    expect(r.leftAlone).toBe(true);
  });

  it('the legacy listener obeys: a listed game starts it only when Game mode is on', () => {
    setUp({ mode: 'off' });
    expect(GameSession.legacyWants(START)).toBe(false);
    expect(GameSession.legacyWants({ ...START, fullscreen: true })).toBe(true);
    setUp({ mode: 'on' });
    expect(GameSession.legacyWants(START)).toBe(true);
    expect(GameSession.legacyWants(STOP)).toBe(false);
    expect(GameSession.legacyWants({ game: true, app: 'x' })).toBe(true);     // an older main
  });
});

describe('the sync engine and the history indexer wait', () => {
  it('the hooks are where the work starts', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer/js/', p), 'utf8');
    const sync = read('sync-engine.js');
    expect(sync).toMatch(/setInterval\(\(\) => \{ if \(gameHolds\(\)\)/);
    expect(sync).toMatch(/if \(gameHolds\(\)\) \{ owedAfterGame = true; return; \}/);
    expect(sync).toMatch(/resumeAfterGame,/);
    // The last upload before the window closes is never held.
    const close = sync.slice(sync.indexOf('async function pushBeforeClose'), sync.indexOf('function startAutoSync'));
    expect(close).not.toMatch(/gameHolds/);
    expect(read('history-indexer.js')).toMatch(/GameSession\.holds\('indexing'\)/);
    expect(read('recall.js')).toMatch(/GameSession\.holds\('recall'\)/);
  });
});

describe('the guide panel', () => {
  const PAGES = { [ROBLOX.id]: [
    { url: 'https://wiki.example/roblox/build', title: 'Build guide' },
    { url: 'https://maps.example/roblox', title: 'Map' },
  ] };

  it('opens a panel per page when the game starts, the first one beside what is open', () => {
    setUp({ pages: PAGES });
    SidebarManager.activePanel = 'notes';
    vi.spyOn(SidebarManager, '_canSit').mockReturnValue(true);
    GameSession.onState(START);
    const ids = [`gameguide_${ROBLOX.id}_0`, `gameguide_${ROBLOX.id}_1`];
    for (const id of ids) {
      expect(document.getElementById('panel-' + id)).not.toBeNull();
      expect(document.querySelector(`.sidebar-icon[data-panel="${id}"]`)).not.toBeNull();
    }
    expect(SidebarManager.panelConfigs[ids[0]]).toMatchObject({ url: 'https://wiki.example/roblox/build', partition: 'persist:main' });
    expect(SidebarManager.openBeside).toHaveBeenCalledWith(ids[0]);
    expect(SidebarManager.showPanel).not.toHaveBeenCalled();
  });

  it('with nothing open it takes the panel area; with nothing saved it opens nothing', () => {
    setUp({ pages: PAGES });
    GameSession.onState(START);
    expect(SidebarManager.showPanel).toHaveBeenCalledWith(`gameguide_${ROBLOX.id}_0`);

    GameSession.onState(STOP);
    setUp({ pages: {} });
    SidebarManager.showPanel.mockClear();
    GameSession.onState(START);
    expect(SidebarManager.showPanel).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[id^="panel-gameguide_"]')).toHaveLength(0);
  });

  it('closes every guide panel when the game ends and puts the layout back', () => {
    setUp({ pages: PAGES });
    SidebarManager.activePanel = 'notes';
    vi.spyOn(SidebarManager, '_canSit').mockReturnValue(false);   // it replaces Notes rather than sitting beside it
    GameSession.onState(START);
    expect(SidebarManager.activePanel).toBe(`gameguide_${ROBLOX.id}_0`);
    SidebarManager.showPanel.mockClear();
    GameSession.onState(STOP);
    expect(document.querySelectorAll('[id^="panel-gameguide_"]')).toHaveLength(0);
    expect(document.querySelectorAll('.sidebar-icon[data-panel^="gameguide_"]')).toHaveLength(0);
    expect(Object.keys(SidebarManager.panelConfigs).filter(k => k.startsWith('gameguide_'))).toEqual([]);
    expect(SidebarManager.showPanel).toHaveBeenCalledWith('notes');
    expect(SidebarManager.activePanel).toBe('notes');
  });

  it('a user who moved on to another panel is not pulled back', () => {
    setUp({ pages: PAGES });
    GameSession.onState(START);
    SidebarManager.activePanel = 'notes';
    SidebarManager.showPanel.mockClear();
    GameSession.onState(STOP);
    expect(SidebarManager.showPanel).not.toHaveBeenCalled();
  });

  it('a page added while the game runs is there at once', () => {
    setUp({ pages: PAGES });
    GameSession.onState(START);
    GameSession.addPage(ROBLOX.id, { url: 'https://tips.example/', title: 'Tips' });
    expect(document.getElementById(`panel-gameguide_${ROBLOX.id}_2`)).not.toBeNull();
  });

  it('a guide panel never goes into the saved pinned sites, usage stamps or pairs', () => {
    setUp({ pages: PAGES });
    localStorage.setItem('vex.panelPairs', JSON.stringify({ notes: 'history', history: 'notes' }));
    const before = { sites: localStorage.getItem('vex.sitePanels'), usage: localStorage.getItem('vex.panelUsage'), pairs: localStorage.getItem('vex.panelPairs') };
    SidebarManager._touchUsage(`gameguide_${ROBLOX.id}_0`);
    SidebarManager._savePair('notes', `gameguide_${ROBLOX.id}_0`);
    SidebarManager.sidePanel = `gameguide_${ROBLOX.id}_0`;
    SidebarManager.activePanel = 'notes';
    SidebarManager.closeBeside.mockRestore();
    vi.spyOn(SidebarManager, '_layoutPanels').mockImplementation(() => {});
    vi.spyOn(SidebarManager, '_announcePanel').mockImplementation(() => {});
    SidebarManager.closeBeside();
    expect(localStorage.getItem('vex.sitePanels')).toBe(before.sites);
    expect(localStorage.getItem('vex.panelUsage')).toBe(before.usage);
    expect(localStorage.getItem('vex.panelPairs')).toBe(before.pairs);      // the user's own pair is still remembered
  });

  it('only the temporary prefix can be mounted, and only web addresses', () => {
    expect(() => SidebarManager.mountTemporarySitePanel({ id: 'notes', name: 'x', url: 'https://a.example/' })).toThrow(/must start with/);
    expect(() => SidebarManager.mountTemporarySitePanel({ id: 'gameguide_x_0', name: 'x', url: 'file:///C:/a.txt' })).toThrow(/web address/);
  });
});

describe('nothing persistent is written by a game', () => {
  it('a whole game — start, a page added in the guide panel, stop — writes nothing to storage', () => {
    setUp({ pages: { [ROBLOX.id]: [{ url: 'https://wiki.example/roblox/build', title: 'Build guide' }] } });
    SidebarManager.activePanel = 'notes';
    const writes = [];
    setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { writes.push(k); });
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (k) { writes.push('-' + k); });
    window.SyncEngine = { resumeAfterGame: vi.fn() };
    GameSession.onState(START);
    GameSession.onState({ ...START, app: 'Roblox Player' });
    GameSession.onState(STOP);
    GameSession.onState(START);
    GameSession.turnOffForNow();
    GameSession.onState(STOP);
    expect(writes).toEqual([]);
    setItem.mockRestore(); remove.mockRestore();
    delete window.SyncEngine;
  });
});

describe('the pieces are in the right places', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../../src', p), 'utf8');

  it('the page loads the script, has the chip and the settings host, and the chip never moves into the overflow menu', () => {
    const html = read('renderer/index.html');
    expect(html).toMatch(/<script src="js\/game-session\.js"><\/script>/);
    expect(html).toMatch(/id="game-mode-chip"/);
    expect(html).toMatch(/id="game-mode-off"/);
    expect(html).toMatch(/id="game-session-settings"/);
    expect(read('renderer/js/toolbar-overflow.js')).toMatch(/'game-mode-chip'/);
  });

  it('the channels are validated and refused to pages', () => {
    const schemas = read('main/ipc-schemas.js');
    for (const ch of ['gamemode:games', 'gamemode:session', 'gamemode:state']) {
      expect(schemas).toContain("'" + ch + "'");
      expect(read('main/ipc-policy.js')).toContain("'" + ch + "'");
    }
    expect(read('preload.js')).toMatch(/gameModeSession: \(s\) => ipcRenderer\.invoke\('gamemode:session', s\)/);
  });

  it('the settings explain what it does and does not do', () => {
    setUp();
    document.body.innerHTML += '<div id="game-session-settings"></div>';
    GameSession.renderSettings();
    const text = document.getElementById('game-session-settings').textContent;
    expect(text).toMatch(/What it does while a game runs/);
    expect(text).toMatch(/never touches the game/);
    expect(text).toMatch(/does not raise your frame rate/);
    expect(text).toMatch(/Roblox — robloxplayerbeta\.exe/);
    expect(document.getElementById('setting-game-session').checked).toBe(true);
  });
});
