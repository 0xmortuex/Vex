// @vitest-environment jsdom
//
// Three defects found by driving the keyboard in a real window (2026-11-06), each held here:
//   1. Ctrl+K pressed with a private window's own interface in front opened the command bar and shut it again.
//   2. A Ctrl+K command that joins the command bar late (Ctrl+Alt+Shift+S, search the selection) never reached main's
//      list of keys, so its key did nothing while a page had the focus.
//   3. After Next Tab / Previous Tab were moved, Ctrl+Tab went on stepping the recency switcher.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('Ctrl+K in the registry', () => {
  it('toggles the command bar once: open() returns nothing, so `open() ?? toggle()` shut it again', () => {
    const src = read('src/renderer/js/app.js');
    const m = src.match(/ShortcutsRegistry\.register\('command-bar',\s*(\(\) => [^\n]*?)\);\r?\n/);
    expect(m, 'the command-bar registration').not.toBeNull();
    expect(m[1]).not.toMatch(/open\?\.\(\)\s*\?\?/);
    // run the real handler against a command bar shaped like the real one
    const bar = { isOpen: false, open() { this.isOpen = true; }, close() { this.isOpen = false; }, toggle() { if (this.isOpen) this.close(); else this.open(); } };
    const handler = new Function('CommandBar', 'return ' + m[1])(bar);
    handler();
    expect(bar.isOpen).toBe(true);
    handler();
    expect(bar.isOpen).toBe(false);
  });
});

describe('a command that joins the command bar late tells main its key', () => {
  let VexExtras;
  beforeEach(() => {
    vi.useFakeTimers();
    ({ VexExtras } = require('../../src/renderer/js/vex-extras.js'));
    VexExtras._commands.length = 0;
    VexExtras._keysTimer = null;
    globalThis.CommandBar = { commands: [] };
    window.ShortcutsRegistry = { _tellMain: vi.fn() };
  });
  afterEach(() => { vi.useRealTimers(); delete globalThis.CommandBar; delete window.ShortcutsRegistry; });

  it('registerCommand into a live command bar sends the keys again, once per burst', () => {
    for (const id of ['k1', 'k2', 'k3']) VexExtras.registerCommand({ id, label: id, action() {} });
    expect(window.ShortcutsRegistry._tellMain).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(window.ShortcutsRegistry._tellMain).toHaveBeenCalledTimes(1);
    expect(globalThis.CommandBar.commands.map(c => c.id)).toEqual(['k1', 'k2', 'k3']);
  });

  it('flushCommands does the same for commands registered before the bar existed', () => {
    const bar = globalThis.CommandBar;
    delete globalThis.CommandBar;
    VexExtras.registerCommand({ id: 'late', label: 'late', action() {} });
    globalThis.CommandBar = bar;
    expect(VexExtras.flushCommands()).toBe(1);
    vi.advanceTimersByTime(400);
    expect(window.ShortcutsRegistry._tellMain).toHaveBeenCalledTimes(1);
  });

  it('says nothing when nothing was added', () => {
    globalThis.CommandBar.commands.push({ id: 'there', label: 'there', action() {} });
    VexExtras.registerCommand({ id: 'there', label: 'there', action() {} });
    VexExtras.flushCommands();
    vi.advanceTimersByTime(400);
    expect(window.ShortcutsRegistry._tellMain).not.toHaveBeenCalled();
  });
});

describe('Ctrl+Tab by recency follows the keys of Next Tab and Previous Tab', () => {
  let VexTabMru;
  const keys = { 'next-tab': 'Ctrl+Tab', 'prev-tab': 'Ctrl+Shift+Tab' };
  beforeEach(() => {
    localStorage.clear();
    ({ VexTabMru } = require('../../src/renderer/js/tab-mru.js'));
    window.vex = { setMruKeys: vi.fn() };
    keys['next-tab'] = 'Ctrl+Tab'; keys['prev-tab'] = 'Ctrl+Shift+Tab';
    globalThis.ShortcutsRegistry = { getShortcut: (id) => keys[id] || null };
  });
  afterEach(() => { delete globalThis.ShortcutsRegistry; delete window.vex; });

  it('is on with the default keys', () => {
    expect(VexTabMru.active()).toBe(true);
    VexTabMru.syncMain();
    expect(window.vex.setMruKeys).toHaveBeenLastCalledWith(true);
    expect(VexTabMru.takes('next-tab')).toBe(true);
  });

  it('gives Ctrl+Tab back to main (and to the page) as soon as Next Tab is moved', () => {
    keys['next-tab'] = 'Ctrl+Alt+9';
    expect(VexTabMru.active()).toBe(false);
    VexTabMru.syncMain();
    expect(window.vex.setMruKeys).toHaveBeenLastCalledWith(false);
    // the registry's own handlers then walk the strip, instead of waiting for a switcher that is off
    expect(VexTabMru.takes('next-tab')).toBe(false);
    expect(VexTabMru.takes('prev-tab')).toBe(false);
  });

  it('does the same when only Previous Tab is moved', () => {
    keys['prev-tab'] = 'Ctrl+Alt+8';
    VexTabMru.syncMain();
    expect(window.vex.setMruKeys).toHaveBeenLastCalledWith(false);
  });

  it('stays off when switched off, whatever the keys', () => {
    VexTabMru.setEnabled(false);
    expect(VexTabMru.active()).toBe(false);
    expect(window.vex.setMruKeys).toHaveBeenLastCalledWith(false);
  });

  it('the registry tells the switcher after every rebinding', () => {
    const src = read('src/renderer/js/shortcuts-registry.js');
    expect(src).toMatch(/function _tellMain\(\)[\s\S]*?VexTabMru\.syncMain\(\)/);
  });
});
