// @vitest-environment jsdom
//
// The Unblock centre's window side (js/unblock-centre.js): when the bar appears (and that it never does in a private
// window), what Try / Not now / Never / Always do to the saved list, and what is sent to the main process.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const FILE = '../../src/renderer/js/unblock-centre.js';
let V, api, tab, nav, confirmAnswer;

function setup({ priv = false } = {}) {
  localStorage.clear();
  document.body.innerHTML = '<div id="webviews-container"></div>';
  tab = { id: 7, partition: 'persist:main', url: 'https://blocked.example.com/', _loadFailed: { code: -101, url: 'https://blocked.example.com/' } };
  nav = vi.fn();
  api = {
    assess: vi.fn(async () => ({ suggest: true, host: 'blocked.example.com', dns: false })),
    try: vi.fn(async () => ({ ok: true, host: 'blocked.example.com', method: 'light', preset: null, steps: [{ id: 'doh', label: 'Encrypted DNS', ok: false, error: 'no' }, { id: 'light', label: 'Encrypted DNS and a split handshake', ok: true }] })),
    sync: vi.fn(async (p) => ({ enabled: p.enabled, active: [], errors: {}, methods: [] })),
    status: vi.fn(async () => ({ enabled: true, methods: [], active: [], errors: {} })),
  };
  window.vex = { unblock: api };
  window.VexTabPolicy = { isPrivateWindow: priv };
  globalThis.TabManager = { tabs: [tab], activeTabId: 7, getActiveTab: () => tab, switchTab: vi.fn() };
  globalThis.WebviewManager = { navigate: nav };
  confirmAnswer = false;
  window.vexConfirm = vi.fn(async () => confirmAnswer);
  vi.resetModules();
  delete require.cache[require.resolve(FILE)];
  V = require(FILE).VexUnblock;
  V._inited = false;
  V._bars.clear();
  V._el = null;
  return V;
}
const button = (label) => [...document.querySelectorAll('#vex-unblock-bar button')].find(b => b.textContent === label);
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => setup());

describe('when the bar appears', () => {
  it('after a failed load that main says is worth offering, on that tab only', async () => {
    await V.onLoadFailed({ tabId: 7, code: -101, url: 'https://blocked.example.com/' });
    expect(api.assess).toHaveBeenCalledWith('https://blocked.example.com/', -101, 'persist:main');
    const bar = document.getElementById('vex-unblock-bar');
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain('This site may be blocked on your network. Try to open it with a bypass?');
    expect([...bar.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Try', 'Not now', 'Never for this site']);
  });
  it('not when main says no', async () => {
    api.assess.mockResolvedValue({ suggest: false, reason: 'recently' });
    await V.onLoadFailed({ tabId: 7, code: -101, url: 'https://blocked.example.com/' });
    expect(document.getElementById('vex-unblock-bar')).toBe(null);
  });
  it('never in a private window: nothing is asked and nothing is sent', async () => {
    setup({ priv: true });
    expect(await V.onLoadFailed({ tabId: 7, code: -101, url: 'https://blocked.example.com/' })).toBe(null);
    await V.sync();
    expect(api.assess).not.toHaveBeenCalled();
    expect(api.sync).not.toHaveBeenCalled();
    expect(document.getElementById('vex-unblock-bar')).toBe(null);
  });
  it('not for an address that is not https, or while the feature is off', async () => {
    await V.onLoadFailed({ tabId: 7, code: -101, url: 'http://blocked.example.com/' });
    V.setEnabled(false);
    await V.onLoadFailed({ tabId: 7, code: -101, url: 'https://blocked.example.com/' });
    expect(api.assess).not.toHaveBeenCalled();
  });
  it('not when the tab has already moved on from that failure', async () => {
    tab._loadFailed = null;
    await V.onLoadFailed({ tabId: 7, code: -101, url: 'https://blocked.example.com/' });
    expect(document.getElementById('vex-unblock-bar')).toBe(null);
  });
  it('the tab\'s own session is what main is told, so main can refuse a Tor or routed tab', async () => {
    tab.partition = 'tor-55';
    await V.onLoadFailed({ tabId: 7, code: -101, url: 'https://blocked.example.com/' });
    expect(api.assess).toHaveBeenCalledWith('https://blocked.example.com/', -101, 'tor-55');
  });
});

describe('the buttons', () => {
  beforeEach(async () => { await V.onLoadFailed({ tabId: 7, code: -101, url: 'https://blocked.example.com/' }); });

  it('Not now just closes the bar and writes nothing', async () => {
    button('Not now').click();
    await flush();
    expect(document.getElementById('vex-unblock-bar')).toBe(null);
    expect(V.sites()).toEqual([]);
    expect(api.try).not.toHaveBeenCalled();
  });
  it('Never remembers the site as never to be offered, and tells main', async () => {
    button('Never for this site').click();
    await flush();
    expect(V.site('blocked.example.com')).toMatchObject({ mode: 'never', method: null });
    expect(api.sync).toHaveBeenLastCalledWith({ enabled: true, sites: [{ host: 'blocked.example.com', mode: 'never', method: null, preset: null }] });
    expect(document.getElementById('vex-unblock-bar')).toBe(null);
  });
  it('Try remembers the way that worked as "once", reloads the page, and offers Always', async () => {
    button('Try').click();
    await flush(); await flush();
    expect(api.try).toHaveBeenCalledWith('blocked.example.com', {});
    expect(V.site('blocked.example.com')).toMatchObject({ mode: 'once', method: 'light' });
    expect(api.sync).toHaveBeenLastCalledWith({ enabled: true, sites: [{ host: 'blocked.example.com', mode: 'once', method: 'light', preset: null }] });
    expect(nav).toHaveBeenCalledWith('https://blocked.example.com/');
    const bar = document.getElementById('vex-unblock-bar');
    expect(bar.textContent).toContain('Encrypted DNS and a split handshake');
    button('Always for this site').click();
    await flush();
    expect(V.site('blocked.example.com').mode).toBe('always');
    expect(api.sync).toHaveBeenLastCalledWith({ enabled: true, sites: [{ host: 'blocked.example.com', mode: 'always', method: 'light', preset: null }] });
    expect(document.getElementById('vex-unblock-bar')).toBe(null);
  });
  it('Just this time keeps it as "once": it is not applied again after a restart', async () => {
    button('Try').click();
    await flush(); await flush();
    button('Just this time').click();
    expect(V.site('blocked.example.com').mode).toBe('once');
  });
  it('a page that opens without any help changes nothing in the list', async () => {
    api.try.mockResolvedValue({ ok: true, direct: true, host: 'blocked.example.com', steps: [] });
    button('Try').click();
    await flush(); await flush();
    expect(V.sites()).toEqual([]);
    expect(nav).toHaveBeenCalled();
  });
  it('when nothing opens the site it says what was tried and why, and offers the centre', async () => {
    api.try.mockResolvedValue({ ok: false, host: 'blocked.example.com', steps: [
      { id: 'doh', label: 'Encrypted DNS', ok: false, error: 'no answer in 7 s' },
      { id: 'admin', label: 'Zapret / WinDivert', skipped: 'admin' },
    ] });
    button('Try').click();
    await flush(); await flush();
    const text = document.getElementById('vex-unblock-bar').textContent;
    expect(text).toContain('Encrypted DNS: no answer in 7 s');
    expect(text).toContain('needs administrator rights, so Vex does not run it');
    expect(button('Open the Unblock centre')).toBeTruthy();
    expect(V.sites()).toEqual([]);
    expect(nav).not.toHaveBeenCalled();
  });
  it('the ByeDPI download is only done after a yes, and a no ends it', async () => {
    api.try.mockResolvedValueOnce({ ok: false, needsDownload: true, host: 'blocked.example.com', steps: [{ id: 'byedpi', label: 'ByeDPI helper', skipped: 'download', error: 'not here' }] });
    button('Try').click();
    await flush(); await flush();
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(api.try).toHaveBeenCalledTimes(1);
    expect(document.getElementById('vex-unblock-bar').textContent).toContain('not tried, the helper is not downloaded');
  });
  it('a yes tries again with the download allowed', async () => {
    confirmAnswer = true;
    api.try.mockResolvedValueOnce({ ok: false, needsDownload: true, host: 'blocked.example.com', steps: [] });
    button('Try').click();
    await flush(); await flush(); await flush();
    expect(api.try).toHaveBeenNthCalledWith(2, 'blocked.example.com', { allowDownload: true });
    expect(V.site('blocked.example.com').method).toBe('light');
  });
  it('an error from main is shown on the bar, not swallowed', async () => {
    api.try.mockRejectedValue(new Error('The helper could not start'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    button('Try').click();
    await flush(); await flush();
    expect(document.getElementById('vex-unblock-bar').textContent).toContain('The helper could not start');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('the list and the switch', () => {
  it('Forget removes the site and tells main', async () => {
    V.put('a.example.com', { mode: 'always', method: 'doh' });
    V.put('b.example.com', { mode: 'once', method: 'light' });
    await V.forget('a.example.com');
    expect(V.sites().map(s => s.host)).toEqual(['b.example.com']);
    expect(api.sync).toHaveBeenLastCalledWith({ enabled: true, sites: [{ host: 'b.example.com', mode: 'once', method: 'light', preset: null }] });
  });
  it('the global Off is sent to main and closes a bar that is showing', async () => {
    await V.onLoadFailed({ tabId: 7, code: -101, url: 'https://blocked.example.com/' });
    V.setEnabled(false);
    await flush();
    expect(V.enabled()).toBe(false);
    expect(api.sync).toHaveBeenLastCalledWith({ enabled: false, sites: [] });
    expect(document.getElementById('vex-unblock-bar')).toBe(null);
    V.setEnabled(true);
    expect(V.enabled()).toBe(true);
  });
  it('a damaged list is reported and read as empty, not allowed to break the window', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('vex.unblock.sites', '{not json');
    expect(V.sites()).toEqual([]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it('keeps up to 200 sites and says so beyond that', () => {
    expect(() => V._save(new Array(201).fill({ host: 'a.example.com', mode: 'ask' }))).toThrow(/200/);
  });
  it('is handed to main at start so an "always" site is on again after a restart', async () => {
    V.put('a.example.com', { mode: 'always', method: 'doh' });
    V.init();
    await flush();
    expect(api.sync).toHaveBeenCalledWith({ enabled: true, sites: [{ host: 'a.example.com', mode: 'always', method: 'doh', preset: null }] });
  });
  it('the centre lists the ways, marks the administrator one, and each site has a switch, Test now and Forget', async () => {
    api.status.mockResolvedValue({ enabled: true, active: [{ host: 'a.example.com', method: 'doh' }], errors: { 'b.example.com': 'The ByeDPI helper is not on this computer' }, methods: [
      { id: 'doh', label: 'Encrypted DNS', adminOnly: false, note: 'n' }, { id: 'admin', label: 'Zapret / WinDivert', adminOnly: true, note: 'x' }] });
    globalThis.VexSettingsGroups = { button: (text, fn) => { const b = document.createElement('button'); b.textContent = text; b.addEventListener('click', fn); return b; } };
    V.put('a.example.com', { mode: 'always', method: 'doh' });
    V.put('b.example.com', { mode: 'always', method: 'byedpi' });
    const body = document.createElement('div');
    document.body.appendChild(body);
    await V.renderCentre(body);
    expect(body.querySelectorAll('.unblock-way')).toHaveLength(2);
    expect(body.querySelector('.unblock-way-admin').textContent).toContain('Needs administrator rights, so Vex never starts it');
    expect(body.querySelectorAll('.unblock-site')).toHaveLength(2);
    expect(body.textContent).toContain('The ByeDPI helper is not on this computer');
    const buttons = [...body.querySelectorAll('.unblock-site')[0].querySelectorAll('button')].map(b => b.textContent);
    expect(buttons).toEqual(['Test now', 'Forget']);
    expect(body.querySelectorAll('.unblock-site input[type=checkbox]')).toHaveLength(2);
    delete globalThis.VexSettingsGroups;
  });
  it('Test now asks main to try the recorded way first, and records a different one if that is what works', async () => {
    V.put('a.example.com', { mode: 'always', method: 'doh' });
    api.try.mockResolvedValue({ ok: true, method: 'byedpi', preset: 2, steps: [] });
    const r = await V.testSite('a.example.com');
    expect(api.try).toHaveBeenCalledWith('a.example.com', { prefer: 'doh', keep: true });
    expect(r.method).toBe('byedpi');
    expect(V.site('a.example.com')).toMatchObject({ method: 'byedpi', preset: 2, mode: 'always' });
  });
  it('Test now on a switched-off site does not switch it on', async () => {
    V.put('a.example.com', { mode: 'ask', method: 'doh' });
    await V.testSite('a.example.com');
    expect(api.try).toHaveBeenCalledWith('a.example.com', { prefer: 'doh', keep: false });
  });
});

describe('the file itself', () => {
  it('has no emoji and no native confirm or prompt', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, FILE), 'utf8');
    expect(/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(src)).toBe(false);
    expect(src).not.toMatch(/\bconfirm\(|\bprompt\(|\balert\(/);
  });
});
