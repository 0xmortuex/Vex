// @vitest-environment jsdom
//
// js/captive-portal.js: "Is this a Wi-Fi sign-in?" on the page that did not load, and Ctrl+K. Nothing is asked until a press,
// and the sign-in lets HTTPS-only leave the portal's hosts alone BEFORE the tab opens, or its plain-http page would be
// upgraded into a failure.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { VexLoadFailure } = require('../../src/renderer/js/load-failure.js');
const { VexCaptivePortal } = require('../../src/renderer/js/captive-portal.js');

const URL1 = 'https://shop.example/cart';
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const PORTAL = { state: 'portal', loginUrl: 'http://gateway.wifi.example/start', hosts: ['detectportal.firefox.com', 'gateway.wifi.example'], secureDns: 'off', probe: 'http://detectportal.firefox.com/canonical.html' };

let order;
function install() {
  const tab = { id: 'a', url: URL1, _loadFailed: { code: -105, url: URL1 } };
  globalThis.TabManager = {
    tabs: [tab], activeTabId: 'a',
    getActiveTab() { return this.tabs.find(t => t.id === this.activeTabId); },
    switchTab: vi.fn(),
    createTab: vi.fn((...a) => { order.push('createTab'); return a; }),
  };
  globalThis.WebviewManager = { webviews: new Map(), navigate: vi.fn() };
  globalThis.VexLoadFailure = VexLoadFailure;
  globalThis.VexCaptivePortal = VexCaptivePortal;
  return tab;
}
function show(code = -105) {
  VexLoadFailure.note('a', { errorCode: code, validatedURL: URL1, isMainFrame: true });
  vi.advanceTimersByTime(300);
}
const buttons = () => [...document.querySelectorAll('#vex-load-failure .vlf-btn')];
const labels = () => buttons().map(b => b.textContent);
const press = async (label) => { buttons().find(b => b.textContent === label).click(); await flush(); };
const status = () => (document.querySelector('.vlf-captive') || {}).textContent || '';

beforeEach(() => {
  vi.useFakeTimers();
  order = [];
  localStorage.clear();
  document.body.innerHTML = '<div id="webviews-container"></div>';
  VexLoadFailure._el = null;
  VexLoadFailure._timers.clear();
  delete globalThis.ArchiveLibrary; delete globalThis.LinkRot;
  window.showToast = vi.fn();
  window.vexConfirm = vi.fn(async () => true);
  window.vex = {
    captiveCheck: vi.fn(async () => PORTAL),
    captiveAllowHttp: vi.fn(async (hosts) => { order.push('allow'); return { ok: true, hosts }; }),
    captivePauseSecureDns: vi.fn(async () => ({ ok: true, until: Date.now() + 600000 })),
  };
});
afterEach(() => { vi.useRealTimers(); });

describe('which failures offer the check', () => {
  it('the errors a portal causes do', () => {
    for (const code of [-105, -106, -101, -100, -104, -109, -118, -7, -324, -21, -137]) expect(VexCaptivePortal.offers(code), String(code)).toBe(true);
  });
  it('a site that refused, an aborted load, a certificate error and a proxy failure do not', () => {
    for (const code of [-102, -3, -200, -202, -130, -501, -310, 0]) expect(VexCaptivePortal.offers(code), String(code)).toBe(false);
  });
  it('the page that did not load shows the button for -105 and not for -102, and asks nothing yet', () => {
    install(); show(-105);
    expect(labels()).toContain('Is this a Wi-Fi sign-in?');
    document.body.innerHTML = '<div id="webviews-container"></div>'; VexLoadFailure._el = null;
    install(); show(-102);
    expect(labels()).not.toContain('Is this a Wi-Fi sign-in?');
    expect(window.vex.captiveCheck).not.toHaveBeenCalled();
  });
});

describe('pressing it', () => {
  it('asks once, says what it found on that screen, and offers the sign-in page', async () => {
    install(); show();
    await press('Is this a Wi-Fi sign-in?');
    expect(window.vex.captiveCheck).toHaveBeenCalledTimes(1);
    expect(status()).toBe('This network wants you to sign in first.');
    expect(labels()).toEqual(expect.arrayContaining(['Open the sign-in page', 'Check the network again']));
    expect(labels()).not.toContain('Is this a Wi-Fi sign-in?');
    expect(document.querySelector('#vex-load-failure').getAttribute('role')).toBe('alert');
  });

  it('an open network says the problem is elsewhere, with no sign-in button', async () => {
    window.vex.captiveCheck = vi.fn(async () => ({ state: 'open', secureDns: 'off' }));
    install(); show();
    await press('Is this a Wi-Fi sign-in?');
    expect(status()).toMatch(/not asking you to sign in/);
    expect(labels()).not.toContain('Open the sign-in page');
  });

  it('with strict secure DNS on and the network not answering, it offers the pause (and only then)', async () => {
    window.vex.captiveCheck = vi.fn(async () => ({ state: 'offline', secureDns: 'strict' }));
    install(); show();
    await press('Is this a Wi-Fi sign-in?');
    expect(status()).toMatch(/Strict secure DNS is on/);
    await press('Pause secure DNS for 10 minutes');
    expect(window.vex.captivePauseSecureDns).toHaveBeenCalledWith(10);
    expect(window.showToast).toHaveBeenCalledWith('Secure DNS is paused for 10 minutes.');

    window.vex.captiveCheck = vi.fn(async () => ({ state: 'open', secureDns: 'strict' }));
    await press('Check the network again');
    expect(labels()).not.toContain('Pause secure DNS for 10 minutes');
  });

  it('a check that fails says so instead of leaving the screen as it was', async () => {
    window.vex.captiveCheck = vi.fn(async () => { throw new Error('boom'); });
    install(); show();
    await press('Is this a Wi-Fi sign-in?');
    expect(status()).toBe('The check did not work: boom');
  });

  it('a build without the bridge says so, and does not throw', async () => {
    delete window.vex.captiveCheck;
    install(); show();
    await press('Is this a Wi-Fi sign-in?');
    expect(status()).toMatch(/not available in this build/);
  });

  it('an answer that arrives after the page moved on is not drawn', async () => {
    let release;
    window.vex.captiveCheck = vi.fn(() => new Promise(r => { release = r; }));
    const tab = install(); show();
    buttons().find(b => b.textContent === 'Is this a Wi-Fi sign-in?').click();
    await flush();
    expect(status()).toBe('Checking the network…');
    VexLoadFailure.clear('a');                      // a new navigation began
    expect(tab._failedPage).toBe(null);
    release(PORTAL); await flush();
    expect(document.getElementById('vex-load-failure')).toBe(null);
  });
});

describe('signing in', () => {
  it('lets HTTPS-only leave the portal hosts alone first, then opens the sign-in page', async () => {
    install(); show();
    await press('Is this a Wi-Fi sign-in?');
    await press('Open the sign-in page');
    expect(window.vexConfirm.mock.calls[0][0].message).toContain('gateway.wifi.example');
    expect(window.vexConfirm.mock.calls[0][0].message).toMatch(/not encrypted/);
    expect(window.vex.captiveAllowHttp).toHaveBeenCalledWith(PORTAL.hosts);
    expect(TabManager.createTab).toHaveBeenCalledWith(PORTAL.loginUrl, true);
    expect(order).toEqual(['allow', 'createTab']);
  });

  it('does nothing at all when the person says not now', async () => {
    window.vexConfirm = vi.fn(async () => false);
    install(); show();
    await press('Is this a Wi-Fi sign-in?');
    await press('Open the sign-in page');
    expect(window.vex.captiveAllowHttp).not.toHaveBeenCalled();
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });

  it('refuses a result that has no hosts to allow, instead of opening a page HTTPS-only would break', async () => {
    install();
    await expect(VexCaptivePortal.signIn({ state: 'portal', loginUrl: 'http://x.example/', hosts: [] })).rejects.toThrow(/no sign-in page/);
    await expect(VexCaptivePortal.signIn({ state: 'open' })).rejects.toThrow(/no sign-in page/);
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });

  it('does not open the tab if main refused to allow the hosts', async () => {
    window.vex.captiveAllowHttp = vi.fn(async () => ({ ok: false }));
    install();
    await expect(VexCaptivePortal.signIn(PORTAL)).rejects.toThrow(/could not allow/);
    expect(TabManager.createTab).not.toHaveBeenCalled();
  });
});

describe('Ctrl+K', () => {
  it('a portal goes straight to the sign-in confirmation', async () => {
    install();
    const r = await VexCaptivePortal.runCommand();
    expect(r.state).toBe('portal');
    expect(window.vex.captiveAllowHttp).toHaveBeenCalled();
    expect(TabManager.createTab).toHaveBeenCalledWith(PORTAL.loginUrl, true);
  });
  it('an open network is only told so, with nothing changed', async () => {
    window.vex.captiveCheck = vi.fn(async () => ({ state: 'open', secureDns: 'off' }));
    install();
    await VexCaptivePortal.runCommand();
    expect(window.showToast).toHaveBeenLastCalledWith(expect.stringMatching(/not asking you to sign in/));
    expect(window.vex.captiveAllowHttp).not.toHaveBeenCalled();
    expect(window.vex.captivePauseSecureDns).not.toHaveBeenCalled();
  });
  it('strict secure DNS and no answer asks before pausing it', async () => {
    window.vex.captiveCheck = vi.fn(async () => ({ state: 'offline', secureDns: 'strict' }));
    install();
    await VexCaptivePortal.runCommand();
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(window.vex.captivePauseSecureDns).toHaveBeenCalledWith(10);
    window.vex.captivePauseSecureDns.mockClear();
    window.vexConfirm = vi.fn(async () => false);
    await VexCaptivePortal.runCommand();
    expect(window.vex.captivePauseSecureDns).not.toHaveBeenCalled();
  });
});
