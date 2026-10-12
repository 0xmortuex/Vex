// Audit B2 (2026-10-10): F12, Ctrl+Shift+J, Ctrl+Shift+F12 and Ctrl+Alt+H were
// Windows-wide hotkeys, so while Vex ran they were dead in every other
// program. They are now answered in Vex's own windows and pages only
// (src/main/window-keys.js); the boss key holds Ctrl+Alt+H Windows-wide only
// while Vex is hidden, to bring it back.
import { describe, it, expect, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const { devToolsKeyFor, isBossKey, createBossKey, BOSS_ACCELERATOR } = require('../../src/main/window-keys.js');

const key = (k, mods = {}) => ({ type: 'keyDown', key: k, control: false, alt: false, shift: false, meta: false, ...mods });
const MAIN = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');

describe('nothing Windows-wide at startup', () => {
  it('main.js registers no global shortcut of its own (the game hotkeys and the boss key\'s way back are modules)', () => {
    expect(MAIN).not.toMatch(/globalShortcut\.register\(/);
    for (const k of ["'F12'", "'CommandOrControl+Shift+J'", "'CommandOrControl+Shift+F12'", "'CommandOrControl+Alt+H'"]) {
      expect(MAIN).not.toContain('globalShortcut.register(' + k);
    }
  });

  it('every Vex window and page answers the keys itself, where it has the focus', () => {
    const i = MAIN.indexOf("contents.on('before-input-event', (event, input) => { handleWindowKeys(event, input, contents); });");
    expect(i).toBeGreaterThan(0);
    const block = MAIN.slice(MAIN.lastIndexOf("app.on('web-contents-created'", i), i);
    expect(block).toContain("if (type !== 'window' && type !== 'webview') return;");
  });
});

describe('which key is which', () => {
  it('F12 is the window\'s DevTools, Ctrl+Shift+F12 detached, Ctrl+Shift+J the focused page\'s', () => {
    expect(devToolsKeyFor(key('F12'))).toBe('window-docked');
    expect(devToolsKeyFor(key('F12', { control: true, shift: true }))).toBe('window-detached');
    expect(devToolsKeyFor(key('J', { control: true, shift: true }))).toBe('focused-detached');
    expect(devToolsKeyFor(key('j', { control: true, shift: true }))).toBe('focused-detached');
  });

  it('leaves everything else alone, and key releases', () => {
    expect(devToolsKeyFor(key('F12', { alt: true }))).toBe(null);
    expect(devToolsKeyFor(key('F12', { control: true }))).toBe(null);
    expect(devToolsKeyFor(key('j', { control: true }))).toBe(null);
    expect(devToolsKeyFor(key('J', { control: true, shift: true, alt: true }))).toBe(null);
    expect(devToolsKeyFor({ ...key('F12'), type: 'keyUp' })).toBe(null);
    expect(devToolsKeyFor(null)).toBe(null);
  });

  it('the boss key is Ctrl+Alt+H only', () => {
    expect(isBossKey(key('h', { control: true, alt: true }))).toBe(true);
    expect(isBossKey(key('H', { control: true, alt: true }))).toBe(true);
    expect(isBossKey(key('h', { control: true }))).toBe(false);
    expect(isBossKey(key('h', { control: true, alt: true, shift: true }))).toBe(false);
    expect(isBossKey({ ...key('h', { control: true, alt: true }), type: 'keyUp' })).toBe(false);
  });
});

describe('the boss key', () => {
  function harness({ registers = true } = {}) {
    const held = new Map();
    const globalShortcut = {
      register: vi.fn((accel, fn) => { if (!registers) return false; held.set(accel, fn); return true; }),
      unregister: vi.fn((accel) => { held.delete(accel); }),
    };
    const win = () => ({ hide: vi.fn(), show: vi.fn(), focus: vi.fn(), isDestroyed: () => false });
    const wins = [win(), win()];
    const pages = [{ setAudioMuted: vi.fn(), isDestroyed: () => false }];
    const boss = createBossKey({ globalShortcut, windows: () => wins, contents: () => pages });
    return { boss, globalShortcut, held, wins, pages };
  }

  it('takes nothing Windows-wide until Vex is hidden', () => {
    const { globalShortcut } = harness();
    expect(globalShortcut.register).not.toHaveBeenCalled();
  });

  it('hides and mutes; Ctrl+Alt+H from anywhere brings Vex back and gives the key back', () => {
    const { boss, globalShortcut, held, wins, pages } = harness();
    expect(boss.hide()).toEqual({ ok: true });
    expect(globalShortcut.register).toHaveBeenCalledWith(BOSS_ACCELERATOR, expect.any(Function));
    expect(wins.every(w => w.hide.mock.calls.length === 1)).toBe(true);
    expect(pages[0].setAudioMuted).toHaveBeenLastCalledWith(true);
    expect(boss.isHidden()).toBe(true);
    held.get(BOSS_ACCELERATOR)();                     // pressed in another program
    expect(boss.isHidden()).toBe(false);
    expect(globalShortcut.unregister).toHaveBeenCalledWith(BOSS_ACCELERATOR);
    expect(held.size).toBe(0);
    expect(wins.every(w => w.show.mock.calls.length === 1 && w.focus.mock.calls.length === 1)).toBe(true);
    expect(pages[0].setAudioMuted).toHaveBeenLastCalledWith(false);
  });

  it('does not hide Vex when the key to bring it back is another program\'s, and says so', () => {
    const { boss, wins } = harness({ registers: false });
    const r = boss.hide();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Another program has Ctrl\+Alt\+H/);
    expect(boss.isHidden()).toBe(false);
    expect(wins.every(w => w.hide.mock.calls.length === 0)).toBe(true);
  });
});
