// @vitest-environment jsdom
//
// "Why isn't this playing?" (js/drm-help.js, with src/main/drm-health.js): which pages count as streaming sites, which console
// lines count as a protected-playback error, the note on the tab, the screen with its honest repairs (a fake window.vex stands
// in for the main process), and the plumbing: IPC schemas, policy, preload, the late-module list, Turkish for every sentence.
// What the screen looks like and a real Netflix/Spotify page are checked in the real app, not here.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
globalThis.VexI18nUI = VexI18nUI;
require('../../src/renderer/js/drm-help-tr.js');   // the Turkish joins the table as the file loads
require('../../src/renderer/js/faq-tr.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
const { VexLayer } = require('../../src/renderer/js/vex-layer.js');
const { VexSettingsGroups } = require('../../src/renderer/js/vex-settings-groups.js');
const { VexDrmHelp } = require('../../src/renderer/js/drm-help.js');
const { diagnose, TEMPLATES, BUILDER_STEPS } = require('../../src/main/drm-health.js');
const tr = VexI18nUI.TABLE.tr;

describe('which pages are streaming sites', () => {
  it('knows the services by host, subdomains included, https only', () => {
    expect(VexDrmHelp.siteOf('https://www.netflix.com/watch/1').name).toBe('Netflix');
    expect(VexDrmHelp.siteOf('https://open.spotify.com/track/x')).toEqual({ name: 'Spotify', host: 'open.spotify.com' });
    expect(VexDrmHelp.siteOf('https://www.primevideo.com/').name).toBe('Prime Video');
    expect(VexDrmHelp.siteOf('https://www.disneyplus.com/').name).toBe('Disney+');
    expect(VexDrmHelp.siteOf('https://play.max.com/').name).toBe('Max');
    expect(VexDrmHelp.siteOf('https://tv.apple.com/').name).toBe('Apple TV');
    expect(VexDrmHelp.siteOf('https://listen.tidal.com/').name).toBe('Tidal');
  });
  it('knows Amazon only on its video pages', () => {
    expect(VexDrmHelp.siteOf('https://www.amazon.com/gp/video/detail/B0').name).toBe('Prime Video');
    expect(VexDrmHelp.siteOf('https://www.amazon.de/Prime-Video/b?x=1').name).toBe('Prime Video');
    expect(VexDrmHelp.siteOf('https://www.amazon.com/dp/B0123')).toBeNull();
  });
  it('is null for anything else, including look-alikes and non-https pages', () => {
    for (const u of ['https://example.com/', 'https://netflix.com.evil.example/', 'https://notnetflix.com/', 'http://www.netflix.com/', 'file:///C:/netflix.com', '', null, 'not a url']) {
      expect(VexDrmHelp.siteOf(u), String(u)).toBeNull();
    }
  });
});

describe('which console lines are a protected-playback error', () => {
  it('counts the EME/Widevine phrases from a warning up', () => {
    expect(VexDrmHelp.looksLikeDrmError('Failed to execute requestMediaKeySystemAccess on Navigator', 2)).toBe(true);
    expect(VexDrmHelp.looksLikeDrmError('Widevine CDM not found', 3)).toBe(true);
    expect(VexDrmHelp.looksLikeDrmError('No supported key system', 2)).toBe(true);
  });
  it('counts a general word only as an error, and never an info line', () => {
    expect(VexDrmHelp.looksLikeDrmError('DRM failed', 3)).toBe(true);
    expect(VexDrmHelp.looksLikeDrmError('license request failed', 3)).toBe(true);
    expect(VexDrmHelp.looksLikeDrmError('DRM failed', 2)).toBe(false);
    expect(VexDrmHelp.looksLikeDrmError('Widevine ready', 1)).toBe(false);
    expect(VexDrmHelp.looksLikeDrmError('', 3)).toBe(false);
    expect(VexDrmHelp.looksLikeDrmError('VEX_CMD:{"widevine":1}', 3)).toBe(false);
    expect(VexDrmHelp.looksLikeDrmError('Uncaught TypeError: x is not a function', 3)).toBe(false);
  });
});

describe('the note on a tab', () => {
  let ask;
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    VexDrmHelp._reports.clear(); VexDrmHelp._offered.clear(); VexDrmHelp._peeked = null; VexDrmHelp._lastUrl = undefined;
    globalThis.VexLayer = VexLayer; globalThis.VexIcons = VexIcons; globalThis.VexSettingsGroups = VexSettingsGroups;
    globalThis.TabManager = { activeTabId: 't1', tabs: [] };
    ask = vi.fn(async () => diagnose({ packaged: true, electron: '42.0.0+wvcus', castlabsBuild: true, api: true, updatesEnabled: true, widevine: { status: 'up-to-date', version: '4.1' }, sig: { checked: true, name: 'Vex.exe.sig', exists: true }, init: { state: 'ready' }, readErrors: [] }));
    window.vex = { drmStatus: ask, drmRepair: vi.fn(), drmClearSite: vi.fn() };
    window.showToast = vi.fn();
  });

  it('offers the screen once, on a streaming tab whose page reports a playback error', () => {
    const tab = { id: 't1', url: 'https://www.netflix.com/watch/1' };
    VexDrmHelp.note(tab, { message: 'requestMediaKeySystemAccess failed', level: 2 });
    const banner = document.getElementById('vex-drm-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Netflix reported a playback problem.');
    expect(banner.querySelector('button.btn-primary').textContent).toBe('Why isn\'t this playing?');
    VexDrmHelp.note(tab, { message: 'requestMediaKeySystemAccess failed again', level: 2 });
    expect(document.querySelectorAll('#vex-drm-banner').length).toBe(1);
    expect(VexDrmHelp._reports.get('t1')).toEqual({ host: 'www.netflix.com', message: 'requestMediaKeySystemAccess failed again' });
  });

  it('stays quiet on other sites, on quiet console lines of a healthy setup, and when switched off', async () => {
    VexDrmHelp.note({ id: 't1', url: 'https://example.com/' }, { message: 'Widevine error', level: 3 });
    VexDrmHelp.note({ id: 't1', url: 'https://www.netflix.com/' }, { message: 'player ready', level: 1 });
    await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById('vex-drm-banner')).toBeNull();
    VexDrmHelp.setEnabled(false);
    VexDrmHelp.note({ id: 't1', url: 'https://www.netflix.com/' }, { message: 'Widevine error', level: 3 });
    expect(document.getElementById('vex-drm-banner')).toBeNull();
    expect(localStorage.getItem('vex.drmHelp.offer')).toBe('off');
  });

  it('offers it on a streaming tab when Vex already knows protected playback is broken', async () => {
    ask.mockResolvedValue(diagnose({ packaged: true, electron: '42.0.0+wvcus', castlabsBuild: true, api: true, updatesEnabled: true, widevine: { status: 'new', version: null }, sig: { checked: true, name: 'Vex.exe.sig', exists: false }, init: { state: 'ready' }, readErrors: [] }));
    VexDrmHelp.note({ id: 't1', url: 'https://open.spotify.com/' }, { message: 'hello', level: 1 });
    await vi.waitFor(() => expect(document.getElementById('vex-drm-banner')).toBeTruthy());
    expect(document.getElementById('vex-drm-banner').textContent).toContain('Spotify may not start');
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('does not put a note on a tab that is not in front', () => {
    globalThis.TabManager.activeTabId = 'other';
    VexDrmHelp.note({ id: 't1', url: 'https://www.netflix.com/' }, { message: 'Widevine error', level: 3 });
    expect(document.getElementById('vex-drm-banner')).toBeNull();
  });
});

describe('the screen', () => {
  let vex;
  const status = (over) => diagnose({ packaged: true, electron: '42.0.0+wvcus', castlabsBuild: true, api: true, updatesEnabled: true, widevine: { status: 'new', version: null }, sig: { checked: true, name: 'Vex.exe.sig', exists: true }, init: { state: 'failed', message: 'timed out' }, readErrors: [], cdmDirs: { exists: true, versions: [] }, ...over });
  const click = async (label) => {
    const b = [...document.querySelectorAll('#vex-drm-help button')].find(x => x.textContent === label);
    if (!b) throw new Error('no button "' + label + '": ' + [...document.querySelectorAll('#vex-drm-help button')].map(x => x.textContent).join(' | '));
    b.click();
    await new Promise(r => setTimeout(r, 0));
  };
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    VexDrmHelp._reports.clear();
    Object.assign(globalThis, { VexLayer, VexIcons, VexSettingsGroups });
    globalThis.TabManager = { activeTabId: 't1', tabs: [{ id: 't1', url: 'https://www.netflix.com/watch/1' }] };
    const wv = { getWebContentsId: () => 77, reload: vi.fn() };
    globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
    window.vexConfirm = vi.fn(async () => true);
    window.showToast = vi.fn();
    vex = { drmStatus: vi.fn(async () => status()), drmRepair: vi.fn(async () => status()), drmClearSite: vi.fn(async () => ({ ok: true })), widevineRetry: vi.fn(async () => ({ ok: true })) };
    window.vex = vex;
    VexDrmHelp._wv = wv;
  });

  it('shows the answer, every reason, the owner part with the exact steps, and the technical details', async () => {
    await VexDrmHelp.open();
    const el = document.getElementById('vex-drm-help');
    expect(el.querySelector('.drm-state').textContent).toBe('Not working');
    expect(el.querySelectorAll('.drm-reason').length).toBeGreaterThanOrEqual(3);
    expect(el.querySelector('.drm-owner-title').textContent).toBe('If the repairs above do not help');
    expect(el.querySelectorAll('.drm-steps li').length).toBe(BUILDER_STEPS.length);
    expect(el.querySelector('.drm-facts-pre').textContent).toContain('"widevine"');
    expect(el.textContent).not.toMatch(/\{0\}|\{1\}/);
  });

  it('Check now asks main again and says honestly that it is still not fixed', async () => {
    await VexDrmHelp.open();
    await click('Check now');
    expect(vex.drmRepair).toHaveBeenCalledWith('recheck', undefined);
    expect(document.querySelector('#vex-drm-help .drm-notice').textContent).toBe('Checked again: it is still not fixed. What is left is listed above.');
  });

  it('says it works only when the fresh answer is ok', async () => {
    vex.drmRepair.mockResolvedValue(diagnose({ packaged: true, electron: '42.0.0+wvcus', castlabsBuild: true, api: true, updatesEnabled: true, widevine: { status: 'up-to-date', version: '4.1' }, sig: { checked: true, name: 'Vex.exe.sig', exists: true }, init: { state: 'ready' }, readErrors: [] }));
    await VexDrmHelp.open();
    await click('Check now');
    expect(document.querySelector('#vex-drm-help .drm-state').textContent).toBe('Working');
    expect(document.querySelector('#vex-drm-help .drm-notice').textContent).toMatch(/Vex cannot promise the site will accept it/);
  });

  it('shows a failed repair\'s error on the screen and in a toast, and never says it worked', async () => {
    vex.drmRepair.mockRejectedValue(new Error('Electron did not accept switching component updates on'));
    vex.drmStatus.mockResolvedValue(status({ updatesEnabled: false }));
    await VexDrmHelp.open();
    await click('Turn component updates on');
    const notice = document.querySelector('#vex-drm-help .drm-notice');
    expect(notice.textContent).toBe('Electron did not accept switching component updates on');
    expect(notice.classList.contains('drm-notice-bad')).toBe(true);
    expect(window.showToast).toHaveBeenCalledWith('Electron did not accept switching component updates on', 'error');
  });

  it('re-downloading the module asks first, and does nothing when declined', async () => {
    await VexDrmHelp.open();
    window.vexConfirm.mockResolvedValueOnce(false);
    await click('Re-download the Widevine module (restarts Vex)');
    expect(vex.widevineRetry).not.toHaveBeenCalled();
    await click('Re-download the Widevine module (restarts Vex)');
    expect(vex.widevineRetry).toHaveBeenCalledTimes(1);
  });

  it('clearing a site needs the page in front, asks first, clears that page\'s id and reloads it', async () => {
    VexDrmHelp._reports.set('t1', { host: 'www.netflix.com', message: 'requestMediaKeySystemAccess failed' });
    const healthy = { packaged: true, electron: '42.0.0+wvcus', castlabsBuild: true, api: true, updatesEnabled: true, widevine: { status: 'up-to-date', version: '4.1' }, sig: { checked: true, name: 'Vex.exe.sig', exists: true }, init: { state: 'ready' }, readErrors: [] };
    vex.drmStatus.mockImplementation(async (reported) => diagnose({ ...healthy, reported }));
    vex.drmRepair.mockImplementation(async (id, reported) => diagnose({ ...healthy, reported }));
    await VexDrmHelp.open();
    expect(vex.drmStatus).toHaveBeenCalledWith({ host: 'www.netflix.com', message: 'requestMediaKeySystemAccess failed' });
    await click('Clear Netflix\'s saved player data and reload');
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(vex.drmClearSite).toHaveBeenCalledWith(77);
    expect(VexDrmHelp._wv.reload).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#vex-drm-help .drm-notice').textContent).toBe('Cleared and reloaded the page. Try playing again.');
  });

  it('leaves the site-clearing button out when no streaming page is in front', async () => {
    globalThis.TabManager.tabs = [{ id: 't1', url: 'https://example.com/' }];
    vex.drmStatus.mockResolvedValue(diagnose({ packaged: true, electron: '42.0.0+wvcus', castlabsBuild: true, api: true, updatesEnabled: true, widevine: { status: 'up-to-date', version: '4.1' }, sig: { checked: true, name: 'Vex.exe.sig', exists: true }, init: { state: 'ready' }, readErrors: [], reported: { host: 'example.com', message: 'DRM' } }));
    await VexDrmHelp.open();
    expect([...document.querySelectorAll('#vex-drm-help button')].some(b => /saved player data/.test(b.textContent))).toBe(false);
  });

  it('throws plainly when the main process does not offer the checks', async () => {
    window.vex = {};
    await expect(VexDrmHelp.open()).rejects.toThrow(/not available in this window/);
  });

  it('writes the same sentences in Turkish once the language is Turkish', async () => {
    localStorage.setItem('vex.lang', 'tr');
    await VexDrmHelp.open();
    const el = document.getElementById('vex-drm-help');
    expect(el.querySelector('.drm-state').textContent).toBe('Çalışmıyor');
    expect(el.querySelector('.drm-headline').textContent).toBe(tr[TEMPLATES['headline-broken']]);
    expect(el.textContent).not.toMatch(/\{0\}/);
    localStorage.clear();
  });
});

describe('the Settings section and the command', () => {
  it('registers both, with the exact names the catalogue and the FAQ use', () => {
    const src = read('src/renderer/js/drm-help.js');
    expect(src).toContain("VexSettingsGroups.register({ id: 'drm-help', title: 'Video and music playback (DRM)'");
    expect(src).toContain("VexExtras.registerCommand({ id: 'drm-help', label: 'Why isn\\'t this playing?'");
    const group = document.createElement('div');
    globalThis.VexSettingsGroups = VexSettingsGroups;
    window.vex = { drmStatus: vi.fn(async () => diagnose({ packaged: true, electron: '1+wvcus', castlabsBuild: true, api: true, widevine: { version: '4.1' }, sig: { checked: true, name: 'a', exists: true }, init: { state: 'ready' }, readErrors: [] })) };
    VexDrmHelp.group(group);
    expect([...group.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Check now', 'Explain and repair']);
    expect(group.querySelector('input[type=checkbox]').checked).toBe(true);
  });
});

describe('the plumbing', () => {
  const src = read('src/renderer/js/drm-help.js');
  it('has Turkish for every sentence the screen can show', () => {
    const used = [...src.matchAll(/(?:\bL|this\._L)\('((?:[^'\\]|\\.)*)'\)/g)].map(m => m[1].replace(/\\'/g, '\''));
    const templated = [...src.matchAll(/this\._T\('((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, '\''));
    expect(used.length).toBeGreaterThan(20);
    for (const s of [...used, ...templated, ...Object.values(TEMPLATES), ...BUILDER_STEPS, 'Working', 'Needs attention', 'Not working']) {
      expect(tr[s], 'Turkish for: ' + s.slice(0, 80)).toBeTruthy();
      expect(tr[s]).not.toBe(s);
    }
    // a hole in the English must still be in the Turkish, or a version number or site name would vanish
    for (const s of [...Object.values(TEMPLATES), ...templated]) for (const hole of s.match(/\{\d\}/g) || []) expect(tr[s], s.slice(0, 60)).toContain(hole);
  });
  it('is wired: late module, console hook, preload, schemas, policy, handlers, one stylesheet', () => {
    expect(read('src/renderer/js/lazy-boot.js')).toContain("{ src: 'js/drm-help.js', usage: [] }");
    expect(read('src/renderer/js/webview.js')).toContain("if (typeof VexDrmHelp !== 'undefined') VexDrmHelp.note(tab, e);");
    expect(read('src/renderer/index.html')).toContain('css/drm-help.css');
    expect(read('src/renderer/index.html')).not.toContain('js/drm-help.js');
    const preload = read('src/preload.js');
    for (const ch of ['drm:status', 'drm:repair', 'drm:clear-site']) {
      expect(preload).toContain("'" + ch + "'");
      expect(read('src/main/ipc-schemas.js')).toContain("define('" + ch + "'");
      expect(read('src/main/ipc-policy.js')).toContain("'" + ch + "'");
      expect(read('src/main.js')).toContain("ipcMain.handle('" + ch + "'");
    }
    expect(read('src/main/ipc-policy.js')).toMatch(/TARGET_CHANNELS = new Set\(\['vex:set-bg-throttling', 'drm:clear-site'/);
  });
  it('uses no emoji and VexLayer for the note', () => {
    expect(/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(src)).toBe(false);
    expect(src).toContain('VexLayer.open(el');
    expect(src).not.toMatch(/\bconfirm\(|\bprompt\(/);
  });
});
