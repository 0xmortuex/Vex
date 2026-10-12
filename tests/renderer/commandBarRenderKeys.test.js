// @vitest-environment jsdom
//
// Ctrl+K drew its results by asking the shortcut registry for its whole table
// once per command, three times per row: typing "a" took ~90 ms. The table is
// now read once per draw, and every row shows the same key it showed before.
import { describe, it, expect, beforeAll, vi } from 'vitest';

let ShortcutsRegistry, CommandBar;

beforeAll(() => {
  localStorage.clear();
  ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');
  globalThis.ShortcutsRegistry = ShortcutsRegistry;
  globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
  ({ CommandBar } = require('../../src/renderer/js/command.js'));
  globalThis.CommandBar = CommandBar;
  ShortcutsRegistry.init();
  document.body.innerHTML = '<div id="command-overlay"><input id="command-input"><div id="command-results"></div></div>';
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

describe('drawing the Ctrl+K results', () => {
  it('reads the shortcut table once, however many commands are listed', () => {
    const rows = CommandBar.commands.filter(c => typeof c.action === 'function').slice(0, 60);
    expect(rows.length).toBeGreaterThan(30);
    CommandBar.results = rows;
    CommandBar.selectedIndex = 0;
    const spy = vi.spyOn(ShortcutsRegistry, 'getAllShortcuts');
    CommandBar.renderResults();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    spy.mockRestore();
    expect(document.querySelectorAll('#command-results .command-result')).toHaveLength(rows.length);
  });

  it('shows the same keys as asking each command', () => {
    expect(ShortcutsRegistry.setShortcut('cmd:wake-all', 'Ctrl+Alt+9')).toBe(true);
    const rows = CommandBar.commands.filter(c => typeof c.action === 'function');
    CommandBar.results = rows;
    CommandBar.renderResults();
    const shown = [...document.querySelectorAll('#command-results .command-result')]
      .map(el => (el.querySelector('.command-result-shortcut') || {}).textContent || '');
    const asked = rows.map(c => c.shortcut || '');
    expect(shown).toEqual(asked.map(String));
    expect(shown.some(k => k === 'Ctrl+Alt+9')).toBe(true);
    // The saving is only for the length of a draw: a binding made afterwards shows at once.
    expect(CommandBar._keyIndex).toBeNull();
    expect(ShortcutsRegistry.setShortcut('cmd:wake-all', 'Ctrl+Alt+8')).toBe(true);
    expect(CommandBar.commands.find(c => c.id === 'wake-all').shortcut).toBe('Ctrl+Alt+8');
  });
});
