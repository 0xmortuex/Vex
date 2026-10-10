// @vitest-environment jsdom
//
// Privacy and security fixes from the 2026-09-29 sweep, one describe per bug:
// the lock that could be walked round, a private window wiping per-site rules,
// backups that left data out, history that survived Clear History, burner and
// container routing that claimed what they had not done, and the smaller ones.

import { describe, it, expect, beforeEach, vi } from 'vitest';

require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = window.VexIcons;

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.escapeHtml = (s) => String(s == null ? '' : s);
  window.VexTabPolicy = undefined;
  window.vex = {};
});

describe('Lock Vex cannot be walked round', () => {
  const { VexLock: L } = require('../../src/renderer/js/vex-lock.js');
  beforeEach(() => { L.unlock(); L._waitUntil = 0; });

  it('makes everything but the PIN screen inert, including what opens later, and undoes it', async () => {
    await L.setPin('4821');
    document.body.innerHTML = '<button id="behind">Settings</button><div id="already" inert></div>';
    window.vex = { setLockState: vi.fn() };
    L.lock();
    expect(document.getElementById('behind').hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.vex-lock-screen').hasAttribute('inert')).toBe(false);
    expect(window.vex.setLockState).toHaveBeenCalledWith(true);
    const panel = document.createElement('div');
    document.body.appendChild(panel);           // e.g. History opened by a shortcut
    await tick();
    expect(panel.hasAttribute('inert')).toBe(true);
    L.unlock();
    expect(document.getElementById('behind').hasAttribute('inert')).toBe(false);
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('already').hasAttribute('inert')).toBe(true);   // was not ours to undo
    expect(window.vex.setLockState).toHaveBeenLastCalledWith(false);
  });

  it('remembers being locked, so a restart starts locked', async () => {
    await L.setPin('4821');
    L.lock();
    expect(localStorage.getItem(L.LOCKED_KEY)).toBe('1');
    // A restart: the in-memory state is gone, the stored flag is not.
    L._locked = false; document.body.innerHTML = '';
    window.VexJobs = { every: vi.fn() };
    globalThis.VexJobs = window.VexJobs;
    L.init();
    expect(L.locked()).toBe(true);
    expect(document.querySelector('.vex-lock-screen')).not.toBeNull();
    L.unlock();
    expect(localStorage.getItem(L.LOCKED_KEY)).toBe(null);
  });

  it('drops a stored lock when there is no PIN to open it with', () => {
    localStorage.setItem(L.LOCKED_KEY, '1');
    globalThis.VexJobs = { every: vi.fn() };
    L.init();
    expect(L.locked()).toBe(false);
    expect(localStorage.getItem(L.LOCKED_KEY)).toBe(null);
  });
});

describe('a private window does not wipe the per-site rules', () => {
  const { SiteRulesUI } = require('../../src/renderer/js/site-rules-ui.js');
  it('pushes the stored rules at startup only from a normal window', async () => {
    document.body.innerHTML = '<button id="btn-site-rules" hidden></button>';
    window.vex = { siteRulesSet: vi.fn(async (r) => ({ ok: true, rules: r })) };
    window.VexTabPolicy = { isPrivateWindow: true };
    SiteRulesUI.init();
    expect(window.vex.siteRulesSet).not.toHaveBeenCalled();
    window.VexTabPolicy = { isPrivateWindow: false };
    SiteRulesUI.init();
    expect(window.vex.siteRulesSet).toHaveBeenCalledTimes(1);
  });
});

describe('a backup carries what the screen says it does', () => {
  const { VexBackup } = require('../../src/renderer/js/backup.js');
  beforeEach(() => { VexBackup._undo = null; VexBackup._undoStores = null; });

  it('includes the file-store notes, reading list and annotations', () => {
    const fileOnly = new Map([['vex.notes', '[{"t":"n"}]'], ['vex.readLater', '[1]'], ['vex.annotations', '{}']]);
    globalThis.PersistentStorage = { fileOnlyEntries: () => [...fileOnly.entries()] };
    const getItem = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (k) { return fileOnly.has(k) ? fileOnly.get(k) : getItem.call(this, k); });
    localStorage.setItem('vex.theme', 'oxford');
    const items = VexBackup.collect().items;
    expect(Object.keys(items).sort()).toEqual(['vex.annotations', 'vex.notes', 'vex.readLater', 'vex.theme']);
    spy.mockRestore();
    delete globalThis.PersistentStorage;
  });

  it('includes the settings file (ad blocker, sleep) and puts it back, undoably', async () => {
    const files = { settings: { adBlocker: false, memCeilingMB: 900 } };
    globalThis.VexStorage = {
      load: vi.fn(async (k) => (k in files ? structuredClone(files[k]) : null)),
      save: vi.fn(async (k, v) => { files[k] = structuredClone(v); return true; }),
    };
    const stores = await VexBackup.collectStores();
    expect(stores).toEqual({ settings: { adBlocker: false, memCeilingMB: 900 } });
    const data = { v: 1, items: {}, stores };
    expect(VexBackup.describe(data).count).toBe(1);
    files.settings = { adBlocker: true };
    expect(await VexBackup.applyStores(data)).toBe(1);
    expect(files.settings).toEqual({ adBlocker: false, memCeilingMB: 900 });
    await VexBackup.undoStores();
    expect(files.settings).toEqual({ adBlocker: true });
    delete globalThis.VexStorage;
  });
});

describe('Clear History clears every copy', () => {
  const MODULE = '../../src/renderer/js/history-panel.js';
  const load = () => { vi.resetModules(); delete require.cache[require.resolve(MODULE)]; return require(MODULE).HistoryPanel; };

  // History is one list now (main/history-fold.js): the list and Recall.
  it('Delete site forgets it in the history list and in Recall', async () => {
    const H = load();
    localStorage.setItem('vex.history', JSON.stringify([{ id: 'a', url: 'https://bad.example/x', visitedAt: new Date().toISOString() }, { id: 'b', url: 'https://ok.example/', visitedAt: new Date().toISOString() }]));
    globalThis.VexStorage = { save: vi.fn(async () => true) };
    window.vex = { recallForget: vi.fn(async () => ({ ok: true, removed: 3 })) };
    H.renderList = () => {};
    await H.deleteSite('bad.example');
    expect(JSON.parse(localStorage.getItem('vex.history')).map(e => e.url)).toEqual(['https://ok.example/']);
    expect(globalThis.VexStorage.save).not.toHaveBeenCalled();
    expect(window.vex.recallForget).toHaveBeenCalledWith({ host: 'bad.example' });
    expect(window.showToast).toHaveBeenLastCalledWith('Removed 1 from bad.example');
    delete globalThis.VexStorage;
  });

  it('says so when Recall could not forget', async () => {
    const H = load();
    globalThis.VexStorage = { save: vi.fn(async () => true) };
    window.vex = { recallClear: vi.fn(async () => ({ ok: false, error: 'disk full' })) };
    await expect(H._forgetElsewhere(null)).rejects.toThrow('disk full');
    expect(globalThis.VexStorage.save).not.toHaveBeenCalled();
    delete globalThis.VexStorage;
  });
});

describe('burner identity with Tor does not open without Tor', () => {
  require('../../src/renderer/js/burner-identity.js');
  it('stops and says so when Tor fails', async () => {
    globalThis.TabManager = { createTab: vi.fn() };
    window.vex = { routingSet: vi.fn(async () => ({ ok: false, error: 'no network' })) };
    window.BurnerIdentity.open();
    document.getElementById('bi-tor').checked = true;
    document.getElementById('bi-go').click();
    await tick();
    expect(globalThis.TabManager.createTab).not.toHaveBeenCalled();
    expect(document.getElementById('bi-msg').textContent).toMatch(/Tor could not start \(no network\) — nothing was opened/);
    delete globalThis.TabManager;
  });
});

describe('container routing checks a proxy address', () => {
  require('../../src/renderer/js/container-routing.js');
  it('refuses "hello" instead of reporting success', async () => {
    globalThis.TabManager = { getActiveTab: () => ({ partition: 'persist:container-a' }) };
    window.vex = { routingGet: vi.fn(async () => ({ mode: 'direct' })), routingSet: vi.fn(async () => ({ ok: true })) };
    await window.ContainerRouting.open();
    document.getElementById('rt-proxy').value = 'hello';
    document.getElementById('rt-proxy-go').click();
    await tick();
    expect(window.vex.routingSet).not.toHaveBeenCalled();
    expect(document.getElementById('rt-msg').textContent).toMatch(/looks like socks5:\/\//);
    document.getElementById('rt-proxy').value = 'socks5://127.0.0.1:1080';
    globalThis.WebviewManager = { getActiveWebview: () => null };
    document.getElementById('rt-proxy-go').click();
    await tick();
    expect(window.vex.routingSet).toHaveBeenCalledWith('persist:container-a', 'proxy', 'socks5://127.0.0.1:1080');
    expect(document.getElementById('rt-msg').innerHTML).not.toContain('✓');
    delete globalThis.TabManager; delete globalThis.WebviewManager;
  });
});

describe('a privacy toggle main refused is not reported as done', () => {
  const { PrivacyPack } = require('../../src/renderer/js/privacy-pack.js');
  it('puts the switch back and says why', async () => {
    PrivacyPack.cfg = { farble: false, doh: 'off', dohProvider: 'cloudflare', httpsOnly: false };
    window.vex = { privacySetConfig: vi.fn(async () => { throw new Error("Error invoking remote method 'privacy:set-config': Error: This operation is unavailable in a private window"); }) };
    const el = document.createElement('div');
    PrivacyPack.renderSettings(el);
    const https = el.querySelector('#priv-https-only');
    https.checked = true;
    https.dispatchEvent(new window.Event('change'));
    await tick();
    expect(https.checked).toBe(false);
    expect(PrivacyPack.cfg.httpsOnly).toBe(false);
    expect(window.showToast).toHaveBeenCalledWith('Not changed: This operation is unavailable in a private window', 'error');
    expect(window.showToast).not.toHaveBeenCalledWith('HTTPS-Only mode on');
  });
});

describe('the autofill log counts only real fills', () => {
  const { PasswordVault } = require('../../src/renderer/js/passwords.js');
  it('records a password fill only when the page says a field was filled', async () => {
    window.AutofillLog = { record: vi.fn() };
    window.vex = { vaultGet: vi.fn(async () => [{ username: 'me', password: 'pw' }]) };
    const wv = (filled) => ({ _navigationGeneration: 1, getURL: () => 'https://site.example/a', executeJavaScript: vi.fn(async () => filled) });
    await PasswordVault.autofill(wv(0), 'https://site.example/a');
    await tick();
    expect(window.AutofillLog.record).not.toHaveBeenCalled();
    await PasswordVault.autofill(wv(2), 'https://site.example/a');
    await tick();
    expect(window.AutofillLog.record).toHaveBeenCalledWith('password', 'https://site.example/a', true, 'me');
  });
});

describe('Escape in a prompt over Site Data closes only the prompt', () => {
  const { SiteData } = require('../../src/renderer/js/site-data.js');
  it('leaves Site Data open while a vex dialog is up', async () => {
    const wv = { getURL: () => 'https://site.example/' };
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://site.example/', partition: 'persist:main' }), activeTabId: 1 };
    globalThis.WebviewManager = { webviews: new Map([[1, wv]]) };
    window.vex = { cookiesList: vi.fn(async () => ({ ok: true, cookies: [] })) };
    await SiteData.open();
    const dlg = document.createElement('div'); dlg.className = 'vex-dialog-overlay'; document.body.appendChild(dlg);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vex-sitedata-overlay')).not.toBeNull();
    dlg.remove();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.vex-sitedata-overlay')).toBeNull();
    delete globalThis.TabManager; delete globalThis.WebviewManager;
  });
});

describe('Password Health says when the vault cannot be read', () => {
  const { PasswordHealth } = require('../../src/renderer/js/password-health.js');
  it('shows the error, not "0 passwords"', async () => {
    window.vex = { vaultHealth: vi.fn(async () => ({ total: 0, reused: [], weak: [], error: 'Cannot read encrypted vault' })), vaultList: vi.fn(async () => []), totpList: vi.fn(async () => []) };
    await PasswordHealth.open();
    await tick();
    const body = document.getElementById('pwh-body').textContent;
    expect(body).toMatch(/could not be checked: Cannot read encrypted vault/);
    expect(body).not.toMatch(/0 saved passwords/);
  });
});

describe('Form Fill fills a textarea and counts only what went in', () => {
  require('../../src/renderer/js/form-fill.js');
  it('uses the textarea setter', async () => {
    let js = '';
    const wv = { executeJavaScript: vi.fn(async (code) => { js = code; return 0; }) };
    globalThis.WebviewManager = { getActiveWebview: () => wv };
    document.body.innerHTML = '<textarea name="street address"></textarea><input name="city">';
    // jsdom has no layout: every element counts as visible for this check.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 });
    window.FormFill.fill({ address: '1 Road', city: 'Town' });
    await tick();
    const n = window.eval(js);
    expect(document.querySelector('textarea').value).toBe('1 Road');
    expect(n).toBe(2);
    rect.mockRestore();
    delete globalThis.WebviewManager;
  });
});

describe('the authenticator says what is wrong with a key', () => {
  require('../../src/renderer/js/authenticator.js');
  const A = () => window.Authenticator;
  it('names the characters a setup key cannot have', () => {
    expect(A()._addError('JBSW Y3DP 0H1K', "Error invoking remote method 'totp:add': Error: Invalid authenticator parameters"))
      .toMatch(/only the letters A–Z and the digits 2–7\. This one also has: 0 1/);
    expect(A()._addError('otpauth://totp/x?secret=JBSWY3DP&digits=12', 'Invalid authenticator parameters')).toMatch(/code length must be 4–8 digits/);
    expect(A()._addError('A', 'Invalid secret')).toMatch(/too short/);
    expect(A()._addError('JBSWY3DP', 'OS encryption unavailable')).toBe('OS encryption unavailable');
  });
});
