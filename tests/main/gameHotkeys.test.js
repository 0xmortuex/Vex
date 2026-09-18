// src/main/game-hotkeys.js — reaching Discord from inside a fullscreen game.
//
// Muting yourself meant alt-tabbing out of the game, finding Vex, finding the
// panel, clicking — by which time the moment has gone. Discord's own app has
// system-wide hotkeys; a Discord living in a browser panel had none.
//
// A global hotkey takes that combination away from every other program on the
// machine, including the game, so each one is off until the user sets it and
// only what really registers is kept.

import { describe, it, expect, vi } from 'vitest';
const { createGameHotkeys, isSafeAccelerator, ACTIONS } = require('../../src/main/game-hotkeys.js');

function harness(over = {}) {
  const taken = new Set(over.taken || []);
  const registered = new Map();
  const globalShortcut = {
    register: vi.fn((accel, cb) => { if (taken.has(accel)) return false; registered.set(accel, cb); return true; }),
    unregister: vi.fn((accel) => registered.delete(accel)),
  };
  const saved = [];
  const onAction = vi.fn();
  const hk = createGameHotkeys({ globalShortcut, onAction, load: () => over.stored || {}, save: (a) => saved.push(a), ...over.deps });
  return { hk, globalShortcut, registered, saved, onAction };
}

describe('which combinations are allowed', () => {
  it('needs a modifier and a real key', () => {
    expect(isSafeAccelerator('Ctrl+Shift+M')).toBe(true);
    expect(isSafeAccelerator('Alt+F4')).toBe(true);
    expect(isSafeAccelerator('CommandOrControl+Alt+Numpad1')).toBe(true);
    expect(isSafeAccelerator('Ctrl+Alt+/')).toBe(true);
  });

  it('refuses what would swallow ordinary typing', () => {
    expect(isSafeAccelerator('M')).toBe(false);            // every M on the machine
    expect(isSafeAccelerator('Shift+A')).toBe(false);      // capital A
    expect(isSafeAccelerator('Ctrl')).toBe(false);
    expect(isSafeAccelerator('')).toBe(false);
    expect(isSafeAccelerator('Banana+M')).toBe(false);
  });
});

describe('registering them', () => {
  it('takes only the actions it knows, and reports what it took', () => {
    const { hk, globalShortcut } = harness();
    const r = hk.set({ 'discord-mute': 'Ctrl+Shift+M', 'not-a-thing': 'Ctrl+Shift+Q' });
    expect(r.applied).toEqual({ 'discord-mute': 'Ctrl+Shift+M' });
    expect(r.errors).toEqual([]);
    expect(globalShortcut.register).toHaveBeenCalledTimes(1);
    expect(hk.current()).toEqual({ 'discord-mute': 'Ctrl+Shift+M' });
  });

  it('a combination another program already holds is reported, not swallowed', () => {
    const { hk } = harness({ taken: ['Ctrl+Shift+M'] });
    const r = hk.set({ 'discord-mute': 'Ctrl+Shift+M' });
    expect(r.applied).toEqual({});
    expect(r.errors).toEqual([{ action: 'discord-mute', accel: 'Ctrl+Shift+M', error: 'Another program already has Ctrl+Shift+M' }]);
    expect(hk.current()).toEqual({});
  });

  it('a plain key is refused with a reason', () => {
    const { hk } = harness();
    expect(hk.set({ 'discord-mute': 'M' }).errors[0].error).toMatch(/needs a modifier/);
  });

  it('only what registered is saved, so a stolen key does not come back dead', () => {
    const { hk, saved } = harness({ taken: ['Ctrl+Shift+D'] });
    hk.set({ 'discord-mute': 'Ctrl+Shift+M', 'discord-deafen': 'Ctrl+Shift+D' });
    expect(saved).toEqual([{ 'discord-mute': 'Ctrl+Shift+M' }]);
  });

  it('setting again releases the old combination first', () => {
    const { hk, globalShortcut } = harness();
    hk.set({ 'discord-mute': 'Ctrl+Shift+M' });
    hk.set({ 'discord-mute': 'Ctrl+Alt+M' });
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Ctrl+Shift+M');
    expect(hk.current()).toEqual({ 'discord-mute': 'Ctrl+Alt+M' });
  });

  it('pressing one reports the action', () => {
    const { hk, registered, onAction } = harness();
    hk.set({ 'discord-deafen': 'Ctrl+Shift+D' });
    registered.get('Ctrl+Shift+D')();
    expect(onAction).toHaveBeenCalledWith('discord-deafen');
  });

  it('starts from what was saved before, and an unreadable file is not fatal', () => {
    const { hk } = harness({ stored: { 'discord-mute': 'Ctrl+Shift+M' } });
    expect(hk.apply().applied).toEqual({ 'discord-mute': 'Ctrl+Shift+M' });
    const broken = createGameHotkeys({ globalShortcut: { register: () => true, unregister: () => {} }, onAction: () => {}, load: () => { throw new Error('unreadable'); } });
    expect(broken.apply().applied).toEqual({});
  });

  it('offers no push-to-talk, because a global shortcut cannot see the key release', () => {
    expect(Object.keys(ACTIONS)).toEqual(['discord-mute', 'discord-deafen', 'discord-hangup']);
  });
});
