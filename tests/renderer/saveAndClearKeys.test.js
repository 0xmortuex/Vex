// @vitest-environment jsdom
//
// Two browser keys Vex lacked (found 2026-10-10): Ctrl+S did not save the
// page, and Clear browsing data was only in Settings (not in Ctrl+K, no
// Ctrl+Shift+Delete). Both run a Ctrl+K command; from a page, Ctrl+S is the
// page's first and reaches Vex only when the page left it alone.
import { describe, it, expect, beforeAll, vi } from 'vitest';

let SR, CommandBar;
const GS = require('../../src/main/guest-shortcuts.js');

beforeAll(() => {
  localStorage.clear();
  SR = require('../../src/renderer/js/shortcuts-registry.js');
  globalThis.ShortcutsRegistry = SR;
  ({ CommandBar } = require('../../src/renderer/js/command.js'));
  globalThis.CommandBar = CommandBar;
  SR.init();
});
const cmd = (id) => CommandBar.commands.find(c => c.id === id);
const press = (key, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...o }));

describe('Ctrl+S', () => {
  it('asks one file or PDF, and saves the one chosen', async () => {
    window.PageExport = { savePage: vi.fn(async () => {}) };
    window.vexConfirm = vi.fn(async () => true);
    expect(cmd('save-as').shortcut).toBe('Ctrl+S');
    await cmd('save-as').action();
    expect(window.PageExport.savePage).toHaveBeenCalledWith('mhtml');
    window.vexConfirm = vi.fn(async (o) => { o.extra.run(); return false; });
    await cmd('save-as').action();
    expect(window.PageExport.savePage).toHaveBeenLastCalledWith('pdf');
  });
  it('the key runs it with Vex focused', () => {
    window.vexConfirm = vi.fn(async () => false);
    press('s');
    expect(window.vexConfirm).toHaveBeenCalled();
  });
  it('from a page, only once the page left it alone', () => {
    const wanted = new Set(['Ctrl+S']);
    expect(GS.shortcutFor({ type: 'keyDown', key: 's', control: true, shift: false, alt: false }, { wanted })).toBe(null);
    expect(GS.pageShortcut({ key: 's', shift: false }, { wanted })).toEqual({ channel: 'guest-shortcut', args: [{ key: 's', ctrl: true, shift: false, alt: false }] });
  });
});

describe('Clear browsing data', () => {
  it('is in Ctrl+K on Ctrl+Shift+Delete and asks through the Settings button', () => {
    document.body.innerHTML = '<button id="setting-clear-data"></button>';
    const clicked = vi.fn();
    document.getElementById('setting-clear-data').addEventListener('click', clicked);
    expect(cmd('clear-data').shortcut).toBe('Ctrl+Shift+Delete');
    press('Delete', { shiftKey: true });
    expect(clicked).toHaveBeenCalledTimes(1);
  });
  it('the key goes up from a page', () => {
    const hit = GS.shortcutFor({ type: 'keyDown', key: 'Delete', control: true, shift: true, alt: false }, { wanted: new Set(['Ctrl+Shift+Delete']) });
    expect(hit).toEqual({ channel: 'guest-shortcut', args: [{ key: 'Delete', ctrl: true, shift: true, alt: false }] });
  });
});
