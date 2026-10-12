// @vitest-environment jsdom
//
// SY3 (found 2026-10-10): one sync email code let anyone overwrite or erase
// the encrypted account without the sync key. The desktop now proves the key
// on every push and wipe (SYNC_PROTOCOL.md §2.7), against the real worker.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn, WORKER_URL } from './syncWorkerStandIn.js';
import { syncSystem, liveValue, previousWorker } from '../workers/syncHarness.js';

require('../../src/renderer/js/vex-utils.js');
const Records = require('../../src/renderer/js/sync-records.js');

let stores;
function freshEngine() {
  vi.resetModules();
  localStorage.clear();
  stores = new Map();
  global.VexStorage = { load: async (k) => (stores.has(k) ? structuredClone(stores.get(k)) : null), save: async (k, v) => { stores.set(k, structuredClone(v)); return true; } };
  window.vex = { syncSaveKey: async () => {}, syncSaveMeta: async () => {}, syncClearState: async () => {}, syncLoadKey: async () => null, syncLoadMeta: async () => null, platform: 'win32' };
  window.VexTabPolicy = { snapshot: (v) => v };
  window.VexSyncRecords = Records;
  require('../../src/renderer/js/sync-crypto.js');
  require('../../src/renderer/js/sync-engine.js');
  return window.SyncEngine;
}
const hexOf = code => window.SyncCrypto.parseRecoveryCode(code);
const keycheck = (system, account) => liveValue(system.accounts.get(account), `sync:keycheck:${account}`);

beforeEach(() => { window.showToast = vi.fn(); });

describe('the desktop proves the sync key', () => {
  it('a new account is locked to its key on the first push; the server gets the derived key only', async () => {
    const { system, calls } = workerStandIn();
    const a = freshEngine();
    const EMAIL = 'new@sy3.test';
    const { recoveryCode } = await a.verifyCode(EMAIL, (await a.requestCode(EMAIL)).devCode, 'Desk A');
    const account = a.getState().emailHash;
    const stored = keycheck(system, account);
    expect(stored.key).toBe(await window.SyncCrypto.authKeyHex(window.SyncCrypto.hexToKey(hexOf(recoveryCode))));
    expect(stored.key).not.toBe(hexOf(recoveryCode));
    expect(stored.setBy).toBe(a.getState().deviceId);
    expect(a.keyCheckState().state).toBe('on');
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/locked to your sync key/), 'info', 15000);
    // Every push asked for a nonce first.
    expect(calls.filter(c => c.path === '/sync/challenge').length).toBeGreaterThanOrEqual(calls.filter(c => c.path === '/sync/push').length);
    // Nothing anywhere carried the sync key.
    expect(JSON.stringify([...system.accounts.get(account).values()])).not.toContain(hexOf(recoveryCode));
  });

  it('join, push and wipe work with the key; a key-less sign-in can neither overwrite nor wipe', async () => {
    const { system } = workerStandIn();
    const EMAIL = 'two@sy3.test';
    const a = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ id: 'bm1', url: 'https://a.test/', title: 'A', folder: '' }]));
    const { recoveryCode } = await a.verifyCode(EMAIL, (await a.requestCode(EMAIL)).devCode, 'Desk A');
    const aToken = a.getState().sessionToken;
    await a.signOut(false);

    // Someone with only an email code.
    const intruder = await system.signIn(EMAIL, 'Intruder');
    const pushed = await system.push(intruder.sessionToken, 0, 'GARBAGE');
    expect(pushed.status).toBe(403);
    expect((await system.push(intruder.sessionToken, 1, 'GARBAGE')).status).toBe(403);
    expect((await system.call('DELETE', '/sync/all', undefined, intruder.sessionToken)).status).toBe(403);

    // A second desktop with the recovery code joins and syncs.
    const b = freshEngine();
    const joined = await b.enrollWithRecoveryCode(EMAIL, (await b.requestCode(EMAIL)).devCode, recoveryCode, 'Desk B');
    expect(joined).toEqual({ ok: true });
    expect(JSON.parse(localStorage.getItem('vex.bookmarks')).map(x => x.id)).toEqual(['bm1']);
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ id: 'bm2', url: 'https://b.test/', title: 'B', folder: '' }, { id: 'bm1', url: 'https://a.test/', title: 'A', folder: '' }]));
    expect((await b.pushNow()).ok).toBe(true);
    const devices = await system.call('GET', '/sync/devices', undefined, aToken);
    expect(devices.body.devices.map(d => d.deviceName).sort()).toEqual(['Desk A', 'Desk B']);

    // Wiping with the key works.
    expect(await b.wipeAllCloudData()).toEqual({ ok: true, signedOut: true });
    expect((await system.call('GET', '/sync/pull', undefined, aToken)).status).toBe(401);
  });

  it('an account from before the key check is locked by the first current desktop, and an older one then only reads', async () => {
    const { system } = workerStandIn();
    const EMAIL = 'migrate@sy3.test';
    const a = freshEngine();
    const { recoveryCode } = await a.verifyCode(EMAIL, (await a.requestCode(EMAIL)).devCode, 'Old desk');
    const account = a.getState().emailHash;
    const oldToken = a.getState().sessionToken;
    await a.signOut(false);
    // As the account was before the key check: no lock, an older desktop pushing without proofs.
    system.accounts.get(account).delete(`sync:keycheck:${account}`);
    const rev = (await system.call('GET', '/sync/pull', undefined, oldToken)).body.revision;
    const blob = (await system.call('GET', '/sync/pull', undefined, oldToken)).body.encryptedBlob;
    expect((await system.push(oldToken, rev, blob)).status).toBe(200);

    const b = freshEngine();
    await b.enrollWithRecoveryCode(EMAIL, (await b.requestCode(EMAIL)).devCode, recoveryCode, 'New desk');
    expect(keycheck(system, account).setBy).toBe(b.getState().deviceId);
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/now locked to your sync key/), 'info', 15000);
    expect(b.keyCheckState().state).toBe('on');

    const now = (await system.call('GET', '/sync/pull', undefined, oldToken)).body;
    expect(now.keyCheck.setAt).toEqual(expect.any(String));
    const refused = await system.push(oldToken, now.revision, 'OLD');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/Update Vex on this device/);
  });

  it('a device whose key is not the account\'s says so instead of overwriting', async () => {
    const { system } = workerStandIn();
    const EMAIL = 'mismatch@sy3.test';
    const a = freshEngine();
    await a.verifyCode(EMAIL, (await a.requestCode(EMAIL)).devCode, 'A');
    const account = a.getState().emailHash;
    // The lock holds some other key (set by someone else during the first-use window).
    const rec = system.accounts.get(account).get(`sync:keycheck:${account}`);
    system.accounts.get(account).set(`sync:keycheck:${account}`, { ...rec, value: JSON.stringify({ ...JSON.parse(rec.value), key: 'ab'.repeat(32) }) });
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', title: 'x' }]));
    const r = await a.pushNow();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not match the key this account is locked to/);
  });
});

describe('the desktop\'s proof matches the SYNC_PROTOCOL.md §2.7.2 vector', () => {
  it('auth key and MACs', async () => {
    freshEngine();
    const C = window.SyncCrypto;
    const auth = await C.authKeyHex(C.hexToKey('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'));
    expect(auth).toBe('189392652584556749599e10df7683b887f593b65e96d70400072158154c72cc');
    const nonce = '00112233445566778899aabbccddeeff', dev = '0123456789abcdef0123456789abcdef';
    expect(await C.sha256Hex('oKGio6Sl')).toBe('b771b6fcbe1fb3c659f047d2417a51272b02932fec1faaf011567117ac7e5479');
    expect(await C.proof(auth, nonce, dev, 'push', '41\n' + await C.sha256Hex('oKGio6Sl'))).toBe('7212737d795bd6b54ded5b01ce84eb570e6e1efddd98a017d911b26ec49baae5');
    expect(await C.proof(auth, nonce, dev, 'wipe', '')).toBe('3b37c704c266d8bc3fb2a8e9229844c0e3d72a4c5edef19c16522a14be928c72');
    expect(await C.proof(auth, nonce, dev, 'prove', '')).toBe('b0cf29d8d2ca3be6bd099bd947e0494b8b9a107a038275ceb14231dec3efda38');
  });
});

describe('starting over without the recovery code', () => {
  it('erases the account only from a fresh sign-in, makes a new key, and signs the other devices out', async () => {
    const { system } = workerStandIn();
    const EMAIL = 'lost@sy3.test';
    const a = freshEngine();
    const first = await a.verifyCode(EMAIL, (await a.requestCode(EMAIL)).devCode, 'A');
    const aToken = a.getState().sessionToken;
    await a.signOut(false);

    const b = freshEngine();
    await expect(b.startOver()).rejects.toThrow(/expired/);
    expect((await b.verifyCode(EMAIL, (await b.requestCode(EMAIL)).devCode, 'B')).needsRecoveryCode).toBe(true);
    const fresh = await b.startOver();
    expect(fresh.ok).toBe(true);
    expect(fresh.recoveryCode).not.toBe(first.recoveryCode);
    expect(b.isEnabled()).toBe(true);
    expect((await system.call('GET', '/sync/pull', undefined, aToken)).status).toBe(401);
    expect(keycheck(system, b.getState().emailHash).setBy).toBe(b.getState().deviceId);
  });
});

// The worker emails the address after an erase (SYNC_PROTOCOL.md §2.9); it
// keeps no address, so the desktop sends the one it signed in with.
describe('the email after the account is erased', () => {
  it('starting over and wiping both send the address, and the worker writes to it', async () => {
    const { system } = workerStandIn();
    const EMAIL = 'notice@sy3.test';
    const a = freshEngine();
    await a.verifyCode(EMAIL, (await a.requestCode(EMAIL)).devCode, 'Desk A');
    await a.signOut(false);
    const b = freshEngine();
    expect((await b.verifyCode(EMAIL, (await b.requestCode(EMAIL)).devCode, 'Laptop B')).needsRecoveryCode).toBe(true);

    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); });
    system.env.RESEND_API_KEY = 're_test';
    try {
      expect((await b.startOver()).ok).toBe(true);
      expect(sent.map(m => [m.url, m.body.to, m.body.subject])).toEqual([['https://api.resend.com/emails', EMAIL, 'Your Vex Sync data was erased']]);
      expect(sent[0].body.text).toContain('a device named "Laptop B" signed in to Vex Sync with a code sent to this address');
      expect(await b.wipeAllCloudData()).toEqual({ ok: true, signedOut: true });
      expect(sent).toHaveLength(2);
      expect(sent[1].body.to).toBe(EMAIL);
      expect(sent[1].body.text).toContain('signed in to this account with its sync key, erased everything synced to it');
    } finally {
      globalThis.fetch = realFetch;
      delete system.env.RESEND_API_KEY;
    }
  });
});

describe('a sync server from before the key check', () => {
  it('the desktop still syncs with it, without proofs, and says the account is not protected', async () => {
    const system = syncSystem({ module: previousWorker });
    window.VexNet = {
      fetch: async (url, opts = {}) => {
        const r = await previousWorker.default.fetch(new Request(url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body }), system.env);
        const text = await r.text();
        return { ok: r.ok, status: r.status, json: async () => JSON.parse(text), text: async () => text };
      },
    };
    window.VexConfig = { ...(window.VexConfig || {}), syncWorkerUrl: () => WORKER_URL };
    const a = freshEngine();
    const EMAIL = 'old-server@sy3.test';
    const created = await a.verifyCode(EMAIL, (await a.requestCode(EMAIL)).devCode, 'A');
    expect(created.ok).toBe(true);
    expect(a.keyCheckState().state).toBe('unsupported');
    localStorage.setItem('vex.notes', JSON.stringify([{ id: 'n1', title: 'x' }]));
    expect((await a.pushNow()).ok).toBe(true);
    expect((await a.pullNow()).ok).toBe(true);
  });
});
