// @vitest-environment jsdom
//
// Vex is on the same screen as the game and the stream.
//
//   The hotkey presses Discord's own button inside the panel, so muting works
//   from a fullscreen game.
//   Streamer mode blurs one-time codes, passwords and notification text while
//   something is being captured — Vex holds all of it, and sharing a screen
//   puts it in front of an audience.

import { describe, it, expect, vi, beforeEach } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { GameMode } = require('../../src/renderer/js/game-mode.js');

let guestCode;
beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  delete GameMode._was;
  delete GameMode._watching;
  guestCode = null;
  window.showToast = vi.fn();
  window.vexGuestEval = vi.fn(async (wv, code) => { guestCode = code; return 'Mute'; });
  globalThis.SidebarManager = { panelWebviews: { discord: { id: 'discord-wv' } }, panelCapture: {} };
  globalThis.TabManager = { tabs: [], isCapturing: (t) => !!(t.capturing && (t.capturing.mic || t.capturing.camera)) };
  globalThis.VexProblems = { note: vi.fn() };
});

describe('the Discord hotkeys', () => {
  it('presses the real button and says what happened', async () => {
    expect(await GameMode.run('discord-mute')).toBe(true);
    // The selectors go in JSON-encoded, so the quotes inside are escaped.
    expect(guestCode).toContain(JSON.stringify(GameMode.CLICKS['discord-mute']));
    expect(guestCode).toMatch(/aria-label\^=.{1,3}Mute/);
    expect(guestCode).toContain('found.click()');
    expect(window.vexGuestEval).toHaveBeenCalledWith({ id: 'discord-wv' }, expect.any(String), true, 4000);
    expect(window.showToast).toHaveBeenCalledWith('Microphone muted');
  });

  it('reads the state from the label as it was before the click', () => {
    expect(GameMode._said('Mute')).toBe('Microphone muted');
    expect(GameMode._said('Unmute (Ctrl+Shift+M)')).toBe('Microphone on');
    expect(GameMode._said('Deafen')).toBe('Deafened');
    expect(GameMode._said('Undeafen')).toBe('Sound on');
    expect(GameMode._said('Disconnect')).toBe('Left the call');
  });

  it('says so when Discord is not in a call, and when the panel was never opened', async () => {
    window.vexGuestEval = vi.fn(async () => null);
    expect(await GameMode.run('discord-mute')).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Discord is not in a call', 'info');

    globalThis.SidebarManager.panelWebviews = {};
    expect(await GameMode.run('discord-mute')).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Open the Discord panel once, and the hotkey will work from anywhere', 'error');
  });

  it('a panel that will not answer is recorded rather than silently doing nothing', async () => {
    window.vexGuestEval = vi.fn(async () => { throw new Error('guest is gone'); });
    expect(await GameMode.run('discord-mute')).toBe(false);
    expect(VexProblems.note).toHaveBeenCalledWith('Discord hotkey', 'Could not reach the Discord panel', expect.any(Error));
  });

  it('ignores an action it does not know', async () => {
    expect(await GameMode.run('launch-missiles')).toBe(false);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
});

describe('streamer mode', () => {
  const capturing = () => { globalThis.TabManager.tabs = [{ id: 't1', capturing: { mic: true } }]; };

  it('by default it follows the capture: off normally, on while something is recording', () => {
    expect(GameMode.mode()).toBe('auto');
    expect(GameMode.apply()).toBe(false);
    expect(document.body.classList.contains('streamer-mode')).toBe(false);

    capturing();
    expect(GameMode.apply()).toBe(true);
    expect(document.body.classList.contains('streamer-mode')).toBe(true);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Streamer mode on — codes, passwords and notifications are blurred/));
  });

  it('a panel sharing a camera counts too', () => {
    globalThis.SidebarManager.panelCapture = { discord: { camera: true } };
    expect(GameMode.captured()).toBe(true);
  });

  it('always-on and off ignore the capture', () => {
    GameMode.setMode('on');
    expect(GameMode.apply()).toBe(true);
    GameMode.setMode('off');
    capturing();
    expect(GameMode.apply()).toBe(false);
    expect(() => GameMode.setMode('sometimes')).toThrow(/Unknown streamer mode/);
  });

  it('says it once when it turns on, and once when it turns off', () => {
    capturing();
    GameMode.apply(); GameMode.apply(); GameMode.apply();
    expect(window.showToast).toHaveBeenCalledTimes(1);
    globalThis.TabManager.tabs = [];
    GameMode.apply();
    expect(window.showToast).toHaveBeenCalledTimes(2);
    expect(window.showToast).toHaveBeenLastCalledWith('Streamer mode off');
  });

  it('never announces "off" before it has ever been on', () => {
    GameMode.apply();
    expect(window.showToast).not.toHaveBeenCalled();
  });

  it('a state it cannot read is treated as not captured, and the switch still works', () => {
    globalThis.TabManager = { get tabs() { throw new Error('gone'); } };
    expect(GameMode.captured()).toBe(false);
    GameMode.setMode('on');
    expect(GameMode.on()).toBe(true);
  });
});

describe('streamer mode, the rest', () => {
  it('blurs an email address in a tab title, and only while on — also one that appears later', async () => {
    document.body.innerHTML = '<div class="tab-title">Inbox (3) - you@gmail.com - Gmail</div><div class="tab-title">YouTube</div>';
    GameMode.setMode('on');
    const [mail, yt] = document.querySelectorAll('.tab-title');
    expect(mail.hasAttribute('data-sensitive')).toBe(true);
    expect(yt.hasAttribute('data-sensitive')).toBe(false);
    yt.textContent = 'Shared with dana@work.example';
    await new Promise(r => setTimeout(r, 0));
    expect(yt.hasAttribute('data-sensitive')).toBe(true);
    GameMode.setMode('off');
    expect(document.querySelectorAll('.tab-title[data-sensitive]')).toHaveLength(0);
  });

  it('the hotkey turns it on, and off again', async () => {
    GameMode.setMode('auto');                  // nothing captured: off
    expect(await GameMode.run('streamer-toggle')).toBe('on');
    expect(document.body.classList.contains('streamer-mode')).toBe(true);
    expect(await GameMode.run('streamer-toggle')).toBe('off');
    expect(document.body.classList.contains('streamer-mode')).toBe(false);
  });

  it('is offered as a hotkey', () => {
    const { ACTIONS } = require('../../src/main/game-hotkeys.js');
    expect(ACTIONS['streamer-toggle']).toMatch(/streamer mode/);
  });
});
