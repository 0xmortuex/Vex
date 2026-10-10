// @vitest-environment jsdom
//
// SY10 (found 2026-10-10): signing in on a second device without ticking "I
// have a recovery code" verified the email code, found the account had data,
// dropped the session and said "Enroll with your recovery code". The code was
// used up, so the user had to ask for a new email just to tick the box. The
// session is now kept and the recovery code asked for in place.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { workerStandIn } from './syncWorkerStandIn.js';

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

beforeEach(() => { window.showToast = vi.fn(); });

describe('signing in to an account that has data, without the recovery code', () => {
  it('keeps the session and joins with the recovery code, without a second email code', async () => {
    const { system, calls } = workerStandIn();
    const EMAIL = 'join@sync.test';
    // Device A makes the account.
    const a = freshEngine();
    localStorage.setItem('vex.bookmarks', JSON.stringify([{ id: 'bm1', url: 'https://a.test/', title: 'A', folder: '' }]));
    const { recoveryCode } = await a.verifyCode(EMAIL, (await a.requestCode(EMAIL)).devCode, 'Desk A');
    await a.signOut(false);

    // Device B: one email code, Verify without the tick.
    const b = freshEngine();
    const code = (await b.requestCode(EMAIL)).devCode;
    const first = await b.verifyCode(EMAIL, code);
    expect(first).toEqual({ ok: false, needsRecoveryCode: true });
    expect(b.isEnabled()).toBe(false);
    expect(b.pendingJoinFor(EMAIL)).toBe(true);
    // The session was not thrown away.
    expect(calls.some(c => c.method === 'DELETE')).toBe(false);

    // Then the recovery code: no new verify, and the account's data arrives.
    const verifies = calls.filter(c => c.path === '/auth/verify-code').length;
    expect((await b.joinPending(recoveryCode)).ok).toBe(true);
    expect(calls.filter(c => c.path === '/auth/verify-code').length).toBe(verifies);
    expect(b.isEnabled()).toBe(true);
    expect(JSON.parse(localStorage.getItem('vex.bookmarks')).map(x => x.id)).toEqual(['bm1']);
    // The device is on the account (A signed out without leaving the server).
    const token = b.getState().sessionToken;
    const devices = await system.call('GET', '/sync/devices', undefined, token);
    expect(devices.body.devices.map(d => d.deviceId)).toContain(b.getState().deviceId);
  });

  it('a waiting sign-in is removed from the server when it is left', async () => {
    const { calls } = workerStandIn();
    const EMAIL = 'leave@sync.test';
    const a = freshEngine();
    await a.verifyCode(EMAIL, (await a.requestCode(EMAIL)).devCode);
    const b = freshEngine();
    expect((await b.verifyCode(EMAIL, (await b.requestCode(EMAIL)).devCode)).needsRecoveryCode).toBe(true);
    await b.cancelPendingJoin();
    expect(b.pendingJoinFor(EMAIL)).toBe(false);
    expect(calls.filter(c => c.method === 'DELETE').length).toBe(1);
    await expect(b.joinPending('00'.repeat(32))).rejects.toThrow(/expired/);
  });
});
