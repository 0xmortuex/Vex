// @vitest-environment node
//
// One Durable Object per sync account, and the move of every account out of
// the single global object that workers up to v2.37.0 kept them all in.
//
// The "before" state is made by running the previous worker itself
// (fixtures/vex-sync-worker-global.js) on in-memory storage; the current
// worker then runs on that same storage, as it will after a deploy.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { hashEmail, legacyHashEmail } from '../../workers/vex-sync-worker/worker.js';
import { syncSystem, previousWorker, memoryKV, isLive, liveValue, SECRET } from './syncHarness.js';

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';

afterEach(() => vi.restoreAllMocks());

// What the owner's deployment holds today, made by the previous worker:
// two accounts, the owner's with two devices, revision 3, a tab in the
// handoff mailbox, and a session from before the per-account session list.
async function previousDeployment() {
  const old = syncSystem({ module: previousWorker });
  const laptop = await old.signIn(OWNER, 'Laptop');
  expect((await old.push(laptop.sessionToken, 0)).status).toBe(200);
  const desktop = await old.signIn(OWNER, 'Desktop');
  expect((await old.call('GET', '/sync/pull', undefined, desktop.sessionToken)).status).toBe(200);
  expect((await old.push(desktop.sessionToken, 1)).status).toBe(200);
  expect((await old.push(laptop.sessionToken, 2)).status).toBe(200);
  expect((await old.call('POST', '/sync/drop', { encryptedBlob: 'TAB-FOR-DESKTOP' }, laptop.sessionToken)).status).toBe(200);
  const phone = await old.signIn(OTHER, 'Phone');
  expect((await old.push(phone.sessionToken, 0, 'OTHER-BLOB')).status).toBe(200);
  // A session issued before the session list existed: in the device list,
  // not in sessions:<account>.
  const A = laptop.emailHash;
  const at = new Date().toISOString();
  old.global.set('auth:sess:prelist01', { value: JSON.stringify({ emailHash: A, deviceId: 'abc123', deviceName: 'Old tablet', createdAt: at }), expires: Date.now() + 1e9 });
  const devices = liveValue(old.global, `sync:devices:${A}`);
  devices.push({ deviceId: 'abc123', deviceName: 'Old tablet', createdAt: at, lastSeenAt: at });
  old.global.set(`sync:devices:${A}`, { value: JSON.stringify(devices), expires: 0 });
  return { global: old.global, laptop, desktop, phone, A, B: phone.emailHash };
}

// Everything but the token-to-account routes the global object caches.
const snapshot = map => JSON.stringify([...map.entries()].filter(([k]) => !k.startsWith('auth:route:')).sort(([a], [b]) => (a < b ? -1 : 1)));

describe('moving each account into its own object', () => {
  it('every signed-in device keeps working and sees its data, revision and mailbox', async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    const pulled = await w.call('GET', '/sync/pull', undefined, d.laptop.sessionToken);
    expect(pulled.status).toBe(200);
    expect(pulled.body).toMatchObject({ ok: true, revision: 3, encryptedBlob: 'BLOB2' });
    const desk = await w.call('GET', '/sync/devices', undefined, d.desktop.sessionToken);
    expect(desk.status).toBe(200);
    expect(desk.body.devices.map(x => x.deviceName).sort()).toEqual(['Desktop', 'Laptop', 'Old tablet']);
    expect(desk.body.currentDeviceId).toBe(d.desktop.deviceId);
    const drop = await w.call('GET', '/sync/drop', undefined, d.desktop.sessionToken);
    expect(drop.body.items.map(i => i.encryptedBlob)).toEqual(['TAB-FOR-DESKTOP']);
    // The session from before the list is looked up on first use.
    expect((await w.call('GET', '/sync/pull', undefined, 'prelist01')).body.revision).toBe(3);
    // Nobody was signed out.
    for (const t of [d.laptop.sessionToken, d.desktop.sessionToken, 'prelist01', d.phone.sessionToken]) {
      expect((await w.call('GET', '/sync/pull', undefined, t)).status).toBe(200);
    }
    // The account now lives in its own object.
    const own = w.accounts.get(d.A);
    expect(own.get('meta:migrated')).toMatchObject({ revision: 3 });
    expect(liveValue(own, `sync:blob:${d.A}`).revision).toBe(3);
  });

  it('revisions continue from where they were, and a stale push still gets 409', async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    expect((await w.push(d.desktop.sessionToken, 3)).body).toMatchObject({ ok: true, revision: 4 });
    const stale = await w.push(d.laptop.sessionToken, 3);
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: 'Sync conflict: pull and merge before pushing', revision: 4 });
    expect((await w.push(d.laptop.sessionToken, 4, 'MERGED')).body.revision).toBe(5);
    expect((await w.call('GET', '/sync/pull', undefined, d.desktop.sessionToken)).body).toMatchObject({ revision: 5, encryptedBlob: 'MERGED', pushedBy: d.laptop.deviceId });
  });

  it('leaves the old copy in the global object exactly as it was', async () => {
    const d = await previousDeployment();
    const accountKeys = [...d.global.keys()].filter(k => k.includes(d.A) || k.startsWith('auth:sess:'));
    const before = new Map(accountKeys.map(k => [k, structuredClone(d.global.get(k))]));
    const w = syncSystem({ global: d.global });
    await w.push(d.desktop.sessionToken, 3);
    await w.call('GET', '/sync/drop', undefined, d.desktop.sessionToken);
    await w.call('DELETE', '/sync/devices/abc123', undefined, d.laptop.sessionToken);
    for (const [k, v] of before) expect(d.global.get(k)).toEqual(v);
    expect(liveValue(d.global, `sync:blob:${d.A}`).revision).toBe(3);
  });

  it('copies each account once, even when its devices all arrive at the same moment', async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    const tokens = [d.laptop.sessionToken, d.desktop.sessionToken, 'prelist01', d.laptop.sessionToken, d.desktop.sessionToken];
    const results = await Promise.all(tokens.map(t => w.call('GET', '/sync/pull', undefined, t)));
    expect(results.map(r => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(results.every(r => r.body.revision === 3)).toBe(true);
    const exports = w.calls.filter(([to, path]) => to === 'global' && path === '/internal/export-account');
    expect(exports).toHaveLength(1);
    // Concurrent pushes on one base: exactly one wins.
    const pushes = await Promise.all([w.push(d.laptop.sessionToken, 3, 'L'), w.push(d.desktop.sessionToken, 3, 'D')]);
    expect(pushes.map(p => p.status).sort()).toEqual([200, 409]);
  });

  it('an interrupted copy is finished by the next request and loses nothing', async () => {
    const d = await previousDeployment();
    const before = snapshot(d.global);
    let failures = 2;
    const w = syncSystem({
      global: d.global,
      hooks: {
        // First the batch write dies halfway, then the "moved" mark does.
        account: () => ({ beforePut: k => { if ((k === `auth:sessions:${d.A}` && failures === 2) || (k === 'meta:migrated' && failures === 1)) { failures--; throw new Error('Durable Object reset'); } } }),
      },
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await w.call('GET', '/sync/pull', undefined, d.laptop.sessionToken)).status).toBe(500);
    expect(w.accounts.get(d.A).has('meta:migrated')).toBe(false);
    expect((await w.call('GET', '/sync/pull', undefined, d.laptop.sessionToken)).status).toBe(500);
    expect(err).toHaveBeenCalledWith('[vex-sync] account request failed:', 'Durable Object reset');
    // The global copy was never touched by the failures.
    expect(snapshot(d.global)).toBe(before);
    const ok = await w.call('GET', '/sync/pull', undefined, d.laptop.sessionToken);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ revision: 3, encryptedBlob: 'BLOB2' });
    expect((await w.call('GET', '/sync/devices', undefined, d.desktop.sessionToken)).body.devices).toHaveLength(3);
    expect(w.accounts.get(d.A).get('meta:migrated')).toBeTruthy();
  });

  it('a pre-DO account still in Workers KV is carried through the global object', async () => {
    const A = await hashEmail(OWNER, SECRET);
    const at = new Date().toISOString();
    const kvSync = memoryKV({ [`blob:${A}`]: JSON.stringify({ revision: 7, encryptedBlob: 'FROM-KV' }), [`devices:${A}`]: JSON.stringify([{ deviceId: 'cc01', deviceName: 'Old PC', createdAt: at, lastSeenAt: at }]) });
    const kvAuth = memoryKV({ 'sess:kvtoken': JSON.stringify({ emailHash: A, deviceId: 'cc01', deviceName: 'Old PC', createdAt: at }) });
    const w = syncSystem({ env: { VEX_SYNC_KV: kvSync, VEX_AUTH_KV: kvAuth } });
    expect((await w.call('GET', '/sync/pull', undefined, 'kvtoken')).body).toMatchObject({ revision: 7, encryptedBlob: 'FROM-KV' });
    expect((await w.push('kvtoken', 7)).body.revision).toBe(8);
    expect(kvSync.raw.get(`blob:${A}`)).toContain('"revision":7');
  });
});

describe('accounts cannot reach each other', () => {
  it('each account sees only its own data, whatever headers a client sends', async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    const other = await w.call('GET', '/sync/pull', undefined, d.phone.sessionToken, { 'X-Vex-Account': d.A });
    expect(other.body).toMatchObject({ revision: 1, encryptedBlob: 'OTHER-BLOB' });
    expect((await w.call('GET', '/sync/devices', undefined, d.phone.sessionToken, { 'X-Vex-Account': d.A })).body.devices.map(x => x.deviceName)).toEqual(['Phone']);
    await w.call('GET', '/sync/pull', undefined, d.laptop.sessionToken);
    expect([...w.accounts.get(d.A).keys()].some(k => k.includes(d.B))).toBe(false);
    expect([...w.accounts.get(d.B).keys()].some(k => k.includes(d.A))).toBe(false);
    expect([...w.accounts.get(d.B).keys()].some(k => k.includes(d.laptop.sessionToken))).toBe(false);
  });

  it("an account's object refuses another account's session even if it is routed there", async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    await w.call('GET', '/sync/pull', undefined, d.phone.sessionToken);
    const misrouted = await w.env.VEX_ACCOUNTS.get({ name: d.B }).fetch(new Request('http://localhost/sync/pull', { headers: { Authorization: 'Bearer ' + d.laptop.sessionToken, 'X-Vex-Account': d.B } }));
    expect(misrouted.status).toBe(401);
    expect(await misrouted.json()).toEqual({ error: 'Invalid session' });
    // And an object bound to one account refuses requests naming another.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrong = await w.env.VEX_ACCOUNTS.get({ name: d.B }).fetch(new Request('http://localhost/sync/pull', { headers: { Authorization: 'Bearer ' + d.phone.sessionToken, 'X-Vex-Account': d.A } }));
    expect(wrong.status).toBe(500);
    expect(err).toHaveBeenCalledWith('[vex-sync] account request failed:', 'Request for another account');
  });

  it('clients cannot call the internal paths', async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    for (const path of ['/internal/route', '/internal/export-account', '/internal/handover', '/internal/alias']) {
      const r = await w.call('POST', path, { token: d.laptop.sessionToken, account: d.A, to: d.B });
      expect(r).toEqual({ status: 404, body: { error: 'Not found' } });
    }
    expect(w.calls.some(([, path]) => path.startsWith('/internal/') && path !== '/internal/route')).toBe(false);
  });

  it('an unknown token is refused before any account object is touched', async () => {
    const w = syncSystem();
    expect(await w.call('GET', '/sync/pull', undefined, 'f'.repeat(64))).toEqual({ status: 401, body: { error: 'Invalid session' } });
    expect(await w.call('GET', '/sync/pull')).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    expect(w.accounts.size).toBe(0);
  });
});

describe('after the move', () => {
  it('a new device joins the moved account', async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    const fresh = await w.signIn(OWNER, 'New PC');
    expect(fresh.hasEncryptedData).toBe(true);
    expect(fresh.emailHash).toBe(d.A);
    expect(Object.keys(fresh).sort()).toEqual(['deviceId', 'emailHash', 'hasEncryptedData', 'ok', 'sessionToken']);
    expect((await w.call('GET', '/sync/devices', undefined, fresh.sessionToken)).status).toBe(403);
    expect((await w.call('GET', '/sync/pull', undefined, fresh.sessionToken)).body.revision).toBe(3);
    expect((await w.call('GET', '/sync/devices', undefined, d.laptop.sessionToken)).body.devices).toHaveLength(4);
    // The new session lives in the account's object, not the global one.
    expect(isLive(w.accounts.get(d.A), `auth:sess:${fresh.sessionToken}`)).toBe(true);
    expect([...d.global.keys()].some(k => k === `auth:sess:${fresh.sessionToken}`)).toBe(false);
  });

  it('a removed device stays removed, even though the old copy still lists it', async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    expect((await w.call('DELETE', '/sync/devices/' + d.desktop.deviceId, undefined, d.laptop.sessionToken)).status).toBe(200);
    expect((await w.call('GET', '/sync/pull', undefined, d.desktop.sessionToken)).status).toBe(401);
    expect((await w.call('GET', '/sync/pull', undefined, d.desktop.sessionToken)).status).toBe(401);
    expect(isLive(d.global, `auth:sess:${d.desktop.sessionToken}`)).toBe(true);
    // The pre-list session, removed before it was ever used here.
    await w.call('DELETE', '/sync/devices/abc123', undefined, d.laptop.sessionToken);
    expect((await w.call('GET', '/sync/pull', undefined, 'prelist01')).body).toEqual({ error: 'Device revoked' });
  });

  it('wiping the account also wipes the copy the previous worker left, and it never comes back', async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    expect((await w.call('DELETE', '/sync/all', undefined, d.laptop.sessionToken)).status).toBe(200);
    for (const t of [d.laptop.sessionToken, d.desktop.sessionToken]) expect((await w.call('GET', '/sync/pull', undefined, t)).status).toBe(401);
    for (const kind of ['blob', 'devices', 'drop']) expect(isLive(d.global, `sync:${kind}:${d.A}`)).toBe(false);
    expect(isLive(d.global, `auth:sess:${d.laptop.sessionToken}`)).toBe(false);
    const again = await w.signIn(OWNER, 'Laptop');
    expect(again.hasEncryptedData).toBe(false);
    expect((await w.call('GET', '/sync/pull', undefined, again.sessionToken)).body).toEqual({ ok: true, blob: null });
    // The other account is untouched.
    expect((await w.call('GET', '/sync/pull', undefined, d.phone.sessionToken)).body.encryptedBlob).toBe('OTHER-BLOB');
  });

  it('rolling back to the previous worker still serves the copy it left (changes since are not in it)', async () => {
    const d = await previousDeployment();
    const w = syncSystem({ global: d.global });
    await w.push(d.desktop.sessionToken, 3);
    const back = syncSystem({ module: previousWorker, global: d.global });
    expect((await back.call('GET', '/sync/pull', undefined, d.laptop.sessionToken)).body).toMatchObject({ revision: 3, encryptedBlob: 'BLOB2' });
    // A client that had revision 4 gets 409 and pulls, as after any race.
    expect((await back.push(d.desktop.sessionToken, 4)).body).toMatchObject({ revision: 3 });
  });
});

describe('an account made before the HMAC key', () => {
  // The previous worker's storage for an account keyed by the plain SHA-256.
  async function unsalted() {
    const old = await legacyHashEmail(OWNER);
    const global = new Map();
    const at = new Date().toISOString();
    global.set(`sync:blob:${old}`, { value: JSON.stringify({ revision: 3, encryptedBlob: 'OLDBLOB', pushedBy: 'aa11' }), expires: 0 });
    global.set(`sync:devices:${old}`, { value: JSON.stringify([{ deviceId: 'aa11', deviceName: 'Old laptop', createdAt: at, lastSeenAt: at }]), expires: 0 });
    global.set(`sync:drop:${old}`, { value: JSON.stringify([{ id: 'd1', encryptedBlob: 'TAB', fromDeviceId: 'zz99' }]), expires: Date.now() + 1e9 });
    global.set('auth:sess:oldsession', { value: JSON.stringify({ emailHash: old, deviceId: 'aa11', deviceName: 'Old laptop', createdAt: at }), expires: Date.now() + 1e9 });
    return { global, old, h: await hashEmail(OWNER, SECRET) };
  }

  it('keeps syncing on the old key, then a sign-in takes it over with everything synced since', async () => {
    const { global, old, h } = await unsalted();
    const w = syncSystem({ global });
    expect((await w.call('GET', '/sync/pull', undefined, 'oldsession')).body.encryptedBlob).toBe('OLDBLOB');
    expect((await w.push('oldsession', 3, 'SINCE-DEPLOY')).body.revision).toBe(4);
    const b = await w.signIn(OWNER, 'New desktop');
    expect(b.emailHash).toBe(h);
    expect(b.hasEncryptedData).toBe(true);
    expect((await w.call('GET', '/sync/pull', undefined, b.sessionToken)).body).toMatchObject({ revision: 4, encryptedBlob: 'SINCE-DEPLOY' });
    // The old laptop is not signed out; it now syncs in the HMAC-keyed object.
    expect((await w.push('oldsession', 4, 'FROM-OLD-LAPTOP')).body.revision).toBe(5);
    expect((await w.call('GET', '/sync/pull', undefined, b.sessionToken)).body.encryptedBlob).toBe('FROM-OLD-LAPTOP');
    expect((await w.call('GET', '/sync/devices', undefined, 'oldsession')).body.devices.map(x => x.deviceId).sort()).toEqual(['aa11', b.deviceId].sort());
    expect((await w.call('GET', '/sync/drop', undefined, b.sessionToken)).body.items).toHaveLength(1);
    expect(liveValue(w.accounts.get(h), `sync:blob:${h}`).encryptedBlob).toBe('FROM-OLD-LAPTOP');
    // The old object keeps its copy and forwards.
    expect(w.accounts.get(old).get('meta:forward')).toMatchObject({ to: h });
    expect(liveValue(w.accounts.get(old), `sync:blob:${old}`).encryptedBlob).toBe('SINCE-DEPLOY');
  });

  it('a takeover cut off halfway finishes on the next request', async () => {
    const { global, h } = await unsalted();
    let fail = true;
    const w = syncSystem({ global, hooks: { global: { beforePut: k => { if (k.startsWith('auth:alias:') && fail) { fail = false; throw new Error('Durable Object reset'); } } } } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = await w.call('POST', '/auth/request-code', { email: OWNER });
    expect((await w.call('POST', '/auth/verify-code', { email: OWNER, code: req.body.devCode, deviceName: 'X' })).status).toBe(500);
    // The old laptop's next request reaches the new object, which finishes.
    const r = await w.call('GET', '/sync/pull', undefined, 'oldsession');
    expect(r.body).toMatchObject({ revision: 3, encryptedBlob: 'OLDBLOB' });
    expect(w.accounts.get(h).get('meta:adopted')).toBeTruthy();
    expect(w.accounts.get(h).has('meta:adopting')).toBe(false);
    const b = await w.signIn(OWNER, 'Y');
    expect(b.hasEncryptedData).toBe(true);
  });

  it('a device the previous worker already moved follows its pointer', async () => {
    const { global, h } = await unsalted();
    // The previous worker moved the account at a sign-in; the old laptop has
    // not synced since.
    const old = syncSystem({ module: previousWorker, global });
    await old.signIn(OWNER, 'Signed in before the upgrade');
    const w = syncSystem({ global });
    const r = await w.call('GET', '/sync/pull', undefined, 'oldsession');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ revision: 3, encryptedBlob: 'OLDBLOB' });
    expect(w.accounts.has(h)).toBe(true);
    expect([...w.accounts.keys()]).toEqual([h]);
  });

  it('a brand-new account looks for an old one once and leaves no trace of the plain hash', async () => {
    const w = syncSystem();
    const a = await w.signIn(OTHER);
    await w.push(a.sessionToken, 0);
    await w.signIn(OTHER, 'Second');
    const plain = await legacyHashEmail(OTHER);
    expect(w.accounts.has(plain)).toBe(false);
    for (const records of [w.global, ...w.accounts.values()]) expect([...records.keys()].some(k => k.includes(plain))).toBe(false);
    expect(w.calls.filter(([, path]) => path === '/internal/has-account')).toHaveLength(1);
  });
});
