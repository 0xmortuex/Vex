// Vex as a WebAuthn authenticator: the main-process service, end to end with
// the independent relying-party verifier. No window, no network, no real
// key store: safeStorage is a stand-in, the sheet is answered by the test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createPasskeyService, normalizeRequest, wantsNative } = require('../../src/main/passkeys.js');
const pc = require('../../src/main/passkey-crypto.js');
const V = require('../helpers/webauthn-verify.js');
// The service answers with flat fields; a page's toJSON() nests them under `response`.
const J = (c) => ({ id: c.id, rawId: c.rawId, response: c });
const VR = (c, e) => V.verifyRegistration(J(c), e);
const VA = (c, st, e) => V.verifyAssertion(J(c), st, e);

const ORIGIN = 'https://login.example.com';
const CHALLENGE = pc.b64u(crypto.randomBytes(32));
const USER_ID = pc.b64u(Buffer.from('user-1234'));

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-passkeys-test-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function setup(over = {}) {
  const state = { locked: false, pin: null, sync: false, suppressed: false, partition: 'persist:main', privateWindow: false, tor: false, asks: [], sent: [], answer: null, pinTries: [] };
  Object.assign(state, over.state || {});
  const handlers = new Map();
  const win = { isDestroyed: () => false };
  const svc = createPasskeyService({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from('ENC' + Buffer.from(s).toString('base64')),
      decryptString: (b) => Buffer.from(b.toString().slice(3), 'base64').toString(),
    },
    ipcMain: { handle: (c, f) => handlers.set(c, f), on: (c, f) => handlers.set(c, f) },
    atomicWrite: async (f, bytes) => fs.promises.writeFile(f, bytes),
    userDataPath: dir,
    isLocked: () => state.locked,
    hasPin: () => state.pin !== null,
    verifyPin: async (p) => { state.pinTries.push(p); return p === state.pin ? { ok: true } : { ok: false, error: 'Wrong PIN' }; },
    ownerOf: () => ({ win, privatePartition: state.privateWindow ? 'private:1' : null }),
    partitionOf: () => state.partition,
    isTorContents: () => state.tor,
    suppressedFor: () => state.suppressed,
    syncOn: () => state.sync,
    windowSend: (_w, channel, payload) => {
      if (channel === 'passkeys:ask') {
        state.asks.push(payload);
        setTimeout(async () => {
          if (!state.answer) return;
          const a = typeof state.answer === 'function' ? state.answer(payload) : state.answer;
          const r = await svc.answer(payload.id, a);
          state.results = (state.results || []).concat([r]);
          // A refused answer (wrong PIN) leaves the sheet open: answer again if asked to.
          if (!r.ok && !r.gone && state.retry) { const again = state.retry(payload); if (again) await svc.answer(payload.id, again); }
        }, 0);
      } else state.sent.push([channel, payload]);
      return true;
    },
    now: () => Date.UTC(2026, 9, 12, 12, 0, 0),
    ...(over.deps || {}),
  });
  svc.register();
  const frame = { url: ORIGIN + '/signin?x=1' };
  const wc = { id: 41, mainFrame: frame, on() {}, once() {} };
  const event = (f = frame) => ({ sender: wc, senderFrame: f });
  return { svc, state, handlers, event, frame, wc, files: () => fs.readdirSync(dir) };
}

const createReq = (over = {}) => ({
  op: 'create', id: 'r1', mediation: 'optional',
  publicKey: {
    challenge: CHALLENGE, rp: { id: 'example.com', name: 'Example' }, user: { id: USER_ID, name: 'ada@example.com', displayName: 'Ada' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000,
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }, ...over,
  },
});
const getReq = (over = {}, extra = {}) => ({
  op: 'get', id: 'g1', mediation: 'optional',
  publicKey: { challenge: pc.b64u(crypto.randomBytes(32)), rpId: 'example.com', userVerification: 'preferred', allowCredentials: [], ...over }, ...extra,
});
const expectedFor = (req, o = {}) => ({ challenge: req.publicKey.challenge, origin: ORIGIN, rpId: 'example.com', ...o });

async function register(h, over) {
  h.state.answer = { action: 'save', nickname: 'Work laptop' };
  const req = createReq(over);
  const res = await h.svc.handleRequest(h.event(), req);
  return { req, res };
}

describe('registration', () => {
  it('creates a passkey a relying party verifies, and the key never leaves main', async () => {
    const h = setup();
    const { req, res } = await register(h);
    expect(res.ok).toBe(true);
    const v = VR(res.credential, expectedFor(req));
    expect(v.flags).toMatchObject({ UP: true, UV: false, AT: true, BE: false, BS: false });
    expect(v.aaguid.equals(Buffer.alloc(16))).toBe(true);
    expect(v.signCount).toBe(0);
    expect(res.credential.authenticatorAttachment).toBe('platform');
    expect(res.credential.transports).toEqual(['internal']);
    // The record is encrypted at rest, and no answer or ask carries a private key.
    const stored = h.svc.load()[0];
    const everything = JSON.stringify([res, h.state.asks, h.state.sent, h.svc.list()]);
    expect(everything).not.toContain(stored.privateKeyPkcs8);
    expect(everything).not.toMatch(/privateKey/);
    const raw = fs.readFileSync(path.join(dir, 'passkeys.dat'));
    expect(raw.toString()).not.toContain('ada@example.com');
    expect(raw.toString().startsWith('ENC')).toBe(true);
  });
  it('asks with the site, the account and the name to save', async () => {
    const h = setup();
    await register(h);
    expect(h.state.asks[0]).toMatchObject({ kind: 'create', host: 'login.example.com', rpId: 'example.com', rpName: 'Example', userName: 'ada@example.com', uv: 'none', hasPin: false, syncOn: false });
    expect(h.svc.list()[0]).toMatchObject({ nickname: 'Work laptop', deviceOnly: true, rpId: 'example.com' });
  });
  it('takes the origin from the frame, not from anything the page said', async () => {
    const h = setup();
    const { req, res } = await register(h);
    const cd = JSON.parse(Buffer.from(res.credential.clientDataJSON, 'base64url'));
    expect(cd).toEqual({ type: 'webauthn.create', challenge: req.publicKey.challenge, origin: ORIGIN, crossOrigin: false });
  });
  it('refuses an rp id the page is not under (SecurityError) and shows nothing', async () => {
    const h = setup();
    await expect(h.svc.handleRequest(h.event(), createReq({ rp: { id: 'bank.com', name: 'Bank' } }))).rejects.toMatchObject({ name: 'SecurityError' });
    expect(h.state.asks).toHaveLength(0);
  });
  it('refuses a frame that is not the top page', async () => {
    const h = setup();
    await expect(h.svc.handleRequest({ sender: h.wc, senderFrame: { url: 'https://evil.test/' } }, createReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
  it('needs ES256 in pubKeyCredParams', async () => {
    const h = setup();
    await expect(h.svc.handleRequest(h.event(), createReq({ pubKeyCredParams: [{ type: 'public-key', alg: -257 }] }))).rejects.toMatchObject({ name: 'NotSupportedError' });
  });
  it('cancel is NotAllowedError and stores nothing', async () => {
    const h = setup();
    h.state.answer = { action: 'cancel' };
    await expect(h.svc.handleRequest(h.event(), createReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(h.svc.list()).toHaveLength(0);
  });
  it('"Never for this site" stores nothing and refuses', async () => {
    const h = setup();
    h.state.answer = { action: 'never' };
    await expect(h.svc.handleRequest(h.event(), createReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(h.svc.list()).toHaveLength(0);
  });
  it('a new passkey for the same account replaces the old one', async () => {
    const h = setup();
    const a = await register(h);
    const b = await register(h);
    expect(h.state.asks[1].replaces.credentialId).toBe(a.res.credential.id);
    const list = h.svc.list();
    expect(list).toHaveLength(1);
    expect(list[0].credentialId).toBe(b.res.credential.id);
  });
  it('excludeCredentials that match refuse with InvalidStateError after telling the person', async () => {
    const h = setup();
    const first = await register(h);
    h.state.answer = { action: 'ok' };
    await expect(h.svc.handleRequest(h.event(), createReq({ user: { id: pc.b64u(Buffer.from('someone-else')), name: 'x', displayName: 'x' }, excludeCredentials: [{ id: first.res.credential.id, transports: ['internal'] }] })))
      .rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(h.state.asks.at(-1).kind).toBe('exists');
    expect(h.svc.list()).toHaveLength(1);
  });
  it('returns credProps when asked', async () => {
    const h = setup();
    const { res } = await register(h, { extensions: { credProps: true } });
    expect(res.credential.clientExtensionResults).toEqual({ credProps: { rk: true } });
  });
});

describe('sign in', () => {
  async function withPasskey(o) {
    const h = setup(o);
    const first = await register(h);
    const stored = VR(first.res.credential, expectedFor(first.req));
    return { h, stored: { publicKey: stored.publicKey, signCount: 0, userHandle: Buffer.from('user-1234') }, id: first.res.credential.id };
  }
  it('signs a challenge a relying party verifies, with a counter that rises', async () => {
    const { h, stored, id } = await withPasskey();
    h.state.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId });
    for (const n of [1, 2]) {
      const req = getReq();
      const res = await h.svc.handleRequest(h.event(), req);
      expect(res.ok).toBe(true);
      expect(res.credential.id).toBe(id);
      const v = VA(res.credential, stored, expectedFor(req));
      expect(v.signCount).toBe(n);
      stored.signCount = v.signCount;
    }
    expect(h.svc.list()[0].lastUsedAt).toBeTruthy();
  });
  it('returns the user handle and the platform attachment', async () => {
    const { h } = await withPasskey();
    h.state.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId });
    const res = await h.svc.handleRequest(h.event(), getReq());
    expect(Buffer.from(res.credential.userHandle, 'base64url').toString()).toBe('user-1234');
    expect(res.credential.authenticatorAttachment).toBe('platform');
  });
  it('lists only this site\'s passkeys, and only allowCredentials when given', async () => {
    const { h, id } = await withPasskey();
    h.state.answer = { action: 'cancel' };
    await h.svc.handleRequest(h.event(), getReq()).catch(() => {});
    expect(h.state.asks.at(-1).accounts.map(a => a.credentialId)).toEqual([id]);
    await h.svc.handleRequest(h.event(), getReq({ allowCredentials: [{ id: pc.b64u(crypto.randomBytes(32)), transports: ['internal'] }] })).catch(() => {});
    expect(h.state.asks.at(-1).accounts).toEqual([]);
    await h.svc.handleRequest(h.event(), getReq({ allowCredentials: [{ id, transports: ['internal'] }] })).catch(() => {});
    expect(h.state.asks.at(-1).accounts).toHaveLength(1);
  });
  it('a site cannot learn whether an account exists: none, cancelled and refused all look alike', async () => {
    const { h } = await withPasskey();
    h.state.answer = { action: 'cancel' };
    const a = await h.svc.handleRequest(h.event(), getReq()).catch(e => e);
    const b = await h.svc.handleRequest(h.event(), getReq({ allowCredentials: [{ id: pc.b64u(crypto.randomBytes(32)) }] })).catch(e => e);
    expect([a.name, a.message]).toEqual([b.name, 'The request was cancelled']);
    expect(a.name).toBe('NotAllowedError');
  });
  it('"use a security key or phone" hands the request to the browser', async () => {
    const { h } = await withPasskey();
    h.state.answer = { action: 'native' };
    expect(await h.svc.handleRequest(h.event(), getReq())).toEqual({ fallback: true });
  });
  it('a request that only names security-key transports goes to the browser without a sheet', async () => {
    const { h } = await withPasskey();
    const before = h.state.asks.length;
    const r = await h.svc.handleRequest(h.event(), getReq({ allowCredentials: [{ id: pc.b64u(crypto.randomBytes(32)), transports: ['usb', 'nfc'] }] }));
    expect(r).toEqual({ fallback: true });
    expect(h.state.asks).toHaveLength(before);
  });
  it('a passkey that syncs reports backup flags honestly and a counter of 0', async () => {
    const { h, stored } = await withPasskey({ state: { sync: true } });
    expect(h.svc.list()[0].deviceOnly).toBe(false);
    h.state.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId });
    const req = getReq();
    const res = await h.svc.handleRequest(h.event(), req);
    const v = VA(res.credential, stored, expectedFor(req));
    expect(v.flags).toMatchObject({ BE: true, BS: true });
    expect(v.signCount).toBe(0);
    // Sync turned off again: still eligible, no longer backed up.
    h.state.sync = false;
    const res2 = await h.svc.handleRequest(h.event(), getReq());
    const f = V.parseAuthData(Buffer.from(res2.credential.authenticatorData, 'base64url')).flags;
    expect(f).toMatchObject({ BE: true, BS: false });
  });
  it('a passkey made while sync was off stays device only and BE false', async () => {
    const { h, stored } = await withPasskey({ state: { sync: false } });
    h.state.sync = true;
    h.state.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId });
    const req = getReq();
    const v = VA((await h.svc.handleRequest(h.event(), req)).credential, stored, expectedFor(req));
    expect(v.flags).toMatchObject({ BE: false, BS: false });
    expect(h.svc.syncStore.load()).toHaveLength(0);
  });
  it('survives a restart: a new service reads the encrypted file', async () => {
    const { h, id } = await withPasskey();
    const again = setup();
    expect(again.svc.list().map(p => p.credentialId)).toEqual([id]);
  });
});

describe('user verification with the Vex PIN', () => {
  it('required with no PIN set cannot be satisfied: the sheet says so and nothing is signed', async () => {
    const h = setup();
    await register(h);
    h.state.results = [];
    h.state.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId });
    h.state.retry = () => ({ action: 'cancel' });
    const err = await h.svc.handleRequest(h.event(), getReq({ userVerification: 'required' })).catch(e => e);
    expect(h.state.asks.at(-1)).toMatchObject({ uv: 'required', hasPin: false });
    expect(err.name).toBe('NotAllowedError');
    expect(h.state.results[0]).toMatchObject({ ok: false });
    expect(h.state.results[0].error).toMatch(/Set a Vex PIN/);
  });
  it('required with a PIN: a wrong PIN keeps the sheet open, the right one signs with UV set', async () => {
    const h = setup({ state: { pin: '4321' } });
    const first = await register(h, { authenticatorSelection: { userVerification: 'discouraged' } });
    const stored = { publicKey: VR(first.res.credential, expectedFor(first.req)).publicKey, signCount: 0 };
    h.state.results = [];
    h.state.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId, pin: '0000' });
    h.state.retry = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId, pin: '4321' });
    const req = getReq({ userVerification: 'required' });
    const res = await h.svc.handleRequest(h.event(), req);
    expect(h.state.results[0]).toMatchObject({ ok: false, error: 'Wrong PIN' });
    expect(h.state.pinTries).toEqual(['0000', '4321']);
    expect(VA(res.credential, stored, expectedFor(req, { requireUV: true })).flags.UV).toBe(true);
  });
  it('preferred with a PIN set may go without it (UV false)', async () => {
    const h = setup({ state: { pin: '4321' } });
    const first = await register(h);
    const stored = { publicKey: VR(first.res.credential, expectedFor(first.req)).publicKey, signCount: 0 };
    h.state.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId });
    const req = getReq({ userVerification: 'preferred' });
    expect(h.state.asks.length).toBe(1);
    const res = await h.svc.handleRequest(h.event(), req);
    expect(h.state.asks.at(-1).uv).toBe('optional');
    expect(VA(res.credential, stored, expectedFor(req)).flags.UV).toBe(false);
  });
  it('a registration with userVerification required is only made with the PIN', async () => {
    const h = setup({ state: { pin: '4321' } });
    h.state.answer = { action: 'save', pin: '4321' };
    const req = createReq({ authenticatorSelection: { userVerification: 'required' } });
    const res = await h.svc.handleRequest(h.event(), req);
    expect(VR(res.credential, expectedFor(req, { requireUV: true })).flags.UV).toBe(true);
    expect(h.state.asks[0].uv).toBe('required');
  });
});

describe('where passkeys are refused', () => {
  for (const [name, state] of [
    ['a private window', { privateWindow: true }],
    ['a burner or temporary tab', { partition: 'temp:abc' }],
    ['a Tor tab', { tor: true, partition: 'persist:route-tor' }],
    ['a Tor container', { partition: 'persist:container-tor-1' }],
  ]) {
    it(`refuses in ${name} with a toast and no sheet`, async () => {
      const h = setup({ state });
      await expect(h.svc.handleRequest(h.event(), createReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect(h.state.asks).toHaveLength(0);
      expect(h.state.sent[0][0]).toBe('passkeys:notice');
      expect(h.state.sent[0][1].message).toMatch(/Passkeys are not used/);
    });
  }
  it('refuses while Vex is locked', async () => {
    const h = setup();
    await register(h);
    h.state.locked = true;
    await expect(h.svc.handleRequest(h.event(), getReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(() => h.svc.list()).toThrow(/locked/);
    expect(h.state.sent.at(-1)[1].message).toMatch(/locked/);
  });
  it('refuses a site on the do-not-offer list', async () => {
    const h = setup({ state: { suppressed: true } });
    await expect(h.svc.handleRequest(h.event(), createReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(h.state.asks).toHaveLength(0);
  });
  it('stops a page that keeps asking after three refusals, for a minute', async () => {
    const clock = { t: Date.UTC(2026, 9, 12, 12, 0, 0) };
    const h = setup({ deps: { now: () => clock.t } });
    h.state.answer = { action: 'cancel' };
    for (let i = 0; i < 3; i++) await expect(h.svc.handleRequest(h.event(), createReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(h.state.asks).toHaveLength(3);
    await expect(h.svc.handleRequest(h.event(), createReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(h.state.asks).toHaveLength(3);                      // no fourth sheet
    expect(h.state.sent.at(-1)[1].message).toMatch(/too many times/);
    clock.t += 61000;
    await expect(h.svc.handleRequest(h.event(), createReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(h.state.asks).toHaveLength(4);                      // asked again after the minute
  });
  it('refuses a page that is not secure', async () => {
    const h = setup();
    h.frame.url = 'http://login.example.com/';
    await expect(h.svc.handleRequest(h.event(), createReq())).rejects.toMatchObject({ name: 'SecurityError' });
  });
  it('a sheet answered after Vex locked signs nothing', async () => {
    const h = setup();
    await register(h);
    h.state.answer = (p) => { h.state.locked = true; return { action: 'use', credentialId: p.accounts[0].credentialId }; };
    // The vault is read at request time (unlocked); the answer arrives locked.
    await expect(h.svc.handleRequest(h.event(), getReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});

describe('conditional mediation', () => {
  it('waits for a pick from the field chooser, then signs', async () => {
    const h = setup();
    const first = await register(h);
    const stored = { publicKey: VR(first.res.credential, expectedFor(first.req)).publicKey, signCount: 0 };
    const req = getReq({}, { mediation: 'conditional', id: 'c1' });
    const asksBefore = h.state.asks.length;
    const pending = h.svc.handleRequest(h.event(), req);
    await new Promise(r => setTimeout(r, 10));
    expect(h.state.asks.length).toBe(asksBefore);          // no sheet for conditional requests
    const info = h.svc.conditionalList(h.event(), 'c1');
    expect(info.accounts).toHaveLength(1);
    // another tab cannot read this request's list
    expect(h.svc.conditionalList({ sender: { id: 99 } }, 'c1').accounts).toEqual([]);
    const r = await h.svc.conditionalChoose('c1', info.accounts[0].credentialId, undefined);
    expect(r.ok).toBe(true);
    const res = await pending;
    expect(VA(res.credential, stored, expectedFor(req)).signCount).toBe(1);
  });
  it('a newer request aborts a waiting one, and an abort from the page ends it', async () => {
    const h = setup();
    await register(h);
    const c1 = h.svc.handleRequest(h.event(), getReq({}, { mediation: 'conditional', id: 'c1' }));
    c1.catch(() => {});
    h.state.answer = { action: 'cancel' };
    await h.svc.handleRequest(h.event(), getReq({}, { id: 'g2' })).catch(() => {});
    await expect(c1).rejects.toMatchObject({ name: 'AbortError' });
    const c2 = h.svc.handleRequest(h.event(), getReq({}, { mediation: 'conditional', id: 'c2' }));
    c2.catch(() => {});
    await new Promise(r => setTimeout(r, 5));
    h.handlers.get('passkeys:cancel')(h.event(), 'c2');
    await expect(c2).rejects.toMatchObject({ name: 'AbortError' });
    expect((await h.svc.conditionalChoose('c2', 'x')).ok).toBe(false);
  });
  it('a conditional pick needs the PIN when the site requires verification', async () => {
    const h = setup({ state: { pin: '1357' } });
    await register(h, { authenticatorSelection: { userVerification: 'discouraged' } });
    const pending = h.svc.handleRequest(h.event(), getReq({ userVerification: 'required' }, { mediation: 'conditional', id: 'c3' }));
    await new Promise(r => setTimeout(r, 5));
    const id = h.svc.conditionalList(h.event(), 'c3').accounts[0].credentialId;
    expect((await h.svc.conditionalChoose('c3', id, undefined)).ok).toBe(false);
    expect((await h.svc.conditionalChoose('c3', id, '1357')).ok).toBe(true);
    const res = await pending;
    expect(V.parseAuthData(Buffer.from(res.credential.authenticatorData, 'base64url')).flags.UV).toBe(true);
  });
});

describe('managing passkeys', () => {
  it('deletes with an undo that puts the same key back, and renames', async () => {
    const h = setup();
    const first = await register(h);
    const id = first.res.credential.id;
    const before = h.svc.load()[0].privateKeyPkcs8;
    const del = await h.svc.remove(id);
    expect(del.ok).toBe(true);
    expect(h.svc.list()).toHaveLength(0);
    expect((await h.svc.undoRemove('nope')).ok).toBe(false);
    expect((await h.svc.undoRemove(del.undo)).ok).toBe(true);
    expect(h.svc.load()[0].privateKeyPkcs8).toBe(before);
    expect((await h.svc.rename(id, '  Home  ')).ok).toBe(true);
    expect(h.svc.list()[0].nickname).toBe('Home');
    expect((await h.svc.remove('missing')).ok).toBe(false);
  });
  it('the sync store holds only passkeys made while sync was on and keeps the others', async () => {
    const h = setup({ state: { sync: true } });
    await register(h);
    h.state.sync = false;
    h.state.answer = { action: 'save' };
    await h.svc.handleRequest(h.event(), createReq({ user: { id: pc.b64u(Buffer.from('u2')), name: 'b', displayName: 'b' } }));
    expect(h.svc.load()).toHaveLength(2);
    const synced = h.svc.syncStore.load();
    expect(synced).toHaveLength(1);
    await h.svc.syncStore.save([]);                       // a remote delete
    expect(h.svc.load().map(r => r.backupEligible)).toEqual([false]);
  });
});

describe('request parsing', () => {
  it('rejects malformed requests as TypeError', () => {
    const bad = [null, {}, { op: 'x' }, { op: 'get', id: 'a' }, { op: 'get', id: 'a', publicKey: {} },
      { op: 'get', id: 'a', publicKey: { challenge: 'a b' } },
      { op: 'create', id: 'a', publicKey: { challenge: 'YQ', rp: { name: 'x' }, user: { id: 'YQ', name: 'n' }, pubKeyCredParams: 'no' } },
      { op: 'create', id: 'a', publicKey: { challenge: 'YQ', rp: { name: 'x' }, user: { id: pc.b64u(Buffer.alloc(65)), name: 'n' }, pubKeyCredParams: [] } }];
    for (const b of bad) expect(() => normalizeRequest(b)).toThrow();
  });
  it('wantsNative: security keys, phones and cross-platform attachment', () => {
    expect(wantsNative('get', { hints: ['security-key'], allowCredentials: [] })).toBe(true);
    expect(wantsNative('get', { hints: ['client-device', 'security-key'], allowCredentials: [] })).toBe(false);
    expect(wantsNative('get', { hints: [], allowCredentials: [{ id: 'a', transports: ['usb'] }, { id: 'b', transports: ['nfc', 'ble'] }] })).toBe(true);
    expect(wantsNative('get', { hints: [], allowCredentials: [{ id: 'a', transports: ['usb'] }, { id: 'b', transports: ['internal'] }] })).toBe(false);
    expect(wantsNative('get', { hints: [], allowCredentials: [{ id: 'a', transports: [] }] })).toBe(false);
    expect(wantsNative('create', { hints: [], authenticatorSelection: { authenticatorAttachment: 'cross-platform' } })).toBe(true);
    expect(wantsNative('create', { hints: [], authenticatorSelection: { authenticatorAttachment: 'platform' } })).toBe(false);
    expect(wantsNative('create', { hints: ['hybrid'], authenticatorSelection: {} })).toBe(true);
  });
});
