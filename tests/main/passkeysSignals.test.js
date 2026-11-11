// What a site says about its own passkeys, and what Vex remembers of each request.
//
// Found 2026-11-10: Discord answered "An error occurred" to a passkey Vex had just signed with, twice, and
// nothing in Vex said anything. Two halves were missing:
//   - the WebAuthn signal methods (signalUnknownCredential, signalAllAcceptedCredentials,
//     signalCurrentUserDetails), which Discord's own code calls when its server does not know a passkey:
//     Vex now sets such a passkey aside instead of offering it for ever;
//   - a record of what each request asked for and what Vex answered (Settings > Passkeys).
// Service, page shim and channel policy, with the independent relying-party verifier.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import vm from 'node:vm';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createPasskeyService, MAX_ATTEMPTS, MAX_SIGNAL_IDS, SIGNAL_GRACE_MS } = require('../../src/main/passkeys.js');
const { vexPasskeyShim } = require('../../src/preload-passkeys.js');
const { installIpcPolicy } = require('../../src/main/ipc-policy.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const pc = require('../../src/main/passkey-crypto.js');
const V = require('../helpers/webauthn-verify.js');

const ORIGIN = 'https://login.example.com';
const b64 = (s) => pc.b64u(Buffer.from(s));
const USER = b64('user-1234');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-passkeys-signal-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function setup(over = {}) {
  const state = { locked: false, suppressed: false, partition: 'persist:main', privateWindow: false, asks: [], sent: [], answer: null, clock: Date.UTC(2026, 10, 10, 16, 0, 0), ...over };
  const handlers = new Map();
  const win = { isDestroyed: () => false };
  const svc = createPasskeyService({
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('ENC' + Buffer.from(s).toString('base64')), decryptString: (b) => Buffer.from(b.toString().slice(3), 'base64').toString() },
    ipcMain: { handle: (c, f) => handlers.set(c, f), on: (c, f) => handlers.set(c, f) },
    atomicWrite: async (f, bytes) => fs.promises.writeFile(f, bytes),
    userDataPath: dir,
    isLocked: () => state.locked,
    hasPin: () => state.pin != null,
    verifyPin: async (p) => (p === state.pin ? { ok: true } : { ok: false, error: 'Wrong PIN' }),
    ownerOf: () => ({ win, privatePartition: state.privateWindow ? 'private:1' : null }),
    partitionOf: () => state.partition,
    suppressedFor: () => state.suppressed,
    windowSend: (_w, channel, payload) => {
      if (channel === 'passkeys:ask') {
        state.asks.push(payload);
        setTimeout(() => { if (state.answer) svc.answer(payload.id, typeof state.answer === 'function' ? state.answer(payload) : state.answer); }, 0);
      } else state.sent.push([channel, payload]);
      return true;
    },
    now: () => state.clock,
  });
  svc.register();
  const frame = { url: ORIGIN + '/signin' };
  const wc = { id: 41, mainFrame: frame, on() {}, once() {} };
  const event = (f = frame) => ({ sender: wc, senderFrame: f });
  const notices = () => state.sent.filter(([c]) => c === 'passkeys:notice').map(([, p]) => p);
  return { svc, state, handlers, event, notices };
}
const createReq = (user = USER, name = 'ada@example.com') => ({ op: 'create', id: crypto.randomBytes(12).toString('base64url'), mediation: 'optional', publicKey: {
  challenge: pc.b64u(crypto.randomBytes(32)), rp: { id: 'example.com', name: 'Example' }, user: { id: user, name, displayName: 'Ada' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } });
const getReq = (allow = []) => ({ op: 'get', id: crypto.randomBytes(12).toString('base64url'), mediation: 'optional',
  publicKey: { challenge: pc.b64u(crypto.randomBytes(32)), rpId: 'example.com', userVerification: 'preferred', allowCredentials: allow.map(id => ({ id, transports: ['internal'] })) } });

async function withPasskey(over) {
  const h = setup(over);
  h.state.answer = { action: 'save', nickname: 'Work laptop' };
  const res = await h.svc.handleRequest(h.event(), createReq());
  h.state.asks.length = 0;
  h.id = res.credential.id;
  h.state.clock += 10 * 60 * 1000;      // the passkey is ten minutes old
  return h;
}
const use = (h) => { h.state.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId }); };

describe('signalUnknownCredential', () => {
  it('sets the passkey aside: it is kept, no longer offered, and the person is told', async () => {
    const h = await withPasskey();
    expect(await h.svc.signal(h.event(), { kind: 'unknown', rpId: 'example.com', credentialId: h.id })).toEqual({ ok: true });
    expect(h.svc.list()[0]).toMatchObject({ credentialId: h.id, setAside: true, setAsideAt: new Date(h.state.clock).toISOString() });
    expect(h.notices()).toHaveLength(1);
    expect(h.notices()[0].message).toBe('login.example.com no longer accepts your passkey "Work laptop", so Vex stopped offering it there. To use a passkey on this site again, add a new one in the site’s security settings.');
    // The next sign-in offers nothing and says why.
    h.state.answer = { action: 'cancel' };
    await expect(h.svc.handleRequest(h.event(), getReq())).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(h.state.asks[0].accounts).toEqual([]);
    expect(h.state.asks[0].setAside.map(a => a.credentialId)).toEqual([h.id]);
    // The key is untouched.
    expect(h.svc.load()[0].privateKeyPkcs8).toBeTruthy();
  });
  it('says the same whether or not Vex holds the passkey, and a second signal changes nothing', async () => {
    const h = await withPasskey();
    expect(await h.svc.signal(h.event(), { kind: 'unknown', rpId: 'example.com', credentialId: b64('some-other-credential-id') })).toEqual({ ok: true });
    expect(h.svc.list()[0].setAside).toBe(false);
    await h.svc.signal(h.event(), { kind: 'unknown', rpId: 'example.com', credentialId: h.id });
    await h.svc.signal(h.event(), { kind: 'unknown', rpId: 'example.com', credentialId: h.id });
    expect(h.notices()).toHaveLength(1);
  });
  it('a page cannot speak for another site (SecurityError), and a frame that is not the top page is ignored', async () => {
    const h = await withPasskey();
    await expect(h.svc.signal(h.event(), { kind: 'unknown', rpId: 'bank.com', credentialId: h.id })).rejects.toMatchObject({ name: 'SecurityError' });
    expect(await h.svc.signal(h.event({ url: 'https://ads.example.net/frame' }), { kind: 'unknown', rpId: 'example.com', credentialId: h.id })).toEqual({ ok: true });
    expect(h.svc.list()[0].setAside).toBe(false);
  });
  it('is not listened to in a private tab, while locked, or on a site where passkeys are off', async () => {
    for (const over of [{ privateWindow: true }, { partition: 'burner-7' }, { locked: true }, { suppressed: true }]) {
      const h = await withPasskey();
      Object.assign(h.state, over);
      expect(await h.svc.signal(h.event(), { kind: 'unknown', rpId: 'example.com', credentialId: h.id })).toEqual({ ok: true });
      h.state.locked = false;
      expect(h.svc.list()[0].setAside, JSON.stringify(over)).toBe(false);
    }
  });
  it('"Offer again" brings it back and it signs as before', async () => {
    const h = await withPasskey();
    await h.svc.signal(h.event(), { kind: 'unknown', rpId: 'example.com', credentialId: h.id });
    expect(await h.svc.restore(h.id)).toEqual({ ok: true });
    expect(h.svc.list()[0].setAside).toBe(false);
    use(h);
    const req = getReq();
    const res = await h.svc.handleRequest(h.event(), req);
    const key = h.svc.load()[0];
    const v = V.verifyAssertion({ id: res.credential.id, rawId: res.credential.rawId, response: res.credential },
      { publicKey: crypto.createPublicKey({ key: Buffer.from(key.publicKeySpki, 'base64url'), format: 'der', type: 'spki' }), signCount: 0 }, { challenge: req.publicKey.challenge, origin: ORIGIN, rpId: 'example.com' });
    expect(v.flags.UP).toBe(true);
    expect(await h.svc.restore('nope')).toEqual({ ok: false, error: 'That passkey is gone' });
  });
});

describe('signalAllAcceptedCredentials', () => {
  it('sets aside this account\'s passkeys that are not in the list, and brings back one that is', async () => {
    const h = await withPasskey();
    await h.svc.signal(h.event(), { kind: 'accepted', rpId: 'example.com', userId: USER, allAcceptedCredentialIds: [b64('a-different-credential')] });
    expect(h.svc.list()[0].setAside).toBe(true);
    await h.svc.signal(h.event(), { kind: 'accepted', rpId: 'example.com', userId: USER, allAcceptedCredentialIds: [h.id] });
    expect(h.svc.list()[0].setAside).toBe(false);
    expect(h.notices().map(n => n.kind)).toEqual(['warning', 'info']);
    expect(h.notices()[1].message).toBe('login.example.com accepts your passkey "Work laptop" again, so Vex offers it there again.');
  });
  it('touches only that account and that site', async () => {
    const h = await withPasskey();
    h.state.answer = { action: 'save' };
    await h.svc.handleRequest(h.event(), createReq(b64('another-user'), 'bob@example.com'));
    h.state.clock += 10 * 60 * 1000;
    await h.svc.signal(h.event(), { kind: 'accepted', rpId: 'example.com', userId: USER, allAcceptedCredentialIds: [] });
    const byUser = Object.fromEntries(h.svc.list().map(p => [p.userName, p.setAside]));
    expect(byUser).toEqual({ 'ada@example.com': true, 'bob@example.com': false });
  });
  it('a list read just before the passkey was made does not set it aside', async () => {
    const h = await withPasskey();
    h.state.clock -= 10 * 60 * 1000 - (SIGNAL_GRACE_MS - 1000);     // the passkey is under a minute old
    await h.svc.signal(h.event(), { kind: 'accepted', rpId: 'example.com', userId: USER, allAcceptedCredentialIds: [] });
    expect(h.svc.list()[0].setAside).toBe(false);
  });
});

describe('signalCurrentUserDetails', () => {
  it('corrects the account\'s names, quietly', async () => {
    const h = await withPasskey();
    await h.svc.signal(h.event(), { kind: 'details', rpId: 'example.com', userId: USER, name: 'ada@new.example', displayName: 'Ada L.' });
    expect(h.svc.list()[0]).toMatchObject({ userName: 'ada@new.example', userDisplayName: 'Ada L.', nickname: 'Work laptop' });
    expect(h.notices()).toHaveLength(0);
    expect(h.svc.load()[0].updatedAt).toBe(new Date(h.state.clock).toISOString());
  });
});

describe('a malformed signal', () => {
  it('is a TypeError and changes nothing', async () => {
    const h = await withPasskey();
    const bad = [null, {}, { kind: 'delete', rpId: 'example.com' }, { kind: 'unknown', rpId: '', credentialId: h.id }, { kind: 'unknown', rpId: 'example.com', credentialId: 'not base64!' },
      { kind: 'accepted', rpId: 'example.com', userId: USER, allAcceptedCredentialIds: 'x' }, { kind: 'accepted', rpId: 'example.com', userId: USER, allAcceptedCredentialIds: new Array(MAX_SIGNAL_IDS + 1).fill(h.id) },
      { kind: 'details', rpId: 'example.com', userId: USER, name: 5, displayName: 'x' }];
    for (const raw of bad) await expect(h.svc.signal(h.event(), raw), JSON.stringify(raw).slice(0, 60)).rejects.toMatchObject({ name: 'TypeError' });
    expect(h.svc.list()[0].setAside).toBe(false);
  });
  it('the channel answers the page with the error name only, never throws', async () => {
    const h = await withPasskey();
    const call = h.handlers.get('passkeys:signal');
    expect(await call(h.event(), { kind: 'unknown', rpId: 'bank.com', credentialId: h.id })).toMatchObject({ ok: false, name: 'SecurityError' });
    expect(await call(h.event(), { nonsense: true })).toMatchObject({ ok: false, name: 'TypeError' });
    expect(await call(h.event(), { kind: 'unknown', rpId: 'example.com', credentialId: h.id })).toEqual({ ok: true });
  });
});

describe('a site that names passkeys Vex does not hold', () => {
  it('the sheet is told which passkey Vex does hold for the site', async () => {
    const h = await withPasskey();
    h.state.answer = { action: 'cancel' };
    await expect(h.svc.handleRequest(h.event(), getReq([b64('a-credential-on-a-phone-0001')]))).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(h.state.asks[0].accounts).toEqual([]);
    expect(h.state.asks[0].unlisted.map(a => a.credentialId)).toEqual([h.id]);
    expect(h.state.asks[0].setAside).toEqual([]);
  });
  it('nothing extra is said when the site names none, or names one Vex holds', async () => {
    const h = await withPasskey();
    use(h);
    await h.svc.handleRequest(h.event(), getReq());
    await h.svc.handleRequest(h.event(), getReq([h.id]));
    for (const ask of h.state.asks) expect([ask.unlisted, ask.setAside]).toEqual([[], []]);
  });
});

describe('a site that asks again right after Vex signed in', () => {
  it('the sheet is told, with the passkey that was used and how long ago', async () => {
    const h = await withPasskey();
    use(h);
    await h.svc.handleRequest(h.event(), getReq());
    expect(h.state.asks[0].repeat).toBeNull();
    h.state.clock += 28 * 1000;
    await h.svc.handleRequest(h.event(), getReq());
    expect(h.state.asks[1].repeat).toEqual({ name: 'Work laptop', secondsAgo: 28, withoutPin: false });
  });
  // The owner of the profile this was found in has a Vex PIN. Where a site only prefers verification the PIN
  // is optional, and a sign-in made without it is one a site may refuse: the likeliest reason for being asked twice.
  it('says when that sign-in was made without the Vex PIN on a site that prefers verification', async () => {
    const h = await withPasskey();
    h.state.pin = '2468';
    use(h);                                                       // no PIN typed
    await h.svc.handleRequest(h.event(), getReq());
    h.state.clock += 20 * 1000;
    await h.svc.handleRequest(h.event(), getReq());
    expect(h.state.asks[1].repeat).toMatchObject({ withoutPin: true, secondsAgo: 20 });
    expect(h.state.asks[1]).toMatchObject({ uv: 'optional', hasPin: true });
  });
  it('not when the PIN was typed, and not when there is no PIN to type', async () => {
    const h = await withPasskey();
    h.state.pin = '2468';
    h.state.answer = (p) => ({ action: 'use', credentialId: p.accounts[0].credentialId, pin: '2468' });
    await h.svc.handleRequest(h.event(), getReq());
    h.state.clock += 20 * 1000;
    await h.svc.handleRequest(h.event(), getReq());
    expect(h.state.asks[1].repeat.withoutPin).toBe(false);
    const none = await withPasskey();
    use(none);
    await none.svc.handleRequest(none.event(), getReq());
    none.state.clock += 20 * 1000;
    await none.svc.handleRequest(none.event(), getReq());
    expect(none.state.asks[1].repeat.withoutPin).toBe(false);
  });
  it('not after two minutes, not after a cancel, and not for another site\'s sign-in', async () => {
    const h = await withPasskey();
    use(h);
    await h.svc.handleRequest(h.event(), getReq());
    h.state.clock += 2 * 60 * 1000 + 1000;
    await h.svc.handleRequest(h.event(), getReq());
    expect(h.state.asks[1].repeat).toBeNull();
    const fresh = await withPasskey();
    fresh.state.answer = { action: 'cancel' };
    await expect(fresh.svc.handleRequest(fresh.event(), getReq())).rejects.toThrow();
    fresh.state.clock += 5000;
    await expect(fresh.svc.handleRequest(fresh.event(), getReq())).rejects.toThrow();
    expect(fresh.state.asks[1].repeat).toBeNull();
  });
});

describe('the record of recent requests', () => {
  it('says what the site asked for and what Vex answered, newest first, with no key, challenge or signature', async () => {
    const h = await withPasskey();
    use(h);
    const req = getReq([h.id, b64('a-credential-on-a-phone-0001')]);
    const res = await h.svc.handleRequest(h.event(), req);
    const list = h.svc.attemptsList();
    expect(list[0]).toEqual({ at: new Date(h.state.clock).toISOString(), op: 'get', host: 'login.example.com', rpId: 'example.com', outcome: 'signed', detail: '',
      uvAsked: 'preferred', asked: 2, saved: 1, matched: 1, uv: false, credential: h.id.slice(0, 8), name: 'Work laptop', signCount: Math.floor(h.state.clock / 1000) });
    expect(list[1]).toMatchObject({ op: 'create', outcome: 'created', name: 'Work laptop', credential: h.id.slice(0, 8) });
    const text = JSON.stringify(list);
    for (const secret of [req.publicKey.challenge, res.credential.signature, h.svc.load()[0].privateKeyPkcs8, h.id]) expect(text).not.toContain(secret);
  });
  it('records a cancel, a hand-over to a security key, and a refusal with its reason', async () => {
    const h = await withPasskey();
    h.state.answer = { action: 'cancel' };
    await expect(h.svc.handleRequest(h.event(), getReq())).rejects.toThrow();
    h.state.answer = { action: 'native' };
    await h.svc.handleRequest(h.event(), getReq());
    await h.svc.handleRequest(h.event(), { ...getReq(), publicKey: { ...getReq().publicKey, allowCredentials: [{ id: b64('a-usb-security-key-00001'), transports: ['usb'] }] } });
    h.state.suppressed = true;
    await expect(h.svc.handleRequest(h.event(), getReq())).rejects.toThrow();
    expect(h.svc.attemptsList().slice(0, 4).map(a => [a.outcome, a.detail])).toEqual([
      ['refused', 'Passkeys are turned off for this site in Vex'],
      ['native', 'The site asked for a security key or a phone'],
      ['native', 'You chose a security key or a phone'],
      ['cancelled', 'The request was cancelled'],
    ]);
  });
  it('keeps nothing from a private or burner tab, not even the refusal', async () => {
    const h = await withPasskey();
    const before = h.svc.attemptsList().length;
    h.state.partition = 'burner-3';
    await expect(h.svc.handleRequest(h.event(), getReq())).rejects.toThrow();
    h.state.partition = 'persist:main';
    h.state.privateWindow = true;
    await expect(h.svc.handleRequest(h.event(), getReq())).rejects.toThrow();
    expect(h.svc.attemptsList()).toHaveLength(before);
  });
  it('a waiting field list that the page abandons is not an attempt; a pick from it is', async () => {
    const h = await withPasskey();
    const before = h.svc.attemptsList().length;
    const waiting = h.svc.handleRequest(h.event(), { ...getReq(), id: 'cond01', mediation: 'conditional' });
    h.svc.forgetContents(41);
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.svc.attemptsList()).toHaveLength(before);
    const second = h.svc.handleRequest(h.event(), { ...getReq(), id: 'cond02', mediation: 'conditional' });
    expect(await h.svc.conditionalChoose('cond02', h.id)).toEqual({ ok: true });
    await second;
    expect(h.svc.attemptsList()[0]).toMatchObject({ outcome: 'signed', name: 'Work laptop', asked: 0, matched: 1 });
  });
  it('holds the newest ' + MAX_ATTEMPTS + ' only, and is not read while Vex is locked', async () => {
    const h = await withPasskey();
    h.state.answer = { action: 'native' };
    for (let i = 0; i < MAX_ATTEMPTS + 5; i++) await h.svc.handleRequest(h.event(), getReq());
    expect(h.svc.attemptsList()).toHaveLength(MAX_ATTEMPTS);
    h.state.locked = true;
    expect(() => h.svc.attemptsList()).toThrow(/locked/);
  });
});

describe('a synced copy arriving', () => {
  it('does not wipe what this device knows about a passkey the site refused', async () => {
    const h = await withPasskey();
    // Made while sync was off, so mark it as a synced one by hand for this check.
    const all = h.svc.load();
    all[0].backupEligible = true;
    await h.svc.save(all);
    await h.svc.signal(h.event(), { kind: 'unknown', rpId: 'example.com', credentialId: h.id });
    const { unknownAt: _local, ...travelling } = h.svc.syncStore.load()[0];
    await h.svc.syncStore.save([travelling]);
    expect(h.svc.list()[0].setAside).toBe(true);
  });
});

// --- the page's half -----------------------------------------------------------
function page({ mode = 'vex', bridge } = {}) {
  const ctx = vm.createContext({ console, DOMException, btoa, atob });
  vm.runInContext(`
    window = globalThis;
    class PublicKeyCredential { static signalUnknownCredential() { return Promise.resolve('native'); } }
    class AuthenticatorAttestationResponse {} class AuthenticatorAssertionResponse {}
    class CredentialsContainer { create() { return Promise.resolve('native-create'); } get() { return Promise.resolve('native-get'); } }
    window.PublicKeyCredential = PublicKeyCredential; window.AuthenticatorAttestationResponse = AuthenticatorAttestationResponse;
    window.AuthenticatorAssertionResponse = AuthenticatorAssertionResponse; window.CredentialsContainer = CredentialsContainer;
    var navigator = { credentials: new CredentialsContainer() };
    var crypto = { getRandomValues(u) { return u; } };
  `, ctx);
  ctx.__bridge = bridge;
  vm.runInContext(`(${vexPasskeyShim.toString()})(__bridge, ${JSON.stringify(mode)})`, ctx);
  return { run: (code) => vm.runInContext(code, ctx) };
}
const bridgeOf = (answer) => { const seen = []; return { seen, request: () => Promise.resolve(null), cancel() {}, signal: (m) => { seen.push(m); return Promise.resolve(answer(m)); } }; };

describe('the page side', () => {
  it('says it supports the three signal methods, and none in a refused tab', async () => {
    const caps = await page({ bridge: bridgeOf(() => ({ ok: true })) }).run(`PublicKeyCredential.getClientCapabilities()`);
    expect(caps).toMatchObject({ signalUnknownCredential: true, signalAllAcceptedCredentials: true, signalCurrentUserDetails: true });
    const refused = page({ mode: 'refused', bridge: bridgeOf(() => ({ ok: true })) });
    expect(await refused.run(`PublicKeyCredential.getClientCapabilities()`)).toMatchObject({ signalUnknownCredential: false, signalAllAcceptedCredentials: false, signalCurrentUserDetails: false });
    // The browser's own method is left as it was there.
    expect(await refused.run(`PublicKeyCredential.signalUnknownCredential({ rpId: 'example.com', credentialId: 'QUJD' })`)).toBe('native');
  });
  it('hands each signal to main as plain text fields and resolves with nothing', async () => {
    const b = bridgeOf(() => ({ ok: true }));
    const p = page({ bridge: b });
    expect(await p.run(`PublicKeyCredential.signalUnknownCredential({ rpId: 'example.com', credentialId: 'QUJDRA', extra: 1 })`)).toBeUndefined();
    expect(await p.run(`PublicKeyCredential.signalAllAcceptedCredentials({ rpId: 'example.com', userId: 'dXNlcg', allAcceptedCredentialIds: ['QUJDRA', 'RUZHSA'] })`)).toBeUndefined();
    expect(await p.run(`PublicKeyCredential.signalCurrentUserDetails({ rpId: 'example.com', userId: 'dXNlcg', name: 'ada', displayName: 'Ada' })`)).toBeUndefined();
    expect(JSON.parse(JSON.stringify(b.seen))).toEqual([
      { kind: 'unknown', rpId: 'example.com', credentialId: 'QUJDRA' },
      { kind: 'accepted', rpId: 'example.com', userId: 'dXNlcg', allAcceptedCredentialIds: ['QUJDRA', 'RUZHSA'] },
      { kind: 'details', rpId: 'example.com', userId: 'dXNlcg', name: 'ada', displayName: 'Ada' },
    ]);
  });
  it('a malformed call is a TypeError and nothing is sent', async () => {
    const b = bridgeOf(() => ({ ok: true }));
    const p = page({ bridge: b });
    for (const call of [`signalUnknownCredential()`, `signalUnknownCredential({ credentialId: 'QUJD' })`, `signalUnknownCredential({ rpId: 'example.com', credentialId: 'not base64!' })`,
      `signalUnknownCredential({ rpId: 'example.com', credentialId: new Uint8Array(4) })`, `signalAllAcceptedCredentials({ rpId: 'example.com', userId: 'dXNlcg', allAcceptedCredentialIds: 7 })`,
      `signalAllAcceptedCredentials({ rpId: 'example.com', userId: 'dXNlcg', allAcceptedCredentialIds: ['QUJD', '!!'] })`]) {
      const name = await p.run(`PublicKeyCredential.${call}.then(() => 'resolved', (e) => e instanceof TypeError ? 'TypeError' : String(e))`);
      expect(name, call).toBe('TypeError');
    }
    expect(b.seen).toHaveLength(0);
  });
  it('only a site the page may not speak for rejects; any other answer, or none, resolves', async () => {
    const wrongSite = page({ bridge: bridgeOf(() => ({ ok: false, name: 'SecurityError', message: 'The relying party id does not match this site' })) });
    expect(await wrongSite.run(`PublicKeyCredential.signalUnknownCredential({ rpId: 'bank.com', credentialId: 'QUJD' }).then(() => 'resolved', (e) => e.name + ': ' + e.message)`)).toBe('SecurityError: The relying party id does not match this site');
    for (const answer of [() => ({ ok: false, name: 'TypeError' }), () => null, () => { throw new Error('main is gone'); }]) {
      const p = page({ bridge: { request() {}, cancel() {}, signal: (m) => Promise.resolve().then(() => answer(m)) } });
      expect(await p.run(`PublicKeyCredential.signalUnknownCredential({ rpId: 'example.com', credentialId: 'QUJD' }).then(() => 'resolved', () => 'rejected')`)).toBe('resolved');
    }
  });
});

// --- who may call what ----------------------------------------------------------
describe('the channels', () => {
  function policy({ ui = false, owner = null } = {}) {
    const handlers = new Map();
    const ipcMain = { handle: (c, f) => handlers.set(c, f), on() {} };
    installIpcPolicy(ipcMain, { isUiFrame: () => ui, owner: () => owner, isAuxiliary: () => false, ownsTarget: () => true });
    for (const c of ['passkeys:signal', 'passkeys:attempts', 'passkeys:restore']) ipcMain.handle(c, () => 'ok');
    return (c, ...a) => handlers.get(c)({ sender: {}, senderFrame: { url: 'https://example.com/' } }, ...a);
  }
  it('a page may signal, and may not read the record or bring a passkey back', async () => {
    const call = policy({ owner: { id: 1 } });
    expect(await call('passkeys:signal', { kind: 'unknown' })).toBe('ok');
    await expect(call('passkeys:attempts')).rejects.toThrow(/Untrusted IPC sender|outside Vex.s own window/);
    await expect(call('passkeys:restore', 'cred')).rejects.toThrow(/Untrusted IPC sender|outside Vex.s own window/);
  });
  it('Vex\'s own window may read the record and bring one back, but not from a private window', async () => {
    const call = policy({ ui: true, owner: { id: 1 } });
    expect(await call('passkeys:attempts')).toBe('ok');
    expect(await call('passkeys:restore', 'cred')).toBe('ok');
    const priv = policy({ ui: true, owner: { id: 1, privatePartition: 'private:1' } });
    await expect(priv('passkeys:attempts')).rejects.toThrow(/private window/);
    await expect(priv('passkeys:restore', 'cred')).rejects.toThrow(/private window/);
  });
  it('the payloads are checked', () => {
    expect(() => validate('passkeys:signal', [{ kind: 'unknown' }])).not.toThrow();
    expect(() => validate('passkeys:signal', ['x'])).toThrow();
    expect(() => validate('passkeys:attempts', [])).not.toThrow();
    expect(() => validate('passkeys:attempts', ['x'])).toThrow();
    expect(() => validate('passkeys:restore', ['cred'])).not.toThrow();
    expect(() => validate('passkeys:restore', ['x'.repeat(2000)])).toThrow();
  });
  it('the page preload has the bridge for it and the window has the two calls', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
    expect(read('src/preload-passkeys.js')).toContain("signal: (msg) => ipcRenderer.invoke('passkeys:signal', msg),");
    expect(read('src/preload.js')).toContain("passkeysAttempts: () => ipcRenderer.invoke('passkeys:attempts'),");
    expect(read('src/preload.js')).toContain("passkeysRestore: (credentialId) => ipcRenderer.invoke('passkeys:restore', credentialId),");
  });
});
