// Audit SY3 (2026-10-10): one sync email code was enough to overwrite or wipe
// the end-to-end-encrypted account without the sync key (push with
// baseRevision 0 -> 409 hands over the revision -> push again; DELETE
// /sync/all). Pushes and wipes now prove the key (SYNC_PROTOCOL.md §2.7).
import { describe, it, expect } from 'vitest';
import { syncSystem, liveValue } from './syncHarness.js';

const enc = new TextEncoder();
const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array(h.match(/../g).map(b => parseInt(b, 16)));

// The client side, written from the protocol text (not from sync-crypto.js),
// so the two are checked against each other.
async function authKeyOf(syncKeyHex) {
  const ikm = await crypto.subtle.importKey('raw', fromHex(syncKeyHex), 'HKDF', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('vex-sync auth key v1') }, ikm, 256));
}
async function mac(authKeyHex, message) {
  const key = await crypto.subtle.importKey('raw', fromHex(authKeyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
const sha = async text => toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const OTHER = 'ff'.repeat(32);

function client(sys, session, syncKeyHex = KEY) {
  const auth = authKeyOf(syncKeyHex);
  const challenge = async () => (await sys.call('GET', '/sync/challenge', undefined, session.sessionToken)).body;
  const headers = async (action, details, { sendKey = true } = {}) => {
    const c = await challenge();
    const k = await auth;
    const h = { 'X-Vex-Proof': c.nonce + '.' + await mac(k, `vex-sync-proof/1\n${c.nonce}\n${session.deviceId}\n${action}\n${details}`) };
    if (sendKey && !c.keyCheck) h['X-Vex-Auth-Key'] = k;
    return h;
  };
  return {
    headers,
    push: async (baseRevision, blob) => sys.call('POST', '/sync/push', { encryptedBlob: blob, baseRevision }, session.sessionToken,
      await headers('push', `${baseRevision}\n${await sha(blob)}`)),
    wipe: async () => sys.call('DELETE', '/sync/all', undefined, session.sessionToken, await headers('wipe', '')),
    prove: async () => sys.call('POST', '/sync/prove', {}, session.sessionToken, await headers('prove', '')),
  };
}

async function lockedAccount(email = 'owner@sy3.test') {
  const sys = syncSystem();
  const owner = await sys.signIn(email, 'Owner PC');
  const o = client(sys, owner);
  const first = await o.push(0, 'OWNER-CIPHERTEXT');
  expect(first.status).toBe(200);
  expect(first.body.keyCheckSet).toBe(true);
  return { sys, owner, o, email };
}

describe('sync worker: the sync key is needed to change the account', () => {
  it('a fresh email-code session without the key can no longer overwrite the account', async () => {
    const { sys, owner, email } = await lockedAccount();
    const intruder = await sys.signIn(email, 'Intruder');
    // The old attack: push, read the revision from the 409, push again.
    const first = await sys.push(intruder.sessionToken, 0, 'GARBAGE');
    expect(first.status).toBe(403);
    expect(first.body.code).toBe('key-required');
    expect(first.body.revision).toBeUndefined();
    expect((await sys.push(intruder.sessionToken, 1, 'GARBAGE')).status).toBe(403);
    // A proof made with a key it does not have fails the same way.
    const guess = client(sys, intruder, OTHER);
    const forged = await guess.push(1, 'GARBAGE');
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe('key-mismatch');
    const pulled = await sys.call('GET', '/sync/pull', undefined, owner.sessionToken);
    expect(pulled.body.encryptedBlob).toBe('OWNER-CIPHERTEXT');
    expect(pulled.body.keyCheck.setAt).toEqual(expect.any(String));
  });

  it('a key-less session cannot wipe the account, nor enrol by pulling', async () => {
    const { sys, owner, email } = await lockedAccount();
    const intruder = await sys.signIn(email, 'Intruder');
    // Reading is allowed (the data is encrypted) but does not enrol the device.
    expect((await sys.call('GET', '/sync/pull', undefined, intruder.sessionToken)).status).toBe(200);
    const devices = await sys.call('GET', '/sync/devices', undefined, owner.sessionToken);
    expect(devices.body.devices.map(d => d.deviceName)).toEqual(['Owner PC']);
    expect((await sys.call('DELETE', '/sync/all', undefined, intruder.sessionToken)).status).toBe(403);
    expect((await client(sys, intruder, OTHER).wipe()).status).toBe(403);
    expect((await sys.call('DELETE', `/sync/devices/${owner.deviceId}`, undefined, intruder.sessionToken)).status).toBe(403);
    expect((await sys.call('GET', '/sync/drop', undefined, intruder.sessionToken)).status).toBe(403);
    expect((await sys.call('GET', '/sync/pull', undefined, owner.sessionToken)).body.encryptedBlob).toBe('OWNER-CIPHERTEXT');
  });

  it('push, pull, join and wipe work for devices that have the key', async () => {
    const { sys, owner, o, email } = await lockedAccount();
    expect((await o.push(1, 'OWNER-2')).body.revision).toBe(2);
    // A second device joins with the recovery code: pulls, then pushes with a proof.
    const laptop = await sys.signIn(email, 'Laptop');
    const l = client(sys, laptop);
    const pulled = await sys.call('GET', '/sync/pull', undefined, laptop.sessionToken);
    expect(pulled.body.encryptedBlob).toBe('OWNER-2');
    const pushed = await l.push(2, 'LAPTOP-3');
    expect(pushed.status).toBe(200);
    expect(pushed.body.keyCheckSet).toBeUndefined();
    const listed = await sys.call('GET', '/sync/devices', undefined, owner.sessionToken);
    expect(listed.body.devices.map(d => d.deviceName).sort()).toEqual(['Laptop', 'Owner PC']);
    // A proven device can use the mailbox and remove devices.
    expect((await sys.call('POST', '/sync/drop', { encryptedBlob: 'X' }, laptop.sessionToken)).status).toBe(200);
    // A 409 still tells a device with the key the revision to rebase on.
    const stale = await o.push(2, 'OWNER-STALE');
    expect(stale.status).toBe(409);
    expect(stale.body.revision).toBe(3);
    // Wiping with the key works and clears the key check with everything else.
    expect((await l.wipe()).status).toBe(200);
    expect((await sys.call('GET', '/sync/pull', undefined, owner.sessionToken)).status).toBe(401);
    const fresh = await sys.signIn(email, 'New start');
    expect(fresh.hasEncryptedData).toBe(false);
    const n = client(sys, fresh, OTHER);
    expect((await n.push(0, 'NEW')).body.keyCheckSet).toBe(true);
  });

  it('POST /sync/prove enrols a device that only reads', async () => {
    const { sys, owner, email } = await lockedAccount();
    const phone = await sys.signIn(email, 'Phone');
    expect((await sys.call('GET', '/sync/devices', undefined, phone.sessionToken)).status).toBe(403);
    expect((await client(sys, phone).prove()).status).toBe(200);
    const listed = await sys.call('GET', '/sync/devices', undefined, owner.sessionToken);
    expect(listed.body.devices.map(d => d.deviceName).sort()).toEqual(['Owner PC', 'Phone']);
    expect((await sys.call('GET', '/sync/drop', undefined, phone.sessionToken)).status).toBe(200);
  });

  it('a proof is good once, for the device that asked for its nonce, for that request only', async () => {
    const { sys, owner, o, email } = await lockedAccount();
    const blob = 'OWNER-2';
    const h = await o.headers('push', `1\n${await sha(blob)}`);
    const first = await sys.call('POST', '/sync/push', { encryptedBlob: blob, baseRevision: 1 }, owner.sessionToken, h);
    expect(first.status).toBe(200);
    // The same request again: the nonce is spent.
    const replay = await sys.call('POST', '/sync/push', { encryptedBlob: blob, baseRevision: 1 }, owner.sessionToken, h);
    expect(replay.status).toBe(403);
    expect(replay.body.code).toBe('proof-stale');
    // A proof for one body does not cover another.
    const h2 = await o.headers('push', `2\n${await sha('A')}`);
    const swapped = await sys.call('POST', '/sync/push', { encryptedBlob: 'B', baseRevision: 2 }, owner.sessionToken, h2);
    expect(swapped.body.code).toBe('key-mismatch');
    // A push proof is not a wipe proof.
    const h3 = await o.headers('push', `2\n${await sha('A')}`);
    expect((await sys.call('DELETE', '/sync/all', undefined, owner.sessionToken, h3)).body.code).toBe('key-mismatch');
    // A nonce asked for by one device cannot be used by another session.
    const intruder = await sys.signIn(email, 'Intruder');
    const h4 = await o.headers('push', `2\n${await sha('C')}`);
    expect((await sys.call('POST', '/sync/push', { encryptedBlob: 'C', baseRevision: 2 }, intruder.sessionToken, h4)).body.code).toBe('proof-stale');
    // A nonce older than five minutes is refused.
    const c = (await sys.call('GET', '/sync/challenge', undefined, owner.sessionToken)).body;
    const list = sys.accounts.get(owner.emailHash).get('auth:challenges');
    const entries = JSON.parse(list.value).map(e => (e.nonce === c.nonce ? { ...e, exp: Date.now() - 1 } : e));
    sys.accounts.get(owner.emailHash).set('auth:challenges', { ...list, value: JSON.stringify(entries) });
    const k = await authKeyOf(KEY);
    const late = { 'X-Vex-Proof': c.nonce + '.' + await mac(k, `vex-sync-proof/1\n${c.nonce}\n${owner.deviceId}\npush\n2\n${await sha('D')}`) };
    expect((await sys.call('POST', '/sync/push', { encryptedBlob: 'D', baseRevision: 2 }, owner.sessionToken, late)).body.code).toBe('proof-stale');
  });

  it('the server keeps the derived auth key, never the sync key', async () => {
    const { sys, owner } = await lockedAccount();
    const stored = liveValue(sys.accounts.get(owner.emailHash), `sync:keycheck:${owner.emailHash}`);
    expect(stored.key).toBe(await authKeyOf(KEY));
    expect(stored.key).not.toBe(KEY);
    expect(stored.setBy).toBe(owner.deviceId);
  });
});

describe('sync worker: accounts from before the key check, and older clients', () => {
  it('an account without a key check takes keyless pushes until the first proof sets it', async () => {
    const sys = syncSystem();
    const email = 'old@sy3.test';
    const oldPc = await sys.signIn(email, 'Old PC');
    // An older desktop: no proof headers.
    expect((await sys.push(oldPc.sessionToken, 0, 'OLD-1')).status).toBe(200);
    expect((await sys.push(oldPc.sessionToken, 1, 'OLD-2')).status).toBe(200);
    const pulled = await sys.call('GET', '/sync/pull', undefined, oldPc.sessionToken);
    expect(pulled.body.keyCheck).toBeUndefined();
    // A current desktop with the key joins and proves: trust on first use.
    const newPc = await sys.signIn(email, 'New PC');
    await sys.call('GET', '/sync/pull', undefined, newPc.sessionToken);
    const n = client(sys, newPc);
    const set = await n.push(2, 'NEW-3');
    expect(set.status).toBe(200);
    expect(set.body.keyCheckSet).toBe(true);
    // From now on the older desktop can still read, but not write or wipe.
    const read = await sys.call('GET', '/sync/pull', undefined, oldPc.sessionToken);
    expect(read.status).toBe(200);
    expect(read.body.encryptedBlob).toBe('NEW-3');
    const refused = await sys.push(oldPc.sessionToken, 3, 'OLD-4');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/Update Vex on this device/);
    expect((await sys.call('DELETE', '/sync/all', undefined, oldPc.sessionToken)).status).toBe(403);
    // It still sees the device list (the old desktop's Sync panel).
    expect((await sys.call('GET', '/sync/devices', undefined, oldPc.sessionToken)).status).toBe(200);
    // Updated, the same session proves and writes again.
    expect((await client(sys, oldPc).push(3, 'OLD-UPDATED-4')).status).toBe(200);
  });

  it('a second proof with another key does not replace the key check', async () => {
    const sys = syncSystem();
    const email = 'race@sy3.test';
    const a = await sys.signIn(email, 'A');
    expect((await client(sys, a).push(0, 'A-1')).body.keyCheckSet).toBe(true);
    const b = await sys.signIn(email, 'B');
    // B tries to set its own key: the existing check wins.
    const c = (await sys.call('GET', '/sync/challenge', undefined, b.sessionToken)).body;
    const kb = await authKeyOf(OTHER);
    const h = { 'X-Vex-Proof': c.nonce + '.' + await mac(kb, `vex-sync-proof/1\n${c.nonce}\n${b.deviceId}\npush\n1\n${await sha('B')}`), 'X-Vex-Auth-Key': kb };
    expect((await sys.call('POST', '/sync/push', { encryptedBlob: 'B', baseRevision: 1 }, b.sessionToken, h)).body.code).toBe('key-mismatch');
  });

  it('a first proof must say which key it is', async () => {
    const sys = syncSystem();
    const a = await sys.signIn('nokey@sy3.test', 'A');
    const r = await sys.call('POST', '/sync/push', { encryptedBlob: 'A', baseRevision: 0 }, a.sessionToken,
      await client(sys, a).headers('push', `0\n${await sha('A')}`, { sendKey: false }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('auth-key-missing');
  });
});

describe('sync worker: starting over without the key', () => {
  it('needs a sign-in from the last ten minutes and the confirmation, and signs every other device out', async () => {
    const { sys, owner, email } = await lockedAccount('reset@sy3.test');
    const lost = await sys.signIn(email, 'Lost key');
    const noConfirm = await sys.call('POST', '/sync/reset', {}, lost.sessionToken);
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body.code).toBe('confirm-required');
    expect((await sys.call('GET', '/sync/pull', undefined, owner.sessionToken)).body.encryptedBlob).toBe('OWNER-CIPHERTEXT');
    // An old sign-in is not enough.
    const stale = await sys.signIn(email, 'Stale');
    const records = sys.accounts.get(owner.emailHash);
    const rec = records.get(`auth:sess:${stale.sessionToken}`);
    records.set(`auth:sess:${stale.sessionToken}`, { ...rec, value: JSON.stringify({ ...JSON.parse(rec.value), createdAt: new Date(Date.now() - 11 * 60000).toISOString() }) });
    expect((await sys.call('POST', '/sync/reset', { confirm: 'erase my synced data' }, stale.sessionToken)).body.code).toBe('fresh-sign-in-required');
    // A registered device cannot use it either (it can wipe with its key).
    expect((await sys.call('POST', '/sync/reset', { confirm: 'erase my synced data' }, owner.sessionToken)).status).toBe(403);
    // Fresh, pending and confirmed: the account is erased, not replaced.
    const reset = await sys.call('POST', '/sync/reset', { confirm: 'erase my synced data' }, lost.sessionToken);
    expect(reset.status).toBe(200);
    expect((await sys.call('GET', '/sync/pull', undefined, owner.sessionToken)).status).toBe(401);
    const empty = await sys.call('GET', '/sync/pull', undefined, lost.sessionToken);
    expect(empty.body).toEqual({ ok: true, blob: null });
    // The new account is locked to the new key.
    expect((await client(sys, lost, OTHER).push(0, 'FRESH')).body.keyCheckSet).toBe(true);
  });
});
