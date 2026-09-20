// @vitest-environment jsdom
//
// Keys for the rest of Vex.
//
// Thirty-eight of two hundred and fifty commands had a shortcut, and the
// editor could only rebind the handful that were not claimed by the window
// itself — so "put this on a key" was not something you could do. Now every
// Ctrl+K command can be given one, and a batch of the ones people reach for
// ship with a default.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');
const ShortcutEditor = require('../../src/renderer/js/shortcut-editor.js');

let ran;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="host"></div>';
  ran = [];
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  window.showToast = () => {};
  globalThis.ShortcutsRegistry = ShortcutsRegistry;
  globalThis.CommandBar = {
    commands: [
      { id: 'library', label: 'Library', action: () => ran.push('library') },
      { id: 'everything', label: 'Everything Vex Can Do', action: () => ran.push('everything') },
      { id: 'zap', label: 'Zap an element', hint: 'Hide something for good', action: () => ran.push('zap') },
      { id: 'qr', label: 'QR code of this page', action: () => ran.push('qr') },
    ],
  };
  ShortcutsRegistry.resetAll();
  ShortcutsRegistry.init();
});

const press = (combo) => {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: key.length === 1 ? key.toLowerCase() : key,
    ctrlKey: parts.includes('Ctrl'),
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    bubbles: true, cancelable: true,
  }));
};

describe('features that now have a key of their own', () => {
  it('a default that names a command runs it, with nothing else to wire up', () => {
    press('Ctrl+Alt+B');
    expect(ran).toEqual(['library']);
    press('Ctrl+Alt+E');
    expect(ran).toEqual(['library', 'everything']);
  });

  it('counts as handled while the command exists, and stops when it does not', () => {
    expect(ShortcutsRegistry.getAllShortcuts().library.hasHandler).toBe(true);
    globalThis.CommandBar.commands = [];
    expect(ShortcutsRegistry.getAllShortcuts().library.hasHandler).toBe(false);
    press('Ctrl+Alt+B');
    expect(ran).toEqual([]);                    // nothing behind it: the key is not swallowed
  });

  it('every new default is on a free combination', () => {
    const all = ShortcutsRegistry.getAllShortcuts();
    const seen = new Map();
    for (const [id, d] of Object.entries(all)) {
      expect(seen.has(d.current), `${id} clashes with ${seen.get(d.current)} on ${d.current}`).toBe(false);
      seen.set(d.current, id);
    }
  });

  it('they can be rebound — none of them is claimed by the window', () => {
    expect(ShortcutsRegistry.setShortcut('tasks', 'Ctrl+Alt+9')).toBe(true);
    press('Ctrl+Alt+9');
    expect(ShortcutsRegistry.getShortcut('tasks')).toBe('Ctrl+Alt+9');
  });
});

describe('a key for anything else', () => {
  it('lists what has no key yet, and leaves out what has one', () => {
    const spare = ShortcutsRegistry.assignable().map(c => c.id);
    expect(spare).toContain('zap');
    expect(spare).not.toContain('library');          // has a default
  });

  it('binds a command of your choosing, and the key runs it', () => {
    expect(ShortcutsRegistry.setShortcut('cmd:zap', 'Ctrl+Alt+1')).toBe(true);
    press('Ctrl+Alt+1');
    expect(ran).toEqual(['zap']);
    expect(ShortcutsRegistry.assignable().map(c => c.id)).not.toContain('zap');
  });

  it('shows up in the list under your own name for it, read from the command bar', () => {
    ShortcutsRegistry.setShortcut('cmd:zap', 'Ctrl+Alt+1');
    const row = ShortcutsRegistry.getAllShortcuts()['cmd:zap'];
    expect(row.label).toBe('Zap an element');
    expect(row.category).toBe('Your own');
    expect(row.removable).toBe(true);
    // Renaming the command renames the row: the label is never copied.
    globalThis.CommandBar.commands.find(c => c.id === 'zap').label = 'Hide this for good';
    expect(ShortcutsRegistry.getAllShortcuts()['cmd:zap'].label).toBe('Hide this for good');
  });

  it('will not take a key that is already doing something', () => {
    const res = ShortcutsRegistry.setShortcut('cmd:zap', 'Ctrl+Alt+B');
    expect(res.conflict).toBe('library');
    expect(res.conflictLabel).toMatch(/Library/);
  });

  it('refuses a command that is not in Vex', () => {
    expect(ShortcutsRegistry.setShortcut('cmd:nonsense', 'Ctrl+Alt+1')).toEqual({ unknown: true });
  });

  it('removing it takes the key away and offers the command again', () => {
    ShortcutsRegistry.setShortcut('cmd:zap', 'Ctrl+Alt+1');
    ShortcutsRegistry.removeShortcut('cmd:zap');
    expect(ShortcutsRegistry.getAllShortcuts()['cmd:zap']).toBeUndefined();
    press('Ctrl+Alt+1');
    expect(ran).toEqual([]);
    expect(ShortcutsRegistry.assignable().map(c => c.id)).toContain('zap');
  });

  it('one whose command has since gone says so rather than vanishing', () => {
    ShortcutsRegistry.setShortcut('cmd:zap', 'Ctrl+Alt+1');
    globalThis.CommandBar.commands = globalThis.CommandBar.commands.filter(c => c.id !== 'zap');
    const row = ShortcutsRegistry.getAllShortcuts()['cmd:zap'];
    expect(row.label).toMatch(/no longer in Vex/);
    expect(row.hasHandler).toBe(false);
  });
});

describe('the editor', () => {
  const render = () => ShortcutEditor.renderPanel(document.getElementById('host'));

  it('offers everything without a key, and says how many there are', () => {
    render();
    expect(document.querySelector('.shortcut-adder')).not.toBeNull();
    expect(document.querySelector('.shortcut-adder .panel-desc').textContent).toMatch(/there are 2 without one/);
    expect([...document.querySelectorAll('[data-add]')].map(b => b.dataset.add)).toEqual(['zap', 'qr']);
  });

  it('searches it, because there are hundreds', () => {
    render();
    const q = document.querySelector('#shortcut-add-q');
    q.value = 'qr';
    q.dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('[data-add]')].map(b => b.dataset.add)).toEqual(['qr']);
    q.value = 'zzzz';
    q.dispatchEvent(new Event('input'));
    expect(document.querySelector('.shortcut-add-empty').textContent).toMatch(/Nothing matches/);
  });

  it('your own shortcuts are listed with a way to take them off', () => {
    ShortcutsRegistry.setShortcut('cmd:zap', 'Ctrl+Alt+1');
    render();
    const remove = document.querySelector('[data-remove="cmd:zap"]');
    expect(remove).not.toBeNull();
    remove.click();
    expect(ShortcutsRegistry.getShortcut('cmd:zap')).toBeNull();
    expect(document.querySelector('[data-remove="cmd:zap"]')).toBeNull();
  });

  it('pressing keys on a row in the adder binds that command', () => {
    render();
    document.querySelector('[data-add="zap"]').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    expect(ShortcutsRegistry.getShortcut('cmd:zap')).toBe('Ctrl+Alt+1');
  });
});
