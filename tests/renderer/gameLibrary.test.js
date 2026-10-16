// @vitest-environment jsdom
//
// js/game-library.js: installed games are OFFERED to Game mode, never added
// without a confirm, a skipped game stays skipped, and the weekly offer goes to
// the Attention Inbox once.
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { GameSession } = require('../../src/renderer/js/game-session.js');
globalThis.GameSession = GameSession; window.GameSession = GameSession;
const { GameLibrary } = require('../../src/renderer/js/game-library.js');

const RESULT = {
  candidates: [
    { source: 'steam', name: 'Counter-Strike 2', exe: 'cs2' },
    { source: 'roblox', name: 'Roblox', exe: 'robloxplayerbeta' },
    { source: 'epic', name: 'Rocket League', exe: 'rocketleague' },
  ],
  errors: [],
  sources: { steam: true, epic: true, roblox: true },
};

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="game-session-settings"></div>';
  window.showToast = vi.fn();
  window.VexProblems = { note: vi.fn() };
  window.vexConfirm = vi.fn(async () => true);
  window.vex = { gameModeLibrary: vi.fn(async () => RESULT), gameModeGames: vi.fn(async () => ({})) };
  delete globalThis.VexAttention;
  delete globalThis.GameMode;
  GameSession.active = false;
  localStorage.setItem('vex.gameMode.games', JSON.stringify([{ id: 'g_robloxplayerbeta', name: 'Roblox', exe: 'robloxplayerbeta' }]));
});

describe('fresh()', () => {
  it('leaves out games already on the list and games the person skipped', () => {
    GameLibrary.skip('Rocket League.exe'.replace(/\s/g, ''));
    expect(GameLibrary.fresh(RESULT).map(c => c.exe)).toEqual(['cs2']);
  });
  it('remembers a skip across reads and clears it', () => {
    GameLibrary.skip('cs2.exe');
    expect(GameLibrary.skipped()).toEqual(['cs2']);
    GameLibrary.unskipAll();
    expect(GameLibrary.skipped()).toEqual([]);
  });
  it('raises a damaged skip list instead of ignoring it', () => {
    localStorage.setItem('vex.gameLibrary.skipped', '{nope');
    expect(() => GameLibrary.skipped()).toThrow(/could not be read/);
  });
});

describe('add()', () => {
  it('adds nothing when the person says no', async () => {
    window.vexConfirm = vi.fn(async () => false);
    expect(await GameLibrary.add(RESULT.candidates[0])).toBe(null);
    expect(GameSession.games().map(g => g.exe)).toEqual(['robloxplayerbeta']);
  });
  it('adds the one game that was confirmed', async () => {
    const g = await GameLibrary.add(RESULT.candidates[0]);
    expect(g.exe).toBe('cs2');
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(GameSession.games().map(g2 => g2.exe)).toEqual(['robloxplayerbeta', 'cs2']);
  });
});

describe('scan()', () => {
  it('raises when the window cannot list games', async () => {
    window.vex = {};
    await expect(GameLibrary.scan()).rejects.toThrow(/not available/);
  });
  it('raises on an answer it does not understand', async () => {
    window.vex.gameModeLibrary = vi.fn(async () => ({}));
    await expect(GameLibrary.scan()).rejects.toThrow(/did not expect/);
  });
});

describe('offer()', () => {
  it('puts ONE line in the Attention Inbox and does not repeat within a week', async () => {
    const suggest = vi.fn(() => true);
    globalThis.VexAttention = { suggest };
    const t0 = 1_000_000_000_000;
    const found = await GameLibrary.offer(t0);
    expect(found.map(c => c.exe)).toEqual(['cs2', 'rocketleague']);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toMatchObject({ feature: 'game-library', id: 'found', action: { key: 'review' } });
    expect(await GameLibrary.offer(t0 + 3 * 24 * 3600 * 1000)).toBe(null);
    expect(window.vex.gameModeLibrary).toHaveBeenCalledTimes(1);
    await GameLibrary.offer(t0 + 8 * 24 * 3600 * 1000);
    expect(window.vex.gameModeLibrary).toHaveBeenCalledTimes(2);
  });
  it('does not look while a game runs, or when switched off', async () => {
    globalThis.VexAttention = { suggest: vi.fn() };
    GameSession.active = true;
    expect(await GameLibrary.offer()).toBe(null);
    GameSession.active = false;
    GameLibrary.setEnabled(false);
    expect(await GameLibrary.offer()).toBe(null);
    expect(window.vex.gameModeLibrary).not.toHaveBeenCalled();
  });
  it('says nothing when everything is already on the list', async () => {
    const suggest = vi.fn();
    globalThis.VexAttention = { suggest };
    window.vex.gameModeLibrary = vi.fn(async () => ({ ...RESULT, candidates: [RESULT.candidates[1]] }));
    expect(await GameLibrary.offer()).toBe(null);
    expect(suggest).not.toHaveBeenCalled();
  });
});

describe('the Settings block', () => {
  it('lists what was found with Add and Not this one, and shows read errors', async () => {
    window.vex.gameModeLibrary = vi.fn(async () => ({ ...RESULT, errors: [{ source: 'epic', message: 'bad.item is damaged' }] }));
    const host = document.getElementById('game-session-settings');
    GameLibrary.mount(host);
    host.querySelector('.gs-library button').click();
    await vi.waitFor(() => expect(host.querySelectorAll('.gs-library-list .setting-toggle-row').length).toBe(2));
    expect(host.textContent).toContain('bad.item is damaged');
    expect(host.textContent).toContain('Counter-Strike 2');
    expect(host.textContent).not.toContain('Roblox — robloxplayerbeta');
  });
});
