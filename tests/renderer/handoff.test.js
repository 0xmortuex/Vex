// @vitest-environment jsdom
//
// Send to your devices (js/handoff.js) over the Vex Sync mailbox
// (docs/SYNC_PROTOCOL.md §7): what may be sent, the inbox that keeps tabs sent
// here until they are opened or dismissed (the server lets go of them on
// fetch), the notification, the menu, and the engine's mailbox calls.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

require('../../src/renderer/js/vex-utils.js');
const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;
const Records = require('../../src/renderer/js/sync-records.js');

const SPEC_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const SPEC_IV = 'a0a1a2a3a4a5a6a7a8a9aaab';
// §3.6: {"url":"https://example.com/","title":"Example"} under the spec key and IV.
const SPEC_HANDOFF = 'oKGio6SlpqeoqaqrnToJXynpOJ0KEfOjdEDv8RXUOH3i2ydC/2FLqV2HV3W7AiuajRhxeCf9abhlH6GEPQdxr/1P2LZzERl0S7rSuA==';

function loadHandoff() {
  vi.resetModules();
  delete require.cache[require.resolve('../../src/renderer/js/handoff.js')];
  return require('../../src/renderer/js/handoff.js').Handoff;
}

let toasts, notes;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  toasts = []; notes = [];
  window.showToast = (message, type) => toasts.push({ message, type });
  window.VexTabPolicy = { isPrivateWindow: false };
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
  window.vex = { notify: vi.fn(async (title, body) => { notes.push({ title, body }); return { ok: true }; }) };
  globalThis.isStartPage = (u) => /start\.html|^vex:\/\/start/.test(String(u || ''));
  delete globalThis.GameMode;
  delete globalThis.SyncEngine;
  delete globalThis.WebviewManager;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('what may be sent', () => {
  it('a web page in a normal or container tab, and nothing else', () => {
    const H = loadHandoff();
    expect(H.sendable({ url: 'https://example.com/a', partition: null }).ok).toBe(true);
    expect(H.sendable({ url: 'http://example.com/', partition: 'persist:main' }).ok).toBe(true);
    expect(H.sendable({ url: 'https://example.com/', partition: 'persist:container-work' }).ok).toBe(true);
    expect(H.sendable({ url: 'https://example.com/', partition: 'otr-1' })).toEqual({ ok: false, why: 'Private tabs are never sent' });
    expect(H.sendable({ url: 'https://example.com/', partition: 'tor-1' })).toEqual({ ok: false, why: 'Tor tabs are never sent' });
    expect(H.sendable({ url: 'file:///C:/Vex/src/renderer/start.html' }).ok).toBe(false);
    expect(H.sendable({ url: 'vex://settings' }).ok).toBe(false);
    expect(H.sendable({ url: 'file:///C:/doc.pdf' }).ok).toBe(false);
    expect(H.sendable({ url: 'about:blank' }).ok).toBe(false);
    expect(H.sendable(null).ok).toBe(false);
  });

  it('nothing at all from a private window', () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    const H = loadHandoff();
    expect(H.sendable({ url: 'https://example.com/' })).toEqual({ ok: false, why: 'Tabs in a private window are never sent' });
  });
});

describe('the inbox: tabs sent to this computer', () => {
  const item = (id, over = {}) => ({ id, url: 'https://ex.test/' + id, title: 'T ' + id, fromDeviceId: 'p', fromDeviceName: 'Pixel 9', at: '2026-10-08T10:00:00.000Z', ...over });

  it('keeps each one once, and it survives a restart until opened or dismissed', () => {
    let H = loadHandoff();
    const fresh = H.add([item('a1'), item('b2'), item('a1')]);
    expect(fresh.map(f => f.id)).toEqual(['ha1', 'hb2']);
    expect(H.add([item('a1')])).toEqual([]);
    H = loadHandoff();               // a restart
    expect(H.inbox().map(i => [i.id, i.from, i.title])).toEqual([['ha1', 'Pixel 9', 'T a1'], ['hb2', 'Pixel 9', 'T b2']]);
    expect(H.take('ha1').url).toBe('https://ex.test/a1');
    H = loadHandoff();
    expect(H.inbox().map(i => i.id)).toEqual(['hb2']);
    expect(H.take('ha1')).toBeNull();
  });

  it('refuses addresses that are not web pages', () => {
    const H = loadHandoff();
    expect(H.add([item('x', { url: 'javascript:alert(1)' }), item('y', { url: 'file:///C:/x' })])).toEqual([]);
  });

  it('an unreadable inbox is an error, not an empty one', () => {
    localStorage.setItem('vex.handoffInbox', '{oops');
    const H = loadHandoff();
    expect(() => H.inbox()).toThrow(/could not be read/);
  });

  it('keeps at most 20', () => {
    const H = loadHandoff();
    H.add(Array.from({ length: 25 }, (_, i) => item('n' + i)));
    expect(H.inbox().length).toBe(20);
    expect(H.inbox()[0].id).toBe('hn5');
  });
});

describe('receiving', () => {
  const engine = (items) => ({ isEnabled: () => true, dropFetch: vi.fn(async () => items), getState: () => ({ deviceId: 'me' }) });

  it('keeps what arrives, says so once on the desktop, and hands it to open New Tab pages', async () => {
    globalThis.SyncEngine = engine([{ id: 'abc', url: 'https://news.test/story', title: 'A story', fromDeviceName: 'Pixel 9' }]);
    const executed = [];
    const wv = { getURL: () => 'file:///C:/x/src/renderer/start.html', executeJavaScript: async (c) => { executed.push(c); return true; } };
    globalThis.WebviewManager = { webviews: new Map([[1, wv]]) };
    const H = loadHandoff();
    const fresh = await H.receive();
    expect(fresh.map(f => f.url)).toEqual(['https://news.test/story']);
    expect(H.inbox().length).toBe(1);
    expect(notes).toEqual([{ title: 'From Pixel 9', body: 'A story — on your New Tab page' }]);
    expect(executed[0]).toContain('__vexHandoff');
    expect(executed[0]).toContain('https://news.test/story');
    expect(executed[0]).toContain('"phone":true');
    // The same item again (it cannot come back from the server, but a retry
    // must not show it twice): no second notification.
    await H.receive();
    expect(notes.length).toBe(1);
  });

  it('several at once are one notification', async () => {
    globalThis.SyncEngine = engine([
      { id: 'a', url: 'https://a.test/', title: 'A', fromDeviceName: 'Pixel 9' },
      { id: 'b', url: 'https://b.test/', title: 'B', fromDeviceName: 'Office PC' },
    ]);
    const H = loadHandoff();
    await H.receive();
    expect(notes).toEqual([{ title: '2 tabs from your devices', body: 'A · B — on your New Tab page' }]);
  });

  it('holds the notification while a game runs, and keeps the card', async () => {
    globalThis.GameMode = { gaming: true };
    globalThis.SyncEngine = engine([{ id: 'g', url: 'https://g.test/', title: 'G', fromDeviceName: 'Pixel 9' }]);
    const H = loadHandoff();
    await H.receive();
    expect(notes).toEqual([]);
    expect(H.inbox().length).toBe(1);
  });

  it('a private window never takes them, and nothing is fetched without sync', async () => {
    window.VexTabPolicy = { isPrivateWindow: true };
    globalThis.SyncEngine = engine([{ id: 'p', url: 'https://p.test/', title: 'P' }]);
    let H = loadHandoff();
    expect(await H.receive()).toEqual([]);
    expect(SyncEngine.dropFetch).not.toHaveBeenCalled();
    window.VexTabPolicy = { isPrivateWindow: false };
    window.VexConfig = { syncWorkerUrl: () => '' };
    H = loadHandoff();
    expect(await H.receive()).toEqual([]);
    expect(SyncEngine.dropFetch).not.toHaveBeenCalled();
  });

  it('a failed check is reported once, not every two minutes', async () => {
    globalThis.SyncEngine = { isEnabled: () => true, dropFetch: vi.fn(async () => { throw new Error('server returned 500'); }) };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const H = loadHandoff();
    await H.receive(); await H.receive();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Open loads it in the New Tab that showed it; Dismiss only forgets it', () => {
    const H = loadHandoff();
    H.add([{ id: 'o', url: 'https://o.test/', title: 'O', fromDeviceName: 'Pixel 9' }, { id: 'd', url: 'https://d.test/', title: 'D', fromDeviceName: 'Pixel 9' }]);
    const wv = { loadURL: vi.fn(async () => {}) };
    H.onStartCommand({ type: 'handoff-open', id: 'ho' }, wv);
    expect(wv.loadURL).toHaveBeenCalledWith('https://o.test/');
    H.onStartCommand({ type: 'handoff-dismiss', id: 'hd' }, wv);
    expect(wv.loadURL).toHaveBeenCalledTimes(1);
    expect(H.inbox()).toEqual([]);
  });
});

describe('the send menu', () => {
  const tab = { id: 't1', url: 'https://example.com/page', title: 'Example page', partition: 'persist:main' };

  it('without Vex Sync it says so and goes to Settings › Cloud', async () => {
    globalThis.SyncEngine = { isEnabled: () => false };
    window.SettingsUI = { openSection: vi.fn() };
    const H = loadHandoff();
    const pop = await H.openMenu(tab);
    const setup = pop.querySelector('[data-act="setup"]');
    expect(setup.textContent).toBe('Set up Vex Sync');
    setup.click();
    expect(window.SettingsUI.openSection).toHaveBeenCalledWith('sync-panel-content');
    expect(document.getElementById('vex-handoff-pop')).toBeNull();
  });

  it('lists the other devices, sends the tab once, and closes', async () => {
    const dropSend = vi.fn(async () => ({ ok: true }));
    globalThis.SyncEngine = {
      isEnabled: () => true, getState: () => ({ deviceId: 'me' }), dropSend,
      listDevices: async () => [
        { deviceId: 'me', deviceName: 'Windows-AAAA', lastSeenAt: new Date().toISOString() },
        { deviceId: 'p', deviceName: 'Pixel 9', lastSeenAt: new Date().toISOString() },
        { deviceId: 'w', deviceName: 'Office PC', lastSeenAt: new Date(Date.now() - 3 * 3600e3).toISOString() },
      ],
    };
    const H = loadHandoff();
    const pop = await H.openMenu(tab);
    await new Promise(r => setTimeout(r, 0));
    const names = [...pop.querySelectorAll('.hp-device-name')].map(e => e.textContent);
    expect(names).toEqual(['Pixel 9', 'Office PC']);
    expect(pop.textContent).toContain('Whichever of these opens Vex first gets it');
    pop.querySelector('[data-act="send"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(dropSend).toHaveBeenCalledWith('https://example.com/page', 'Example page');
    expect(document.getElementById('vex-handoff-pop')).toBeNull();
    expect(toasts).toContainEqual({ message: 'Sent to your devices', type: 'success' });
  });

  it('a failed send stays open and says why', async () => {
    globalThis.SyncEngine = {
      isEnabled: () => true, getState: () => ({ deviceId: 'me' }), listDevices: async () => [],
      dropSend: async () => { throw new Error('Encrypted handoff required (max 16 KB)'); },
    };
    const H = loadHandoff();
    const pop = await H.openMenu(tab);
    pop.querySelector('[data-act="send"]').click();
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('vex-handoff-pop')).not.toBeNull();
    expect(pop.querySelector('.hp-error').hidden).toBe(false);
    expect(pop.querySelector('.hp-error').textContent).toContain('Encrypted handoff required');
  });

  it('refuses a private tab outright', async () => {
    const H = loadHandoff();
    expect(await H.openMenu({ ...tab, partition: 'otr-9' })).toBeNull();
    expect(toasts[0].message).toBe('Private tabs are never sent');
    await expect(H.send({ ...tab, partition: 'tor-1' })).rejects.toThrow(/Tor tabs are never sent/);
  });
});

describe('the engine\'s mailbox calls', () => {
  let calls, reply;
  async function engine() {
    vi.resetModules();
    window.vex = {
      syncSaveKey: async () => {}, syncSaveMeta: async () => {}, syncClearState: async () => {},
      syncLoadKey: async () => SPEC_KEY,
      syncLoadMeta: async () => ({ email: 'a@b.test', sessionToken: 'tok', deviceId: 'me', revision: 0 }),
      platform: 'win32',
    };
    window.VexSyncRecords = Records;
    calls = [];
    window.VexNet = { fetch: async (url, opts = {}) => { calls.push([opts.method || 'GET', url, opts.body]); return reply(url, opts); } };
    for (const f of ['sync-crypto.js', 'sync-engine.js']) delete require.cache[require.resolve('../../src/renderer/js/' + f)];
    require('../../src/renderer/js/sync-crypto.js');
    require('../../src/renderer/js/sync-engine.js');
    vi.useFakeTimers();
    await window.SyncEngine.initFromDisk();
    vi.useRealTimers();
    return window.SyncEngine;
  }
  afterEach(() => { try { window.SyncEngine && window.SyncEngine.signOut && window.SyncEngine.signOut(false); } catch {} });

  it('reads a handoff made exactly as the spec says (§3.6 vector)', async () => {
    reply = () => ({ ok: true, status: 200, json: async () => ({ ok: true, items: [{ id: '0011223344556677', encryptedBlob: SPEC_HANDOFF, fromDeviceId: 'p', fromDeviceName: 'Pixel 9', at: '2026-10-08T10:00:00.000Z' }] }) });
    const E = await engine();
    const items = await E.dropFetch();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ url: 'https://example.com/', title: 'Example', fromDeviceName: 'Pixel 9' });
  });

  it('sends {url, title} encrypted as the spec says, and nothing else', async () => {
    reply = () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const E = await engine();
    // The spec's fixed IV makes the ciphertext comparable with §3.6.
    const iv = Uint8Array.from(SPEC_IV.match(/../g).map(h => parseInt(h, 16)));
    const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((a) => { if (a.length === 12) { a.set(iv); return a; } return real(a); });
    await E.dropSend('https://example.com/', 'Example');
    const [method, url, body] = calls.find(c => c[1].endsWith('/sync/drop'));
    expect(method).toBe('POST');
    expect(url).toBe('https://sync.test/sync/drop');
    expect(JSON.parse(body)).toEqual({ encryptedBlob: SPEC_HANDOFF });
  });

  it('a 401 signs the device out and says so; a pending session gets nothing; a server error throws', async () => {
    reply = () => ({ ok: false, status: 403, json: async () => ({ error: 'This device has not synced yet' }) });
    let E = await engine();
    expect(await E.dropFetch()).toEqual([]);
    reply = () => ({ ok: false, status: 500, json: async () => ({ error: 'Sync request failed' }) });
    await expect(E.dropFetch()).rejects.toThrow(/server returned 500/);
    reply = () => ({ ok: false, status: 401, json: async () => ({ error: 'Invalid session' }) });
    window.showToast = vi.fn();
    await expect(E.dropFetch()).rejects.toThrow(/no longer enrolled/);
    expect(E.isEnabled()).toBe(false);
  });
});

describe('the tab menu', () => {
  async function tabs() {
    vi.resetModules();
    document.body.innerHTML = '<div id="tabs-list"></div><div id="tab-groups-container"></div><input id="url-input"><button id="btn-new-tab"></button>';
    globalThis.VexStorage = { loadTabs: async () => [], loadGroups: async () => [], loadStacks: async () => [], saveTabs: async () => true, saveGroups: async () => true, saveStacks: async () => true };
    globalThis.WebviewManager = { webviews: new Map() };
    globalThis.SidebarManager = { hideActivePanel() {} };
    globalThis.START_URL = 'vex://start';
    await import('../../src/renderer/js/data-contracts.js');   // index.html loads it before tab-policy.js
    await import('../../src/renderer/js/tab-policy.js');
    const TM = (await import('../../src/renderer/js/tabs.js')).TabManager;
    globalThis.Handoff = loadHandoff();
    return TM;
  }
  const rows = () => [...document.querySelectorAll('.tab-context-menu .tab-context-item')].map(e => e.textContent);
  afterEach(() => { delete globalThis.Handoff; });

  it('offers Send to your devices on a web page, not on a private or Tor tab or the New Tab page', async () => {
    const TM = await tabs();
    const at = { clientX: 20, clientY: 20 };
    TM.showContextMenu(at, { id: 'a', url: 'https://example.com/', title: 'E', partition: 'persist:main' });
    expect(rows()).toContain('Send to your devices…');
    TM.showContextMenu(at, { id: 'b', url: 'https://example.com/', title: 'E', partition: 'otr-1' });
    expect(rows()).not.toContain('Send to your devices…');
    TM.showContextMenu(at, { id: 'c', url: 'https://example.com/', title: 'E', partition: 'tor-1' });
    expect(rows()).not.toContain('Send to your devices…');
    TM.showContextMenu(at, { id: 'd', url: 'vex://start', title: 'New Tab', partition: 'persist:main' });
    expect(rows()).not.toContain('Send to your devices…');
  });
});

// webcrypto is used by sync-crypto under jsdom.
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = webcrypto;
