// @vitest-environment jsdom
//
// The helpers around Game mode (js/game-helpers.js):
//   T1-041 GameFlush      save my work when a game (or its launcher) starts
//   T1-035 GameWarmdown   hold background work when a launcher opens
//   T1-032 GamePitstop    one card when a game ends
//   T1-023 GameChecklist  an optional list before I play; it never blocks

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const { GameSession } = require('../../src/renderer/js/game-session.js');
const { GameMode } = require('../../src/renderer/js/game-mode.js');
const { GameFlush } = require('../../src/renderer/js/game-flush.js');
const { GameWarmdown } = require('../../src/renderer/js/game-warmdown.js');
const { GamePitstop } = require('../../src/renderer/js/game-pitstop.js');
const { GameChecklist } = require('../../src/renderer/js/game-checklist.js');
const { GameHelpers } = require('../../src/renderer/js/game-helpers.js');

const ROBLOX = { id: 'g_robloxplayerbeta', name: 'Roblox', exe: 'robloxplayerbeta' };
const LAUNCH = { game: false, app: '', id: '', launcher: true, launcherApp: 'Steam' };
const GAME = { game: true, app: 'Roblox', id: ROBLOX.id, listed: true, fullscreen: false };
const IDLE = { game: false, app: '', id: '' };

let notes, ledger, problems;

function setUp({ mode = 'on', games = [ROBLOX] } = {}) {
  localStorage.clear();
  if (mode) localStorage.setItem('vex.gameMode', mode);
  localStorage.setItem('vex.gameMode.games', JSON.stringify(games));
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  setUp();
  ledger = { note: vi.fn(), registerUndo: vi.fn() };
  problems = { note: vi.fn() };
  window.showToast = vi.fn();
  window.VexProblems = problems; globalThis.VexProblems = problems;
  globalThis.VexLedger = ledger; window.VexLedger = ledger;
  window.VexTabPolicy = { isPrivateWindow: false };
  window.vex = { gameModeSession: vi.fn(async () => ({})), gameModeGames: vi.fn(async () => ({})), attention: { denied: vi.fn(async () => []) } };
  for (const [n, v] of Object.entries({ GameSession, GameMode, GameFlush, GameWarmdown, GamePitstop, GameChecklist, GameHelpers })) { globalThis[n] = v; window[n] = v; }
  GameSession.active = false; GameSession._suspended = false; GameSession._last = null; GameSession._lastResume = null;
  GameMode.gaming = false; GameMode._gamingReport = null;
  GameFlush._lastAt = 0; GameFlush._running = null; GameFlush._seen = '';
  GameWarmdown._stopTimers(); GameWarmdown.active = false; GameWarmdown.sleptIds = []; GameWarmdown.handedOver = [];
  GamePitstop._s = null; GamePitstop._report = null; GamePitstop.hide();
  GameChecklist._shownAt = 0; GameChecklist._seen = ''; GameChecklist.hide();
  globalThis.TabManager = { tabs: [], activeTabId: 1, sleepTab: vi.fn(), wakeTab: vi.fn(), isCapturing: () => false };
  for (const n of ['SessionManager', 'NotesPanel', 'TabSnapshots', 'PersistentStorage', 'CommitGuard', 'VexAttention', 'AttentionInbox', 'VexJobs', 'DownloadsPanel']) delete globalThis[n];
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
describe('T1-041 flush drafts and sessions at game launch', () => {
  function stubs({ fail = null } = {}) {
    globalThis.SessionManager = { saveCurrentSession: vi.fn() };
    globalThis.TabManager.tabs = [{ id: 1 }];
    globalThis.NotesPanel = { _editorDirty: () => true, flush: vi.fn(), _flushSticky: vi.fn() };
    globalThis.TabSnapshots = { isOn: () => true, tick: vi.fn(async () => ({ formsKept: 2 })) };
    globalThis.PersistentStorage = { _flush: vi.fn(async () => { if (fail) throw new Error(fail); }) };
  }

  it('saves the session, the note, typed text and the write queue, and writes one ledger line', async () => {
    stubs();
    const r = await GameFlush.run('game', 'Roblox');
    expect(r.ran).toBe(true);
    expect(r.done).toEqual(['the open tabs', 'the note being typed', 'text typed into 2 page boxes', 'your settings and lists']);
    expect(SessionManager.saveCurrentSession).toHaveBeenCalledWith(expect.stringContaining('before a game'), null, { auto: true });
    expect(NotesPanel.flush).toHaveBeenCalled(); expect(NotesPanel._flushSticky).toHaveBeenCalled();
    expect(TabSnapshots.tick).toHaveBeenCalled(); expect(PersistentStorage._flush).toHaveBeenCalled();
    expect(ledger.note).toHaveBeenCalledTimes(1);
    expect(ledger.note.mock.calls[0][0]).toMatchObject({ feature: 'game-flush' });
    expect(ledger.note.mock.calls[0][0].what).toMatch(/^Saved the open tabs, .* before Roblox$/);
    expect(GameFlush.last()).toMatchObject({ app: 'Roblox', trigger: 'game', failed: [] });
  });

  it('once at most every 90 seconds, and not at all when switched off', async () => {
    stubs();
    expect((await GameFlush.run('launcher', 'Steam')).ran).toBe(true);
    expect(await GameFlush.run('game', 'Roblox')).toEqual({ ran: false, why: 'recent' });
    GameFlush._lastAt -= 91000;
    expect((await GameFlush.run('game', 'Roblox')).ran).toBe(true);
    GameFlush.setEnabled(false);
    GameFlush._lastAt = 0;
    expect(await GameFlush.run('game', 'Roblox')).toEqual({ ran: false, why: 'off' });
  });

  it('a step that fails is reported and the others still run', async () => {
    stubs({ fail: 'disk full' });
    const r = await GameFlush.run('game', 'Roblox');
    expect(r.failed).toEqual([{ step: 'storage', error: 'disk full' }]);
    expect(r.done).toContain('the open tabs');
    expect(problems.note).toHaveBeenCalledWith('Game mode', expect.stringContaining('storage'), expect.any(Error));
    expect(ledger.note.mock.calls[0][0].why).toMatch(/Could not save: storage/);
  });

  it('a private window is never saved as a session', async () => {
    stubs();
    window.VexTabPolicy.isPrivateWindow = true;
    const r = await GameFlush.run('game', 'Roblox');
    expect(SessionManager.saveCurrentSession).not.toHaveBeenCalled();
    expect(r.done).not.toContain('the open tabs');
  });

  it('runs on the first sight of a launcher or a game, not on every repeat of the state', async () => {
    stubs();
    const run = vi.spyOn(GameFlush, 'run').mockResolvedValue({ ran: true });
    GameFlush.onState(LAUNCH); GameFlush.onState(LAUNCH);
    expect(run).toHaveBeenCalledTimes(1); expect(run).toHaveBeenLastCalledWith('launcher', 'Steam');
    GameFlush.onState(GAME); GameFlush.onState(GAME);
    expect(run).toHaveBeenCalledTimes(2); expect(run).toHaveBeenLastCalledWith('game', 'Roblox');
    GameFlush.onState(IDLE);
    GameFlush.onState(GAME);
    expect(run).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
describe('T1-035 pre-launch warm-down', () => {
  it('watches the usual launchers, marked, and never one that is also a listed game', () => {
    const steam = GameWarmdown.watchList().find(l => l.exe === 'steam');
    expect(steam).toMatchObject({ launcher: true, name: 'Steam' });
    setUp({ games: [ROBLOX, { id: 'g_steam', name: 'Steam as a game', exe: 'steam' }] });
    expect(GameWarmdown.watchList().some(l => l.exe === 'steam')).toBe(false);
    GameWarmdown.setEnabled(false);
    expect(GameWarmdown.watchList()).toEqual([]);
  });

  it('adds no poll of its own: nothing is watched unless Game mode is on and a game is listed', () => {
    setUp({ games: [] });
    expect(GameWarmdown.watchList()).toEqual([]);
    setUp({ mode: 'ask' });
    expect(GameWarmdown.watchList()).toEqual([]);
    setUp({ mode: 'off' });
    expect(GameWarmdown.watchList()).toEqual([]);
  });

  it('the launcher list can be edited, with clear errors', () => {
    expect(() => GameWarmdown.addLauncher({ name: 'x', exe: '  ' })).toThrow(/program name/);
    expect(() => GameWarmdown.addLauncher({ name: 'Steam again', exe: 'Steam.exe' })).toThrow(/already in the list/);
    const l = GameWarmdown.addLauncher({ name: 'Itch', exe: 'Itch.exe' });
    expect(l).toMatchObject({ exe: 'itch', name: 'Itch' });
    expect(GameWarmdown.launchers().some(x => x.exe === 'itch')).toBe(true);
    GameWarmdown.removeLauncher(l.id);
    expect(GameWarmdown.launchers().some(x => x.exe === 'itch')).toBe(false);
    expect(() => GameWarmdown.removeLauncher('nope')).toThrow(/not in the list/);
    GameWarmdown.resetLaunchers();
    expect(GameWarmdown.launchers().length).toBe(GameWarmdown.DEFAULTS.length);
  });

  it('the launchers go to main with the game list, marked as launchers', async () => {
    await GameSession.syncWatch();
    const [sent, watch] = window.vex.gameModeGames.mock.calls.at(-1);
    expect(watch).toBe(true);
    expect(sent.find(g => g.exe === 'robloxplayerbeta').launcher).toBeUndefined();
    expect(sent.find(g => g.exe === 'steam').launcher).toBe(true);
  });

  it('a launcher opening holds sync, indexing and recall, tells main, and writes a ledger line with an Undo', () => {
    expect(GameWarmdown.onState(LAUNCH)).toBe('warm');
    expect(GameWarmdown.active).toBe(true);
    for (const kind of ['sync', 'indexing', 'recall']) expect(GameSession.holds(kind)).toBe(true);
    expect(window.vex.gameModeSession).toHaveBeenCalledWith({ on: true, warm: true, holds: GameSession.HOLDS });
    expect(ledger.note.mock.calls[0][0]).toMatchObject({ feature: 'game-warmdown', undo: { kind: 'warmdown-release' } });
    expect(GameMode.holdingAi()).toBe(true);
  });

  it('only with Game mode on, not suspended, not in a private window, and when switched on', () => {
    for (const set of [() => setUp({ mode: 'ask' }), () => setUp({ mode: 'off' }), () => { setUp(); GameSession._suspended = true; }, () => { setUp(); window.VexTabPolicy.isPrivateWindow = true; }, () => { setUp(); GameWarmdown.setEnabled(false); }]) {
      GameWarmdown.release('test'); GameSession._suspended = false; window.VexTabPolicy.isPrivateWindow = false; localStorage.removeItem('vex.game.warmdown');
      set();
      expect(GameWarmdown.onState(LAUNCH)).toBe('ignored');
      expect(GameWarmdown.active).toBe(false);
    }
  });

  it('the launcher closing puts everything back: main told, the owed work catches up', () => {
    const resume = vi.spyOn(GameSession, '_resume').mockImplementation(() => {});
    GameWarmdown.onState(LAUNCH);
    expect(GameWarmdown.onState(IDLE)).toBe('idle');
    expect(GameWarmdown.active).toBe(false);
    expect(GameSession.holds('sync')).toBe(false);
    expect(window.vex.gameModeSession).toHaveBeenLastCalledWith({ on: false, warm: true, holds: [] });
    expect(resume).toHaveBeenCalled();
  });

  it('ends by itself after 15 minutes, because Steam can stay open all day', () => {
    vi.useFakeTimers();
    vi.spyOn(GameSession, '_resume').mockImplementation(() => {});
    GameWarmdown.onState(LAUNCH);
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(GameWarmdown.active).toBe(true);
    vi.advanceTimersByTime(61 * 1000);
    expect(GameWarmdown.active).toBe(false);
  });

  it('after 20 s sleeps background tabs the way Game mode does, and wakes them when it ends', async () => {
    vi.useFakeTimers();
    vi.spyOn(GameSession, '_resume').mockImplementation(() => {});
    const a = { id: 2, sleeping: false }, b = { id: 3, sleeping: false };
    globalThis.TabManager.tabs = [a, b];
    globalThis.TabManager.sleepTab = vi.fn(async (id) => { (id === 2 ? a : b).sleeping = true; });
    globalThis.CommitGuard = { _sleepable: () => [a, b] };
    GameWarmdown.onState(LAUNCH);
    await vi.advanceTimersByTimeAsync(19000);
    expect(TabManager.sleepTab).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(TabManager.sleepTab).toHaveBeenCalledTimes(2);
    expect(GameWarmdown.sleptIds).toEqual([2, 3]);
    expect(ledger.note.mock.calls.some(c => /Slept 2 background tabs/.test(c[0].what))).toBe(true);
    GameWarmdown.onState(IDLE);
    await vi.advanceTimersByTimeAsync(4000);
    expect(TabManager.wakeTab).toHaveBeenCalledWith(2); expect(TabManager.wakeTab).toHaveBeenCalledWith(3);
  });

  it('a launcher that closes within 20 s leaves the tabs alone', async () => {
    vi.useFakeTimers();
    vi.spyOn(GameSession, '_resume').mockImplementation(() => {});
    globalThis.CommitGuard = { _sleepable: vi.fn(() => [{ id: 2 }]) };
    GameWarmdown.onState(LAUNCH);
    await vi.advanceTimersByTimeAsync(5000);
    GameWarmdown.onState(IDLE);
    await vi.advanceTimersByTimeAsync(30000);
    expect(TabManager.sleepTab).not.toHaveBeenCalled();
  });

  it('the game starting hands over: the warm-down ends, Game mode holds, the slept tabs join the game\'s', async () => {
    vi.useFakeTimers();
    GameWarmdown.onState(LAUNCH);
    GameWarmdown.sleptIds = [2];
    GameMode._gamingReport = { sleptIds: [9], slept: 1 };
    expect(GameWarmdown.onState(GAME)).toBe('game');
    expect(GameWarmdown.active).toBe(false);
    expect(GameWarmdown.handedOver).toEqual([2]);
    await vi.advanceTimersByTimeAsync(1600);
    expect(GameMode._gamingReport.sleptIds).toEqual([9, 2]);
    expect(GameMode._gamingReport.slept).toBe(2);
  });

  it('jobs and heavy work wait while it is on', () => {
    const { VexJobs } = require('../../src/renderer/js/jobs.js');
    GameWarmdown.onState(LAUNCH);
    expect(VexJobs.heldBecause('ui', {})).toBe('a game launcher is open');
    expect(VexJobs._heavyBlock({}, Date.now())).toBe('a game launcher is open');
  });

  it('its Undo ends it', async () => {
    GameWarmdown._wired = false;
    GameWarmdown.init();
    const undo = ledger.registerUndo.mock.calls.find(c => c[0] === 'warmdown-release');
    expect(undo).toBeTruthy();
    vi.spyOn(GameSession, '_resume').mockImplementation(() => {});
    GameWarmdown.onState(LAUNCH);
    await undo[1]();
    expect(GameWarmdown.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('T1-032 after-game pit-stop panel', () => {
  const START = 1_000_000;
  function game(extra = {}) { return { app: 'Roblox', gameId: ROBLOX.id, start: START, end: START + 60 * 60000, jobsAtStart: 2, inboxIds: new Set(['old']), ...extra }; }

  function stubs() {
    globalThis.VexAttention = { denied: () => [{ feature: 'ai-news', title: 'Story A', reason: 'quiet: game', t: START + 10, n: 2 }, { feature: 'x', title: 'before', reason: 'quiet: game', t: START - 5, n: 9 }, { feature: 'y', title: 'other reason', reason: 'hourly limit', t: START + 20 }], request: vi.fn(() => ({ route: 'toast' })) };
    window.vex.attention.denied = vi.fn(async () => [{ feature: 'reminders', title: 'Windows toast', reason: 'quiet: game', t: START + 30, n: 1 }]);
    globalThis.AttentionInbox = { list: () => [{ id: 'old', title: 'already there' }, { id: 'new1', feature: 'gh', title: 'PR merged' }], open: vi.fn() };
    globalThis.VexJobs = { _jobs: new Map([['a', { held: 4 }], ['b', { held: 3 }]]) };
    GameSession._lastResume = { sync: true, indexQueue: 3 };
    globalThis.TabManager.tabs = [{ id: 11, title: 'Docs', sleeping: true }, { id: 12, title: 'Mail', sleeping: false }];
    GamePitstop._report = { app: 'Roblox', sleptIds: [11, 12], panels: ['discord'], models: ['llama3'], freedMB: 5632 };
  }

  it('counts what was held since the game started, and nothing from before', async () => {
    stubs();
    const card = await GamePitstop.compile(game());
    expect(card).toMatchObject({ app: 'Roblox', minutes: 60, jobsHeld: 5, sync: true, indexing: 3, panels: 1, models: ['llama3'], freedMB: 5632 });
    expect(card.notifications).toEqual({ toasts: 2, windows: 1, inbox: 1 });
    expect(card.tabs.map(t => t.id)).toEqual([11, 12]);
    expect(card.titles.map(t => t.title)).toEqual(['PR merged', 'Story A', 'Windows toast']);
    expect(GamePitstop.summaryLine(card)).toBe('3 notifications held, 1 item waiting in the Attention Inbox, 2 tabs slept, sync caught up');
  });

  it('a game with nothing held has no card, however long; a two-minute one needs slept tabs or an unloaded model', async () => {
    expect(await GamePitstop.compile(game({ end: START + 60000 }))).toBeNull();
    expect(await GamePitstop.compile(game({ end: START + 4 * 60000 }))).toBeNull();
    expect(await GamePitstop.compile(game())).toBeNull();
    stubs();
    GamePitstop._report = null;
    expect(await GamePitstop.compile(game({ end: START + 60000 }))).toBeNull();           // notices only, under two minutes
    GamePitstop._report = { sleptIds: [11] };
    expect((await GamePitstop.compile(game({ end: START + 60000 })))?.tabs.length).toBe(1);
  });

  it('is off when switched off', async () => {
    stubs();
    GamePitstop.setEnabled(false);
    expect(await GamePitstop.compile(game())).toBeNull();
    expect(GamePitstop.takeOver({})).toBe(false);
  });

  it('replaces the "While you played" toast only when it is on', () => {
    GameMode.gaming = true;
    GameMode._gamingReport = { app: 'Roblox', at: 1, freedMB: 0, models: [], slept: 1, sleptIds: [], panels: [] };
    GameMode.onGameEnd();
    expect(window.showToast).not.toHaveBeenCalled();
    GamePitstop.setEnabled(false);
    GameMode.gaming = true;
    GameMode._gamingReport = { app: 'Roblox', at: 1, freedMB: 0, models: [], slept: 1, sleptIds: [], panels: [] };
    GameMode.onGameEnd();
    expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('While you played'));
  });

  it('goes through the Attention Budget: a card when allowed, the inbox when it is a quiet moment', async () => {
    stubs();
    const card = await GamePitstop.compile(game());
    expect(GamePitstop.deliver(card)).toBe('shown');
    expect(VexAttention.request).toHaveBeenCalledWith(expect.objectContaining({ feature: 'game-pitstop', urgency: 'useful' }));
    expect(document.getElementById('game-pitstop')).not.toBeNull();
    GamePitstop.hide();
    VexAttention.request = vi.fn(() => ({ route: 'inbox' }));
    expect(GamePitstop.deliver(card)).toBe('inbox');
    expect(document.getElementById('game-pitstop')).toBeNull();
    expect(GamePitstop.last().app).toBe('Roblox');
  });

  it('the card says it plainly and one click wakes the tabs that are still asleep', async () => {
    vi.useFakeTimers();
    stubs();
    const card = await GamePitstop.compile(game());
    const root = GamePitstop.show(card);
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.textContent).toContain('Roblox: pit stop');
    expect(root.textContent).toContain('You played 1 h');
    expect(root.textContent).toContain('Notifications held while you played');
    expect(root.textContent).toContain('PR merged');
    const wake = [...root.querySelectorAll('button')].find(b => /^Wake the 1 tab$/.test(b.textContent));
    expect(wake).toBeTruthy();                       // only tab 11 is still asleep
    wake.click();
    vi.advanceTimersByTime(2000);
    expect(TabManager.wakeTab).toHaveBeenCalledTimes(1);
    expect(TabManager.wakeTab).toHaveBeenCalledWith(11);
    [...root.querySelectorAll('button')].find(b => b.textContent === 'Open the held items').click();
    expect(AttentionInbox.open).toHaveBeenCalled();
    expect(document.getElementById('game-pitstop')).toBeNull();
  });

  it('Escape puts the card away', async () => {
    stubs();
    GamePitstop.show(await GamePitstop.compile(game()));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('game-pitstop')).toBeNull();
  });

  it('follows the game state: begins at the start, compiles 1.5 s after the end', async () => {
    vi.useFakeTimers();
    stubs();
    const deliver = vi.spyOn(GamePitstop, 'deliver').mockReturnValue('shown');
    GamePitstop.onState(GAME);
    expect(GamePitstop._s).toMatchObject({ app: 'Roblox', jobsAtStart: 7 });
    GamePitstop._s.start -= 61 * 60000;
    GamePitstop.onState(IDLE);
    await vi.advanceTimersByTimeAsync(1400);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].minutes).toBeGreaterThanOrEqual(60);
  });

  it('the last card is always available', () => {
    expect(() => GamePitstop.show()).toThrow(/no game pit stop yet/);
  });
});

// ---------------------------------------------------------------------------
describe('T1-023 pre-game checklist', () => {
  it('is off until you turn it on, and an empty list shows nothing', () => {
    expect(GameChecklist.enabled()).toBe(false);
    expect(GameChecklist.onState(LAUNCH)).toBe(false);
    GameChecklist.setEnabled(true);
    expect(GameChecklist.onState(LAUNCH)).toBe(false);          // nothing to say
    expect(document.getElementById('game-checklist')).toBeNull();
  });

  it('keeps your items, checks the input, and resets a daily item the next day', () => {
    expect(() => GameChecklist.addItem('   ')).toThrow(/Type what should be done/);
    const a = GameChecklist.addItem('Homework', { daily: true });
    const b = GameChecklist.addItem('Take the bins out');
    GameChecklist.setDone(a.id, true); GameChecklist.setDone(b.id, true);
    expect(GameChecklist.pending()).toEqual([]);
    const raw = JSON.parse(localStorage.getItem('vex.game.checklist.items'));
    raw.find(i => i.id === a.id).doneOn = '2000-01-01';
    localStorage.setItem('vex.game.checklist.items', JSON.stringify(raw));
    expect(GameChecklist.pending().map(i => i.text)).toEqual(['Homework']);
    expect(() => GameChecklist.setDone('nope', true)).toThrow(/not in the checklist/);
    GameChecklist.removeItem(b.id);
    expect(GameChecklist.items().map(i => i.text)).toEqual(['Homework']);
  });

  it('shows the card when a launcher opens or a listed game starts, with "Play anyway" that only puts it away', () => {
    GameChecklist.setEnabled(true);
    GameChecklist.addItem('Homework');
    expect(GameChecklist.onState(LAUNCH)).toBe(true);
    const root = document.getElementById('game-checklist');
    expect(root.textContent).toContain('Before you play Steam');
    expect(root.textContent).toContain('Homework');
    const go = [...root.querySelectorAll('button')].find(b => b.textContent === 'Play anyway');
    go.click();
    expect(document.getElementById('game-checklist')).toBeNull();
    // Nothing about a game or a process was asked of anyone.
    expect(window.vex.gameModeSession).not.toHaveBeenCalled();
    // Half an hour does not pass for a second card.
    GameChecklist._seen = '';
    expect(GameChecklist.onState(GAME)).toBe(false);
    GameChecklist._shownAt -= GameChecklist.GAP_MS + 1;
    GameChecklist._seen = '';
    expect(GameChecklist.onState(GAME)).toBe(true);
  });

  it('a game that is not on your list does not bring the card', () => {
    GameChecklist.setEnabled(true);
    GameChecklist.addItem('Homework');
    expect(GameChecklist.onState({ game: true, app: 'Whatever', fullscreen: true, listed: false })).toBe(false);
  });

  it('adds the checks Vex can make itself: an unsaved note is saved, a running download is named', () => {
    GameChecklist.setEnabled(true);
    globalThis.NotesPanel = { _editorDirty: () => true, flush: vi.fn() };
    globalThis.DownloadsPanel = { downloads: [{ state: 'progressing' }, { state: 'completed' }] };
    const c = GameChecklist.checks();
    expect(NotesPanel.flush).toHaveBeenCalled();
    expect(c).toEqual([
      { id: 'draft', ok: true, text: 'A note you were typing was not saved: it has been saved now' },
      { id: 'downloads', ok: false, text: '1 download is still running' },
    ]);
    // With nothing on the list, a running download alone is enough to show the card.
    expect(GameChecklist.onState(LAUNCH)).toBe(true);
    expect(document.getElementById('game-checklist').textContent).toContain('1 download is still running');
  });

  it('while a game is on screen the card waits in the Attention Inbox instead', () => {
    GameChecklist.setEnabled(true);
    GameChecklist.addItem('Homework');
    globalThis.VexAttention = { request: vi.fn(() => ({ route: 'inbox' })) };
    expect(GameChecklist.onState(GAME)).toBe(true);
    expect(VexAttention.request).toHaveBeenCalledWith(expect.objectContaining({ feature: 'game-checklist', urgency: 'useful', action: { label: 'Open', key: 'open' } }));
    expect(document.getElementById('game-checklist')).toBeNull();
  });

  it('is silent in a private window', () => {
    GameChecklist.setEnabled(true);
    GameChecklist.addItem('Homework');
    window.VexTabPolicy.isPrivateWindow = true;
    expect(GameChecklist.onState(LAUNCH)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('the door', () => {
  it('Game mode passes every state to every helper, and one that throws stops none of the others', () => {
    const seen = [];
    vi.spyOn(GameFlush, 'onState').mockImplementation(() => { seen.push('flush'); throw new Error('boom'); });
    vi.spyOn(GamePitstop, 'onState').mockImplementation(() => { seen.push('pitstop'); });
    GameSession.onState(IDLE);
    expect(seen).toEqual(['flush', 'pitstop']);
    expect(problems.note).toHaveBeenCalledWith('Game mode', expect.stringContaining('failed on a game change'), expect.any(Error));
  });
});
