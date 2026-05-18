// @vitest-environment jsdom
//
// Bug 1 — spellcheck suggestions in the webview right-click menu.
//
// WebviewManager.showContextMenu builds Vex's custom context menu. Before
// this fix it never read e.params.misspelledWord / e.params.dictionarySuggestions,
// so right-clicking a misspelled word showed the menu with no suggestions.
//
// These tests drive showContextMenu with faked context-menu params and
// inspect the resulting .tab-context-menu DOM.

import { describe, it, expect, vi, beforeEach } from 'vitest';

async function loadWebviewManager() {
  vi.resetModules();
  const mod = await import('../../src/renderer/js/webview.js');
  return mod.WebviewManager;
}

// Minimal <webview> stand-in — showContextMenu reads canGoBack/canGoForward
// at build time and replaceMisspelling only inside a suggestion's click.
function fakeWebview(over = {}) {
  return {
    canGoBack: () => false,
    canGoForward: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    getURL: () => 'https://example.com/',
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    replaceMisspelling: vi.fn(),
    ...over,
  };
}

function fakeEvent(params = {}) {
  return { params };
}

beforeEach(() => {
  document.body.innerHTML = '';
  // TabManager is left undefined on purpose: showContextMenu's clamp/dismissal
  // calls are guarded by `typeof TabManager !== 'undefined'`, so they no-op.
  delete globalThis.TabManager;
  delete globalThis.AIPanel;
});

// ===========================================================================
// Suggestions present
// ===========================================================================
describe('showContextMenu — spelling suggestions', () => {
  it('puts every suggestion as a clickable item at the TOP of the menu', async () => {
    const WM = await loadWebviewManager();
    const e = fakeEvent({
      misspelledWord: 'featrues',
      dictionarySuggestions: ['features', 'fixtures', 'feathers'],
    });

    WM.showContextMenu(e, fakeWebview(), { x: 10, y: 10 });

    const menu = document.querySelector('.tab-context-menu');
    expect(menu).toBeTruthy();
    // First three children are the suggestions, in order.
    expect(menu.children[0].textContent).toBe('features');
    expect(menu.children[1].textContent).toBe('fixtures');
    expect(menu.children[2].textContent).toBe('feathers');
    // Followed by a separator, then the normal menu (starting with Back).
    expect(menu.children[3].classList.contains('tab-context-sep')).toBe(true);
    expect(menu.children[4].textContent).toBe('Back');
  });

  it('returns N suggestion items at the top for N suggestions', async () => {
    const WM = await loadWebviewManager();
    const suggestions = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    WM.showContextMenu(
      fakeEvent({ misspelledWord: 'aphla', dictionarySuggestions: suggestions }),
      fakeWebview(), { x: 5, y: 5 },
    );

    const menu = document.querySelector('.tab-context-menu');
    // The first separator sits exactly after the N suggestions.
    const firstSepIdx = [...menu.children].findIndex(c => c.classList.contains('tab-context-sep'));
    expect(firstSepIdx).toBe(suggestions.length);
    for (let i = 0; i < suggestions.length; i++) {
      expect(menu.children[i].textContent).toBe(suggestions[i]);
    }
  });

  it('clicking a suggestion calls webview.replaceMisspelling with that word', async () => {
    const WM = await loadWebviewManager();
    const wv = fakeWebview();
    WM.showContextMenu(
      fakeEvent({ misspelledWord: 'featrues', dictionarySuggestions: ['features', 'fixtures'] }),
      wv, { x: 10, y: 10 },
    );

    const menu = document.querySelector('.tab-context-menu');
    menu.children[1].click(); // "fixtures"

    expect(wv.replaceMisspelling).toHaveBeenCalledWith('fixtures');
    expect(wv.replaceMisspelling).toHaveBeenCalledTimes(1);
    // The menu closes after an item is actioned.
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });
});

// ===========================================================================
// Misspelled word, but no suggestions
// ===========================================================================
describe('showContextMenu — misspelled word with no suggestions', () => {
  it('shows a disabled "No suggestions" item when dictionarySuggestions is empty', async () => {
    const WM = await loadWebviewManager();
    WM.showContextMenu(
      fakeEvent({ misspelledWord: 'zxqwfgb', dictionarySuggestions: [] }),
      fakeWebview(), { x: 10, y: 10 },
    );

    const menu = document.querySelector('.tab-context-menu');
    expect(menu.children[0].textContent).toBe('No suggestions');
    expect(menu.children[0].style.pointerEvents).toBe('none'); // disabled
    expect(menu.children[1].classList.contains('tab-context-sep')).toBe(true);
    expect(menu.children[2].textContent).toBe('Back');
  });

  it('treats a missing dictionarySuggestions field as no suggestions', async () => {
    const WM = await loadWebviewManager();
    WM.showContextMenu(
      fakeEvent({ misspelledWord: 'zxqwfgb' }), // no dictionarySuggestions at all
      fakeWebview(), { x: 10, y: 10 },
    );

    const menu = document.querySelector('.tab-context-menu');
    expect(menu.children[0].textContent).toBe('No suggestions');
  });
});

// ===========================================================================
// No misspelled word — no spelling section at all
// ===========================================================================
describe('showContextMenu — no misspelled word', () => {
  it('adds no spelling section: the menu starts with the normal items', async () => {
    const WM = await loadWebviewManager();
    WM.showContextMenu(fakeEvent({}), fakeWebview(), { x: 10, y: 10 });

    const menu = document.querySelector('.tab-context-menu');
    // No leading separator, no "No suggestions" — first item is Back.
    expect(menu.children[0].textContent).toBe('Back');
    const labels = [...menu.querySelectorAll('.tab-context-item')].map(i => i.textContent);
    expect(labels).not.toContain('No suggestions');
  });
});
