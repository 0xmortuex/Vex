// Every key the shortcut registry answers works while a page has the focus,
// and a key moved away stops doing the old thing there (found 2026-10-10):
//   * Ctrl+Shift+K (shortcut sheet), Ctrl+Shift+F (AI full screen),
//     Ctrl+Shift+P (picture-in-picture), Ctrl+Shift+N (Notes), Ctrl+Alt+1..3
//     (command chains) and any Ctrl/Ctrl+Shift letter you bound yourself did
//     nothing from inside a page;
//   * Ctrl+L, Ctrl+Shift+R and Ctrl+Alt+L kept focusing the bar, hard
//     reloading and locking Vex in pages after being moved to another key.
// Ctrl/Ctrl+Shift letters stay the page's first (as in Chrome): the page
// preload reports one the page left alone, and main turns it into the
// registry's key.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const GS = require('../../src/main/guest-shortcuts.js');

const press = (key, { ctrl = true, shift = false, alt = false } = {}) =>
  ({ type: 'keyDown', key, control: ctrl, shift, alt, meta: false });
const up = (key, shift, alt = false) => ({ channel: 'guest-shortcut', args: [{ key, ctrl: true, shift, alt }] });

describe('registry keys a page left alone reach the registry', () => {
  const wanted = new Set(['Ctrl+Shift+K', 'Ctrl+Shift+F', 'Ctrl+Shift+E', 'Ctrl+E']);
  it('Ctrl+Shift+K and Ctrl+Shift+F', () => {
    expect(GS.pageShortcut({ key: 'k', shift: true }, { wanted })).toEqual(up('k', true));
    expect(GS.pageShortcut({ key: 'f', shift: true }, { wanted })).toEqual(up('f', true));
  });
  it('a letter you bound yourself, with or without Shift', () => {
    expect(GS.pageShortcut({ key: 'e', shift: true }, { wanted })).toEqual(up('e', true));
    expect(GS.pageShortcut({ key: 'e', shift: false }, { wanted })).toEqual(up('e', false));
  });
  it('a letter nobody bound stays nothing', () => {
    expect(GS.pageShortcut({ key: 'q', shift: true }, { wanted })).toBe(null);
    expect(GS.pageShortcut({ key: 'k', shift: true })).toBe(null);
  });
  it('Notes and picture-in-picture, which live outside the rebindable list', () => {
    expect(GS.pageShortcut({ key: 'n', shift: true })).toEqual({ channel: 'toggle-notes' });
    expect(GS.pageShortcut({ key: 'p', shift: true })).toEqual({ channel: 'toggle-pip' });
  });
  it('the page keeps them first: main never takes a Ctrl+Shift letter it is not fixed on', () => {
    for (const k of ['K', 'F', 'E', 'N', 'P']) expect(GS.shortcutFor(press(k, { shift: true }), { wanted }), k).toBe(null);
  });
});

describe('Ctrl+Alt keys outside the registry list', () => {
  it('Ctrl+Alt+1 goes up when the window asked for it', () => {
    const wanted = new Set(['Ctrl+Alt+1']);
    expect(GS.shortcutFor(press('1', { alt: true }), { wanted })).toEqual(up('1', false, true));
  });
});

describe('a key moved away stops doing the old thing in a page', () => {
  it('Ctrl+L: the bar while it is the bar key, another command once given to one, the page’s once free', () => {
    expect(GS.shortcutFor(press('l'))).toEqual({ channel: 'focus-address-bar' });   // before the window said
    expect(GS.shortcutFor(press('l'), { wanted: new Set(['Ctrl+L']) })).toEqual(up('l', false));
    expect(GS.shortcutFor(press('l'), { wanted: new Set(['Ctrl+Alt+U']) })).toBe(null);
  });
  it('Ctrl+Shift+R hard reload', () => {
    expect(GS.shortcutFor(press('R', { shift: true }))).toEqual({ channel: 'hard-reload-tab' });
    expect(GS.shortcutFor(press('R', { shift: true }), { wanted: new Set(['Ctrl+Shift+R']) })).toEqual(up('r', true));
    expect(GS.shortcutFor(press('R', { shift: true }), { wanted: new Set(['F9']) })).toBe(null);
  });
  it('Ctrl+Alt+L lock', () => {
    expect(GS.shortcutFor(press('l', { alt: true }))).toEqual({ channel: 'lock-vex' });
    expect(GS.shortcutFor(press('l', { alt: true }), { wanted: new Set(['Ctrl+Alt+L']) })).toEqual(up('l', false, true));
    expect(GS.shortcutFor(press('l', { alt: true }), { wanted: new Set(['Ctrl+Alt+Q']) })).toBe(null);
  });
  it('main.js no longer answers Ctrl+Shift+R or Ctrl+Alt+L in a page on its own', () => {
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(main).not.toMatch(/handleHardReloadShortcut\(event, input\)\) return;/);
    expect(main).not.toMatch(/input\.control && input\.alt && !input\.shift && \(input\.key \|\| ''\)\.toLowerCase\(\) === 'l'/);
  });
});

// The page-first block of preload-webview.js with a stand-in window and ipc.
function loadPageFirst() {
  const src = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
  const block = src.slice(src.indexOf("// === Vex's keys a page may use first ==="), src.indexOf('// === Escape the page left alone'));
  const sent = [];
  let handler = null;
  const win = { addEventListener: (type, fn) => { if (type === 'keydown') handler = fn; } };
  const req = () => ({ ipcRenderer: { send: (ch, payload) => sent.push(payload) } });
  new Function('require', 'window', 'document', block)(req, win, { designMode: 'off' });
  const target = { nodeType: 1, tagName: 'DIV', isContentEditable: false };
  const pressIn = async (k, { shift = false, prevented = false } = {}) => {
    handler({ isTrusted: true, ctrlKey: true, metaKey: false, altKey: false, repeat: false, shiftKey: shift, key: shift ? k.toUpperCase() : k, target, composedPath: () => [target], defaultPrevented: prevented });
    await new Promise(r => setTimeout(r, 5));
  };
  return { sent, pressIn };
}

describe('the page preload reports any Ctrl letter the page left alone', () => {
  it('Ctrl+Shift+K, Ctrl+Shift+N and a plain Ctrl+E', async () => {
    const { sent, pressIn } = loadPageFirst();
    await pressIn('k', { shift: true }); await pressIn('n', { shift: true }); await pressIn('e');
    expect(sent).toEqual([{ key: 'k', shift: true }, { key: 'n', shift: true }, { key: 'e', shift: false }]);
  });
  it('but not copy, paste, cut, select all, undo, redo, nor one the page took', async () => {
    const { sent, pressIn } = loadPageFirst();
    for (const k of ['c', 'v', 'x', 'a', 'z', 'y']) await pressIn(k);
    await pressIn('k', { shift: true, prevented: true });
    expect(sent).toEqual([]);
  });
});
