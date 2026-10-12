// @vitest-environment jsdom
//
// The find bar (Ctrl+F). Found 2026-10-10:
//  - a tab opened in the background never showed a match count: the count was
//    read only from the page in front when a page was made;
//  - switching tabs left the bar open with the last tab's "2/5";
//  - Shift+Enter went forward instead of back;
//  - its buttons had no names and the count was not announced.
// The find block of app.js runs here against fake tabs and pages.
import { describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');

function findBlock() {
  const start = APP.indexOf('  // === Find in Page ===');
  const end = APP.indexOf('  // === Settings Panel ===');
  if (start < 0 || end < start) throw new Error('find block not found in app.js');
  return APP.slice(start, end);
}

function fakePage() {
  const listeners = {};
  return {
    calls: [],
    stopped: 0,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    findInPage(text, opts) { this.calls.push([text, opts && opts.forward]); },
    stopFindInPage() { this.stopped++; },
    report(ordinal, matches) { (listeners['found-in-page'] || []).forEach(fn => fn({ result: { activeMatchOrdinal: ordinal, matches } })); },
  };
}

function setup() {
  const bar = HTML.match(/<div id="find-bar"[\s\S]*?<\/div>/)[0];
  document.body.innerHTML = bar + '<div id="webviews-container"></div>';
  const pages = new Map([['a', fakePage()], ['b', fakePage()]]);
  const TabManager = { activeTabId: 'a' };
  const WebviewManager = {
    getActiveWebview: () => pages.get(TabManager.activeTabId),
    stopFindInPage: () => WebviewManager.getActiveWebview()?.stopFindInPage(),
  };
  const vex = { onFindInPage: (fn) => { vex.toggle = fn; } };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'TabManager', 'WebviewManager', 'handFindToPage',
    findBlock() + "\n;window.__showFindBar = typeof showFindBar === 'function' ? showFindBar : null;")(
    Object.assign(window, { vex }), document, TabManager, WebviewManager, () => false);
  const switchTo = (id) => {
    TabManager.activeTabId = id;
    window.dispatchEvent(new CustomEvent('vex:tab-activated', { detail: { tabId: id } }));
  };
  const $ = (id) => document.getElementById(id);
  const type = (text) => { $('find-input').value = text; $('find-input').dispatchEvent(new Event('input')); };
  const key = (k, shiftKey = false) => $('find-input').dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey }));
  return { pages, switchTo, $, type, key, open: () => vex.toggle() };
}

describe('find bar', () => {
  it('shows the count on a tab that was opened in the background', () => {
    const { pages, switchTo, $, type, open } = setup();
    switchTo('b');            // never the tab in front when its page was made
    open();
    type('vex');
    pages.get('b').report(1, 5);
    expect($('find-count').textContent).toBe('1/5');
  });

  it('a result from a tab no longer in front is not shown', () => {
    const { pages, switchTo, $, type, open } = setup();
    open(); type('vex');
    switchTo('b');
    pages.get('a').report(2, 5);
    expect($('find-count').textContent).toBe('');
  });

  it('each tab keeps its own bar: hidden where it was not opened, back and searched again where it was', () => {
    const { pages, switchTo, $, type, open } = setup();
    open(); type('vex');
    pages.get('a').report(2, 5);
    expect($('find-count').textContent).toBe('2/5');

    switchTo('b');
    expect($('find-bar').style.display).toBe('none');
    expect($('find-count').textContent).toBe('');

    pages.get('a').calls.length = 0;
    switchTo('a');
    expect($('find-bar').style.display).toBe('flex');
    expect($('find-input').value).toBe('vex');
    expect(pages.get('a').calls).toEqual([['vex', undefined]]);
  });

  it('a bar closed on a tab stays closed when coming back to it', () => {
    const { switchTo, $, type, open, key } = setup();
    open(); type('vex'); key('Escape');
    switchTo('b'); switchTo('a');
    expect($('find-bar').style.display).toBe('none');
  });

  it('Enter goes forward and Shift+Enter goes back', () => {
    const { pages, $, type, open, key } = setup();
    open(); type('vex');
    pages.get('a').calls.length = 0;
    key('Enter');
    key('Enter', true);
    expect(pages.get('a').calls).toEqual([['vex', true], ['vex', false]]);
    $('find-prev').click();
    $('find-next').click();
    expect(pages.get('a').calls.slice(2)).toEqual([['vex', false], ['vex', true]]);
  });

  it('Ctrl+F on an open bar only selects the text, it does not move to the next match', () => {
    const { pages, type, open } = setup();
    open(); type('vex');
    pages.get('a').calls.length = 0;
    window.__showFindBar();
    expect(pages.get('a').calls).toEqual([]);
  });

  it('its buttons have names and the count is announced', () => {
    const { $ } = setup();
    for (const id of ['find-prev', 'find-next', 'find-close']) expect($(id).getAttribute('aria-label')).toBeTruthy();
    expect($('find-input').getAttribute('aria-label')).toBeTruthy();
    expect($('find-count').getAttribute('aria-live')).toBe('polite');
  });
});
