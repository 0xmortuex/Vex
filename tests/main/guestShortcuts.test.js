// The keys Vex answers while a PAGE has the focus. Before this, Vex's own
// shortcuts were handled only on the window's webContents — which stops
// hearing anything the moment you click into a page, so half of them seemed
// to need "a click somewhere else first". The risk in fixing it is the
// opposite: stealing keys that belong to the page.
import { describe, it, expect } from 'vitest';
const { shortcutFor } = require('../../src/main/guest-shortcuts.js');

const key = (k, { shift = false, alt = false, control = true, type = 'keyDown' } = {}) =>
  ({ key: k, shift, alt, control, type });

describe('Vex\u2019s own keys, from inside a page', () => {
  it('the tab and window ones', () => {
    expect(shortcutFor(key('t'))).toEqual({ channel: 'new-tab' });
    expect(shortcutFor(key('w'))).toEqual({ channel: 'close-tab' });
    expect(shortcutFor(key('l'))).toEqual({ channel: 'focus-address-bar' });
    expect(shortcutFor(key('d'))).toEqual({ channel: 'bookmark-current' });
    expect(shortcutFor(key('Tab'))).toEqual({ channel: 'next-tab' });
    expect(shortcutFor(key('Tab', { shift: true }))).toEqual({ channel: 'prev-tab' });
    expect(shortcutFor(key('4'))).toEqual({ channel: 'jump-to-tab', args: [4] });
  });

  it('the ones that used to need a click first', () => {
    expect(shortcutFor(key('b'))).toEqual({ channel: 'toggle-tabs-sidebar' });
    expect(shortcutFor(key('h'))).toEqual({ channel: 'toggle-history' });
    expect(shortcutFor(key('m'))).toEqual({ channel: 'toggle-mute-tab' });
    expect(shortcutFor(key('T', { shift: true }))).toEqual({ channel: 'reopen-last-closed' });
    expect(shortcutFor(key('O', { shift: true }))).toEqual({ channel: 'toggle-sessions' });
    expect(shortcutFor(key('S', { shift: true }))).toEqual({ channel: 'toggle-split' });
    expect(shortcutFor(key('A', { shift: true }))).toEqual({ channel: 'toggle-ai-panel' });
    expect(shortcutFor(key('M', { shift: true }))).toEqual({ channel: 'toggle-memory' });
    expect(shortcutFor(key('L', { shift: true }))).toEqual({ channel: 'toggle-schedules' });
    expect(shortcutFor(key('Z', { shift: true }))).toEqual({ channel: 'sleep-current-tab' });
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
