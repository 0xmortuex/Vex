// @vitest-environment jsdom
//
// SE5: a pop-up the blocker refused is said in the address bar of the tab it
// happened in ("Pop-up blocked"), which opens the site panel to allow them.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const fs = require('fs'), path = require('path');

let onBlocked = null;
function setup() {
  document.body.innerHTML = '<div id="url-bar"><input id="url-input"><button id="btn-copy-url"></button></div>';
  globalThis.VexIcons = { svg: (n) => `<svg data-icon="${n}"></svg>` };
  window.showToast = vi.fn();
  const wv1 = { getWebContentsId: () => 11, getURL: () => 'https://news.example/a' };
  const wv2 = { getWebContentsId: () => 12, getURL: () => 'https://other.example/' };
  let active = wv1;
  globalThis.WebviewManager = { webviews: new Map([['t1', wv1], ['t2', wv2]]), getActiveWebview: () => active };
  globalThis.SitePanel = { open: vi.fn() };
  window.vex = { onPopupBlocked: (cb) => { onBlocked = cb; } };
  delete require.cache[require.resolve('../../src/renderer/js/popup-blocked.js')];
  const api = require('../../src/renderer/js/popup-blocked.js');
  return { api, setActive: (w) => { active = w; }, wv1, wv2 };
}

describe('Pop-up blocked in the address bar', () => {
  beforeEach(() => { onBlocked = null; });

  it('shows on the tab it happened in, counts, and opens the site panel at Permissions', () => {
    const { api, setActive, wv2 } = setup();
    const pill = document.getElementById('url-popups');
    expect(pill.hidden).toBe(true);
    onBlocked({ pageId: 11, origin: 'https://news.example', url: 'about:blank' });
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toBe('Pop-up blocked');
    onBlocked({ pageId: 11, origin: 'https://news.example', url: 'https://ads.example/' });
    expect(pill.textContent).toBe('2 pop-ups blocked');
    expect(api.forPage(11).urls).toEqual(['about:blank', 'https://ads.example/']);
    pill.click();
    expect(SitePanel.open).toHaveBeenCalledWith(expect.objectContaining({ section: 'permissions' }));
    setActive(wv2); api.update();
    expect(pill.hidden).toBe(true);
    expect(pill.nextElementSibling.id).toBe('btn-copy-url');
  });

  it('goes when the page goes somewhere else, or once pop-ups are allowed', () => {
    const { api } = setup();
    const pill = document.getElementById('url-popups');
    onBlocked({ pageId: 11, origin: 'https://news.example', url: 'about:blank' });
    api.onUrlChanged({ detail: { tabId: 't1', url: 'https://news.example/a' } });   // same page
    expect(pill.hidden).toBe(false);
    api.onUrlChanged({ detail: { tabId: 't1', url: 'https://news.example/b' } });
    expect(pill.hidden).toBe(true);
    onBlocked({ pageId: 11, origin: 'https://news.example', url: 'about:blank' });
    api.clear(11);
    expect(pill.hidden).toBe(true);
  });

  it('a page with no address bar (an app panel) says it in a toast, once in a while', () => {
    setup();
    onBlocked({ pageId: 99, origin: 'https://discord.com', url: 'https://x.example/' });
    onBlocked({ pageId: 99, origin: 'https://discord.com', url: 'https://x.example/' });
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][0]).toMatch(/Blocked a pop-up from discord\.com/);
    expect(document.getElementById('url-popups').hidden).toBe(true);
  });

  it('is loaded by the window', () => {
    expect(fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8')).toMatch(/<script src="js\/popup-blocked\.js"><\/script>/);
  });
});
