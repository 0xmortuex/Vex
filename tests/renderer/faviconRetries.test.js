// @vitest-environment jsdom
//
// A tab favicon points at the site's own /favicon.ico, on purpose: asking
// Google's icon service would hand it every domain you visit. Some sites will
// not serve theirs to us — Gmail sends Cross-Origin-Resource-Policy:
// same-site — and the tab used to keep the dead address, so every redraw
// asked again. Hundreds of identical ERR_BLOCKED_BY_RESPONSE lines in the
// console, one per render, for ever.

import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; global.window.VexIcons = VexIcons;
const { TabManager } = require('../../src/renderer/js/tabs.js');

beforeEach(() => {
  document.body.innerHTML = '<div id="tabs-list"></div>';
  TabManager.tabs = [];
  TabManager._deadFavicons = new Set();
  TabManager.persistTabs = vi.fn();
});

describe('a favicon that will not load', () => {
  const GMAIL = 'https://mail.google.com/favicon.ico';

  it('is remembered, and taken off every tab wearing it', () => {
    TabManager.tabs = [
      { id: 'a', favicon: GMAIL, url: 'https://mail.google.com/' },
      { id: 'b', favicon: GMAIL, url: 'https://mail.google.com/u/1' },
      { id: 'c', favicon: 'https://other.test/favicon.ico', url: 'https://other.test/' },
    ];
    TabManager.markDeadFavicon(GMAIL);
    expect(TabManager.isDeadFavicon(GMAIL)).toBe(true);
    expect(TabManager.tabs.map(t => t.favicon)).toEqual([null, null, 'https://other.test/favicon.ico']);
    expect(TabManager.persistTabs).toHaveBeenCalled();
  });

  it('is not worth remembering when it is already a picture', () => {
    expect(TabManager.markDeadFavicon('data:image/png;base64,AAA')).toBe(false);
    expect(TabManager.markDeadFavicon('')).toBe(false);
    expect(TabManager._deadFavicons.size).toBe(0);
  });

  it('leaves the tabs alone, and untouched storage, when nothing wore it', () => {
    TabManager.tabs = [{ id: 'a', favicon: 'https://other.test/favicon.ico' }];
    TabManager.markDeadFavicon(GMAIL);
    expect(TabManager.tabs[0].favicon).toBe('https://other.test/favicon.ico');
    expect(TabManager.persistTabs).not.toHaveBeenCalled();
  });

  // The whole point: the second render must not ask again.
  it('an image error records it, so the next render does not ask again', () => {
    TabManager.tabs = [{ id: 'a', favicon: GMAIL }];
    TabManager._faviconErrWired = false;
    // Wire just the delegated handler, without the rest of init's storage work.
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.nodeName !== 'IMG' || !img.classList.contains('tab-favicon')) return;
      TabManager.markDeadFavicon(img.getAttribute('src'));
    }, true);
    const img = document.createElement('img');
    img.className = 'tab-favicon';
    img.setAttribute('src', GMAIL);
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    expect(TabManager.isDeadFavicon(GMAIL)).toBe(true);
    expect(TabManager.tabs[0].favicon).toBe(null);
  });
});
