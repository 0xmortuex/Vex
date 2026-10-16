// T1-035: a launcher (Steam, Epic ...) on the list is noticed by its program name by
// the SAME poll Game mode already runs, and it starts only a warm-down: the holds
// apply, Vex's process priority is not touched until a game really runs.

import { describe, it, expect, vi } from 'vitest';
const { createProcessWatch, createGameModeSession, cleanGames, MISSES_TO_END } = require('../../src/main/game-mode.js');

function manualTimers() {
  const pending = [];
  return {
    setTimer: (fn) => { const t = { fn, unref() {} }; pending.push(t); return t; },
    clearTimer: (t) => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1); },
    count: () => pending.length,
    async fire() { const t = pending.shift(); if (t) await t.fn(); },
  };
}

const LIST = [
  { id: 'roblox', name: 'Roblox', exe: 'RobloxPlayerBeta.exe' },
  { id: 'l_steam', name: 'Steam', exe: 'steam', launcher: true },
];

function make(names) {
  const timers = manualTimers();
  const events = [];
  const list = vi.fn(async () => names.current);
  const w = createProcessWatch({ list, onChange: (s) => events.push(s), setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: vi.fn() });
  return { w, timers, events, list };
}

describe('the launcher flag', () => {
  it('survives the list check only when it is true, so an old list is unchanged', () => {
    expect(cleanGames(LIST)).toEqual([
      { id: 'roblox', name: 'Roblox', exe: 'robloxplayerbeta' },
      { id: 'l_steam', name: 'Steam', exe: 'steam', launcher: true },
    ]);
    expect(cleanGames([{ id: 'a', name: 'A', exe: 'a', launcher: 'yes' }])[0]).not.toHaveProperty('launcher');
  });
});

describe('the process watch with a launcher on the list', () => {
  it('a launcher opening says so, and is not a game', async () => {
    const names = { current: new Set(['explorer']) };
    const { w, timers, events } = make(names);
    w.setGames(LIST);
    await w.start();
    expect(events).toEqual([]);
    names.current = new Set(['explorer', 'steam']);
    await timers.fire();
    expect(events).toEqual([{ game: false, app: '', id: '', launcher: true, launcherApp: 'Steam' }]);
    expect(w.state().game).toBe(false);
  });

  it('the game starting while the launcher is open is a game, with the launcher beside it', async () => {
    const names = { current: new Set(['steam']) };
    const { w, timers, events } = make(names);
    w.setGames(LIST);
    await w.start();
    names.current = new Set(['steam', 'robloxplayerbeta']);
    await timers.fire();
    expect(events.at(-1)).toEqual({ game: true, app: 'Roblox', id: 'roblox', launcher: true, launcherApp: 'Steam' });
  });

  it('the launcher closing says so; the game ending with the launcher still open leaves the launcher', async () => {
    const names = { current: new Set(['steam']) };
    const { w, timers, events } = make(names);
    w.setGames(LIST);
    await w.start();
    names.current = new Set();
    await timers.fire();
    expect(events.at(-1)).toEqual({ game: false, app: '', id: '' });

    names.current = new Set(['steam', 'robloxplayerbeta']);
    await timers.fire();
    names.current = new Set(['steam']);
    for (let i = 0; i < MISSES_TO_END; i++) await timers.fire();
    expect(events.at(-1)).toEqual({ game: false, app: '', id: '', launcher: true, launcherApp: 'Steam' });
  });

  it('is the same poll: one read of the running programs per tick, launchers or not', async () => {
    const names = { current: new Set(['steam']) };
    const { w, timers, list } = make(names);
    w.setGames(LIST);
    await w.start();
    const first = list.mock.calls.length;
    await timers.fire();
    expect(list.mock.calls.length).toBe(first + 1);
  });

  it('a list without launchers behaves exactly as before', async () => {
    const names = { current: new Set(['steam']) };
    const { w, events } = make(names);
    w.setGames([LIST[0]]);
    await w.start();
    expect(events).toEqual([]);
  });
});

describe('the session hold for a warm-down', () => {
  function session() {
    const os = { constants: { priority: { PRIORITY_BELOW_NORMAL: 10 } }, setPriority: vi.fn(), getPriority: vi.fn(() => 0) };
    return { os, s: createGameModeSession({ os, processes: () => [{ pid: 7, type: 'Tab' }] , setTimer: () => ({ unref() {} }), clearTimer() {} }) };
  }
  it('holds the given kinds without lowering any priority', () => {
    const { os, s } = session();
    s.warm(true, ['extensionUpdates']);
    expect(s.held('extensionUpdates')).toBe(true);
    expect(s.held('sync')).toBe(false);
    expect(s.active()).toBe(false);
    expect(os.setPriority).not.toHaveBeenCalled();
    expect(s.state().warm).toEqual(['extensionUpdates']);
    s.warm(false);
    expect(s.held('extensionUpdates')).toBe(false);
    expect(s.state()).not.toHaveProperty('warm');
  });
  it('the game starting ends the warm-down and takes over the holds', () => {
    const { os, s } = session();
    s.warm(true, ['extensionUpdates']);
    s.begin({ app: 'Roblox', holds: ['sync'] });
    expect(s.held('extensionUpdates')).toBe(false);
    expect(s.held('sync')).toBe(true);
    expect(os.setPriority).toHaveBeenCalled();
    s.end();
    expect(s.held('sync')).toBe(false);
  });
});
