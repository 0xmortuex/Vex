// The keys Vex answers while a PAGE has the focus. Before this, Vex's own
// shortcuts were handled only on the window's webContents — which stops
// hearing anything the moment you click into a page, so half of them seemed
// to need "a click somewhere else first". The risk in fixing it is the
// opposite: stealing keys that belong to the page.
import { describe, it, expect } from 'vitest';
const { shortcutFor, pageShortcut, PAGE_FIRST } = require('../../src/main/guest-shortcuts.js');
const fs = require('fs');
const path = require('path');

const key = (k, { shift = false, alt = false, control = true, type = 'keyDown' } = {}) =>
  ({ key: k, shift, alt, control, type });

describe('Vex\u2019s own keys, from inside a page', () => {
  it('the tab and window ones', () => {
    expect(shortcutFor(key('t'))).toEqual({ channel: 'new-tab' });
    expect(shortcutFor(key('w'))).toEqual({ channel: 'close-tab' });
    expect(shortcutFor(key('l'))).toEqual({ channel: 'focus-address-bar' });
    expect(shortcutFor(key('Tab'))).toEqual({ channel: 'next-tab' });
    expect(shortcutFor(key('Tab', { shift: true }))).toEqual({ channel: 'prev-tab' });
    expect(shortcutFor(key('4'))).toEqual({ channel: 'jump-to-tab', args: [4] });
  });

  it('the ones that used to need a click first', () => {
    expect(shortcutFor(key('T', { shift: true }))).toEqual({ channel: 'reopen-last-closed' });
  });
});

// Ctrl+B is bold in an editor and Ctrl+Shift+Z is redo; taking them before
// the page made bold hide the tab sidebar and redo put the tab to sleep
// (2026-09-29). The page hears them first; only a key it left alone is
// reported, and main decides what it does.
describe('keys a page may use first', () => {
  it('main does not take them before the page', () => {
    for (const k of ['b', 'h', 'm', 'd', 'p', 'u']) expect(shortcutFor(key(k)), k).toBe(null);
    for (const k of ['O', 'S', 'Z', 'A', 'M', 'L', 'H']) expect(shortcutFor(key(k, { shift: true })), k).toBe(null);
  });

  it('a key the page left alone does what it always did', () => {
    expect(pageShortcut({ key: 'b', shift: false })).toEqual({ channel: 'toggle-tabs-sidebar' });
    expect(pageShortcut({ key: 'h', shift: false })).toEqual({ channel: 'toggle-history' });
    expect(pageShortcut({ key: 'm', shift: false })).toEqual({ channel: 'toggle-mute-tab' });
    expect(pageShortcut({ key: 'd', shift: false })).toEqual({ channel: 'bookmark-current' });
    // Print and View Page Source had no key at all (2026-09-29).
    expect(pageShortcut({ key: 'p', shift: false })).toEqual({ channel: 'print-page' });
    expect(pageShortcut({ key: 'u', shift: false })).toEqual({ channel: 'view-source' });
    expect(pageShortcut({ key: 'o', shift: true })).toEqual({ channel: 'toggle-sessions' });
    expect(pageShortcut({ key: 's', shift: true })).toEqual({ channel: 'toggle-split' });
    expect(pageShortcut({ key: 'a', shift: true })).toEqual({ channel: 'toggle-ai-panel' });
    expect(pageShortcut({ key: 'm', shift: true })).toEqual({ channel: 'toggle-memory' });
    expect(pageShortcut({ key: 'l', shift: true })).toEqual({ channel: 'toggle-schedules' });
    expect(pageShortcut({ key: 'z', shift: true })).toEqual({ channel: 'sleep-current-tab' });
  });

  it('the page cannot name an action of its own', () => {
    for (const bad of [null, {}, { key: 't' }, { key: 'toString' }, { key: 'bb' }, { key: 'constructor', shift: true }, { key: 7 }]) {
      expect(pageShortcut(bad), JSON.stringify(bad)).toBe(null);
    }
  });

  it('the page preload watches exactly these keys', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8');
    expect(src.match(/PAGE_FIRST_PLAIN = '(\w+)'/)[1].split('').sort()).toEqual(Object.keys(PAGE_FIRST.plain).sort());
    expect(src.match(/PAGE_FIRST_SHIFTED = '(\w+)'/)[1].split('').sort()).toEqual(Object.keys(PAGE_FIRST.shifted).sort());
  });

  it('a key the user may have rebound travels as the key itself', () => {
    expect(shortcutFor(key('Y', { shift: true }))).toEqual({
      channel: 'guest-shortcut', args: [{ key: 'Y', ctrl: true, shift: true, alt: false }],
    });
    expect(shortcutFor(key('j'))).toEqual({
      channel: 'guest-shortcut', args: [{ key: 'j', ctrl: true, shift: false, alt: false }],
    });
  });
});

describe('what stays the page\u2019s', () => {
  it('the keys a page needs', () => {
    for (const k of ['s', 'p', 'a', 'c', 'v', 'x', 'z', 'y', 'e', 'u']) {
      expect(shortcutFor(key(k)), k).toBe(null);
    }
  });

  it('developer tools and the combos handled elsewhere', () => {
    for (const k of ['I', 'J', 'C', 'P', 'R', 'N']) {
      expect(shortcutFor(key(k, { shift: true })), k).toBe(null);
    }
  });

  it('a key with no Ctrl, or with Alt, is not ours here', () => {
    expect(shortcutFor(key('t', { control: false }))).toBe(null);
    expect(shortcutFor(key('r', { alt: true }))).toBe(null);
  });

  it('a key going up is not a key press', () => {
    expect(shortcutFor(key('t', { type: 'keyUp' }))).toBe(null);
    expect(shortcutFor(null)).toBe(null);
  });

  it('Ctrl+F opens Vex’s find bar, unless the site has its own', () => {
    expect(shortcutFor(key('f'))).toEqual({ channel: 'find-in-page' });
    expect(shortcutFor(key('f'), {})).toEqual({ channel: 'find-in-page' });
    // A code host or a spreadsheet searches what it has not drawn yet; Vex's
    // find bar cannot, so that key stays the page's.
    expect(shortcutFor(key('f'), { ownsFind: true })).toBe(null);
  });
});
