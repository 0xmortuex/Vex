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
// at build time and executeJavaScript only inside a suggestion's click (the
// word is replaced via guest-side execCommand('insertText'), not the broken
// native replaceMisspelling).
function fakeWebview(over = {}) {
  return {
    canGoBack: () => false,
    canGoForward: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    getURL: () => 'https://example.com/',
    getWebContentsId: () => 7,
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    executeJavaScript: vi.fn(() => Promise.resolve()),
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
  delete globalThis.vexSpellcheck;
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

  // Menu items activate on MOUSEDOWN, not click — a <webview> guest right-
  // click leaves focus in the guest, and the resulting host-window blur runs
  // the dismissal close() between a left-click's mousedown and mouseup, so
  // the 'click' never fires. mousedown wins that race.
  it('mousedown on a suggestion replaces the word via guest execCommand insertText', async () => {
    const WM = await loadWebviewManager();
    const execSpy = vi.fn(() => Promise.resolve());
    const wv = fakeWebview({ executeJavaScript: execSpy });

    WM.showContextMenu(
      fakeEvent({ misspelledWord: 'featrues', dictionarySuggestions: ['features', 'fixtures'] }),
      wv,
    );

    const menu = document.querySelector('.tab-context-menu');
    menu.children[1].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));

    // JSON-encoded suggestion keeps quotes/backslashes from breaking the literal.
    expect(execSpy).toHaveBeenCalledWith(`document.execCommand('insertText', false, "fixtures")`);
    expect(execSpy).toHaveBeenCalledTimes(1);
    // The menu closes after an item is actioned.
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('a bare click (no mousedown) does NOT trigger the action — activation is mousedown-based', async () => {
    const WM = await loadWebviewManager();
    const execSpy = vi.fn(() => Promise.resolve());
    const wv = fakeWebview({ executeJavaScript: execSpy });

    WM.showContextMenu(
      fakeEvent({ misspelledWord: 'featrues', dictionarySuggestions: ['features'] }),
      wv,
    );
    document.querySelector('.tab-context-menu').children[0].click();

    expect(execSpy).not.toHaveBeenCalled();
  });

  it('right-click (button 2) mousedown on a suggestion does NOT trigger the action', async () => {
    const WM = await loadWebviewManager();
    const execSpy = vi.fn(() => Promise.resolve());
    const wv = fakeWebview({ executeJavaScript: execSpy });

    WM.showContextMenu(
      fakeEvent({ misspelledWord: 'featrues', dictionarySuggestions: ['features'] }),
      wv,
    );
    const menu = document.querySelector('.tab-context-menu');
    menu.children[0].dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));

    expect(execSpy).not.toHaveBeenCalled();
    // Action never ran, so menu.remove() never ran — the menu is still open.
    expect(document.querySelector('.tab-context-menu')).not.toBeNull();
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

// ===========================================================================
// Menu position — regression: params.x/y are already host-viewport coords
//
// The 'context-menu' event delivers params.x/y in host-viewport CSS pixels.
// A prior version added webview.getBoundingClientRect().left/top on top,
// double-counting the icon-rail width + top-bar height and shifting the menu
// down-right of the cursor. The menu must land exactly at params.x/params.y.
// ===========================================================================
describe('showContextMenu — menu position', () => {
  it('places the menu exactly at params.x / params.y', async () => {
    const WM = await loadWebviewManager();
    WM.showContextMenu(fakeEvent({ x: 200, y: 300 }), fakeWebview());

    const menu = document.querySelector('.tab-context-menu');
    expect(menu.style.left).toBe('200px');
    expect(menu.style.top).toBe('300px');
  });

  it('does NOT add webviewRect.left/top to the params coords', async () => {
    const WM = await loadWebviewManager();
    // A webview offset from the viewport by an icon rail (54) + top bar (87).
    const wv = fakeWebview({ getBoundingClientRect: () => ({ left: 54, top: 87 }) });
    WM.showContextMenu(fakeEvent({ x: 342, y: 627 }), wv);

    const menu = document.querySelector('.tab-context-menu');
    // Correct: the click point itself.
    expect(menu.style.left).toBe('342px');
    expect(menu.style.top).toBe('627px');
    // The old double-counting bug placed it at (54+342, 87+627) = (396, 714).
    expect(menu.style.left).not.toBe('396px');
    expect(menu.style.top).not.toBe('714px');
  });
});
