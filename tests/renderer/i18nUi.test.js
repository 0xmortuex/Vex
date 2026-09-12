// @vitest-environment jsdom
//
// Translating the interface.
//
// The wizard has always offered Turkish, but only the wizard and the start
// page ever spoke it — every other label in Vex stayed English. This adds the
// chrome.
//
// The risky part is the approach: matching the ENGLISH string rather than
// tagging a thousand elements. That is what makes it possible at all across
// dozens of files, and it is also how you accidentally "translate" a person's
// bookmark called "History". So most of this file is about what it must NOT
// touch.

import { describe, it, expect, beforeEach } from 'vitest';

const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');

const tr = () => localStorage.setItem('vex.lang', JSON.stringify('tr'));
const en = () => localStorage.setItem('vex.lang', JSON.stringify('en'));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('choosing a language', () => {
  it('is English until you say otherwise', () => {
    expect(VexI18nUI.locale()).toBe('en');
  });

  it('reads the language the wizard stored, quoted or not', () => {
    tr();
    expect(VexI18nUI.locale()).toBe('tr');
    localStorage.setItem('vex.lang', 'tr');          // older, unquoted form
    expect(VexI18nUI.locale()).toBe('tr');
  });

  it('falls back to English for a language it has no table for', () => {
    localStorage.setItem('vex.lang', JSON.stringify('de'));
    expect(VexI18nUI.locale()).toBe('en');
  });
});

describe('what it translates', () => {
  beforeEach(tr);

  it('translates a toolbar button\'s tooltip and leaves the markup alone', () => {
    document.body.innerHTML = '<div id="top-bar"><button id="b" title="Back"><svg></svg></button></div>';
    VexI18nUI.apply();
    const b = document.getElementById('b');
    expect(b.getAttribute('title')).toBe('Geri');
    expect(b.querySelector('svg')).toBeTruthy();      // untouched
  });

  it('translates a text-only label', () => {
    document.body.innerHTML = '<div id="icon-sidebar"><span>Settings</span></div>';
    VexI18nUI.apply();
    expect(document.querySelector('#icon-sidebar span').textContent).toBe('Ayarlar');
  });

  it('leaves an element that has children to its children', () => {
    document.body.innerHTML = '<div id="top-bar"><div id="wrap">Settings<b>!</b></div></div>';
    VexI18nUI.apply();
    expect(document.getElementById('wrap').innerHTML).toContain('<b>!</b>');
  });

  it('translates placeholders and aria-labels', () => {
    document.body.innerHTML = '<div id="top-bar"><input placeholder="Search or enter address" aria-label="Search"></div>';
    VexI18nUI.apply();
    const i = document.querySelector('input');
    expect(i.getAttribute('placeholder')).toBe('Arayın veya adres girin');
    expect(i.getAttribute('aria-label')).toBe('Ara');
  });

  it('leaves anything not in the table exactly as it was', () => {
    document.body.innerHTML = '<div id="top-bar"><span>Quantum flux capacitor</span></div>';
    VexI18nUI.apply();
    expect(document.querySelector('span').textContent).toBe('Quantum flux capacitor');
  });
});

describe('what it must never touch', () => {
  beforeEach(tr);

  it('does not reach into a page', () => {
    document.body.innerHTML = '<div id="top-bar"><webview><span>Settings</span></webview></div>';
    VexI18nUI.apply();
    expect(document.querySelector('webview span').textContent).toBe('Settings');
  });

  it('leaves everything outside the chrome alone', () => {
    // A tab title, a bookmark, a heading on a page — all of which can read
    // "History" without meaning Vex's History panel.
    document.body.innerHTML = '<div id="page-content"><span>History</span></div>';
    VexI18nUI.apply();
    expect(document.querySelector('#page-content span').textContent).toBe('History');
  });

  it('does not translate the same element twice', () => {
    document.body.innerHTML = '<div id="top-bar"><span>Settings</span></div>';
    VexI18nUI.apply();
    VexI18nUI.apply();
    VexI18nUI.apply();
    expect(document.querySelector('span').textContent).toBe('Ayarlar');
    expect(document.querySelector('span').dataset.i18nText).toBe('Settings');
  });
});

describe('switching back', () => {
  it('restores the exact English it started from', () => {
    tr();
    document.body.innerHTML = '<div id="top-bar"><button title="Back">Settings</button></div>';
    VexI18nUI.apply();
    expect(document.querySelector('button').textContent).toBe('Ayarlar');

    en();
    VexI18nUI.apply();
    const b = document.querySelector('button');
    expect(b.textContent).toBe('Settings');
    expect(b.getAttribute('title')).toBe('Back');
  });

  it('English does no work at all', () => {
    en();
    document.body.innerHTML = '<div id="top-bar"><span>Settings</span></div>';
    expect(VexI18nUI.apply()).toBe(0);
    expect(document.querySelector('span').textContent).toBe('Settings');
  });
});

describe('the table itself', () => {
  it('covers the words you see every day', () => {
    for (const word of ['Settings', 'History', 'Downloads', 'Bookmarks', 'Back', 'Forward',
      'Save', 'Cancel', 'Delete', 'Close', 'New Tab', 'Search']) {
      expect(VexI18nUI.lookup(word, 'tr'), word).toBeTruthy();
    }
  });

  it('never maps a string to itself, or to nothing', () => {
    for (const [english, turkish] of Object.entries(VexI18nUI.TABLE.tr)) {
      expect(turkish, english).toBeTruthy();
      expect(turkish, english + ' is untranslated').not.toBe(english);
    }
  });

  it('ignores surrounding whitespace, which markup is full of', () => {
    expect(VexI18nUI.lookup('  Settings\n  ', 'tr')).toBe('Ayarlar');
  });

  it('returns nothing for an empty string rather than a stray match', () => {
    expect(VexI18nUI.lookup('', 'tr')).toBeNull();
    expect(VexI18nUI.lookup(null, 'tr')).toBeNull();
  });
});

describe('labels that carry their shortcut', () => {
  // "Back (Alt+Left)" is the shape of nearly every toolbar tooltip. Matching
  // only the exact string left the whole toolbar English.
  it('translates the label and keeps the shortcut', () => {
    expect(VexI18nUI.lookup('Back (Alt+Left)', 'tr')).toBe('Geri (Alt+Left)');
    expect(VexI18nUI.lookup('Picture-in-Picture (Ctrl+Shift+P)', 'tr'))
      .toBe('Pencere içinde pencere (Ctrl+Shift+P)');
  });

  it('does not invent a translation for a label it does not know', () => {
    expect(VexI18nUI.lookup('Frobnicate (Ctrl+Q)', 'tr')).toBeNull();
  });

  it('is not fooled by brackets in the middle', () => {
    expect(VexI18nUI.lookup('Back (Alt+Left) and more', 'tr')).toBeNull();
  });

  it('applies it to a real tooltip', () => {
    localStorage.setItem('vex.lang', JSON.stringify('tr'));
    document.body.innerHTML = '<div id="top-bar"><button title="Back (Alt+Left)"></button></div>';
    VexI18nUI.apply();
    expect(document.querySelector('button').getAttribute('title')).toBe('Geri (Alt+Left)');
  });
});
