// @vitest-environment jsdom
//
// Vex is on the same screen as the game and the stream.
//
//   The hotkeys that pressed Discord's own buttons are gone (Discord is a plain page in Vex).
//
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

describe('the hotkeys that pressed buttons in Discord are gone', () => {
  it('a Discord action does nothing and nothing is run in a page', async () => {
    for (const action of ['discord-mute', 'discord-deafen', 'discord-hangup']) expect(await GameMode.run(action)).toBe(false);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
    expect(GameMode.CLICKS).toBeUndefined();
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/js/game-mode.js'), 'utf8');
    expect(src).not.toMatch(/vexGuestEval|executeJavaScript|button\[aria-label/);
  });

  it('ignores an action it does not know', async () => {
    expect(await GameMode.run('launch-missiles')).toBe(false);
    expect(window.vexGuestEval).not.toHaveBeenCalled();
  });
});

describe('streamer mode', () => {
  const capturing = () => { globalThis.TabManager.tabs = [{ id: 't1', capturing: { screen: true } }]; };

  it('by default it follows screen sharing: off normally, on while the screen is shared', () => {
    expect(GameMode.mode()).toBe('auto');
    expect(GameMode.apply()).toBe(false);
    expect(document.body.classList.contains('streamer-mode')).toBe(false);

    capturing();
    expect(GameMode.apply()).toBe(true);
    expect(document.body.classList.contains('streamer-mode')).toBe(true);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/Streamer mode on — codes, passwords and notifications are blurred/));
  });

  it('a panel sharing the screen counts; a call (microphone, camera) does not', () => {
    globalThis.SidebarManager.panelCapture = { discord: { mic: true, camera: true } };
    globalThis.TabManager.tabs = [{ id: 't1', capturing: { mic: true } }];
    expect(GameMode.captured()).toBe(false);
    globalThis.SidebarManager.panelCapture = { discord: { mic: true, screen: true } };
    expect(GameMode.captured()).toBe(true);
  });

  it('Vex recording the screen counts too', () => {
    window.ScreenRecorder = { recording: () => true };
    expect(GameMode.captured()).toBe(true);
    delete window.ScreenRecorder;
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
