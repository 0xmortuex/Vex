// @vitest-environment jsdom
//
// The keys Ctrl+K and the Shortcuts & Gestures guide show come from the
// shortcut registry, so they are the keys that actually work. Both were typed
// in by hand: Private Window said Ctrl+Shift+N, which opens Notes (the real
// key is Ctrl+Alt+N), and a key moved in Settings › Shortcuts still showed the
// old one (found 2026-10-10).

import { describe, it, expect, beforeAll } from 'vitest';

let ShortcutsRegistry, CommandBar;
const cmd = (id) => CommandBar.commands.find(c => c.id === id);

beforeAll(() => {
  localStorage.clear();
  ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');
  globalThis.ShortcutsRegistry = ShortcutsRegistry;
  ({ CommandBar } = require('../../src/renderer/js/command.js'));
  globalThis.CommandBar = CommandBar;
  ShortcutsRegistry.init();
});

describe('Ctrl+K key hints', () => {
  it('Private Window shows the key that opens one', () => {
    expect(cmd('private').shortcut).toBe('Ctrl+Alt+N');
  });

  it('a key moved in the editor is the key shown', () => {
    ShortcutsRegistry.register('group-tabs', () => {});
    expect(cmd('group-tabs').shortcut).toBe('Ctrl+Shift+G');
    expect(ShortcutsRegistry.setShortcut('group-tabs', 'Ctrl+Alt+O')).toBe(true);
    expect(cmd('group-tabs').shortcut).toBe('Ctrl+Alt+O');
  });

  it('a command whose key is a registry entry of its own (Library) shows it', () => {
    expect(cmd('library').shortcut).toBe('Ctrl+Alt+B');
  });

  it('a key you gave a command yourself shows on that command', () => {
    expect(ShortcutsRegistry.setShortcut('cmd:wake-all', 'Ctrl+Alt+9')).toBe(true);
    expect(cmd('wake-all').shortcut).toBe('Ctrl+Alt+9');
  });

  it('Remember (AI history search) shows the AI-history key, Notes keeps its fixed key', () => {
    expect(cmd('remember').shortcut).toBe(ShortcutsRegistry.getShortcut('history-ai'));
    expect(cmd('notes').shortcut).toBe('Ctrl+Shift+N');
  });
});

describe('the Shortcuts & Gestures guide reads the registry', () => {
  beforeAll(() => { globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons; require('../../src/renderer/js/shortcuts-guide.js'); });

  it('lists a moved key under its new combination, and the keys that live outside the registry', () => {
    const rows = window.ShortcutsGuide.keys();
    const find = (label) => rows.find(r => r[0] === label);
    expect(find('Organize Tabs with AI')[1]).toBe('Ctrl+Alt+O');
    expect(find('Private Window')[1]).toBe('Ctrl+Alt+N');
    const keys = rows.map(r => r[1]);
    expect(keys).toContain('Ctrl+Shift+N');          // Notes, fixed
    expect(keys).toContain('Ctrl+Alt+1 / 2 / 3');    // command chains
    expect(keys).toContain('Ctrl+P');
    expect(keys).toContain('Ctrl+U');
  });
});
