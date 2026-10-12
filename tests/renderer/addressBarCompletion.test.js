// @vitest-environment jsdom
//
// The address bar completes a visited site inline, like Chrome and Firefox:
// "gith" shows "github.com" with "ub.com" selected, and Enter goes there
// instead of searching for "gith". Backspace/Delete take the completion away,
// it never completes a search or in the middle of the text, suggestions rank
// by how often and how recently a page was visited, and Shift+Delete removes
// a highlighted history suggestion from history.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
const { SmartSearchbar, rankSuggestions, _inlineCompletion } = require('../../src/renderer/js/smart-searchbar.js');

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

let input, submitted;
function type(value, inputType = 'insertText') {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { inputType }));
  vi.advanceTimersByTime(200);
}
const key = (k, extra = {}) => SmartSearchbar.handleKeydown(new KeyboardEvent('keydown', { key: k, ...extra }));

// One address bar for the file, as in the app: the searchbar keeps its
// dropdown element from the first init.
beforeAll(() => {
  document.body.innerHTML = '<div id="url-bar-wrapper"><input id="url-input"></div>';
  input = document.getElementById('url-input');
  SmartSearchbar.init(input, { onSubmit: (u) => submitted.push(u) });
});
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  globalThis.isStartPage = () => false;
  globalThis.TabManager = { tabs: [] };
  submitted = [];
  SmartSearchbar.close();
  input.value = '';
});
afterEach(() => { vi.useRealTimers(); delete globalThis.HistoryPanel; });

describe('inline completion', () => {
  beforeEach(() => {
    localStorage.setItem('vex.history', JSON.stringify([
      { url: 'https://github.com/0xmortuex/Vex', title: 'Vex', visitedAt: ago(0) },
    ]));
  });

  it('completes "gith" to github.com with the rest selected, and Enter goes there instead of searching', () => {
    type('gith');
    expect(input.value).toBe('github.com');
    expect([input.selectionStart, input.selectionEnd]).toEqual([4, 10]);
    expect(key('Enter')).toBe(true);
    expect(submitted).toEqual(['https://github.com/']);
  });

  it('Enter pressed before the suggestions caught up still goes to the site', () => {
    input.value = 'gith';
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    expect(key('Enter')).toBe(true);
    expect(submitted).toEqual(['https://github.com/']);
  });

  it('Backspace or Delete over the completion leaves just what was typed, and Enter then searches it', () => {
    type('gith');
    type('gith', 'deleteContentBackward');
    expect(input.value).toBe('gith');
    expect(key('Enter')).toBe(false); // app.js submits "gith" as typed
    type('gith', 'deleteContentForward');
    expect(input.value).toBe('gith');
  });

  it('Esc takes the completion away first', () => {
    type('gith');
    expect(key('Escape')).toBe(true);
    expect(input.value).toBe('gith');
  });

  it('never completes a search, text being edited in the middle, or a site not visited', () => {
    type('gith hub');
    expect(input.value).toBe('gith hub');
    input.value = 'gith';
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    vi.advanceTimersByTime(200);
    expect(input.value).toBe('gith');
    type('hub'); // inside the word, not its start
    expect(input.value).toBe('hub');
    type('zzz');
    expect(input.value).toBe('zzz');
  });

  it('completes the whole address once a "/" is typed, keeping what was typed as typed', () => {
    expect(_inlineCompletion('GitHub.com/0x', [{ url: 'https://github.com/0xmortuex/Vex', kind: 'history' }]))
      .toEqual({ text: 'GitHub.com/0xmortuex/Vex', url: 'https://github.com/0xmortuex/Vex' });
    expect(_inlineCompletion('www.gi', [{ url: 'https://www.github.com/', kind: 'history' }]))
      .toEqual({ text: 'www.github.com', url: 'https://www.github.com/' });
    expect(_inlineCompletion('git', [{ query: 'github', kind: 'web' }])).toBeNull();
    expect(_inlineCompletion('fi', [{ url: 'file:///C:/files/x.html', kind: 'tab' }])).toBeNull();
  });
});

describe('ranking by frecency', () => {
  it('puts a site visited on many days above one visited once more recently', () => {
    const now = Date.now();
    const items = [
      { url: 'https://example.net/new', title: 'Example new', kind: 'history', time: now - 1000 },
      ...[1, 2, 3, 5, 8].map(d => ({ url: 'https://example.com/', title: 'Example', kind: 'history', time: now - d * DAY })),
    ];
    expect(rankSuggestions('exam', items, 8, now).map(i => i.url)).toEqual(['https://example.com/', 'https://example.net/new']);
  });

  it('puts a recent visit above an old one when each was visited once', () => {
    const now = Date.now();
    const items = [
      { url: 'https://old.example/', title: 'Example old', kind: 'history', time: now - 200 * DAY },
      { url: 'https://new.example/', title: 'Example new', kind: 'history', time: now - DAY },
    ];
    expect(rankSuggestions('example', items, 8, now)[0].url).toBe('https://new.example/');
  });
});

describe('Shift+Delete on a history suggestion', () => {
  it('removes that page from history through History\'s delete, and the rest stay', async () => {
    localStorage.setItem('vex.history', JSON.stringify([
      { id: 'a', url: 'https://github.com/x', title: 'X repo', visitedAt: ago(0) },
      { id: 'b', url: 'https://github.com/x', title: 'X repo', visitedAt: ago(3) },
      { id: 'c', url: 'https://github.com/y', title: 'Y repo', visitedAt: ago(1) },
    ]));
    const forgot = [];
    window.vex = { recallForget: async (q) => { forgot.push(q); return { ok: true }; } };
    window.escapeHtml = (s) => String(s == null ? '' : s);
    const { HistoryPanel } = require('../../src/renderer/js/history-panel.js');
    HistoryPanel._hydrated = false;
    globalThis.HistoryPanel = HistoryPanel;

    type('github.com/');
    key('ArrowDown');
    expect(document.querySelector('.sb-suggestion.selected').textContent).toContain('X repo');
    expect(key('Delete', { shiftKey: true })).toBe(true);
    await vi.runAllTimersAsync();

    expect(JSON.parse(localStorage.getItem('vex.history')).map(e => e.id)).toEqual(['c']);
    expect(forgot).toEqual([{ url: 'https://github.com/x' }]);
    expect(document.querySelector('#searchbar-suggestions').textContent).not.toContain('X repo');
  });

  it('does nothing special on a row that is not history', () => {
    globalThis.TabManager = { tabs: [{ id: 't', url: 'https://github.com/', title: 'GitHub' }] };
    type('github');
    key('ArrowDown');
    expect(key('Delete', { shiftKey: true })).toBe(false);
  });
});
