// @vitest-environment jsdom
//
// When a game starts: free the graphics card, sleep background tabs, hold
// background AI — each its own switch, all on by default. And the model is
// unloaded one minute after a reply instead of Ollama's five.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { GameMode } = require('../../src/renderer/js/game-mode.js');
const { Ollama } = require('../../src/renderer/js/ollama.js');

let gameCb;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() };
  GameMode.gaming = false;
  GameMode._gamingReport = null;
  GameMode._gamingWired = false;
  window.vex = { gameWatch: vi.fn(async (on) => ({ running: on })), onGameState: vi.fn((cb) => { gameCb = cb; }) };
  globalThis.ModelManager = { freeGpu: vi.fn(async () => ({ freed: 5632, models: ['qwen3.5:latest'] })) };
  const tabs = [
    { id: 1, title: 'Active' },
    { id: 2, title: 'Idle' },
    { id: 3, title: 'Music', audible: true },
    { id: 4, title: 'Muted video', audible: true, muted: true },
    { id: 5, title: 'Call' },
    { id: 6, title: 'Kept awake', kept: true },
    { id: 7, title: 'Already asleep', sleeping: true },
  ];
  globalThis.TabManager = {
    tabs, activeTabId: 1,
    isCapturing: (t) => t.id === 5,
    sleepTab: vi.fn(async (id) => { const t = tabs.find(x => x.id === id); if (!t.kept) t.sleeping = true; }),
  };
});

describe('when a game starts', () => {
  it('frees the graphics card and sleeps the idle tabs — not music, a call, a kept-awake or the active one', async () => {
    const r = await GameMode.onGameStart('Valorant');
    expect(ModelManager.freeGpu).toHaveBeenCalled();
    expect(r).toMatchObject({ app: 'Valorant', freedMB: 5632, models: ['qwen3.5:latest'], slept: 2 });
    const asked = TabManager.sleepTab.mock.calls.map(c => c[0]);
    expect(asked).toEqual([2, 4, 6]);                  // 6 is asked, and sleepTab itself spares it
    expect(TabManager.tabs.find(t => t.id === 6).sleeping).toBeFalsy();
    expect(GameMode.holdingAi()).toBe(true);
  });

  it('says nothing while the game is running', async () => {
    await GameMode.onGameStart('Valorant');
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('a second report of the same game does nothing twice', async () => {
    await GameMode.onGameStart('Valorant');
    await GameMode.onGameStart('Valorant');
    expect(ModelManager.freeGpu).toHaveBeenCalledTimes(1);
  });

  it('each switch can be turned off on its own', async () => {
    GameMode.setGamingSetting('freeGpu', false);
    GameMode.setGamingSetting('holdAi', false);
    await GameMode.onGameStart('Game');
    expect(ModelManager.freeGpu).not.toHaveBeenCalled();
    expect(TabManager.sleepTab).toHaveBeenCalled();
    expect(GameMode.holdingAi()).toBe(false);
  });

  it('a failure in one step does not stop the others', async () => {
    ModelManager.freeGpu = vi.fn(async () => { throw new Error('Ollama gone'); });
    const r = await GameMode.onGameStart('Game');
    expect(r.slept).toBe(2);
    expect(window.VexProblems.note).toHaveBeenCalled();
  });
});

describe('when it ends', () => {
  it('says what was done, once you are back', async () => {
    await GameMode.onGameStart('Valorant');
    GameMode.onGameEnd();
    expect(window.showToast).toHaveBeenCalledWith('While you played Valorant, Vex freed 5.5 GB of graphics memory and slept 2 tabs. The tabs are waking now; panels come back when you open them.');
    expect(GameMode.holdingAi()).toBe(false);
  });
  it('and says nothing if there was nothing to do', async () => {
    ModelManager.freeGpu = vi.fn(async () => ({ freed: 0, models: [] }));
    TabManager.tabs = [{ id: 1 }];
    await GameMode.onGameStart('Game');
    GameMode.onGameEnd();
    expect(window.showToast).not.toHaveBeenCalled();
  });
});

describe('the watcher follows the switches', () => {
  it('runs while anything would happen during a game, stops when nothing would', async () => {
    GameMode.initGaming();
    expect(window.vex.gameWatch).toHaveBeenLastCalledWith(true);
    GameMode.setGamingSetting('freeGpu', false);
    GameMode.setGamingSetting('sleepTabs', false);
    GameMode.setGamingSetting('holdAi', false);
    expect(window.vex.gameWatch).toHaveBeenLastCalledWith(true);          // "Keep Vex still" is still on
    GameMode.setGamingSetting('stillVex', false);
    expect(window.vex.gameWatch).toHaveBeenLastCalledWith(false);         // "Wake after" alone has nothing to do
  });
  it('main\'s reports drive start and end', async () => {
    GameMode.initGaming();
    gameCb({ game: true, app: 'Roblox' });
    await vi.waitFor(() => expect(GameMode.gaming).toBe(true));
    gameCb({ game: false, app: 'explorer' });
    expect(GameMode.gaming).toBe(false);
  });
});

describe('the settings', () => {
  it('shows the five switches and the keep-loaded choice, and saves them', () => {
    document.body.innerHTML = '<div id="gaming-settings"></div>';
    GameMode.renderGamingSettings();
    const boxes = document.querySelectorAll('#gaming-settings input[type=checkbox]');
    expect(boxes).toHaveLength(5);
    expect([...boxes].every(b => b.checked)).toBe(true);
    boxes[1].checked = false; boxes[1].dispatchEvent(new Event('change'));
    expect(GameMode.gamingSetting('sleepTabs')).toBe(false);
    const sel = document.querySelector('#gaming-settings select');
    expect(sel.value).toBe('1m');
    sel.value = '5m'; sel.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('vex.ai.keepAlive')).toBe('5m');
  });
});

describe('the model unloads a minute after a reply', () => {
  let sent;
  beforeEach(() => {
    delete window.VexNet;
    globalThis.fetch = vi.fn(async (_u, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ message: { content: 'hi' }, response: 'hi' }) }; });
  });
  it('by default, on both chat and generate', async () => {
    await Ollama.chat('qwen3.5:latest', [{ role: 'user', content: 'x' }]);
    expect(sent.keep_alive).toBe('1m');
    await Ollama.generate('qwen3.5:latest', 'x');
    expect(sent.keep_alive).toBe('1m');
  });
  it('the choice is honoured, and 0 unloads at once', async () => {
    Ollama.setKeepAlive('15m');
    await Ollama.chat('m', []);
    expect(sent.keep_alive).toBe('15m');
    Ollama.setKeepAlive('0');
    await Ollama.chat('m', []);
    expect(sent.keep_alive).toBe(0);
  });
  it('rubbish in storage falls back to a minute, and nonsense is refused', () => {
    localStorage.setItem('vex.ai.keepAlive', '-1; DROP');
    expect(Ollama.keepAlive()).toBe('1m');
    expect(() => Ollama.setKeepAlive('forever')).toThrow(/must be one of/);
  });
});

describe('holding background AI', () => {
  it('the scheduler claims nothing while a game runs, and resumes after', async () => {
    const Scheduler = require('../../src/renderer/js/scheduler.js');
    const getAll = vi.spyOn(Scheduler, 'getAllTasks').mockReturnValue([]);
    await GameMode.onGameStart('Game');
    Scheduler._checkDueTasks(Date.now());
    expect(getAll).not.toHaveBeenCalled();
    GameMode.onGameEnd();
    Scheduler._checkDueTasks(Date.now());
    expect(getAll).toHaveBeenCalled();
    getAll.mockRestore();
  });
});

describe('a question asked during a game', () => {
  let sent;
  beforeEach(() => {
    delete window.VexNet;
    globalThis.fetch = vi.fn(async (_u, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ message: { content: 'hi' } }) }; });
    window.GameMode = GameMode;
  });
  it('is answered, and the model leaves the card the moment it has', async () => {
    await GameMode.onGameStart('Roblox');
    await Ollama.chat('qwen3.5:latest', []);
    expect(sent.keep_alive).toBe(0);
    GameMode.onGameEnd();
    await Ollama.chat('qwen3.5:latest', []);
    expect(sent.keep_alive).toBe('1m');
  });
  it('unless "free the graphics card" is off', async () => {
    GameMode.setGamingSetting('freeGpu', false);
    await GameMode.onGameStart('Roblox');
    await Ollama.chat('qwen3.5:latest', []);
    expect(sent.keep_alive).toBe('1m');
  });
});

describe('panels, waking up, and keeping Vex still', () => {
  it('hidden panels sleep too (the same rules as Free memory now)', async () => {
    globalThis.SidebarManager = { sleepHiddenPanels: vi.fn(() => ['spotify', 'github']) };
    const r = await GameMode.onGameStart('Game');
    expect(SidebarManager.sleepHiddenPanels).toHaveBeenCalled();
    expect(r.panels).toEqual(['spotify', 'github']);
    delete globalThis.SidebarManager;
  });

  it('after the game, the tabs it slept wake one at a time — not ones asleep before, not closed ones', async () => {
    vi.useFakeTimers();
    TabManager.wakeTab = vi.fn((id) => { const t = TabManager.tabs.find(x => x.id === id); if (t) t.sleeping = false; });
    await GameMode.onGameStart('Game');
    expect(TabManager.tabs.find(t => t.id === 2).sleeping).toBe(true);
    GameMode.onGameEnd();
    vi.advanceTimersByTime(0);
    expect(TabManager.wakeTab).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(GameMode.WAKE_GAP_MS * 5);
    expect(TabManager.wakeTab.mock.calls.map(c => c[0])).toEqual([2, 4]);   // 7 was asleep already
    vi.useRealTimers();
  });

  it('"Wake the tabs after the game" off: they stay asleep', async () => {
    vi.useFakeTimers();
    GameMode.setGamingSetting ? GameMode.setGamingSetting('wakeAfter', false) : localStorage.setItem('vex.game.wakeAfter', 'off');
    TabManager.wakeTab = vi.fn();
    await GameMode.onGameStart('Game');
    GameMode.onGameEnd();
    vi.advanceTimersByTime(60000);
    expect(TabManager.wakeTab).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('Vex stops animating while the game has the screen, and starts again after', async () => {
    await GameMode.onGameStart('Game');
    expect(document.body.classList.contains('vex-gaming-still')).toBe(true);
    GameMode.onGameEnd();
    expect(document.body.classList.contains('vex-gaming-still')).toBe(false);
  });
});
