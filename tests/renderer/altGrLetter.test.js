// @vitest-environment jsdom
//
// Windows reports AltGr as Ctrl+Alt. On a Turkish or German keyboard AltGr+Q types '@', AltGr+E the euro sign and AltGr+T the lira
// sign, so the event's key is that character and Ctrl+Alt+Q (tab hints), Ctrl+Alt+E (Everything) and Ctrl+Alt+T (tasks) never fired.
// The letter now comes from the physical key (event.code) when AltGr changed the key, and a Ctrl+Alt shortcut never takes a typed
// character from a text field. The same rule lives in main (guest-shortcuts.js) and the page preload.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const Guest = require('../../src/main/guest-shortcuts.js');
let SR;
const fired = [];

// What each layout puts in event.key for Ctrl+Alt+<physical key> (measured with ToUnicodeEx on the real layouts).
const AG = (key, code, extra = {}) => ({ key, code, ctrlKey: true, altKey: true, ...extra });

beforeAll(() => {
  localStorage.clear();
  globalThis.CommandBar = { commands: [] };
  window.vex = { setGuestShortcutKeys: vi.fn() };
  SR = require('../../src/renderer/js/shortcuts-registry.js');
  SR.init();
  for (const id of ['tab-hints', 'everything', 'tasks', 'link-hints']) SR.register(id, () => fired.push(id));
});
beforeEach(() => { fired.length = 0; });

function press(target, init) {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe('altGrLetter / eventToShortcut', () => {
  it('Turkish Q: AltGr+Q, AltGr+E, AltGr+T are Ctrl+Alt+Q / E / T', () => {
    expect(SR.eventToShortcut(AG('@', 'KeyQ'))).toBe('Ctrl+Alt+Q');
    expect(SR.eventToShortcut(AG('€', 'KeyE'))).toBe('Ctrl+Alt+E');
    expect(SR.eventToShortcut(AG('₺', 'KeyT'))).toBe('Ctrl+Alt+T');
    expect(SR.eventToShortcut(AG('æ', 'KeyA'))).toBe('Ctrl+Alt+A');
    expect(SR.eventToShortcut(AG('ß', 'KeyS'))).toBe('Ctrl+Alt+S');
  });
  it('German: AltGr+Q (@), AltGr+E (euro), AltGr+M (micro)', () => {
    expect(SR.eventToShortcut(AG('@', 'KeyQ'))).toBe('Ctrl+Alt+Q');
    expect(SR.eventToShortcut(AG('€', 'KeyE'))).toBe('Ctrl+Alt+E');
    expect(SR.eventToShortcut(AG('µ', 'KeyM'))).toBe('Ctrl+Alt+M');
  });
  it('French AZERTY: AltGr+E (euro); the key cap letter decides for the rest (physical KeyQ carries an A)', () => {
    expect(SR.eventToShortcut(AG('€', 'KeyE'))).toBe('Ctrl+Alt+E');
    expect(SR.eventToShortcut(AG('a', 'KeyQ'))).toBe('Ctrl+Alt+A');
  });
  it('US and every key that already is a letter are unchanged, with Shift too', () => {
    expect(SR.eventToShortcut(AG('q', 'KeyQ'))).toBe('Ctrl+Alt+Q');
    expect(SR.eventToShortcut(AG('F', 'KeyF', { shiftKey: true }))).toBe('Ctrl+Alt+Shift+F');
  });
  it('a dead key under AltGr still reads as the physical letter', () => {
    expect(SR.eventToShortcut(AG('Dead', 'KeyS'))).toBe('Ctrl+Alt+S');
  });
  it('is only for Ctrl+Alt together and a letter key', () => {
    expect(SR.altGrLetter({ key: '@', code: 'KeyQ', ctrlKey: false, altKey: true })).toBeNull();
    expect(SR.altGrLetter({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: false })).toBeNull();
    expect(SR.altGrLetter({ key: '@', code: 'Digit2', ctrlKey: true, altKey: true })).toBeNull();
    expect(SR.altGrLetter({ key: 'Enter', code: 'KeyQ', ctrlKey: true, altKey: true })).toBeNull();
    expect(SR.altGrLetter({ key: '@', ctrlKey: true, altKey: true })).toBeNull();
    expect(SR.eventToShortcut({ key: '@', ctrlKey: false, altKey: false })).toBe('@');
  });
});

describe('the shortcut fires, and never takes typing', () => {
  it('Turkish AltGr+Q outside a text field runs tab hints; AltGr+E everything; AltGr+T tasks', () => {
    press(document.body, AG('@', 'KeyQ'));
    press(document.body, AG('€', 'KeyE'));
    press(document.body, AG('₺', 'KeyT'));
    expect(fired).toEqual(['tab-hints', 'everything', 'tasks']);
  });
  it('AltGr+Q inside an input, a textarea and a contenteditable stays typing (no shortcut, not cancelled)', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const rich = document.createElement('div');
    Object.defineProperty(rich, 'isContentEditable', { value: true }); // jsdom does not compute it
    document.body.append(input, area, rich);
    for (const el of [input, area, rich]) {
      for (const [k, c] of [['@', 'KeyQ'], ['€', 'KeyE'], ['₺', 'KeyT']]) {
        const ev = press(el, AG(k, c));
        expect(ev.defaultPrevented).toBe(false);
      }
    }
    expect(fired).toEqual([]);
  });
  it('a Ctrl+Alt letter that types nothing still works from a field, as it always did (US Ctrl+Alt+Q)', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const ev = press(input, AG('q', 'KeyQ'));
    expect(fired).toEqual(['tab-hints']);
    expect(ev.defaultPrevented).toBe(true);
  });
  it('German and AZERTY events behave the same way', () => {
    const input = document.createElement('input');
    document.body.append(input);
    press(input, AG('@', 'KeyQ'));         // German AltGr+Q typed in a form
    press(document.body, AG('@', 'KeyQ')); // German AltGr+Q on the page chrome
    press(document.body, AG('€', 'KeyE')); // AZERTY AltGr+E
    expect(fired).toEqual(['tab-hints', 'everything']);
  });
});

describe('main: guest-shortcuts.js', () => {
  const wanted = new Set(['Ctrl+Alt+Q', 'Ctrl+Alt+E', 'Ctrl+Alt+T', 'Ctrl+Alt+Shift+F']);
  const input = (key, code, extra = {}) => ({ type: 'keyDown', key, code, control: true, alt: true, shift: false, meta: false, ...extra });

  it('altGrLetter agrees with the renderer on every case', () => {
    const cases = [['@', 'KeyQ'], ['€', 'KeyE'], ['₺', 'KeyT'], ['q', 'KeyQ'], ['Q', 'KeyQ'], ['Dead', 'KeyS'], ['Enter', 'KeyQ'], ['@', 'Digit2'], ['@', undefined], ['ab', 'KeyQ']];
    for (const [key, code] of cases) {
      expect(Guest.altGrLetter(input(key, code))).toBe(SR.altGrLetter({ key, code, ctrlKey: true, altKey: true }));
    }
    expect(Guest.altGrLetter(input('@', 'KeyQ', { alt: false }))).toBeNull();
  });
  it('AltGr+Q is left to the page (typing an @ in a form must never become a shortcut)', () => {
    expect(Guest.shortcutFor(input('@', 'KeyQ'), { wanted })).toBeNull();
    expect(Guest.shortcutFor(input('€', 'KeyE'), { wanted })).toBeNull();
  });
  it('a Ctrl+Alt letter that types nothing is still taken before the page', () => {
    expect(Guest.shortcutFor(input('q', 'KeyQ'), { wanted })).toEqual({ channel: 'guest-shortcut', args: [{ key: 'q', ctrl: true, shift: false, alt: true }] });
  });
  it('the page preload reports AltGr+Q when no field has the focus, and main passes it up only when the registry wants it', () => {
    expect(Guest.pageShortcut({ key: 'q', shift: false, alt: true }, { wanted })).toEqual({ channel: 'guest-shortcut', args: [{ key: 'q', ctrl: true, shift: false, alt: true }] });
    expect(Guest.pageShortcut({ key: 'f', shift: true, alt: true }, { wanted })).toEqual({ channel: 'guest-shortcut', args: [{ key: 'f', ctrl: true, shift: true, alt: true }] });
    expect(Guest.pageShortcut({ key: 'z', shift: false, alt: true }, { wanted })).toBeNull();
    expect(Guest.pageShortcut({ key: 'q', shift: false, alt: true }, { wanted: null })).toBeNull();
    expect(Guest.pageShortcut({ key: '@', shift: false, alt: true }, { wanted })).toBeNull();
  });
});

describe('the page preload (run with stand-ins)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
  const block = src.slice(src.indexOf("// === Vex's keys a page may use first ==="), src.indexOf('// === Escape the page left alone'));
  function load() {
    const sent = [];
    const handlers = [];
    const win = { addEventListener: (type, fn) => { if (type === 'keydown') handlers.push(fn); } };
    const req = () => ({ ipcRenderer: { send: (ch, payload) => sent.push([ch, payload]) } });
    new Function('require', 'window', 'document', block)(req, win, { designMode: 'off' });
    const el = (tagName, extra = {}) => ({ nodeType: 1, tagName, isContentEditable: false, ...extra });
    const press = async (key, code, target, extra = {}) => {
      const e = { isTrusted: true, ctrlKey: true, altKey: true, metaKey: false, repeat: false, shiftKey: false, key, code, target, composedPath: () => [target], defaultPrevented: false, ...extra };
      for (const h of handlers) h(e);
      await new Promise(r => setTimeout(r, 5));
    };
    return { sent, press, el };
  }
  it('reports Turkish AltGr+Q from a plain page, with the physical letter', async () => {
    const { sent, press, el } = load();
    await press('@', 'KeyQ', el('DIV'));
    await press('€', 'KeyE', el('BODY'));
    expect(sent).toEqual([['guest:page-shortcut', { key: 'q', shift: false, alt: true }], ['guest:page-shortcut', { key: 'e', shift: false, alt: true }]]);
  });
  it('says nothing from an input, textarea, select, contenteditable or designMode (that @ is being typed)', async () => {
    const { sent, press, el } = load();
    for (const t of [el('INPUT'), el('TEXTAREA'), el('SELECT'), el('DIV', { isContentEditable: true })]) await press('@', 'KeyQ', t);
    expect(sent).toEqual([]);
  });
  it('says nothing for a letter key (main took it), a page-handled key, a repeat or a script-made event', async () => {
    const { sent, press, el } = load();
    await press('q', 'KeyQ', el('DIV'));
    await press('@', 'KeyQ', el('DIV'), { defaultPrevented: true });
    await press('@', 'KeyQ', el('DIV'), { repeat: true });
    await press('@', 'KeyQ', el('DIV'), { isTrusted: false });
    await press('@', 'KeyQ', el('DIV'), { altKey: false });
    expect(sent).toEqual([]);
  });
});
