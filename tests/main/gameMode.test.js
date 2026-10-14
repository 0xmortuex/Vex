// src/main/game-mode.js — noticing a listed game by its program name, and
// lowering Vex's own process priority for the length of a game.

import { describe, it, expect, vi } from 'vitest';
const {
  createProcessWatch, createGameModeSession, normalizeExe, parseTasklist, cleanGames, MISSES_TO_END,
} = require('../../src/main/game-mode.js');

// A timer the test turns by hand.
function manualTimers() {
  const pending = [];
  return {
    setTimer: (fn) => { const t = { fn, unref() {} }; pending.push(t); return t; },
    clearTimer: (t) => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1); },
    count: () => pending.length,
    async fire() { const t = pending.shift(); if (t) await t.fn(); },
  };
}

describe('program names', () => {
  it('a path, an extension and a capital are all the same program', () => {
    expect(normalizeExe('C:\\Games\\Foo\\FooClient.EXE')).toBe('fooclient');
    expect(normalizeExe('fooclient')).toBe('fooclient');
    expect(normalizeExe('  RobloxPlayerBeta.exe ')).toBe('robloxplayerbeta');
  });

  it('reads tasklist CSV and ignores the rest', () => {
    const csv = '"System Idle Process","0","Services","0","8 K"\r\n"RobloxPlayerBeta.exe","4242","Console","1","300,000 K"\r\n\r\nINFO: junk\r\n';
    expect([...parseTasklist(csv)].sort()).toEqual(['robloxplayerbeta', 'system idle process']);
  });

  it('a game without a program name is refused, not guessed', () => {
    expect(() => cleanGames([{ id: 'a', name: 'A', exe: '  ' }])).toThrow(/no program name/);
    expect(() => cleanGames('nope')).toThrow(/must be a list/);
    expect(cleanGames([{ id: 'r', name: 'Roblox', exe: 'RobloxPlayerBeta.exe' }])).toEqual([{ id: 'r', name: 'Roblox', exe: 'robloxplayerbeta' }]);
  });
});

describe('the process watch: start, stop, start while running, a vanished game', () => {
  const GAMES = [{ id: 'roblox', name: 'Roblox', exe: 'RobloxPlayerBeta.exe' }];

  function make(names) {
    const timers = manualTimers();
    const events = [];
    const w = createProcessWatch({
      list: vi.fn(async () => names.current),
      onChange: (s) => events.push(s),
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
      log: vi.fn(),
    });
    return { w, timers, events };
  }

  it('a listed game starting is noticed, and ending is noticed after it stays gone', async () => {
    const names = { current: new Set(['explorer']) };
    const { w, timers, events } = make(names);
    w.setGames(GAMES);
    await w.start();
    expect(events).toEqual([]);                       // nothing running

    names.current = new Set(['explorer', 'robloxplayerbeta']);
    await timers.fire();
    expect(events).toEqual([{ game: true, app: 'Roblox', id: 'roblox' }]);

    names.current = new Set(['explorer']);
    for (let i = 0; i < MISSES_TO_END - 1; i++) await timers.fire();
    expect(w.state().game).toBe(true);                // one missed poll is a launcher handing over, not the end
    await timers.fire();
    expect(events.at(-1)).toEqual({ game: false, app: '', id: '' });
  });

  it('Vex started while the game is already running reports it at once', async () => {
    const { w, events } = make({ current: new Set(['robloxplayerbeta']) });
    w.setGames(GAMES);
    await w.start();
    expect(events).toEqual([{ game: true, app: 'Roblox', id: 'roblox' }]);
    expect(w.state()).toMatchObject({ game: true, id: 'roblox' });
  });

  it('the same game seen again says nothing twice', async () => {
    const { w, timers, events } = make({ current: new Set(['robloxplayerbeta']) });
    w.setGames(GAMES);
    await w.start();
    await timers.fire(); await timers.fire();
    expect(events).toHaveLength(1);
  });

  it('stopping, or emptying the list, ends a running game and stops polling', async () => {
    const { w, timers, events } = make({ current: new Set(['robloxplayerbeta']) });
    w.setGames(GAMES);
    await w.start();
    w.stop();
    expect(events.at(-1)).toMatchObject({ game: false });
    expect(timers.count()).toBe(0);
  });

  it('nothing is listed: nothing is read at all', async () => {
    const names = { current: new Set(['robloxplayerbeta']) };
    const list = vi.fn(async () => names.current);
    const w = createProcessWatch({ list, onChange: vi.fn(), ...manualTimers() });
    await w.start();
    expect(list).not.toHaveBeenCalled();
  });

  it('a list that cannot be read is logged and the answer stays what it was', async () => {
    const timers = manualTimers();
    const log = vi.fn();
    let fail = false;
    const w = createProcessWatch({
      list: async () => { if (fail) throw new Error('tasklist timed out'); return new Set(['robloxplayerbeta']); },
      onChange: vi.fn(), setTimer: timers.setTimer, clearTimer: timers.clearTimer, log,
    });
    w.setGames(GAMES);
    await w.start();
    fail = true;
    await timers.fire(); await timers.fire(); await timers.fire();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/tasklist timed out/));
    expect(w.state().game).toBe(true);                // not flipped by a failed read
  });

  it('the timers do not keep Vex alive', async () => {
    const unref = vi.fn();
    const w = createProcessWatch({ list: async () => new Set(), onChange: vi.fn(), setTimer: () => ({ unref }), clearTimer: () => {} });
    w.setGames(GAMES);
    await w.start();
    expect(unref).toHaveBeenCalled();
  });
});

describe('the session: priority is lowered for the game and put back exactly', () => {
  const BELOW = 10, NORMAL = 0, HIGH = -7;
  function fakeOs(initial) {
    const prio = new Map(Object.entries(initial).map(([k, v]) => [Number(k), v]));
    return {
      constants: { priority: { PRIORITY_BELOW_NORMAL: BELOW } },
      prio,
      getPriority: vi.fn((pid) => { if (!prio.has(pid)) throw new Error('ESRCH'); return prio.get(pid); }),
      setPriority: vi.fn((pid, level) => { if (!prio.has(pid)) throw new Error('A system error occurred: uv_os_setpriority returned ESRCH (no such process)'); prio.set(pid, level); }),
    };
  }

  function make({ procs, audible = [], initial }) {
    const os = fakeOs(initial);
    const timers = manualTimers();
    const log = vi.fn();
    const session = createGameModeSession({
      os, ownPid: 1,
      processes: () => procs.current,
      audiblePids: () => new Set(audible),
      setTimer: timers.setTimer, clearTimer: timers.clearTimer, log,
    });
    return { os, session, timers, log };
  }

  it('lowers page and graphics processes only — not the main process, not a page playing sound', () => {
    const procs = { current: [{ pid: 1, type: 'Browser' }, { pid: 2, type: 'Tab' }, { pid: 3, type: 'Tab' }, { pid: 4, type: 'GPU' }, { pid: 5, type: 'Utility' }] };
    const { os, session } = make({ procs, audible: [3], initial: { 1: NORMAL, 2: NORMAL, 3: NORMAL, 4: HIGH, 5: NORMAL } });
    const s = session.begin({ app: 'Roblox', holds: ['extensionUpdates'] });
    expect(s).toMatchObject({ active: true, app: 'Roblox', lowered: 2 });
    expect(os.prio.get(1)).toBe(NORMAL);
    expect(os.prio.get(2)).toBe(BELOW);
    expect(os.prio.get(3)).toBe(NORMAL);          // music is never starved
    expect(os.prio.get(4)).toBe(BELOW);
    expect(os.prio.get(5)).toBe(NORMAL);
  });

  it('ending puts every priority back to what it was, and clears the holds', () => {
    const procs = { current: [{ pid: 2, type: 'Tab' }, { pid: 4, type: 'GPU' }] };
    const { os, session } = make({ procs, initial: { 2: NORMAL, 4: HIGH } });
    session.begin({ holds: ['extensionUpdates', 'sync'] });
    expect(session.held('extensionUpdates')).toBe(true);
    expect(session.held('sync')).toBe(true);
    const r = session.end();
    expect(r.wasActive).toBe(true);
    expect(os.prio.get(2)).toBe(NORMAL);
    expect(os.prio.get(4)).toBe(HIGH);
    expect(session.held('extensionUpdates')).toBe(false);
    expect(session.state()).toMatchObject({ active: false, lowered: 0, holds: [] });
  });

  it('starting twice lowers once; ending twice restores once', () => {
    const procs = { current: [{ pid: 2, type: 'Tab' }] };
    const { os, session } = make({ procs, initial: { 2: NORMAL } });
    session.begin({}); session.begin({});
    expect(os.setPriority).toHaveBeenCalledTimes(1);
    session.end();
    const again = session.end();
    expect(again.wasActive).toBe(false);
    expect(os.setPriority).toHaveBeenCalledTimes(2);   // one down, one back up
  });

  it('a page opened during the game is lowered at the next look; one that starts sound is raised', async () => {
    const procs = { current: [{ pid: 2, type: 'Tab' }] };
    const audible = [];
    const os = fakeOs({ 2: NORMAL, 6: NORMAL });
    const timers = manualTimers();
    const session = createGameModeSession({ os, ownPid: 1, processes: () => procs.current, audiblePids: () => new Set(audible), setTimer: timers.setTimer, clearTimer: timers.clearTimer });
    session.begin({});
    procs.current = [{ pid: 2, type: 'Tab' }, { pid: 6, type: 'Tab' }];
    await timers.fire();
    expect(os.prio.get(6)).toBe(BELOW);
    audible.push(6);
    await timers.fire();
    expect(os.prio.get(6)).toBe(NORMAL);
    session.end();
    expect(timers.count()).toBe(0);
  });

  it('a process that exited during the game is not an error on the way back', () => {
    const procs = { current: [{ pid: 2, type: 'Tab' }, { pid: 3, type: 'Tab' }] };
    const { os, session, log } = make({ procs, initial: { 2: NORMAL, 3: NORMAL } });
    session.begin({});
    os.prio.delete(3);                               // a tab closed
    expect(() => session.end()).not.toThrow();
    expect(os.prio.get(2)).toBe(NORMAL);
    expect(log).not.toHaveBeenCalled();              // ESRCH on restore is expected
  });

  it('a process Vex may not change is said, and does not stop the rest', () => {
    const procs = { current: [{ pid: 2, type: 'Tab' }, { pid: 3, type: 'Tab' }] };
    const { os, session, log } = make({ procs, initial: { 2: NORMAL, 3: NORMAL } });
    const real = os.setPriority.getMockImplementation();
    os.setPriority.mockImplementation((pid, level) => { if (pid === 2) throw new Error('EACCES: permission denied'); return real(pid, level); });
    const s = session.begin({});
    expect(s).toMatchObject({ lowered: 1, failed: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/process 2.*EACCES/));
    expect(os.prio.get(3)).toBe(BELOW);
  });

  it('holds only exist while a session is active', () => {
    const { session } = make({ procs: { current: [] }, initial: {} });
    expect(session.held('extensionUpdates')).toBe(false);
    session.begin({ holds: ['extensionUpdates'] });
    expect(session.held('extensionUpdates')).toBe(true);
    expect(session.held('sync')).toBe(false);
  });

  it('nothing is written to disk: the module never touches the file system', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/main/game-mode.js'), 'utf8');
    expect(src).not.toMatch(/require\(['"]fs['"]\)|writeFile|appendFile|localStorage|preferences\.set/);
  });
});

describe('extension update checks wait for a game', () => {
  const { createExtensionUpdater, defaultState } = require('../../src/main/extension-updates.js');

  function updater(extra = {}) {
    const state = { ...defaultState(), auto: true };
    const writes = [];
    const timers = manualTimers();
    const u = createExtensionUpdater({
      list: () => [], find: async () => null, install: async () => ({ ok: true }),
      readState: () => JSON.parse(JSON.stringify(state)),
      writeState: (s) => { writes.push(s); },
      isOnline: () => true, isMetered: async () => false,
      setTimeout: timers.setTimer, clearTimeout: timers.clearTimer,
      ...extra,
    });
    return { u, writes, timers };
  }

  it('a scheduled check is skipped while held, writes nothing, and looks again soon', async () => {
    let held = true;
    const { u, writes, timers } = updater({ isHeld: () => held, heldRetryMs: 1234 });
    expect(await u.checkNow({ manual: false })).toEqual({ skipped: 'game' });
    expect(writes).toEqual([]);
    held = false;
    const r = await u.checkNow({ manual: false });
    expect(r.skipped).toBeUndefined();
    expect(timers.count()).toBe(0);
  });

  it('"Check now" is the user asking, so it is never held', async () => {
    const { u } = updater({ isHeld: () => true });
    const r = await u.checkNow({ manual: true });
    expect(r.skipped).toBeUndefined();
  });

  it('the schedule retries after the short wait, not after a day', async () => {
    const calls = [];
    const timers = manualTimers();
    const { u } = updater({
      isHeld: () => true, heldRetryMs: 600000, everyMs: 86400000, firstCheckMs: 1,
      setTimeout: (fn, ms) => { calls.push(ms); return timers.setTimer(fn); }, clearTimeout: timers.clearTimer,
    });
    u.start();
    await timers.fire();
    expect(calls).toEqual([1, 600000]);
  });
});
