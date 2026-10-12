// The page-world half of Vex passkeys (src/preload-passkeys.js vexPasskeyShim),
// run in a bare vm context that stands in for a page: what a site's code sees,
// what is handed to the bridge, and that everything it declines is passed to
// the browser's own implementation.
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
const { vexPasskeyShim } = require('../../src/preload-passkeys.js');

function page({ mode = 'vex', bridge } = {}) {
  const ctx = vm.createContext({ console, AbortController, DOMException, btoa, atob, TextEncoder, TextDecoder });
  vm.runInContext(`
    window = globalThis;
    var nativeCalls = [];
    class PublicKeyCredential { static isUserVerifyingPlatformAuthenticatorAvailable() { return Promise.resolve(false); } static isConditionalMediationAvailable() { return Promise.resolve(false); } get id() { throw new TypeError('Illegal invocation'); } get [Symbol.toStringTag]() { return 'PublicKeyCredential'; } }
    class AuthenticatorResponse {}
    class AuthenticatorAttestationResponse extends AuthenticatorResponse {}
    class AuthenticatorAssertionResponse extends AuthenticatorResponse {}
    class CredentialsContainer {
      create(o) { nativeCalls.push(['create', o]); return Promise.resolve('native-create'); }
      get(o) { nativeCalls.push(['get', o]); return Promise.resolve('native-get'); }
    }
    window.PublicKeyCredential = PublicKeyCredential; window.AuthenticatorAttestationResponse = AuthenticatorAttestationResponse;
    window.AuthenticatorAssertionResponse = AuthenticatorAssertionResponse; window.CredentialsContainer = CredentialsContainer;
    var navigator = { credentials: new CredentialsContainer() };
    var crypto = { getRandomValues(u) { for (let i = 0; i < u.length; i++) u[i] = (i * 37 + 11) & 255; return u; } };
  `, ctx);
  ctx.__bridge = bridge;
  vm.runInContext(`(${vexPasskeyShim.toString()})(__bridge, ${JSON.stringify(mode)})`, ctx);
  return { ctx, run: (code) => vm.runInContext(code, ctx) };
}

const b64u = (s) => Buffer.from(s).toString('base64url');
const assertionResult = {
  ok: true, kind: 'get',
  credential: { id: b64u('cred-id-0123456789'), rawId: b64u('cred-id-0123456789'), clientDataJSON: b64u('{"type":"webauthn.get"}'),
    authenticatorData: b64u('AD'), signature: b64u('SIG'), userHandle: b64u('uh'), authenticatorAttachment: 'platform', clientExtensionResults: {} },
};
const attestationResult = {
  ok: true, kind: 'create',
  credential: { id: b64u('cred-id-0123456789'), rawId: b64u('cred-id-0123456789'), clientDataJSON: b64u('{"type":"webauthn.create"}'),
    attestationObject: b64u('ATT'), authenticatorData: b64u('AD'), publicKey: b64u('SPKI'), publicKeyAlgorithm: -7, transports: ['internal'],
    authenticatorAttachment: 'platform', clientExtensionResults: { credProps: { rk: true } } },
};
const bridgeOf = (handler) => { const seen = []; return { seen, request: (r) => { seen.push(r); return Promise.resolve(handler(r)); }, cancel: (id) => seen.push({ cancel: id }) }; };

describe('availability', () => {
  it('reports a platform authenticator and conditional mediation in vex mode, none in refused mode', async () => {
    const a = page({ bridge: bridgeOf(() => null) });
    expect(await a.run(`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`)).toBe(true);
    expect(await a.run(`PublicKeyCredential.isConditionalMediationAvailable()`)).toBe(true);
    expect(await a.run(`PublicKeyCredential.getClientCapabilities().then(c => c.conditionalGet && c.passkeyPlatformAuthenticator)`)).toBe(true);
    const r = page({ mode: 'refused', bridge: bridgeOf(() => null) });
    expect(await r.run(`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`)).toBe(false);
    expect(await r.run(`PublicKeyCredential.isConditionalMediationAvailable()`)).toBe(false);
  });
  it('keeps create and get looking native', () => {
    const a = page({ bridge: bridgeOf(() => null) });
    expect(a.run(`Function.prototype.toString.call(CredentialsContainer.prototype.get)`)).toMatch(/\{\s*\[native code\]\s*\}|nativeCalls/);
    expect(a.run(`CredentialsContainer.prototype.get.name`)).toBe('get');
  });
});

describe('navigator.credentials.get', () => {
  it('sends base64url fields, takes no origin from the page, and returns a credential that passes instanceof', async () => {
    const b = bridgeOf(() => assertionResult);
    const p = page({ bridge: b });
    const out = await p.run(`
      (async () => {
        const c = await navigator.credentials.get({ publicKey: { challenge: new Uint8Array([1, 2, 3]).buffer, rpId: 'example.com', timeout: 5000,
          userVerification: 'required', allowCredentials: [{ type: 'public-key', id: new Uint8Array([9, 9, 9]), transports: ['internal'] }], origin: 'https://evil.test' } });
        return {
          inst: c instanceof PublicKeyCredential, respInst: c.response instanceof AuthenticatorAssertionResponse,
          id: c.id, type: c.type, att: c.authenticatorAttachment, tag: Object.prototype.toString.call(c),
          raw: Array.from(new Uint8Array(c.rawId)).length,           sigBytes: Array.from(new Uint8Array(c.response.signature)), uh: Array.from(new Uint8Array(c.response.userHandle)),
          json: JSON.stringify(c.toJSON()), ext: c.getClientExtensionResults(), keys: Object.keys(c),
        };
      })()`);
    expect(out.inst).toBe(true);
    expect(out.respInst).toBe(true);
    expect(out.type).toBe('public-key');
    expect(out.att).toBe('platform');
    expect(out.tag).toBe('[object PublicKeyCredential]');
    expect(out.sigBytes).toEqual([...Buffer.from('SIG')]);
    expect(out.uh).toEqual([...Buffer.from('uh')]);
    expect(JSON.parse(out.json)).toMatchObject({ id: assertionResult.credential.id, type: 'public-key', response: { signature: assertionResult.credential.signature } });
    expect(out.keys).toEqual([]);
    const sent = b.seen[0];
    expect(sent.op).toBe('get');
    expect(sent.mediation).toBe('optional');
    expect(sent.publicKey).toEqual({ challenge: 'AQID', rpId: 'example.com', timeout: 5000, userVerification: 'required', allowCredentials: [{ id: 'CQkJ', transports: ['internal'] }] });
    expect(JSON.stringify(sent)).not.toContain('evil.test');
  });
  it('passes password and federated requests, and anything without publicKey, to the browser', async () => {
    const b = bridgeOf(() => assertionResult);
    const p = page({ bridge: b });
    expect(await p.run(`navigator.credentials.get({ password: true })`)).toBe('native-get');
    expect(await p.run(`navigator.credentials.get()`)).toBe('native-get');
    expect(b.seen).toHaveLength(0);
  });
  it('hands the call to the browser when main says to (security key, phone)', async () => {
    const b = bridgeOf(() => ({ fallback: true }));
    const p = page({ bridge: b });
    expect(await p.run(`navigator.credentials.get({ publicKey: { challenge: new Uint8Array(4), allowCredentials: [{ type: 'public-key', id: new Uint8Array(4), transports: ['usb'] }] } })`)).toBe('native-get');
    expect(p.run(`nativeCalls.length`)).toBe(1);
  });
  it('turns main\'s refusal into the DOMException a browser would raise', async () => {
    const p = page({ bridge: bridgeOf(() => ({ ok: false, name: 'NotAllowedError', message: 'nope' })) });
    const e = await p.run(`navigator.credentials.get({ publicKey: { challenge: new Uint8Array(4) } }).then(() => null, e => ({ name: e.name, msg: e.message, dom: e instanceof DOMException }))`);
    expect(e).toEqual({ name: 'NotAllowedError', msg: 'nope', dom: true });
  });
  it('a malformed challenge is a TypeError, nothing is sent', async () => {
    const b = bridgeOf(() => assertionResult);
    const p = page({ bridge: b });
    const e = await p.run(`navigator.credentials.get({ publicKey: { challenge: 'not a buffer' } }).then(() => null, e => e.name)`);
    expect(e).toBe('TypeError');
    expect(b.seen).toHaveLength(0);
  });
  it('an abort signal rejects with its reason and tells main to cancel', async () => {
    let release;
    const b = { seen: [], request(r) { this.seen.push(r); return new Promise(res => { release = res; }); }, cancel(id) { this.seen.push({ cancel: id }); } };
    const p = page({ bridge: b });
    const result = p.run(`(() => { globalThis.ac = new AbortController(); return navigator.credentials.get({ mediation: 'conditional', signal: ac.signal, publicKey: { challenge: new Uint8Array(4) } }).then(() => 'resolved', e => e.name); })()`);
    expect(b.seen[0].mediation).toBe('conditional');
    p.run(`ac.abort()`);
    expect(await result).toBe('AbortError');
    expect(b.seen[1]).toEqual({ cancel: b.seen[0].id });
    release(assertionResult);
  });
  it('an already aborted signal never reaches main', async () => {
    const b = bridgeOf(() => assertionResult);
    const p = page({ bridge: b });
    const r = await p.run(`(() => { const ac = new AbortController(); ac.abort(); return navigator.credentials.get({ signal: ac.signal, publicKey: { challenge: new Uint8Array(4) } }).then(() => 'resolved', e => e.name); })()`);
    expect(r).toBe('AbortError');
    expect(b.seen).toHaveLength(0);
  });
  it('ignores a call whose receiver is not navigator.credentials', async () => {
    const b = bridgeOf(() => assertionResult);
    const p = page({ bridge: b });
    expect(await p.run(`CredentialsContainer.prototype.get.call(new CredentialsContainer(), { publicKey: { challenge: new Uint8Array(4) } })`)).toBe('native-get');
    expect(b.seen).toHaveLength(0);
  });
});

describe('navigator.credentials.create', () => {
  const options = `{ publicKey: { challenge: new Uint8Array([7, 7]), rp: { id: 'example.com', name: 'Example' }, user: { id: new Uint8Array([1, 2]), name: 'ada', displayName: 'Ada' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }], excludeCredentials: [{ type: 'public-key', id: new Uint8Array([5]) }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred', junk: 1 }, extensions: { credProps: true, prf: {} } } }`;
  it('sends only what main needs, and returns an attestation credential with the getters', async () => {
    const b = bridgeOf(() => attestationResult);
    const p = page({ bridge: b });
    const out = await p.run(`navigator.credentials.create(${options}).then(c => ({
      inst: c instanceof PublicKeyCredential, resp: c.response instanceof AuthenticatorAttestationResponse,
      att: Array.from(new Uint8Array(c.response.attestationObject)), alg: c.response.getPublicKeyAlgorithm(),
      pk: Array.from(new Uint8Array(c.response.getPublicKey())), tr: c.response.getTransports(), ext: c.getClientExtensionResults(),
      ad: Array.from(new Uint8Array(c.response.getAuthenticatorData())) }))`);
    expect(out.inst && out.resp).toBe(true);
    expect(out.att).toEqual([...Buffer.from('ATT')]);
    expect(out.alg).toBe(-7);
    expect(out.pk).toEqual([...Buffer.from('SPKI')]);
    expect(out.tr).toEqual(['internal']);
    expect(out.ext).toEqual({ credProps: { rk: true } });
    expect(out.ad).toEqual([...Buffer.from('AD')]);
    const sent = b.seen[0].publicKey;
    expect(sent.rp).toEqual({ id: 'example.com', name: 'Example' });
    expect(sent.user).toEqual({ id: 'AQI', name: 'ada', displayName: 'Ada' });
    expect(sent.excludeCredentials).toEqual([{ id: 'BQ', transports: [] }]);
    expect(sent.authenticatorSelection).toEqual({ residentKey: 'required', userVerification: 'preferred' });
    expect(sent.extensions).toEqual({ credProps: true });
  });
  it('a missing rp or user is a TypeError', async () => {
    const p = page({ bridge: bridgeOf(() => attestationResult) });
    expect(await p.run(`navigator.credentials.create({ publicKey: { challenge: new Uint8Array(1) } }).then(() => null, e => e.name)`)).toBe('TypeError');
  });
});
