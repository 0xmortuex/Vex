// @vitest-environment jsdom
//
// Ctrl+K "Open Game Control Center": the command exists, asks main to start
// the app (never naming a program), and when main cannot find it the person is
// told where it looked and offered "Choose location…".
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { GameMode } = require('../../src/renderer/js/game-mode.js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');

const commandSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/command.js'), 'utf8');

beforeEach(() => {
  window.showToast = vi.fn();
  window.vex = {};
});

describe('the command', () => {
  it('is in the command bar with its hint and a VexIcons icon, no emoji', () => {
    const line = commandSrc.split('\n').find(l => l.includes("id: 'game-control-center'"));
    expect(line).toContain("label: 'Open Game Control Center'");
    expect(line).toContain("hint: 'Bypass, game boost, network, overlay and gamma light'");
    expect(line).toContain("icon: 'gamepad'");
    expect(/\p{Extended_Pictographic}/u.test(line)).toBe(false);
  });

  it('is in Turkish too', () => {
    expect(VexI18nUI.lookup('Open Game Control Center', 'tr')).toBeTruthy();
    expect(VexI18nUI.lookup('Choose location…', 'tr')).toBeTruthy();
    expect(VexI18nUI.lookup('Game Control Center location', 'tr')).toBeTruthy();
  });
});

describe('asking main to start it', () => {
  it('says so when it started, and passes nothing to main', async () => {
    window.vex.gccLaunch = vi.fn(async () => ({ ok: true, source: 'shortcut' }));
    await GameMode.openControlCenter();
    expect(window.vex.gccLaunch).toHaveBeenCalledWith();
    expect(window.showToast).toHaveBeenCalledWith('Opened Game Control Center', 'success');
  });

  it('when it is not found, names where it looked and offers Choose location', async () => {
    window.vex.gccLaunch = vi.fn(async () => ({ ok: false, error: 'Game Control Center was not found', looked: ['the Start menu shortcut', 'Program Files'], refused: [] }));
    await GameMode.openControlCenter();
    const [msg, type, , opts] = window.showToast.mock.calls[0];
    expect(msg).toMatch(/not found\. Looked in: the Start menu shortcut; Program Files/);
    expect(type).toBe('error');
    expect(opts.action.label).toBe('Choose location…');
    // The button picks a location and then tries again.
    window.vex.gccPick = vi.fn(async () => ({ ok: true, path: 'D:\\Game Control Center.exe' }));
    window.vex.gccLaunch = vi.fn(async () => ({ ok: true }));
    await opts.action.run();
    expect(window.vex.gccPick).toHaveBeenCalled();
    expect(window.vex.gccLaunch).toHaveBeenCalledTimes(1);
  });

  it('a refused file is shown, not launched', async () => {
    window.vex.gccPick = vi.fn(async () => ({ ok: false, error: 'Choose the file named "Game Control Center.exe"' }));
    await GameMode.chooseControlCenter(true);
    expect(window.showToast.mock.calls[0][0]).toMatch(/Choose the file named/);
    expect(window.showToast.mock.calls[0][1]).toBe('error');
  });

  it('a window without the bridge raises instead of doing nothing', async () => {
    window.vex = {};
    await expect(GameMode.openControlCenter()).rejects.toThrow(/cannot be started/);
  });
});
