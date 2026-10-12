// @vitest-environment node
//
// vex-sync worker fixes (found 2026-09-30), run through the real Durable
// Object class on in-memory storage:
//   a. removing a device or wiping the account left every sess:<token> in the
//      auth store for its whole year;
//   b. accounts were keyed by an unsalted SHA-256 of the address — now an
//      HMAC with EMAIL_HASH_SECRET, with accounts under the old key moved on
//      the next sign-in, and no secret means every request is refused;
//   c. verify-code put the device in the list before the app had decided
//      anything, so a refused sign-in left a ghost device.
//
// Since each account has its own Durable Object, these run through the whole
// worker (entry, global object, account objects; tests/workers/syncHarness.js).
// `records` is the global object's storage; live()/value() read the account
// objects' storage (where the accounts now are) unless told otherwise.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { hashEmail, legacyHashEmail } from '../../workers/vex-sync-worker/worker.js';
import { syncSystem, SECRET, isLive } from '../workers/syncHarness.js';

const EMAIL = 'someone@example.com';

function worker(env = {}, records = new Map()) {
  const sys = syncSystem({ env, global: records });
  const inAccount = (key, account) => {
    if (account) return sys.accounts.get(account);
    const hit = [...sys.accounts.values()].find(m => m.has(key));
    return hit || records;
  };
  const live = (key, account) => isLive(inAccount(key, account), key);
  const value = (key, account) => live(key, account) ? JSON.parse(inAccount(key, account).get(key).value) : null;
  return { call: sys.call, records, accounts: sys.accounts, live, value };
}

async function signIn(w, email = EMAIL, deviceName = 'Laptop') {
  const req = await w.call('POST', '/auth/request-code', { email });
  expect(req.status).toBe(200);
  const res = await w.call('POST', '/auth/verify-code', { email, code: req.body.devCode, deviceName });
  expect(res.status).toBe(200);
  return res.body;
}
const push = (w, token, baseRevision = 0) => w.call('POST', '/sync/push', { encryptedBlob: 'BLOB' + baseRevision, baseRevision }, token);

afterEach(() => vi.restoreAllMocks());

describe('the secret', () => {
  it('refuses every request, loudly, when EMAIL_HASH_SECRET is not set', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const env of [{ EMAIL_HASH_SECRET: undefined }, { EMAIL_HASH_SECRET: 'short' }]) {
      const w = worker(env);
      for (const [method, path] of [['POST', '/auth/request-code'], ['POST', '/auth/verify-code'], ['GET', '/sync/pull']]) {
        const r = await w.call(method, path, method === 'POST' ? { email: EMAIL } : undefined, 'tok');
        expect(r.status).toBe(503);
        expect(r.body.error).toMatch(/EMAIL_HASH_SECRET/);
      }
      expect(w.records.size).toBe(0);
      expect(w.accounts.size).toBe(0);
    }
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/EMAIL_HASH_SECRET/));
  });

  it('keys accounts by an HMAC of the address, not its plain SHA-256', async () => {
    const h = await hashEmail(EMAIL, SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(await legacyHashEmail(EMAIL));
    expect(h).not.toBe(await hashEmail(EMAIL, SECRET + 'x'));
    expect(await hashEmail('  SomeOne@Example.com ', SECRET)).toBe(h);
    await expect(hashEmail(EMAIL, undefined)).rejects.toThrow(/EMAIL_HASH_SECRET/);
    const w = worker();
    const a = await signIn(w);
    expect(a.emailHash).toBe(h);
    const old = await legacyHashEmail(EMAIL);
    for (const records of [w.records, ...w.accounts.values()]) expect([...records.keys()].some(k => k.includes(old))).toBe(false);
    expect(w.accounts.has(old)).toBe(false);
  });
});

describe('no ghost devices', () => {
  it('a device joins the list on its first push, not at verify-code', async () => {
    const w = worker();
    const a = await signIn(w);
    expect(a.hasEncryptedData).toBe(false);
    expect(w.value(`sync:devices:${a.emailHash}`)).toBe(null);
    // Not usable for anything else before it has synced.
    expect((await w.call('GET', '/sync/devices', undefined, a.sessionToken)).status).toBe(403);
    expect((await push(w, a.sessionToken)).status).toBe(200);
    const listed = await w.call('GET', '/sync/devices', undefined, a.sessionToken);
    expect(listed.body.devices.map(d => d.deviceId)).toEqual([a.deviceId]);
    expect(listed.body.devices[0].deviceName).toBe('Laptop');
  });

  it('a refused sign-in (data but no recovery code) leaves no device and no session behind', async () => {
    const w = worker();
    const a = await signIn(w);
    await push(w, a.sessionToken);
    const b = await signIn(w, EMAIL, 'Desktop');
    expect(b.hasEncryptedData).toBe(true);
    expect((await w.call('GET', '/sync/devices', undefined, a.sessionToken)).body.devices).toHaveLength(1);
    // What the app does when it gives up on the sign-in (SyncEngine.forgetDevice).
    expect((await w.call('DELETE', '/sync/devices/' + b.deviceId, undefined, b.sessionToken)).status).toBe(200);
    expect(w.live(`auth:sess:${b.sessionToken}`)).toBe(false);
    expect(w.value(`auth:sessions:${a.emailHash}`).map(s => s.token)).toEqual([a.sessionToken]);
    expect((await w.call('GET', '/sync/devices', undefined, a.sessionToken)).body.devices.map(d => d.deviceId)).toEqual([a.deviceId]);
  });

  it('a recovery-code join registers on its first pull; a failed one is removed by the app', async () => {
    const w = worker();
    const a = await signIn(w);
    await push(w, a.sessionToken);
    const b = await signIn(w, EMAIL, 'Desktop');
    const pulled = await w.call('GET', '/sync/pull', undefined, b.sessionToken);
    expect(pulled.body.encryptedBlob).toBe('BLOB0');
    expect((await w.call('GET', '/sync/devices', undefined, a.sessionToken)).body.devices).toHaveLength(2);
    // Wrong key on the client → signOut(true) → DELETE its own id.
    await w.call('DELETE', '/sync/devices/' + b.deviceId, undefined, b.sessionToken);
    expect((await w.call('GET', '/sync/devices', undefined, a.sessionToken)).body.devices).toHaveLength(1);
    expect(w.live(`auth:sess:${b.sessionToken}`)).toBe(false);
  });

  it('a push the server refuses (409) does not register the device', async () => {
    const w = worker();
    const a = await signIn(w);
    await push(w, a.sessionToken);
    const b = await signIn(w, EMAIL, 'Desktop');
    expect((await push(w, b.sessionToken, 0)).status).toBe(409);
    expect((await w.call('GET', '/sync/devices', undefined, a.sessionToken)).body.devices).toHaveLength(1);
  });
});

describe('sessions are deleted with their device', () => {
  async function twoDevices() {
    const w = worker();
    const a = await signIn(w);
    await push(w, a.sessionToken);
    const b = await signIn(w, EMAIL, 'Desktop');
    await w.call('GET', '/sync/pull', undefined, b.sessionToken);
    return { w, a, b };
  }

  it('removing a device deletes its session', async () => {
    const { w, a, b } = await twoDevices();
    expect(w.live(`auth:sess:${b.sessionToken}`)).toBe(true);
    await w.call('DELETE', '/sync/devices/' + b.deviceId, undefined, a.sessionToken);
    expect(w.live(`auth:sess:${b.sessionToken}`)).toBe(false);
    expect(w.live(`auth:sess:${a.sessionToken}`)).toBe(true);
    expect((await w.call('GET', '/sync/pull', undefined, b.sessionToken)).status).toBe(401);
  });

  it('wiping the account deletes every session', async () => {
    const { w, a, b } = await twoDevices();
    expect((await w.call('DELETE', '/sync/all', undefined, a.sessionToken)).status).toBe(200);
    expect(w.live(`auth:sess:${a.sessionToken}`)).toBe(false);
    expect(w.live(`auth:sess:${b.sessionToken}`)).toBe(false);
    expect(w.live(`auth:sessions:${a.emailHash}`)).toBe(false);
  });

  it('a session from before the list keeps working, joins it, and is deleted with its device', async () => {
    const w = worker();
    const a = await signIn(w);
    await push(w, a.sessionToken);
    const h = a.emailHash;
    // An old worker's session and device: the session in the global object,
    // the device in the (already moved) list, not in sessions:.
    const at = new Date().toISOString();
    w.records.set('auth:sess:oldtoken', { value: JSON.stringify({ emailHash: h, deviceId: 'abc123', deviceName: 'Old', createdAt: at }), expires: Date.now() + 1e9 });
    const devices = w.value(`sync:devices:${h}`);
    devices.push({ deviceId: 'abc123', deviceName: 'Old', createdAt: at, lastSeenAt: at });
    w.accounts.get(h).set(`sync:devices:${h}`, { value: JSON.stringify(devices), expires: 0 });
    expect((await w.call('GET', '/sync/pull', undefined, 'oldtoken')).status).toBe(200);
    expect(w.value(`auth:sessions:${h}`).map(s => s.token)).toContain('oldtoken');
    await w.call('DELETE', '/sync/devices/abc123', undefined, a.sessionToken);
    expect(w.live('auth:sess:oldtoken')).toBe(false);
  });

  it('a stale session of a wiped account is deleted when it is next seen', async () => {
    const w = worker();
    const a = await signIn(w);
    await push(w, a.sessionToken);
    w.records.set('auth:sess:stale', { value: JSON.stringify({ emailHash: a.emailHash, deviceId: 'dead01', deviceName: 'Gone', createdAt: new Date().toISOString() }), expires: Date.now() + 1e9 });
    expect((await w.call('GET', '/sync/pull', undefined, 'stale')).status).toBe(401);
    expect(w.live('auth:sess:stale')).toBe(false);
  });
});

describe('an account made with the old unsalted key', () => {
  async function oldAccount() {
    const w = worker();
    const old = await legacyHashEmail(EMAIL);
    const at = new Date().toISOString();
    // What the previous worker left: blob, device list, mailbox, one session.
    w.records.set(`sync:blob:${old}`, { value: JSON.stringify({ revision: 3, encryptedBlob: 'OLDBLOB', pushedBy: 'aa11' }), expires: 0 });
    w.records.set(`sync:devices:${old}`, { value: JSON.stringify([{ deviceId: 'aa11', deviceName: 'Old laptop', createdAt: at, lastSeenAt: at }]), expires: 0 });
    w.records.set(`sync:drop:${old}`, { value: JSON.stringify([{ id: 'd1', encryptedBlob: 'TAB', fromDeviceId: 'zz99' }]), expires: Date.now() + 1e9 });
    w.records.set('auth:sess:oldsession', { value: JSON.stringify({ emailHash: old, deviceId: 'aa11', deviceName: 'Old laptop', createdAt: at }), expires: Date.now() + 1e9 });
    return { w, old };
  }

  it('keeps working on the old key until someone signs in', async () => {
    const { w, old } = await oldAccount();
    const r = await w.call('GET', '/sync/pull', undefined, 'oldsession');
    expect(r.body.encryptedBlob).toBe('OLDBLOB');
    expect(w.live(`sync:blob:${old}`)).toBe(true);
  });

  it('is moved to the HMAC key on the next sign-in, and the old device follows it', async () => {
    const { w, old } = await oldAccount();
    // Used once on the new worker before the move: its session joins a list
    // under the old key, which must move too.
    expect((await w.call('GET', '/sync/pull', undefined, 'oldsession')).status).toBe(200);
    expect(w.live(`auth:sessions:${old}`)).toBe(true);
    const b = await signIn(w, EMAIL, 'New desktop');
    const h = await hashEmail(EMAIL, SECRET);
    expect(b.emailHash).toBe(h);
    expect(b.hasEncryptedData).toBe(true);
    expect(w.value(`sync:blob:${h}`).encryptedBlob).toBe('OLDBLOB');
    expect(w.value(`sync:devices:${h}`).map(d => d.deviceId)).toEqual(['aa11']);
    expect(w.value(`sync:drop:${h}`)).toHaveLength(1);
    // The old key's object keeps its copy and forwards from now on.
    expect(w.accounts.get(old).get('meta:forward')).toMatchObject({ to: h });
    // The new device joins with the recovery code: its pull sees the old data.
    const pulled = await w.call('GET', '/sync/pull', undefined, b.sessionToken);
    expect(pulled.body).toMatchObject({ encryptedBlob: 'OLDBLOB', revision: 3 });
    // The old laptop's session still names the old key; it follows the move.
    const oldPull = await w.call('GET', '/sync/pull', undefined, 'oldsession');
    expect(oldPull.status).toBe(200);
    expect(oldPull.body.encryptedBlob).toBe('OLDBLOB');
    expect(w.value('auth:sess:oldsession', h).emailHash).toBe(h);
    expect((await w.call('GET', '/sync/devices', undefined, 'oldsession')).body.devices.map(d => d.deviceId).sort()).toEqual(['aa11', b.deviceId].sort());
    // Its handoff mailbox came along too.
    expect((await w.call('GET', '/sync/drop', undefined, 'oldsession')).body.items).toHaveLength(1);
    // The global object sends every session of the old key here.
    expect(w.records.get(`auth:alias:${old}`).value).toBe(h);
  });
});
