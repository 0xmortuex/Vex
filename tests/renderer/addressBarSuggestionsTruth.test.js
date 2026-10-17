// @vitest-environment jsdom
//
// Address bar suggestions (found 2026-10-10):
//   * a history row showed the previous page's title, or a stale one for up
//     to 30 s: suggestions read the saved copy, which History writes titles
//     to only every 30 s, and a visit was recorded with the tab's old title;
//   * /Docs/API and /docs/api, two pages, were folded into one row;
//   * the tab you are typing in was offered as "Switch to tab";
//   * Ctrl+Enter opened a new tab instead of completing "example" to
//     www.example.com, as in every browser (Alt+Enter is the new tab).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
require('../../src/renderer/js/vex-utils.js');
const { SmartSearchbar, rankSuggestions } = require('../../src/renderer/js/smart-searchbar.js');

let input;
const rows = () => [...document.querySelectorAll('.sb-suggestion')].map(r => r.querySelector('.sb-title').textContent + ' | ' + r.querySelector('.sb-kind').textContent);
function type(value) {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
  vi.advanceTimersByTime(200);
}

beforeAll(() => {
  window.escapeHtml = (s) => String(s);
  document.body.innerHTML = '<div id="url-bar-wrapper"><input id="url-input"></div>';
  input = document.getElementById('url-input');
  SmartSearchbar.init(input, {});
});
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  globalThis.isStartPage = () => false;
  globalThis.TabManager = { tabs: [], activeTabId: null };
  SmartSearchbar.close();
  input.value = '';
});
afterEach(() => { vi.useRealTimers(); delete globalThis.HistoryPanel; });

describe('history titles', () => {
  it('come from History itself, not its saved copy', () => {
    localStorage.setItem('vex.history', JSON.stringify([{ url: 'https://alpha.example/', title: 'Old title', visitedAt: new Date().toISOString() }]));
    globalThis.HistoryPanel = { list: () => [{ url: 'https://alpha.example/', title: 'Alpha, renamed', visitedAt: new Date().toISOString() }] };
    type('alph');
    expect(rows()[0]).toBe('Alpha, renamed | History');
  });

  it('a visit is not recorded under the page it came from', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/webview.js'), 'utf8');
    expect(src).not.toMatch(/this\.historyVisit\(url, t\?\.title\)/);
  });
});

describe('suggestion rows', () => {
  it('two pages differing only by path case stay two rows', () => {
    const items = [
      { url: 'https://example.com/Docs/API', title: 'API', kind: 'history', time: Date.now() },
      { url: 'https://example.com/docs/api', title: 'api lower', kind: 'history', time: Date.now() },
    ];
    expect(rankSuggestions('example', items).length).toBe(2);
    // The host is still one site whatever its case.
    expect(rankSuggestions('example', [{ url: 'https://EXAMPLE.com/a', title: 'x', kind: 'history' }, { url: 'https://example.com/a', title: 'y', kind: 'history' }]).length).toBe(1);
  });

  // The two rows were kept apart but both read "example.com/docs": the
  // address under each title was lowercased whole (found 2026-10-11).
  it('each row shows its own address as written, path case kept', () => {
    globalThis.HistoryPanel = { list: () => [
      { url: 'https://Example.com/Docs/API', title: 'Upper', visitedAt: new Date().toISOString() },
      { url: 'https://example.com/docs/api', title: 'Lower', visitedAt: new Date().toISOString() },
    ] };
    type('docs');
    const urls = [...document.querySelectorAll('.sb-suggestion .sb-url')].map(e => e.textContent).sort();
    expect(urls).toEqual(['example.com/Docs/API', 'example.com/docs/api']);
  });

  it('the tab you are in is not offered as Switch to tab', () => {
    globalThis.TabManager = { tabs: [{ id: 't1', url: 'https://gamma.example/', title: 'Gamma here' }, { id: 't2', url: 'https://gamma.example/two', title: 'Gamma two' }], activeTabId: 't1' };
    type('gamma');
    expect(rows()).toEqual(['Gamma two | Switch to tab']);
  });
});

describe('Ctrl+Enter', () => {
  it('leaves what was typed for the bar to complete with www. and .com, without the inline completion', () => {
    localStorage.setItem('vex.history', JSON.stringify([{ url: 'https://exampleshop.test/', title: 'Shop', visitedAt: new Date().toISOString() }]));
    type('example');
    expect(input.value).toBe('exampleshop.test');
    const e = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true });
    expect(SmartSearchbar.handleKeydown(e)).toBe(false);
    expect(input.value).toBe('example');
  });

  it('app.js completes a single word with Ctrl+Enter and opens Alt+Enter in a new tab', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/js/app.js'), 'utf8');
    expect(src).toMatch(/submitUrlBar\(completeWithCtrlEnter\(urlInput\.value, e\), e\.altKey(?:, [^)]*)?\)/);
    const fn = new Function(src.match(/function completeWithCtrlEnter[\s\S]*?\n {2}\}/)[0] + '; return completeWithCtrlEnter;')();
    expect(fn('example', { ctrlKey: true, altKey: false })).toBe('www.example.com');
    expect(fn('example', { ctrlKey: false })).toBe('example');
    expect(fn('two words', { ctrlKey: true })).toBe('two words');
    expect(fn('example.org', { ctrlKey: true })).toBe('example.org');
  });
});
