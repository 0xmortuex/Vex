// @vitest-environment jsdom
//
// The keys every browser has that Vex lacked (found 2026-10-10): F5 reload,
// Ctrl+F5 / Shift+F5 reload ignoring the cache, F6 / Alt+D to the address
// bar, Ctrl+PageUp / Ctrl+PageDown for the previous / next tab. They are in
// the shortcut registry, so they show in the shortcut editor and can be
// moved, and as in Chrome they are Vex's whether Vex's own interface or a
// page has the focus: a page's key goes up through main/guest-shortcuts.js
// as the key itself, and the registry decides.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');
const { shortcutFor } = require('../../src/main/guest-shortcuts.js');

const KEYS = {
  'reload-f5': 'F5',
  'hard-reload-ctrl-f5': 'Ctrl+F5',
  'hard-reload-shift-f5': 'Shift+F5',
  'focus-url-f6': 'F6',
  'focus-url-alt-d': 'Alt+D',
  'next-tab-pagedown': 'Ctrl+PageDown',
  'prev-tab-pageup': 'Ctrl+PageUp',
};

let ran, wanted;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '<input id="url-input">';
  ran = [];
  wanted = null;
  window.vex = { setGuestShortcutKeys: (combos) => { wanted = new Set(combos); } };
  ShortcutsRegistry.resetAll();
  for (const id of Object.keys(KEYS)) ShortcutsRegistry.register(id, () => ran.push(id));
  ShortcutsRegistry.init();
  ShortcutsRegistry._tellMain();
});

// A key as the DOM reports it, from "Ctrl+PageUp".
function domKey(combo) {
  const parts = combo.split('+');
  const k = parts[parts.length - 1];
  return { key: k.length === 1 ? k.toLowerCase() : k, ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift') };
}
const press = (combo, target = document) => target.dispatchEvent(new KeyboardEvent('keydown', { ...domKey(combo), bubbles: true, cancelable: true }));

// The same key as Electron's before-input-event gives it to main.
function inputOf(combo) {
  const d = domKey(combo);
  return { type: 'keyDown', key: d.key, control: d.ctrlKey, alt: d.altKey, shift: d.shiftKey, meta: false };
}
// What app.js does with a 'guest-shortcut' from main.
function fromPage(combo) {
  const hit = shortcutFor(inputOf(combo), { wanted });
  if (!hit) return null;
  expect(hit.channel).toBe('guest-shortcut');
  const c = hit.args[0];
  document.dispatchEvent(new KeyboardEvent('keydown', { key: c.key, ctrlKey: c.ctrl, shiftKey: c.shift, altKey: c.alt, bubbles: true, cancelable: true }));
  return hit;
}

describe('the standard browser keys', () => {
  it('are in the registry with these defaults, rebindable, and free of clashes', () => {
    const all = ShortcutsRegistry.getAllShortcuts();
    for (const [id, combo] of Object.entries(KEYS)) {
      expect(all[id], id).toBeTruthy();
      expect(all[id].current, id).toBe(combo);
      expect(all[id].system, id).toBeFalsy();
      expect(all[id].hasHandler, id).toBe(true);
      const owners = Object.entries(all).filter(([, d]) => d.current === combo).map(([other]) => other);
      expect(owners, combo).toEqual([id]);
    }
  });

  it('work with Vex’s own interface focused', () => {
    for (const [id, combo] of Object.entries(KEYS)) {
      ran = [];
      press(combo);
      expect(ran, combo).toEqual([id]);
    }
  });

  it('work from the address bar too (F6, Alt+D and the rest are not typing)', () => {
    const input = document.getElementById('url-input');
    for (const [id, combo] of Object.entries(KEYS)) {
      ran = [];
      press(combo, input);
      expect(ran, combo).toEqual([id]);
    }
  });

  it('work with a page focused: main passes each one up and the registry runs it', () => {
    expect(wanted).toBeTruthy();
    for (const [id, combo] of Object.entries(KEYS)) {
      ran = [];
      expect(fromPage(combo), combo).toBeTruthy();
      expect(ran, combo).toEqual([id]);
    }
  });

  it('follow a rebind, in Vex and in pages', () => {
    expect(ShortcutsRegistry.setShortcut('reload-f5', 'Ctrl+Alt+F5')).toBe(true);
    ran = [];
    press('F5');
    expect(ran).toEqual([]);
    expect(shortcutFor(inputOf('F5'), { wanted })).toBe(null);   // the page has F5 back
    fromPage('Ctrl+Alt+F5');
    expect(ran).toEqual(['reload-f5']);
  });

  it('the page keeps the keys Vex does not answer', () => {
    expect(shortcutFor(inputOf('PageUp'), { wanted })).toBe(null);
    expect(shortcutFor(inputOf('Shift+PageDown'), { wanted })).toBe(null);
    expect(shortcutFor(inputOf('F7'), { wanted })).toBe(null);
  });
});
