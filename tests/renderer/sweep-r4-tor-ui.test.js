// @vitest-environment jsdom
//
// Fixes of 2026-09-30 (r4-tor): Stop counted and closed the Tor tabs of the
// window it was clicked in only; a Tor route whose Tor had stopped loaded
// nothing, and a Tor page that could not load was blank; a "Tor tab" in a
// private window went direct; a load nobody waited for went uncaught when a
// typed address superseded it, and an address typed before the page was
// attached threw; the proxy routing screens did not say calls may fail.
// Verified live too (scratchpad agents/r4-tor p1, p6, p7, p8).
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;
require('../../src/renderer/js/vex-utils.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const SESSION = require.resolve('../../src/renderer/js/tor-session.js');
const { WebviewManager } = require('../../src/renderer/js/webview.js');

function loadTorSession(vex) {
  document.body.innerHTML = '';   // no #tor-running: the indicator is not wired
  window.vex = vex;
  window.showToast = vi.fn();
  delete require.cache[SESSION];
  return require(SESSION).TorSession;
}

describe('Stop, counted over every window', () => {
  beforeEach(() => {
    globalThis.TabManager = { tabs: [], closeTab: vi.fn() };
    globalThis.WebviewManager = { webviews: new Map() };
    window.vexConfirm = vi.fn(() => Promise.resolve(true));
  });

  // r7 (2026-09-30): Stop closed the tabs of containers, burners and site
  // rules routed through Tor too. They stay open and say what happens to them.
  it('says how many Tor tabs close, in how many windows, and what happens to the pages routed through Tor', () => {
    const T = loadTorSession({});
    expect(T._stopMessage({ tabs: 1, windows: 1, routed: 0 })).toBe('The Tor tab will close.');
    expect(T._stopMessage({ tabs: 3, windows: 1, routed: 0 })).toBe('The 3 Tor tabs will close.');
    expect(T._stopMessage({ tabs: 4, windows: 2, routed: 0 })).toBe('The 4 Tor tabs will close in 2 windows.');
    expect(T._stopMessage({ tabs: 2, windows: 1, routed: 3 })).toBe('The 2 Tor tabs will close. 3 pages going through Tor (containers, site rules, burners) stop loading until you use them again.');
    expect(T._stopMessage({ tabs: 0, windows: 0, routed: 1 })).toBe('1 page going through Tor (a container, site rule or burner) stops loading until you use it again.');
    expect(T._stopMessage({ tabs: 1, windows: 1, routed: 2 })).toBe('The Tor tab will close. 2 pages going through Tor (containers, site rules, burners) stop loading until you use them again.');
  });

  it('asks with the totals main gives, and leaves the closing to main (every window)', async () => {
    const vex = { torStatus: vi.fn(() => Promise.resolve({ running: true, tabs: 3, windows: 2, routed: 1 })), stopTor: vi.fn(() => Promise.resolve({ ok: true })) };
    const T = loadTorSession(vex);
    TabManager.tabs = [{ id: 'a', partition: 'tor-x1' }];
    expect(await T.stop()).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'The 3 Tor tabs will close in 2 windows. 1 page going through Tor (a container, site rule or burner) stops loading until you use it again.' }));
    expect(TabManager.closeTab).not.toHaveBeenCalled();
    expect(vex.stopTor).toHaveBeenCalledTimes(1);
  });

  it('asks when only routed pages go through Tor, and stops at once when nothing does', async () => {
    const vex = { torStatus: vi.fn(() => Promise.resolve({ running: true, tabs: 0, windows: 0, routed: 2 })), stopTor: vi.fn(() => Promise.resolve({ ok: true })) };
    const T = loadTorSession(vex);
    expect(await T.stop()).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    vex.torStatus = vi.fn(() => Promise.resolve({ running: true, tabs: 0, windows: 0, routed: 0 }));
    expect(await T.stop()).toBe(true);
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(vex.stopTor).toHaveBeenCalledTimes(2);
  });

  it('each window counts and closes only its real Tor tabs, asleep ones too; routed tabs stay', () => {
    const T = loadTorSession({});
    TabManager.tabs = [{ id: 'a', partition: 'tor-x1' }, { id: 'b', partition: 'persist:container-work' }, { id: 'c', partition: 'persist:main' }, { id: 'd', partition: 'persist:route-tor' }, { id: 'e', partition: 'otr-burner-1' }, { id: 'f', partition: 'tor-x2' }];
    expect(T.countTorTabs()).toBe(2);
    expect(TabManager.closeTab).not.toHaveBeenCalled();
    expect(T.closeTorTabs()).toBe(2);
    expect(TabManager.closeTab.mock.calls.map(c => c[0])).toEqual(['a', 'f']);
  });
});

describe('a Tor route starting Tor again', () => {
  let progress, vex;
  beforeEach(() => {
    vex = { onTorProgress: vi.fn((cb) => { progress = cb; return vi.fn(); }), cancelTor: vi.fn(() => Promise.resolve({ ok: true })) };
  });

  it('shows the same progress as opening a Tor tab, then closes it once connected', async () => {
    vi.useFakeTimers();
    const T = loadTorSession(vex);
    T._reviving();
    T._reviving();                     // a second page in the same start: one dialog
    expect(document.querySelectorAll('#vex-tor-progress')).toHaveLength(1);
    progress({ phase: 'bootstrap', value: 45, detail: 'loading_descriptors' });
    expect(document.querySelector('#tor-bs-pct').textContent).toBe('45%');
    T._revived({ ok: true, port: 50000 });
    expect(document.querySelector('#tor-bs-stage').textContent).toBe('Connected — loading your page…');
    vi.advanceTimersByTime(600);
    expect(document.querySelector('#vex-tor-progress')).toBeNull();
    expect(window.showToast).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a start that fails is said; one the person cancelled is not', () => {
    const T = loadTorSession(vex);
    T._reviving();
    T._revived({ ok: false, error: 'Tor took too long to connect' });
    expect(document.querySelector('#vex-tor-progress')).toBeNull();
    expect(window.showToast).toHaveBeenCalledWith('Tor could not start: Tor took too long to connect', 'error');
    T._reviving();
    document.querySelector('#tor-prog-cancel').click();
    expect(vex.cancelTor).toHaveBeenCalled();
    T._revived({ ok: false, cancelled: true, error: 'cancelled' });
    expect(window.showToast).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way of a Tor tab that is opening', () => {
    const T = loadTorSession(vex);
    T._busy = true;
    T._reviving();
    expect(document.querySelector('#vex-tor-progress')).toBeNull();
  });
});

describe('a Tor tab in a private window', () => {
  it('is refused, and said: every tab there uses the private window\'s own connection', async () => {
    const vex = { createTor: vi.fn() };
    const T = loadTorSession(vex);
    window.VexTabPolicy = { isPrivateWindow: true };
    try {
      await T.open();
      expect(vex.createTor).not.toHaveBeenCalled();
      expect(window.showToast).toHaveBeenCalledWith(expect.stringContaining('from a normal Vex window'), 'error');
    } finally { delete window.VexTabPolicy; }
  });
});

describe('a Tor page that cannot load says why', () => {
  const W = WebviewManager;
  beforeEach(() => { W.webviews = new Map(); });

  it('writes the message into the tab whose page main names', async () => {
    const executeJavaScript = vi.fn(() => Promise.resolve(true));
    W.webviews.set('t1', { getWebContentsId: () => 4 });
    W.webviews.set('t2', { getWebContentsId: () => 8, executeJavaScript });
    W.webviews.set('t3', { getWebContentsId: () => { throw new Error('not attached'); } });
    expect(W.showTorDown(8, 'starting')).toBe(true);
    const script = executeJavaScript.mock.calls[0][0];
    expect(script).toContain('Tor is not running — starting it…');
    expect(script).toContain('This page loads as soon as Tor is connected.');
    expect(script).toContain('<svg');
    expect(W.showTorDown(99, 'stopped')).toBe(false);
  });

  it('runs in a page: the words are text, not markup, and the error is shown', () => {
    const executeJavaScript = vi.fn(() => Promise.resolve(true));
    W.webviews.set('t', { getWebContentsId: () => 5, executeJavaScript });
    W.showTorDown(5, 'failed', '<b>no route</b>');
    document.head.innerHTML = ''; document.body.innerHTML = '';
    expect(eval(executeJavaScript.mock.calls[0][0])).toBe(true);
    expect(document.querySelector('h1').textContent).toBe('Tor could not start');
    expect(document.querySelector('p').textContent).toBe('Reload the page to try again. (<b>no route</b>)');
    expect(document.querySelector('p b')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    W.showTorDown(5, 'stopped');
    expect(executeJavaScript.mock.calls[1][0]).toContain('Tor stopped — reopen to start it again');
  });

  it('an unknown state is a Vex fault, not a blank', () => {
    expect(() => W.showTorDown(1, 'sleeping')).toThrow(/Unknown Tor page state/);
  });

  it('a navigate toast names a proxy that is not answering', () => {
    expect(W._whyLoadFailed("Error: ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://x/'")).toBe('the proxy or Tor it goes through is not answering');
  });

  // r7 (2026-09-30), codes checked live through a real Tor: a dead onion
  // service, a closed port and a name that does not exist all give -120 with
  // Tor working; Tor not running (its port refusing) gives -130.
  it('through Tor: Tor not running is not the same as a site that did not answer', () => {
    const socks = "Error invoking remote method 'GUEST_VIEW_MANAGER_CALL': Error: ERR_SOCKS_CONNECTION_FAILED (-120) loading 'http://x.onion/'";
    const proxy = "Error: ERR_PROXY_CONNECTION_FAILED (-130) loading 'https://x/'";
    for (const part of ['tor-mun3czzk-d6hc', 'persist:route-tor']) {
      expect(W._whyLoadFailed(socks, part)).toBe('the site did not answer through Tor');
      expect(W._whyLoadFailed(proxy, part)).toBe('Tor is not running');
      expect(W._whyLoadFailed('ERR_TUNNEL_CONNECTION_FAILED (-111)', part)).toBe('the site did not answer through Tor');
    }
    // A container or burner goes through Tor or another proxy.
    expect(W._whyLoadFailed(socks, 'persist:container-work')).toBe('the site did not answer through the proxy or Tor it goes through');
    expect(W._whyLoadFailed(proxy, 'otr-burner-1')).toBe('the proxy or Tor it goes through is not answering');
    expect(W._whyLoadFailed('ERR_CONNECTION_REFUSED (-102)', 'persist:main')).toBe('nothing is answering at that address');
  });

  it('the toast in a Tor tab says the site did not answer through Tor', async () => {
    const wv = document.createElement('div');
    wv._attached = true;
    wv.loadURL = vi.fn(() => Promise.reject(new Error("Error: ERR_SOCKS_CONNECTION_FAILED (-120) loading 'http://x.onion/'")));
    W.webviews = new Map([['t', wv]]);
    const tab = { id: 't', partition: 'tor-x1', url: '' };
    globalThis.TabManager = { activeTabId: 't', tabs: [tab], getActiveTab: () => tab };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.showToast = vi.fn();
    W.navigate('http://x.onion/');
    await tick();
    expect(window.showToast).toHaveBeenCalledWith('Could not open http://x.onion/ — the site did not answer through Tor', 'error');
    warn.mockRestore();
  });
});

describe('loads nobody waits for', () => {
  it('a superseded one is expected; any other failure is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    WebviewManager._loadUnwatched({ loadURL: () => Promise.reject(new Error("Error invoking remote method 'GUEST_VIEW_MANAGER_CALL': Error: ERR_ABORTED (-3) loading 'https://duckduckgo.com/'")) }, 'https://a/', 'waking a sleeping tab');
    WebviewManager._loadUnwatched({ loadURL: () => Promise.reject(new Error('ERR_NAME_NOT_RESOLVED (-105)')) }, 'https://b/', 'reload');
    await tick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[Vex] reload: could not load https://b/ —');
    warn.mockRestore();
  });

  it('a webview not attached yet still throws, for the caller\'s src fallback', () => {
    expect(() => WebviewManager._loadUnwatched({ loadURL: () => { throw new Error('The WebView must be attached'); } }, 'https://a/', 'x')).toThrow(/attached/);
  });
});

describe('an address typed before the tab\'s page is attached', () => {
  it('is loaded once it is, instead of throwing out of the address bar', async () => {
    const wv = document.createElement('div');
    wv.loadURL = vi.fn(() => Promise.resolve());
    const W = WebviewManager;
    W.webviews = new Map([['t', wv]]);
    globalThis.TabManager = { activeTabId: 't', tabs: [{ id: 't', partition: 'persist:main' }], getActiveTab: () => ({ id: 't', partition: 'persist:main' }) };
    expect(() => W.navigate('https://example.com/')).not.toThrow();
    expect(wv.loadURL).not.toHaveBeenCalled();
    wv._attached = true;
    wv.dispatchEvent(new Event('did-attach'));
    expect(wv.loadURL).toHaveBeenCalledWith('https://example.com/');
    W.navigate('https://example.org/');
    expect(wv.loadURL).toHaveBeenLastCalledWith('https://example.org/');
  });
});

describe('the proxy routing screens say calls may not connect', () => {
  const NOTE = /Calls in Discord, Meet and similar may not connect: WebRTC is limited to the proxy so it can.t show your real address/;

  it('Private routing, beside the proxy choice', async () => {
    const { PrivateRouting } = require('../../src/renderer/js/private-routing.js');
    window.escapeHtml = (v) => String(v == null ? '' : v);
    window.vex = { routingGetAll: async () => ({ mode: 'direct' }) };
    const el = await PrivateRouting.open();
    expect(el.querySelector('.vexroute-proxy').textContent).toMatch(NOTE);
    PrivateRouting.close();
  });

  it('Route through Tor / Proxy, under the proxy address', async () => {
    require('../../src/renderer/js/container-routing.js');
    globalThis.TabManager = { getActiveTab: () => ({ partition: 'persist:container-work' }) };
    window.vex = { routingGet: async () => ({ mode: 'direct' }) };
    await window.ContainerRouting.open();
    expect(document.getElementById('vex-routing').textContent).toMatch(NOTE);
    document.getElementById('vex-routing').remove();
  });
});
