// @vitest-environment jsdom
//
// "There are too many options on right click" (2026-09-27): twenty-odd rows in
// one column. Now the menu is Back / Forward / Reload as one row of buttons,
// the few rows for what was clicked, and submenus: More for this picture /
// link / text, Page, and This site.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { WebviewManager } = require('../../src/renderer/js/webview.js');

function fakeWebview(over = {}) {
  const wv = document.createElement('webview');
  Object.assign(wv, {
    canGoBack: () => false,
    canGoForward: () => false,
    getURL: () => 'https://example.com/page',
    getTitle: () => 'Example',
    getWebContentsId: () => 7,
    goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn(),
    copy: vi.fn(),
    downloadURL: vi.fn(),
  }, over);
  return wv;
}

const open = (params, wv = fakeWebview()) => { WebviewManager.showContextMenu({ params }, wv); return document.querySelector('.tab-context-menu'); };
// The rows of the menu itself, not of an open submenu.
const top = (menu) => [...menu.children].filter(c => c.classList.contains('tab-context-item')).map(c => c.textContent);
const openSub = (menu, label) => {
  const row = [...menu.children].find(c => c.textContent === label);
  if (!row) throw new Error('no row "' + label + '" — has: ' + top(menu).join(', '));
  row.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  // The submenu is drawn in the page beside the menu, not inside it: the
  // menu scrolls, and a submenu inside it was clipped away (2026-09-29).
  return document.querySelector('.ctx-submenu');
};
const rows = (el) => [...el.querySelectorAll('.tab-context-item')].map(c => c.textContent);

beforeEach(() => {
  document.body.innerHTML = '';
  delete globalThis.TabManager;
  delete globalThis.AIPanel;
});

describe('the page menu, grouped', () => {
  it('a plain page: a button row, two submenus and Inspect', () => {
    const menu = open({});
    expect(menu.querySelector('.ctx-button-row')).not.toBeNull();
    expect(top(menu)).toEqual(['Page', 'This site', 'Inspect Element']);
  });

  it('Back is off with no history, and Reload reloads', () => {
    const wv = fakeWebview();
    const menu = open({}, wv);
    expect(menu.querySelector('[aria-label="Back"]').disabled).toBe(true);
    menu.querySelector('[aria-label="Reload"]').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(wv.reload).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('Page holds what used to be seven rows', () => {
    const sub = openSub(open({}), 'Page');
    expect(rows(sub)).toEqual(expect.arrayContaining(['Copy Page URL', 'Copy as Markdown link', 'Open in New Tab', 'Open as App', 'Send to Phone']));
  });

  it('in a panel, Page has no Duplicate Tab or Auto-refresh', () => {
    const sub = openSub(open({}), 'Page');
    expect(rows(sub).some(l => /Duplicate Tab|Auto-refresh/.test(l))).toBe(false);
  });

  it('in a tab, Page has them', () => {
    const wv = fakeWebview();
    wv.dataset.tabId = '5';
    const sub = openSub(open({}, wv), 'Page');
    expect(rows(sub)).toEqual(expect.arrayContaining(['Duplicate Tab', 'Auto-refresh…']));
  });

  it('This site holds dark mode, zap and reset', () => {
    const sub = openSub(open({}), 'This site');
    expect(rows(sub).length).toBe(3);
  });

  it('a link: two rows, the rest under More', () => {
    const menu = open({ linkURL: 'https://site.example/a' });
    expect(top(menu)).toEqual(expect.arrayContaining(['Open Link in New Tab', 'Copy Link', 'More for this link']));
    expect(top(menu)).not.toContain('Where Does This Link Go?');
    expect(rows(openSub(menu, 'More for this link'))).toContain('Where Does This Link Go?');
  });

  it('a picture inside a link: the picture comes first', () => {
    const menu = open({ linkURL: 'https://site.example/a', mediaType: 'image', srcURL: 'https://img.example/p.png' });
    const t = top(menu);
    expect(t.indexOf('Save Image')).toBeGreaterThanOrEqual(0);
    expect(t.indexOf('Save Image')).toBeLessThan(t.indexOf('Open Link in New Tab'));
    expect(t).toEqual(expect.arrayContaining(['Save Image', 'Save Image As…', 'Copy Image', 'More for this image']));
    expect(rows(openSub(menu, 'More for this image'))).toEqual(expect.arrayContaining(['Open Image in New Tab', 'Copy Image Address', 'Search Image with Lens']));
  });

  it('selected text: Copy and Search stay, the rest under More', () => {
    const menu = open({ selectionText: 'moon knight' });
    expect(top(menu)).toEqual(expect.arrayContaining(['Copy', 'More for this text']));
    expect(top(menu).some(l => /^Search "/.test(l))).toBe(true);
    expect(rows(openSub(menu, 'More for this text'))).toContain('Read aloud');
  });

  it('a row in a submenu does its thing and closes the whole menu', () => {
    const wv = fakeWebview();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn() } });
    const sub = openSub(open({}, wv), 'Page');
    const copy = [...sub.querySelectorAll('.tab-context-item')].find(c => c.textContent === 'Copy Page URL');
    copy.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/page');
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('one submenu at a time', () => {
    const menu = open({});
    openSub(menu, 'Page');
    openSub(menu, 'This site');
    expect(document.querySelectorAll('.ctx-submenu').length).toBe(1);
  });

  it('no submenu is empty, and none follows a separator into nothing', () => {
    const menu = open({ linkURL: 'https://site.example/a' });
    const kids = [...menu.children];
    kids.forEach((c, i) => {
      if (c.classList.contains('tab-context-sep')) expect(kids[i + 1] && kids[i + 1].classList.contains('tab-context-sep')).toBe(false);
    });
  });
});
