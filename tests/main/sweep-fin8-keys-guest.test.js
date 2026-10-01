// Fixed in the 2026-09-29 sweep (fin8-keys): keys pressed while a PAGE has
// the focus. Ctrl+Tab / Ctrl+Shift+Tab reached the registry as "Ctrl+tab" and
// matched nothing; Ctrl+R and Alt+Left/Right did nothing; and a plain
// textarea or contenteditable lost its own editing keys to Vex (Ctrl+B bold
// also hid the sidebar, Ctrl+Shift+Z redo slept the tab).
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { shortcutFor } = require('../../src/main/guest-shortcuts.js');

const key = (k, { shift = false, alt = false, control = true, type = 'keyDown' } = {}) =>
  ({ key: k, shift, alt, control, type });
const WANTED = new Set(['Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+Alt+W', 'F11', 'Ctrl+0']);

describe('guest keys the registry answers keep their name', () => {
  it('Ctrl+Tab and Ctrl+Shift+Tab travel as "Tab", which the registry matches', () => {
    expect(shortcutFor(key('Tab'), { wanted: WANTED })).toEqual({
      channel: 'guest-shortcut', args: [{ key: 'Tab', ctrl: true, shift: false, alt: false }],
    });
    expect(shortcutFor(key('Tab', { shift: true }), { wanted: WANTED }).args[0].key).toBe('Tab');
    // What the registry makes of it (shortcuts-registry.js eventToShortcut).
    const Registry = require('../../src/renderer/js/shortcuts-registry.js');
    expect(Registry.eventToShortcut({ key: 'Tab', ctrlKey: true })).toBe('Ctrl+Tab');
    expect(Registry.eventToShortcut({ key: 'Tab', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+Tab');
  });

  it('a letter is still lowercased, a function key keeps its name', () => {
    expect(shortcutFor(key('W', { alt: true }), { wanted: WANTED }).args[0].key).toBe('w');
    expect(shortcutFor(key('F11', { control: false }), { wanted: WANTED }).args[0].key).toBe('F11');
  });
});

describe('Reload, Back and Forward from inside a page', () => {
  it('Ctrl+R reloads (Ctrl+Shift+R stays the hard reload handled in main.js)', () => {
    expect(shortcutFor(key('r'))).toEqual({ channel: 'reload-tab' });
    expect(shortcutFor(key('r'), { wanted: new Set(['Ctrl+R']) })).toEqual({ channel: 'reload-tab' });
    expect(shortcutFor(key('R', { shift: true }))).toBe(null);
  });

  it('Alt+Left / Alt+Right go back and forward', () => {
    expect(shortcutFor(key('ArrowLeft', { control: false, alt: true }))).toEqual({ channel: 'navigate-back' });
    expect(shortcutFor(key('ArrowRight', { control: false, alt: true }))).toEqual({ channel: 'navigate-forward' });
    // Not with Ctrl or Shift, and not a plain arrow.
    expect(shortcutFor(key('ArrowLeft', { alt: true }))).toBe(null);
    expect(shortcutFor(key('ArrowLeft', { control: false, alt: true, shift: true }))).toBe(null);
    expect(shortcutFor(key('ArrowLeft', { control: false }))).toBe(null);
  });
});

// The page-first block of preload-webview.js, run with a stand-in window and
// ipc. Real key events are trusted; the stand-in says so.
function loadPageFirst({ designMode = 'off' } = {}) {
  const src = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
  const start = src.indexOf("// === Vex's keys a page may use first ===");
  const end = src.indexOf('// === Escape the page left alone');
  const block = src.slice(start, end);
  const sent = [];
  let handler = null;
  const win = { addEventListener: (type, fn) => { if (type === 'keydown') handler = fn; } };
  const req = () => ({ ipcRenderer: { send: (ch, payload) => sent.push([ch, payload]) } });
  new Function('require', 'window', 'document', block)(req, win, { designMode });
  const press = async (k, target, { shift = false, prevented = false } = {}) => {
    handler({ isTrusted: true, ctrlKey: true, metaKey: false, altKey: false, repeat: false, shiftKey: shift, key: shift ? k.toUpperCase() : k, target, composedPath: () => [target], defaultPrevented: prevented });
    await new Promise(r => setTimeout(r, 5));
  };
  return { sent, press };
}
const el = (tagName, extra = {}) => ({ nodeType: 1, tagName, isContentEditable: false, ...extra });

describe('a field keeps the editing keys it acts on itself', () => {
  it('contenteditable: Ctrl+B, Ctrl+U and Ctrl+Shift+Z stay the editor’s', async () => {
    const { sent, press } = loadPageFirst();
    const ce = el('DIV', { isContentEditable: true });
    await press('b', ce); await press('u', ce); await press('z', ce, { shift: true });
    expect(sent).toEqual([]);
    // Keys editing has no use for still reach Vex.
    await press('h', ce); await press('d', ce);
    expect(sent.map(s => s[1].key)).toEqual(['h', 'd']);
  });

  it('designMode counts as an editor', async () => {
    const { sent, press } = loadPageFirst({ designMode: 'on' });
    await press('b', el('BODY'));
    expect(sent).toEqual([]);
  });

  it('textarea and text inputs: Ctrl+Shift+Z is redo, not "sleep this tab"', async () => {
    const { sent, press } = loadPageFirst();
    await press('z', el('TEXTAREA'), { shift: true });
    await press('z', el('INPUT', { type: 'search' }), { shift: true });
    expect(sent).toEqual([]);
    // A textarea has no bold, so Ctrl+B/H/U there are Vex's as in Chrome.
    await press('b', el('TEXTAREA')); await press('h', el('TEXTAREA')); await press('u', el('INPUT', { type: 'text' }));
    expect(sent.map(s => s[1].key)).toEqual(['b', 'h', 'u']);
  });

  it('a read-only field or a checkbox edits nothing, so the key is Vex’s', async () => {
    const { sent, press } = loadPageFirst();
    await press('z', el('TEXTAREA', { readOnly: true }), { shift: true });
    await press('z', el('INPUT', { type: 'checkbox' }), { shift: true });
    expect(sent).toEqual([['guest:page-shortcut', { key: 'z', shift: true }], ['guest:page-shortcut', { key: 'z', shift: true }]]);
  });

  it('on a plain page and for a key the page used, nothing changed', async () => {
    const { sent, press } = loadPageFirst();
    await press('b', el('BODY'));
    await press('z', el('BODY'), { shift: true });
    await press('b', el('BODY'), { prevented: true });
    expect(sent).toEqual([['guest:page-shortcut', { key: 'b', shift: false }], ['guest:page-shortcut', { key: 'z', shift: true }]]);
  });
});

describe('Ctrl+1…9 with Vex’s own window focused', () => {
  it('the main window’s key handler sends jump-to-tab for a digit', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    const at = src.indexOf("mainWindow.webContents.on('before-input-event'");
    const handler = src.slice(at, src.indexOf('Menu.setApplicationMenu(null)', at));
    expect(handler).toMatch(/ctrlOnly && !input\.shift && \/\^\[1-9\]\$\/\.test\(input\.key\)\)\s*\{\s*mainWindow\.webContents\.send\('jump-to-tab', Number\(input\.key\)\)/);
  });
});
