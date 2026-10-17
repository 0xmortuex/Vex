// @vitest-environment jsdom
//
// Wave 5, T3-036: text and small pictures shared from a phone, against a fake relay that stands in for the
// sync worker's mailbox (nothing here reaches a real server). The phone is simulated by encrypting the payloads
// docs/PHONE_SHARE.md describes with the account key; the desktop is the real SyncEngine.dropFetch, Handoff.receive
// and VexPhoneShare.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
require('../../src/renderer/js/vex-icons.js');
const Records = require('../../src/renderer/js/sync-records.js');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG = '/9j/4AAQSkZJRg==';
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code, body = {}) => ({ ok: false, status: code, json: async () => body });

// The relay: a phone POSTs encrypted items, the desktop GETs what it did not send.
function fakeRelay() {
  const relay = { mailbox: [], devices: 0, posts: 0 };
  window.VexNet = {
    fetch: async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const path = url.replace('https://sync.test', '');
      if (path === '/auth/verify-code') { relay.devices++; return ok({ sessionToken: 'tok', deviceId: 'dev' + relay.devices, emailHash: 'h', hasEncryptedData: false }); }
      if (path === '/sync/push') return ok({ revision: 1 });
      if (path === '/sync/pull') return ok({ blob: null });
      if (path === '/sync/devices') return ok({ devices: [] });
      if (path === '/sync/drop' && method === 'POST') {
        const blob = JSON.parse(opts.body).encryptedBlob;
        if (typeof blob !== 'string' || !blob || blob.length > 16384) return status(400, { error: 'Encrypted handoff required (max 16 KB)' });
        relay.posts++;
        relay.mailbox.push({ id: 'item' + relay.posts, encryptedBlob: blob, fromDeviceId: 'phone1', fromDeviceName: 'Pixel 8', at: new Date().toISOString() });
        return ok({ ok: true });
      }
      if (path === '/sync/drop' && method === 'GET') { const items = relay.mailbox; relay.mailbox = []; return ok({ items }); }
      return status(404);
    },
  };
  return relay;
}

let savedKeyHex;
function freshEngine() {
  vi.resetModules();
  const stores = new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = {
    syncSaveKey: async (hex) => { savedKeyHex = hex; }, syncSaveMeta: async () => {}, syncClearState: async () => {},
    syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32',
  };
  window.VexTabPolicy = { snapshot: (v) => v, isPrivateWindow: false };
  window.VexSyncRecords = Records;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}
async function phonePost(relay, payload) {
  const key = await window.SyncCrypto.importKey(window.SyncCrypto.hexToKey(savedKeyHex));
  const blob = await window.SyncCrypto.encrypt(payload, key);
  const r = await window.VexNet.fetch('https://sync.test/sync/drop', { method: 'POST', body: JSON.stringify({ encryptedBlob: blob }) });
  return r;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the desktop reads what the phone posts (SyncEngine.dropFetch against the fake relay)', () => {
  it('returns links, text and a small picture, each in its own shape', async () => {
    const relay = fakeRelay();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    expect((await phonePost(relay, { url: 'https://example.com/a', title: 'A', note: 'see this' })).ok).toBe(true);
    await phonePost(relay, { kind: 'text', text: 'Milk, eggs\u0007 and bread', title: 'Shopping' });
    await phonePost(relay, { kind: 'image', image: { mime: 'image/png', data: PNG }, title: 'Receipt' });
    const items = await engine.dropFetch();
    expect(items.map(i => i.url ? 'link' : i.kind)).toEqual(['link', 'text', 'image']);
    expect(items[0].note).toBe('see this');
    expect(items[1]).toMatchObject({ kind: 'text', text: 'Milk, eggs and bread', title: 'Shopping', fromDeviceName: 'Pixel 8' });
    expect(items[2].image).toEqual({ mime: 'image/png', data: PNG });
    engine.signOut();
  });
  it('drops a picture that lies about its type, is too large, or is not base64, and a text that is empty', async () => {
    const relay = fakeRelay();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await phonePost(relay, { kind: 'image', image: { mime: 'image/jpeg', data: PNG } });          // PNG bytes called JPEG
    await phonePost(relay, { kind: 'image', image: { mime: 'image/png', data: 'A'.repeat(9001) } });
    await phonePost(relay, { kind: 'image', image: { mime: 'image/svg+xml', data: PNG } });
    await phonePost(relay, { kind: 'image', image: { mime: 'image/png', data: '<script>' } });
    await phonePost(relay, { kind: 'text', text: '   ' });
    await phonePost(relay, { kind: 'text', text: 42 });
    await phonePost(relay, { kind: 'file', text: 'x' });
    await phonePost(relay, { kind: 'text', text: 'kept' });
    const items = await engine.dropFetch();
    expect(items.map(i => i.text)).toEqual(['kept']);
    engine.signOut();
  });
  it('cuts text at 4000 characters', async () => {
    const relay = fakeRelay();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    await phonePost(relay, { kind: 'text', text: 'x'.repeat(5000) });
    expect((await engine.dropFetch())[0].text).toHaveLength(4000);
    engine.signOut();
  });
  it('the relay itself refuses an item over 16 KB, as the real worker does', async () => {
    const relay = fakeRelay();
    const engine = freshEngine();
    await engine.verifyCode('a@b.test', '123456');
    const r = await phonePost(relay, { kind: 'text', text: 'y'.repeat(20000) });
    expect(r.status).toBe(400);
    engine.signOut();
  });
});

describe('Handoff.receive and the phone-share list', () => {
  function setup(items, { autoFile = false } = {}) {
    vi.resetModules();
    globalThis.SyncEngine = { isEnabled: () => true, dropFetch: vi.fn(async () => items), getState: () => ({ deviceId: 'desk' }) };
    delete require.cache[require.resolve('../../src/renderer/js/handoff.js')];
    delete require.cache[require.resolve('../../src/renderer/js/phone-share.js')];
    globalThis.VexSettingsGroups = { register() {} };
    const { Handoff } = require('../../src/renderer/js/handoff.js');
    globalThis.Handoff = Handoff;
    const { VexPhoneShare } = require('../../src/renderer/js/phone-share.js');
    globalThis.VexPhoneShare = VexPhoneShare;
    if (autoFile) VexPhoneShare.setPrefs({ autoFile: true });
    window.vex = { notify: vi.fn(async () => ({ ok: true })), clipsInboxAdd: vi.fn(async () => ({ ok: true, id: 'clip1' })), clipsInboxRemove: vi.fn(async () => ({ ok: true })) };
    window.VexTabPolicy = { isPrivateWindow: false };
    window.VexConfig = { syncWorkerUrl: () => 'https://sync.test' };
    return { Handoff, VexPhoneShare };
  }
  const shares = () => [
    { id: 'a', url: 'https://l.test/', title: 'L', fromDeviceName: 'Pixel 8' },
    { id: 'b', kind: 'text', text: 'Remember the keys', title: 'Note', fromDeviceName: 'Pixel 8' },
    { id: 'c', kind: 'image', image: { mime: 'image/png', data: PNG }, title: 'Pic', fromDeviceName: 'Pixel 8' },
  ];

  it('keeps links as cards and the rest in the phone-share list', async () => {
    const { Handoff, VexPhoneShare } = setup(shares());
    await Handoff.receive();
    expect(Handoff.inbox().map(i => i.id)).toEqual(['ha']);
    expect(VexPhoneShare.sharedItems().map(i => i.kind)).toEqual(['text', 'image']);
    expect(VexPhoneShare.sharedItems()[1].image.data).toBe(PNG);
  });
  it('files text into Clips when asked to, with an undo, and leaves the picture in the list', async () => {
    const ledger = { note: vi.fn(), registerUndo: vi.fn(), registerStop: vi.fn() };
    globalThis.VexLedger = ledger;
    const { Handoff, VexPhoneShare } = setup(shares().slice(1), { autoFile: true });
    await Handoff.receive();
    expect(window.vex.clipsInboxAdd).toHaveBeenCalledWith('Note\nRemember the keys');
    expect(VexPhoneShare.sharedItems().map(i => i.kind)).toEqual(['image']);
    const line = ledger.note.mock.calls[0][0];
    expect(line.undo.kind).toBe('phone-share-unfile-text');
    await VexPhoneShare.unfileText(line.undo.clipId, line.undo.entry);
    expect(window.vex.clipsInboxRemove).toHaveBeenCalledWith('clip1');
    expect(VexPhoneShare.sharedItems().map(i => i.kind).sort()).toEqual(['image', 'text']);
    delete globalThis.VexLedger;
  });
  it('without the switch nothing is filed, and the same item is not kept twice', async () => {
    const { Handoff, VexPhoneShare } = setup(shares().slice(1));
    await Handoff.receive();
    await Handoff.receive();
    expect(window.vex.clipsInboxAdd).not.toHaveBeenCalled();
    expect(VexPhoneShare.sharedItems()).toHaveLength(2);
  });
  it('refuses a stored item that is not valid, and a picture type it does not know', () => {
    const { VexPhoneShare } = setup([]);
    expect(VexPhoneShare.validShare({ id: 'x', from: 'p', kind: 'image', image: { mime: 'image/svg+xml', data: PNG } })).toBe(false);
    expect(VexPhoneShare.validShare({ id: 'x', from: 'p', kind: 'text', text: '' })).toBe(false);
    expect(VexPhoneShare.validShare({ id: 'x', from: 'p', kind: 'text', text: 'ok' })).toBe(true);
    const bad = VexPhoneShare.addShared([{ id: 'z', kind: 'image', image: { mime: 'image/png', data: '<b>' } }]);
    expect(bad).toEqual([]);
  });
  it('forgets items after 14 days and keeps at most 20', () => {
    const { VexPhoneShare } = setup([]);
    const t0 = Date.now();
    VexPhoneShare.addShared([{ id: 'old', kind: 'text', text: 'old' }], t0 - 15 * 24 * 3600 * 1000);
    expect(VexPhoneShare.sharedItems()).toEqual([]);
    VexPhoneShare.addShared(Array.from({ length: 25 }, (_, i) => ({ id: 'n' + i, kind: 'text', text: 't' + i })), t0);
    expect(VexPhoneShare.sharedItems()).toHaveLength(20);
    expect(VexPhoneShare.sharedItems()[19].text).toBe('t24');
  });
  it('a private window fetches nothing, so nothing is kept', async () => {
    const { Handoff, VexPhoneShare } = setup(shares());
    window.VexTabPolicy = { isPrivateWindow: true };
    expect(await Handoff.receive()).toEqual([]);
    expect(SyncEngine.dropFetch).not.toHaveBeenCalled();
    expect(VexPhoneShare.sharedItems()).toEqual([]);
  });
  it('the list shows the text and the picture with Copy, Save and Dismiss', async () => {
    window.VexUndo = { offer: vi.fn() };
    window.VexSettingsGroups = undefined;
    const { Handoff, VexPhoneShare } = setup(shares());
    await Handoff.receive();
    globalThis.VexSettingsGroups = {
      dialog: () => ({ body: document.body }), note: (t) => Object.assign(document.createElement('div'), { textContent: t }),
      button: (t, fn, o = {}) => { const b = document.createElement('button'); b.textContent = t; b.setAttribute('aria-label', o.label || t); b.addEventListener('click', fn); return b; },
    };
    VexPhoneShare.open();
    expect(document.querySelector('img').src).toMatch(/^data:image\/png;base64,/);
    expect(document.body.textContent).toContain('Remember the keys');
    const save = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Save the shared text to Clips');
    save.click();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vex.clipsInboxAdd).toHaveBeenCalled();
    expect(VexPhoneShare.sharedItems().map(i => i.kind)).toEqual(['image']);
  });
});
