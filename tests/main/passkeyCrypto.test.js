// Vex passkeys: every byte format a site verifies, checked against an
// independent verifier (tests/helpers/webauthn-verify.js) and known vectors.
import { describe, it, expect } from 'vitest';
const crypto = require('crypto');
const pc = require('../../src/main/passkey-crypto.js');
const V = require('../helpers/webauthn-verify.js');

const hex = (b) => Buffer.from(b).toString('hex');

describe('CBOR encoder (RFC 8949 appendix A vectors)', () => {
  const vectors = [
    [0, '00'], [1, '01'], [10, '0a'], [23, '17'], [24, '1818'], [25, '1819'], [100, '1864'], [1000, '1903e8'],
    [1000000, '1a000f4240'], [-1, '20'], [-10, '29'], [-100, '3863'], [-1000, '3903e7'],
    ['', '60'], ['a', '6161'], ['IETF', '6449455446'], ['\u00fc', '62c3bc'],
    [Buffer.from('01020304', 'hex'), '4401020304'], [[], '80'], [[1, 2, 3], '83010203'],
    [new Map(), 'a0'], [new Map([[1, 2], [3, 4]]), 'a201020304'], [false, 'f4'], [true, 'f5'], [null, 'f6'],
    [{ a: 1, b: [2, 3] }, 'a26161016162820203'],
  ];
  for (const [value, expected] of vectors) {
    it(`encodes ${JSON.stringify(value instanceof Map ? [...value] : value)} as ${expected}`, () => {
      expect(hex(pc.cborEncode(value))).toBe(expected);
    });
  }
  it('round-trips through the independent decoder', () => {
    const v = new Map([['fmt', 'none'], ['n', -70000], ['b', Buffer.alloc(300, 7)], ['l', [1, [2]]]]);
    const back = V.cborDecodeAll(pc.cborEncode(v));
    expect(back.get('fmt')).toBe('none');
    expect(back.get('n')).toBe(-70000);
    expect(back.get('b').length).toBe(300);
    expect(back.get('l')).toEqual([1, [2]]);
  });
  it('refuses a float rather than writing a wrong one', () => {
    expect(() => pc.cborEncode(1.5)).toThrow(/integers/);
  });
});

describe('base64url', () => {
  it('round-trips and rejects non-base64url text', () => {
    const b = crypto.randomBytes(37);
    expect(pc.fromB64u(pc.b64u(b)).equals(b)).toBe(true);
    expect(pc.b64u(Buffer.from([0xfb, 0xff]))).toBe('-_8');
    expect(() => pc.fromB64u('a+b')).toThrow();
    expect(() => pc.fromB64u('abcde')).toThrow();
  });
});

describe('COSE key', () => {
  it('is a canonical ES256 EC2 key', () => {
    const k = pc.generateCredentialKey();
    const cose = pc.coseKeyEs256(k.x, k.y);
    // a5 | 01 02 | 03 26 | 20 01 | 21 58 20 <x> | 22 58 20 <y>
    expect(hex(cose.subarray(0, 10))).toBe('a501020326200121' + '5820');
    const m = V.cborDecodeAll(cose);
    expect(m.get(1)).toBe(2);
    expect(m.get(3)).toBe(-7);
    expect(m.get(-1)).toBe(1);
    expect(m.get(-2).equals(k.x)).toBe(true);
    expect(m.get(-3).equals(k.y)).toBe(true);
    // The same point as the SPKI the page can read with getPublicKey().
    expect(V.coseToKeyObject(m).export({ format: 'der', type: 'spki' }).equals(k.publicKeySpki)).toBe(true);
    expect(pc.coseKeyFromSpki(k.publicKeySpki).equals(cose)).toBe(true);
  });
  it('refuses a coordinate that is not 32 bytes', () => {
    expect(() => pc.coseKeyEs256(Buffer.alloc(31), Buffer.alloc(32))).toThrow();
  });
});

describe('authenticatorData', () => {
  const rpId = 'example.com';
  it('has the layout of WebAuthn 6.1 without attested data', () => {
    const ad = pc.buildAuthData({ rpId, userPresent: true, userVerified: true, signCount: 0x01020304 });
    expect(ad.length).toBe(37);
    expect(ad.subarray(0, 32).equals(crypto.createHash('sha256').update('example.com').digest())).toBe(true);
    expect(ad[32]).toBe(0x05);                                   // UP | UV
    expect(hex(ad.subarray(33, 37))).toBe('01020304');           // big endian
  });
  it('sets BE and BS only as asked, and never BS without BE', () => {
    expect(pc.buildAuthData({ rpId, backupEligible: true })[32]).toBe(0x09);
    expect(pc.buildAuthData({ rpId, backupEligible: true, backupState: true })[32]).toBe(0x19);
    expect(() => pc.buildAuthData({ rpId, backupState: true })).toThrow(/backup eligible/);
    expect(pc.buildAuthData({ rpId, userPresent: false })[32]).toBe(0x00);
  });
  it('appends attested credential data: zero AAGUID, id length, id, COSE key', () => {
    const k = pc.generateCredentialKey();
    const id = crypto.randomBytes(32);
    const cose = pc.coseKeyEs256(k.x, k.y);
    const ad = pc.buildAuthData({ rpId, userVerified: false, credentialId: id, coseKey: cose });
    expect(ad[32]).toBe(0x41);                                   // UP | AT
    const parsed = V.parseAuthData(ad);
    expect(parsed.flags).toMatchObject({ UP: true, UV: false, AT: true, ED: false });
    expect(parsed.attested.aaguid.equals(Buffer.alloc(16))).toBe(true);
    expect(parsed.attested.credentialId.equals(id)).toBe(true);
    expect(parsed.attested.keyBytes.equals(cose)).toBe(true);
    expect(parsed.extensionBytes.length).toBe(0);
  });
  it('rejects an out of range counter and a short credential id', () => {
    expect(() => pc.buildAuthData({ rpId, signCount: -1 })).toThrow();
    expect(() => pc.buildAuthData({ rpId, signCount: 2 ** 32 })).toThrow();
    expect(() => pc.buildAuthData({ rpId, credentialId: Buffer.alloc(8), coseKey: Buffer.alloc(1) })).toThrow();
  });
});

describe('attestationObject (format none)', () => {
  it('decodes as { fmt: none, attStmt: {}, authData } in the order browsers emit', () => {
    const k = pc.generateCredentialKey();
    const ad = pc.buildAuthData({ rpId: 'a.example', credentialId: crypto.randomBytes(32), coseKey: pc.coseKeyEs256(k.x, k.y) });
    const obj = pc.attestationObjectNone(ad);
    // a3 63 'fmt' 64 'none' 67 'attStmt' a0 68 'authData' 58 xx
    expect(hex(obj.subarray(0, 1 + 4 + 5 + 8 + 1))).toBe('a3' + '63666d74' + '646e6f6e65' + '6761747453746d74' + 'a0');
    const m = V.cborDecodeAll(obj);
    expect([...m.keys()]).toEqual(['fmt', 'attStmt', 'authData']);
    expect(m.get('authData').equals(ad)).toBe(true);
  });
});

describe('clientDataJSON', () => {
  it('is built from the real origin, in the order browsers use', () => {
    const json = pc.buildClientDataJSON({ type: 'webauthn.get', challenge: 'YWJj', origin: 'https://login.example.com' });
    expect(json.toString()).toBe('{"type":"webauthn.get","challenge":"YWJj","origin":"https://login.example.com","crossOrigin":false}');
  });
  it('adds topOrigin only when cross origin', () => {
    const j = JSON.parse(pc.buildClientDataJSON({ type: 'webauthn.create', challenge: 'YWJj', origin: 'https://a.test', crossOrigin: true, topOrigin: 'https://b.test' }));
    expect(j.crossOrigin).toBe(true);
    expect(j.topOrigin).toBe('https://b.test');
  });
  it('refuses an unknown type and a challenge that is not base64url', () => {
    expect(() => pc.buildClientDataJSON({ type: 'x', challenge: 'YQ', origin: 'https://a.test' })).toThrow();
    expect(() => pc.buildClientDataJSON({ type: 'webauthn.get', challenge: 'a b', origin: 'https://a.test' })).toThrow();
    expect(() => pc.buildClientDataJSON({ type: 'webauthn.get', challenge: '', origin: 'https://a.test' })).toThrow();
  });
});

describe('assertion signature', () => {
  it('is DER ECDSA over authData || SHA-256(clientDataJSON) that verifies, and only for that data', () => {
    const k = pc.generateCredentialKey();
    const ad = pc.buildAuthData({ rpId: 'example.com', userVerified: true, signCount: 5 });
    const cd = pc.buildClientDataJSON({ type: 'webauthn.get', challenge: 'Y2hhbGxlbmdl', origin: 'https://example.com' });
    const sig = pc.signAssertion(k.privateKeyPkcs8, ad, cd);
    // DER: SEQUENCE { INTEGER r, INTEGER s }
    expect(sig[0]).toBe(0x30);
    expect(sig[1]).toBe(sig.length - 2);
    expect(sig[2]).toBe(0x02);
    const pub = crypto.createPublicKey({ key: k.publicKeySpki, format: 'der', type: 'spki' });
    const msg = Buffer.concat([ad, V.sha256(cd)]);
    expect(crypto.verify('sha256', msg, { key: pub, dsaEncoding: 'der' }, sig)).toBe(true);
    const other = pc.buildClientDataJSON({ type: 'webauthn.get', challenge: 'b3RoZXI', origin: 'https://example.com' });
    expect(crypto.verify('sha256', Buffer.concat([ad, V.sha256(other)]), { key: pub, dsaEncoding: 'der' }, sig)).toBe(false);
  });
  it('verifies through the independent relying-party verifier, and it catches tampering', () => {
    const k = pc.generateCredentialKey();
    const ad = pc.buildAuthData({ rpId: 'example.com', signCount: 1 });
    const cd = pc.buildClientDataJSON({ type: 'webauthn.get', challenge: 'Y2g', origin: 'https://example.com' });
    const cred = { rawId: 'AAAA', response: { clientDataJSON: pc.b64u(cd), authenticatorData: pc.b64u(ad), signature: pc.b64u(pc.signAssertion(k.privateKeyPkcs8, ad, cd)) } };
    const stored = { publicKey: crypto.createPublicKey({ key: k.publicKeySpki, format: 'der', type: 'spki' }), signCount: 0 };
    const expected = { challenge: 'Y2g', origin: 'https://example.com', rpId: 'example.com' };
    expect(V.verifyAssertion(cred, stored, expected).signCount).toBe(1);
    expect(() => V.verifyAssertion(cred, stored, { ...expected, origin: 'https://evil.example' })).toThrow(/origin/);
    expect(() => V.verifyAssertion(cred, stored, { ...expected, rpId: 'other.com' })).toThrow(/rpIdHash/);
    expect(() => V.verifyAssertion(cred, stored, { ...expected, challenge: 'zzz' })).toThrow(/challenge/);
    expect(() => V.verifyAssertion(cred, { ...stored, signCount: 1 }, expected)).toThrow(/signCount/);
    expect(() => V.verifyAssertion(cred, stored, { ...expected, requireUV: true })).toThrow(/verification/);
  });
});

describe('relying party id and origin', () => {
  const ok = (rp, url) => pc.resolveRpId(rp, url);
  const bad = (rp, url) => { try { pc.resolveRpId(rp, url); } catch (e) { return e; } return null; };
  it('defaults to the page host', () => {
    expect(ok(undefined, 'https://login.example.com/x?y').rpId).toBe('login.example.com');
    expect(ok(undefined, 'https://example.com:8443/').origin).toBe('https://example.com:8443');
  });
  it('accepts the host or a domain above it', () => {
    expect(ok('example.com', 'https://login.example.com/').rpId).toBe('example.com');
    expect(ok('login.example.com', 'https://login.example.com/').rpId).toBe('login.example.com');
    expect(ok('EXAMPLE.com', 'https://a.b.example.com/').rpId).toBe('example.com');
  });
  it('refuses a domain the page is not under', () => {
    expect(bad('example.org', 'https://example.com/').name).toBe('SecurityError');
    expect(bad('ample.com', 'https://example.com/').name).toBe('SecurityError');
    expect(bad('sub.example.com', 'https://example.com/').name).toBe('SecurityError');
    expect(bad('example.com.evil.test', 'https://example.com/').name).toBe('SecurityError');
  });
  it('refuses public suffixes and bare TLDs', () => {
    expect(bad('com', 'https://example.com/')).not.toBeNull();
    expect(bad('co.uk', 'https://example.co.uk/')).not.toBeNull();
    expect(bad('github.io', 'https://me.github.io/')).not.toBeNull();
    expect(ok('me.github.io', 'https://me.github.io/').rpId).toBe('me.github.io');
    expect(ok('example.co.uk', 'https://www.example.co.uk/').rpId).toBe('example.co.uk');
  });
  it('refuses IP addresses and rp ids that are not plain domains', () => {
    expect(bad(undefined, 'https://127.0.0.1/')).not.toBeNull();
    expect(bad('1.2.3.4', 'https://1.2.3.4/')).not.toBeNull();
    expect(bad('example.com/path', 'https://example.com/')).not.toBeNull();
    expect(bad('user@example.com', 'https://example.com/')).not.toBeNull();
    expect(bad('example.com:443', 'https://example.com/')).not.toBeNull();
    expect(bad('', 'https://example.com/')).not.toBeNull();
  });
  it('needs a secure page, localhost excepted', () => {
    expect(bad(undefined, 'http://example.com/').message).toMatch(/secure/);
    expect(bad(undefined, 'file:///C:/x.html')).not.toBeNull();
    expect(ok(undefined, 'http://localhost:8080/').rpId).toBe('localhost');
    expect(ok('localhost', 'http://localhost:8080/').origin).toBe('http://localhost:8080');
    expect(bad(undefined, 'about:blank')).not.toBeNull();
    expect(bad(undefined, 'not a url')).not.toBeNull();
  });
});
