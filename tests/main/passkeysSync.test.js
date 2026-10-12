// Passkeys in Vex Sync: sealed one by one in the main process
// (src/main/sync-secrets.js kind "passkeys"), so a second device can sign in
// with a passkey made on the first, and nothing readable leaves either.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createPasskeyService } = require('../../src/main/passkeys.js');
const { createSyncSecrets } = require('../../src/main/sync-secrets.js');
const pc = require('../../src/main/passkey-crypto.js');
const V = require('../helpers/webauthn-verify.js');

const KEY = crypto.randomBytes(32).toString('hex');
const ORIGIN = 'https://example.com';
let dirs;
beforeEach(() => { dirs = []; });
afterEach(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function device({ sync = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-pk-sync-'));
  dirs.push(dir);
  const st = { sync, answer: null, asks: [] };
  const win = { isDestroyed: () => false };
  const svc = createPasskeyService({
    safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from('E' + Buffer.from(s).toString('base64')), decryptString: b => Buffer.from(b.toString().slice(1), 'base64').toString() },
    ipcMain: { handle() {}, on() {} },
    atomicWrite: (f, b) => fs.promises.writeFile(f, b),
    userDataPath: dir,
    ownerOf: () => ({ win, privatePartition: null }),
    partitionOf: () => 'persist:main',
    syncOn: () => st.sync,
    windowSend: (_w, channel, payload) => {
      if (channel === 'passkeys:ask') setTimeout(() => svc.answer(payload.id, typeof st.answer === 'function' ? st.answer(payload) : st.answer), 0);
      return true;
    },
  });
  const secrets = createSyncSecrets({
    readKeyHex: async () => KEY, isLocked: () => false,
    stores: { passkeys: { load: () => svc.syncStore.load(), save: (l) => svc.syncStore.save(l), validate: (e) => svc.validateRecord(e) } },
  });
  const frame = { url: ORIGIN + '/login' };
  const wc = { id: 1, mainFrame: frame, on() {}, once() {} };
  return { svc, secrets, st, event: { sender: wc, senderFrame: frame } };
}
const create = (user = 'ada') => ({ op: 'create', id: crypto.randomBytes(12).toString('base64url'), publicKey: {
  challenge: pc.b64u(crypto.randomBytes(32)), rp: { id: 'example.com', name: 'Example' }, user: { id: pc.b64u(Buffer.from(user)), name: user, displayName: user },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } });
const get = () => ({ op: 'get', id: crypto.randomBytes(12).toString('base64url'), publicKey: { challenge: pc.b64u(crypto.randomBytes(32)), rpId: 'example.com', allowCredentials: [] } });
const J = (c) => ({ id: c.id, rawId: c.rawId, response: c });

describe('passkeys through Vex Sync', () => {
  it('seals no key, name or site into what leaves main', async () => {
    const a = device();
    a.st.answer = { action: 'save' };
    await a.svc.handleRequest(a.event, create('ada@example.com'));
    const sealed = await a.secrets.sealKinds(['passkeys']);
    const text = JSON.stringify(sealed);
    const rec = a.svc.load()[0];
    for (const plain of [rec.privateKeyPkcs8, rec.credentialId, 'ada@example.com', 'example.com', 'Example']) expect(text).not.toContain(plain);
    expect(sealed.passkeys).toHaveLength(1);
  });

  it('a second device signs in with a passkey made on the first, and a site verifies it', async () => {
    const a = device(), b = device();
    a.st.answer = { action: 'save' };
    const req = create();
    const made = await a.svc.handleRequest(a.event, req);
    const stored = V.verifyRegistration(J(made.credential), { challenge: req.publicKey.challenge, origin: ORIGIN, rpId: 'example.com' });
    expect(stored.flags).toMatchObject({ BE: true, BS: true });

    await b.secrets.sealKinds(['passkeys']);
    const theirs = await a.secrets.sealKinds(['passkeys']);
    expect(await b.secrets.applyKinds(theirs)).toEqual({ changed: 1 });
    expect(b.svc.list()).toHaveLength(1);
    expect(b.svc.list()[0].deviceOnly).toBe(false);

    b.st.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId });
    const gr = get();
    const res = await b.svc.handleRequest(b.event, gr);
    const v = V.verifyAssertion(J(res.credential), { publicKey: stored.publicKey, signCount: 0 }, { challenge: gr.publicKey.challenge, origin: ORIGIN, rpId: 'example.com' });
    expect(v.flags).toMatchObject({ BE: true, BS: true });
    expect(v.signCount).toBe(0);
  });

  it('a deletion on one device reaches the other', async () => {
    const a = device(), b = device();
    a.st.answer = { action: 'save' };
    await a.svc.handleRequest(a.event, create());
    await b.secrets.sealKinds(['passkeys']);
    await b.secrets.applyKinds(await a.secrets.sealKinds(['passkeys']));
    expect(b.svc.list()).toHaveLength(1);
    await a.svc.remove(a.svc.list()[0].credentialId);
    const afterDelete = await a.secrets.sealKinds(['passkeys']);
    await b.secrets.sealKinds(['passkeys']);
    expect(await b.secrets.applyKinds(afterDelete)).toEqual({ changed: 1 });
    expect(b.svc.list()).toHaveLength(0);
  });

  it('a rename travels, and using a passkey is not a sync change', async () => {
    const a = device(), b = device();
    a.st.answer = { action: 'save' };
    await a.svc.handleRequest(a.event, create());
    const first = await a.secrets.sealKinds(['passkeys']);
    a.st.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId });
    await a.svc.handleRequest(a.event, get());
    expect(await a.secrets.sealKinds(['passkeys'])).toEqual(first);
    await a.svc.rename(a.svc.list()[0].credentialId, 'Work');
    const renamed = await a.secrets.sealKinds(['passkeys']);
    expect(renamed.passkeys[0].s).not.toBe(first.passkeys[0].s);
    await b.secrets.sealKinds(['passkeys']);
    await b.secrets.applyKinds(renamed);
    expect(b.svc.list()[0].nickname).toBe('Work');
  });

  it('device-only passkeys (made with sync off) are never sealed and survive a sync', async () => {
    const a = device({ sync: false });
    a.st.answer = { action: 'save' };
    await a.svc.handleRequest(a.event, create());
    expect((await a.secrets.sealKinds(['passkeys'])).passkeys).toEqual([]);
    await a.secrets.applyKinds({ passkeys: [] });
    expect(a.svc.list()).toHaveLength(1);
  });

  it('refuses an item whose keys do not match, and one sealed with another sync key', async () => {
    const a = device(), b = device();
    a.st.answer = { action: 'save' };
    await a.svc.handleRequest(a.event, create());
    const rec = a.svc.load()[0];
    const otherPair = pc.generateCredentialKey();
    // A well-formed record whose private key is not the one for its public key.
    const forged = device();
    forged.svc.syncStore.load = () => [{ ...rec, privateKeyPkcs8: pc.b64u(otherPair.privateKeyPkcs8) }];
    const forgedSecrets = createSyncSecrets({ readKeyHex: async () => KEY, isLocked: () => false, stores: { passkeys: { load: () => forged.svc.syncStore.load(), save: async () => {} } } });
    const sealed = await forgedSecrets.sealKinds(['passkeys']);
    await b.secrets.sealKinds(['passkeys']);
    await expect(b.secrets.applyKinds(sealed)).rejects.toThrow(/do not match/);
    expect(b.svc.list()).toHaveLength(0);
    const stranger = createSyncSecrets({ readKeyHex: async () => 'ee'.repeat(32), isLocked: () => false, stores: { passkeys: { load: () => a.svc.syncStore.load(), save: async () => {} } } });
    await expect(b.secrets.applyKinds(await stranger.sealKinds(['passkeys']))).rejects.toThrow(/could not be opened/);
  });
});
