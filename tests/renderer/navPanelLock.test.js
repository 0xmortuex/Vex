// @vitest-environment jsdom
//
// The toolbar's Back, Forward and Reload are the website's. With a side panel
// (Discord, WhatsApp, Spotify, Notes, a pinned site...) in front, they went
// back, forward and reloaded the website hidden behind it, and so did
// Alt+Left/Right, F5, Ctrl+R, Ctrl+F5, Shift+F5, Ctrl+Shift+R pressed inside
// the panel, and Ctrl+K's Reload (found 2026-10-12, owner: "the forward,
// refresh or backwards button for the websites dont work while i am on a
// sidebar tab"). Now they stand still, show it, and say why; the moment the
// panel closes, or the page itself is used beside a docked panel, they work
// again and show whether there is anywhere to go back or forward to.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let NavLock, page;

function fakePage({ back = true, forward = false } = {}) {
  return {
    _attached: true,
    canGoBack: vi.fn(() => back),
    canGoForward: vi.fn(() => forward),
  };
}

beforeEach(() => {
  vi.resetModules();
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  document.body.innerHTML = `
    <div id="nav-buttons">
      <button id="btn-back" class="nav-btn" title="Back (Alt+Left)"></button>
      <button id="btn-forward" class="nav-btn" title="Forward (Alt+Right)"></button>
      <button id="btn-reload" class="nav-btn" title="Reload (Ctrl+R)"></button>
    </div>
    <div id="content-area">
      <div id="webviews-container"><webview id="tab-page"></webview></div>
      <div id="panels-container"><div class="panel" id="panel-discord"><webview id="discord-page"></webview></div>
        <div class="panel" id="panel-notes"><textarea id="note"></textarea></div></div>
    </div>`;
  page = fakePage();
  globalThis.WebviewManager = {
    getActiveWebview: () => page,
    goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn(), hardReload: vi.fn(), stop: vi.fn(),
  };
  globalThis.SidebarManager = {
    activePanel: null,
    _docksBesidePage: (name) => !!document.body.dataset.sbSide && name !== 'settings',
  };
  // One instance for the file: init() puts its listeners on the document,
  // which outlives each test.
  if (!NavLock) {
    ({ NavLock } = require('../../src/renderer/js/nav-lock.js'));
    NavLock.init();
  }
  NavLock._onPanel = false;
  NavLock.sync();
});

const btn = (id) => document.getElementById(id);
const openPanel = (name) => {
  SidebarManager.activePanel = name;
  document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: { panel: name } }));
};
const closePanel = () => {
  SidebarManager.activePanel = null;
  document.dispatchEvent(new CustomEvent('vex:panel-changed', { detail: { panel: null } }));
};

describe('with no panel open', () => {
  it('Back, Forward, Reload and Stop act on the website', () => {
    for (const a of ['back', 'forward', 'reload', 'hardReload', 'stop']) expect(NavLock.run(a)).toBe(true);
    expect(WebviewManager.goBack).toHaveBeenCalledTimes(1);
    expect(WebviewManager.goForward).toHaveBeenCalledTimes(1);
    expect(WebviewManager.reload).toHaveBeenCalledTimes(1);
    expect(WebviewManager.hardReload).toHaveBeenCalledTimes(1);
    expect(WebviewManager.stop).toHaveBeenCalledTimes(1);
  });

  it('Back and Forward show whether the page has anywhere to go', () => {
    NavLock.sync();
    expect(btn('btn-back').getAttribute('aria-disabled')).toBeNull();
    expect(btn('btn-forward').getAttribute('aria-disabled')).toBe('true');
    expect(btn('btn-forward').title).toBe('Forward (Alt+Right)');
    expect(btn('btn-reload').getAttribute('aria-disabled')).toBeNull();
  });

  it('a page not ready to be asked counts as nowhere to go, and any other failure is raised', () => {
    page.canGoBack = () => { throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.'); };
    NavLock.sync();
    expect(btn('btn-back').getAttribute('aria-disabled')).toBe('true');
    page.canGoBack = () => { throw new Error('boom'); };
    expect(() => NavLock.sync()).toThrow('boom');
  });

  it('an unknown action is an error, not a silent no-op', () => {
    expect(() => NavLock.run('sideways')).toThrow(/unknown/i);
  });
});

describe('with a panel covering the page (Classic, or maximized in a browser look)', () => {
  beforeEach(() => openPanel('discord'));

  it('nothing reaches the hidden website', () => {
    for (const a of ['back', 'forward', 'reload', 'hardReload', 'stop']) expect(NavLock.run(a)).toBe(false);
    expect(WebviewManager.goBack).not.toHaveBeenCalled();
    expect(WebviewManager.goForward).not.toHaveBeenCalled();
    expect(WebviewManager.reload).not.toHaveBeenCalled();
    expect(WebviewManager.hardReload).not.toHaveBeenCalled();
    expect(WebviewManager.stop).not.toHaveBeenCalled();
  });

  it('the three buttons show it and say why, keeping their own name', () => {
    for (const id of ['btn-back', 'btn-forward', 'btn-reload']) {
      expect(btn(id).getAttribute('aria-disabled')).toBe('true');
      expect(btn(id).title).toMatch(/not available while a side panel is open/i);
    }
    expect(btn('btn-back').title).toMatch(/^Back/);
    expect(btn('btn-reload').title).toMatch(/^Reload/);
  });

  it('even after the page beside it was clicked: it is not on screen', () => {
    btn('tab-page').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(NavLock.blocked()).toBe(true);
  });

  it('a maximized panel in a browser look covers the page too', () => {
    closePanel();
    document.body.dataset.sbSide = 'left';
    document.body.dataset.sidebarMax = '';
    openPanel('discord');
    btn('tab-page').dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(NavLock.blocked()).toBe(true);
  });

  it('closing the panel gives everything back at once, with the true Back/Forward state', () => {
    page = fakePage({ back: false, forward: true });
    closePanel();
    expect(NavLock.run('reload')).toBe(true);
    expect(btn('btn-back').getAttribute('aria-disabled')).toBe('true');
    expect(btn('btn-back').title).toBe('Back (Alt+Left)');
    expect(btn('btn-forward').getAttribute('aria-disabled')).toBeNull();
    expect(btn('btn-forward').title).toBe('Forward (Alt+Right)');
    expect(btn('btn-reload').getAttribute('aria-disabled')).toBeNull();
    expect(btn('btn-reload').title).toBe('Reload (Ctrl+R)');
  });

  it('a title the button changed to while locked (Reload turned Stop) is the one put back', () => {
    // TabManager.syncReloadButton writes through NavLock.setTitle.
    NavLock.setTitle(btn('btn-reload'), 'Stop loading this page (Esc)');
    expect(btn('btn-reload').title).toMatch(/^Stop loading this page — not available/);
    closePanel();
    expect(btn('btn-reload').title).toBe('Stop loading this page (Esc)');
  });
});

describe('with a panel docked beside the page (browser looks, Glass)', () => {
  beforeEach(() => {
    document.body.dataset.sbSide = 'left';
    openPanel('discord');
  });

  it('opening the panel puts you on it: the website buttons stand still', () => {
    expect(NavLock.run('back')).toBe(false);
    expect(btn('btn-back').getAttribute('aria-disabled')).toBe('true');
  });

  it('using the page beside it gives them back; using the panel again takes them away', () => {
    btn('tab-page').dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(NavLock.run('back')).toBe(true);
    expect(btn('btn-back').getAttribute('aria-disabled')).toBeNull();
    btn('discord-page').dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(NavLock.run('back')).toBe(false);
    btn('tab-page').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(NavLock.run('forward')).toBe(true);
    // A feature panel's own controls count as the panel.
    btn('note').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(NavLock.run('reload')).toBe(false);
  });

  it('a click on the toolbar itself does not change who you are on', () => {
    btn('btn-back').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    btn('btn-back').dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(NavLock.blocked()).toBe(true);
  });

  it('Settings takes the whole area even in a docked look', () => {
    closePanel();
    openPanel('settings');
    btn('tab-page').dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(NavLock.blocked()).toBe(true);
  });
});

describe('every way in goes through the lock', () => {
  const app = read('src/renderer/js/app.js');
  const command = read('src/renderer/js/command.js');

  it('the toolbar buttons', () => {
    expect(app).toMatch(/getElementById\('btn-back'\)\.addEventListener\('click', \(\) => NavLock\.run\('back'\)\)/);
    expect(app).toMatch(/getElementById\('btn-forward'\)\.addEventListener\('click', \(\) => NavLock\.run\('forward'\)\)/);
    expect(app).toMatch(/NavLock\.run\(e\.currentTarget\.dataset\.state === 'stop' \? 'stop' : 'reload'\)/);
  });

  it('the keys main passes up (Alt+Left/Right, Ctrl+R, Ctrl+Shift+R) and the registry keys (F5, Ctrl+F5, Shift+F5)', () => {
    expect(app).toMatch(/onReloadTab\(\(from\) => NavLock\.run\('reload', from\)\)/);
    expect(app).toMatch(/onHardReloadTab\?\.\(\(from\) => NavLock\.run\('hardReload', from\)\)/);
    expect(app).toMatch(/onNavigateBack\(\(from\) => NavLock\.run\('back', from\)\)/);
    expect(app).toMatch(/onNavigateForward\(\(from\) => NavLock\.run\('forward', from\)\)/);
    for (const k of ['reload', 'reload-f5']) expect(app).toMatch(new RegExp(`register\\('${k}',\\s*\\(\\) => NavLock\\.run\\('reload'\\)\\)`));
    for (const k of ['hard-reload', 'hard-reload-ctrl-f5', 'hard-reload-shift-f5']) expect(app).toMatch(new RegExp(`register\\('${k}',\\s*\\(\\) => NavLock\\.run\\('hardReload'\\)\\)`));
  });

  it("Ctrl+K's Reload and Hard Reload", () => {
    expect(command).toMatch(/id: 'reload',[^\n]*action: \(\) => NavLock\.run\('reload'\)/);
    expect(command).toMatch(/id: 'hard-reload',[^\n]*action: \(\) => NavLock\.run\('hardReload'\)/);
  });

  it('the window loads the lock before app.js wires it', () => {
    const html = read('src/renderer/index.html');
    const lock = html.indexOf('<script src="js/nav-lock.js"></script>');
    expect(lock).toBeGreaterThan(html.indexOf('<script src="js/sidebar.js"></script>'));
    expect(lock).toBeLessThan(html.indexOf('<script src="js/app.js"></script>'));
  });

  it('the Reload button keeps its real title when it first turns Stop under a panel', () => {
    const tabs = read('src/renderer/js/tabs.js');
    expect(tabs).toMatch(/NavLock\.realTitle\(btn\)/);
    expect(tabs).toMatch(/NavLock\.setTitle\(btn, /);
  });
});

describe('looks', () => {
  it('every look greys a locked button and gives it no hover fill', () => {
    const appCss = read('src/renderer/css/app.css');
    const browser = read('src/renderer/css/gui-browser.css');
    expect(appCss).toMatch(/\.nav-btn\[aria-disabled="true"\]/);
    expect(browser).toMatch(/\.nav-btn\[aria-disabled="true"\]/);
    expect(read('src/renderer/css/gui-glass.css')).toMatch(/\.nav-btn\[aria-disabled="true"\]/);
  });
});

describe('a key names the page it was pressed in', () => {
  const { withSource, shortcutFor } = require('../../src/main/guest-shortcuts.js');
  const key = (k, mods = {}) => ({ type: 'keyDown', key: k, control: false, alt: false, shift: false, ...mods });

  it('main adds the page to Back, Forward, Reload and to keys passed up to the registry', () => {
    expect(withSource(shortcutFor(key('ArrowLeft', { alt: true })), 7)).toEqual({ channel: 'navigate-back', args: [7] });
    expect(withSource(shortcutFor(key('ArrowRight', { alt: true })), 7)).toEqual({ channel: 'navigate-forward', args: [7] });
    expect(withSource(shortcutFor(key('r', { control: true })), 7)).toEqual({ channel: 'reload-tab', args: [7] });
    expect(withSource(shortcutFor(key('R', { control: true, shift: true })), 7)).toEqual({ channel: 'hard-reload-tab', args: [7] });
    const f5 = withSource(shortcutFor(key('F5'), { wanted: new Set(['F5']) }), 7);
    expect(f5).toEqual({ channel: 'guest-shortcut', args: [{ key: 'F5', ctrl: false, shift: false, alt: false, from: 7 }] });
    // Anything else is left as it was; no key, nothing.
    expect(withSource(shortcutFor(key('t', { control: true })), 7)).toEqual({ channel: 'new-tab' });
    expect(withSource(null, 7)).toBeNull();
    expect(() => withSource({ channel: 'navigate-back' }, undefined)).toThrow(/webContents id/);
  });

  it('main.js passes every page key through it', () => {
    expect(read('src/main.js')).toMatch(/const hit = withSource\(shortcutFor\(input, \{[^}]*\}\), contents\.id\);/);
  });

  describe('with a panel docked beside the page', () => {
    beforeEach(() => {
      document.body.dataset.sbSide = 'left';
      btn('tab-page').getWebContentsId = () => 11;
      btn('discord-page').getWebContentsId = () => 22;
      openPanel('discord');
    });

    it("a key from the panel's page is refused even when the window last saw the page used", () => {
      btn('tab-page').dispatchEvent(new Event('focusin', { bubbles: true }));
      expect(NavLock.run('back', 22)).toBe(false);
      expect(NavLock.run('reload', 22)).toBe(false);
      expect(WebviewManager.goBack).not.toHaveBeenCalled();
    });

    it("a key from the website's own page goes through even while the panel was last used", () => {
      expect(NavLock.blocked()).toBe(true);
      expect(NavLock.run('back', 11)).toBe(true);
      expect(WebviewManager.goBack).toHaveBeenCalledTimes(1);
    });

    it('the registry keys (F5, Ctrl+F5, Shift+F5) carry the page through fromPage', () => {
      expect(NavLock.fromPage(22, () => NavLock.run('reload'))).toBe(false);
      expect(NavLock.fromPage(11, () => NavLock.run('reload'))).toBe(true);
      expect(NavLock._keyFrom).toBeUndefined();
    });

    it('a page not loaded yet is skipped; any other failure is raised', () => {
      btn('discord-page').getWebContentsId = () => { throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.'); };
      expect(NavLock.run('back', 11)).toBe(true);
      btn('tab-page').getWebContentsId = () => { throw new Error('boom'); };
      expect(() => NavLock.run('back', 11)).toThrow('boom');
    });
  });

  it('a panel covering the page refuses a key even from the website (it is hidden)', () => {
    btn('tab-page').getWebContentsId = () => 11;
    openPanel('discord');
    expect(NavLock.run('back', 11)).toBe(false);
  });

  it('app.js hands the page on', () => {
    const app = read('src/renderer/js/app.js');
    expect(app).toMatch(/onNavigateBack\(\(from\) => NavLock\.run\('back', from\)\)/);
    expect(app).toMatch(/NavLock\.fromPage\(combo\.from, \(\) => document\.dispatchEvent/);
  });
});
