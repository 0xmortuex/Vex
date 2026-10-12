// An independent WebAuthn relying-party verifier for Vex's tests and probes.
// Written from the specification (W3C WebAuthn level 3 §7.1 and §7.2) and the
// CBOR / COSE RFCs, NOT from src/main/passkey-crypto.js, so a mistake in the
// product's encoder is not mirrored here. It has its own CBOR decoder.
'use strict';
const crypto = require('crypto');

function cborDecode(buf, state = { i: 0 }) {
  const b = buf[state.i++];
  const major = b >> 5, info = b & 31;
  let n = info;
  if (info === 24) n = buf[state.i++];
  else if (info === 25) { n = buf.readUInt16BE(state.i); state.i += 2; }
  else if (info === 26) { n = buf.readUInt32BE(state.i); state.i += 4; }
  else if (info === 27) { n = Number(buf.readBigUInt64BE(state.i)); state.i += 8; }
  else if (info > 27) throw new Error('CBOR: unsupported additional info ' + info);
  switch (major) {
    case 0: return n;
    case 1: return -1 - n;
    case 2: { const v = buf.subarray(state.i, state.i + n); state.i += n; return Buffer.from(v); }
    case 3: { const v = buf.subarray(state.i, state.i + n).toString('utf8'); state.i += n; return v; }
    case 4: { const a = []; for (let k = 0; k < n; k++) a.push(cborDecode(buf, state)); return a; }
    case 5: { const m = new Map(); for (let k = 0; k < n; k++) { const key = cborDecode(buf, state); m.set(key, cborDecode(buf, state)); } return m; }
    case 7: if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; throw new Error('CBOR: unsupported simple value');
    default: throw new Error('CBOR: unsupported major type ' + major);
  }
}
function cborDecodeAll(buf) {
  const state = { i: 0 };
  const v = cborDecode(buf, state);
  if (state.i !== buf.length) throw new Error('CBOR: trailing bytes');
  return v;
}

// authenticatorData -> { rpIdHash, flags, signCount, attested?: { aaguid, credentialId, coseKey(Map), rest } }
function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('authenticatorData too short');
  const out = { rpIdHash: ad.subarray(0, 32), flagsByte: ad[32], signCount: ad.readUInt32BE(33) };
  const f = ad[32];
  out.flags = { UP: !!(f & 1), UV: !!(f & 4), BE: !!(f & 8), BS: !!(f & 16), AT: !!(f & 64), ED: !!(f & 128) };
  let i = 37;
  if (out.flags.AT) {
    const aaguid = ad.subarray(i, i + 16); i += 16;
    const len = ad.readUInt16BE(i); i += 2;
    const credentialId = ad.subarray(i, i + len); i += len;
    const state = { i: 0 };
    const rest = ad.subarray(i);
    const coseKey = cborDecode(rest, state);
    out.attested = { aaguid, credentialId, coseKey, keyBytes: rest.subarray(0, state.i) };
    i += state.i;
  }
  out.extensionBytes = ad.subarray(i);
  return out;
}
function coseToKeyObject(cose) {
  if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) throw new Error('Not an ES256 COSE key');
  const jwk = { kty: 'EC', crv: 'P-256', x: cose.get(-2).toString('base64url'), y: cose.get(-3).toString('base64url') };
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
function check(cond, msg) { if (!cond) throw new Error('verify: ' + msg); }

// A registration, per §7.1. `expected`: { challenge (base64url), origin, rpId, requireUV? }.
// Returns { credentialId, publicKey (KeyObject), signCount, flags, aaguid, cose }.
function verifyRegistration(cred, expected) {
  const clientDataJSON = Buffer.from(cred.response.clientDataJSON, 'base64url');
  const clientData = JSON.parse(clientDataJSON.toString('utf8'));
  check(clientData.type === 'webauthn.create', 'type is ' + clientData.type);
  check(clientData.challenge === expected.challenge, 'challenge mismatch');
  check(clientData.origin === expected.origin, 'origin mismatch: ' + clientData.origin);
  check(clientData.crossOrigin === false || clientData.crossOrigin === undefined, 'crossOrigin');
  const att = cborDecodeAll(Buffer.from(cred.response.attestationObject, 'base64url'));
  check(att instanceof Map, 'attestationObject is not a map');
  check(att.get('fmt') === 'none', 'fmt is ' + att.get('fmt'));
  const stmt = att.get('attStmt');
  check(stmt instanceof Map && stmt.size === 0, 'attStmt must be empty for none');
  const authData = att.get('authData');
  const ad = parseAuthData(authData);
  check(ad.rpIdHash.equals(sha256(Buffer.from(expected.rpId))), 'rpIdHash mismatch');
  check(ad.flags.UP, 'user presence not set');
  if (expected.requireUV) check(ad.flags.UV, 'user verification not set');
  check(ad.flags.AT && ad.attested, 'no attested credential data');
  check(!(ad.flags.BS && !ad.flags.BE), 'BS set without BE');
  const credentialId = ad.attested.credentialId;
  check(Buffer.from(cred.rawId, 'base64url').equals(credentialId), 'rawId differs from the credential id in authData');
  check(cred.id === credentialId.toString('base64url'), 'id differs from rawId');
  const publicKey = coseToKeyObject(ad.attested.coseKey);
  // getPublicKey() / getPublicKeyAlgorithm() the page may call.
  if (cred.response.publicKey) {
    const spki = Buffer.from(cred.response.publicKey, 'base64url');
    check(crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ format: 'der', type: 'spki' }).equals(publicKey.export({ format: 'der', type: 'spki' })), 'publicKey differs from the COSE key');
  }
  if (cred.response.publicKeyAlgorithm !== undefined) check(cred.response.publicKeyAlgorithm === -7, 'publicKeyAlgorithm');
  return { credentialId, publicKey, signCount: ad.signCount, flags: ad.flags, aaguid: ad.attested.aaguid, cose: ad.attested.coseKey };
}

// An assertion, per §7.2. `stored`: { publicKey (KeyObject), signCount, userHandle? (Buffer) }.
// `expected`: { challenge, origin, rpId, requireUV?, allowCredentialIds? }.
function verifyAssertion(cred, stored, expected) {
  const clientDataJSON = Buffer.from(cred.response.clientDataJSON, 'base64url');
  const clientData = JSON.parse(clientDataJSON.toString('utf8'));
  check(clientData.type === 'webauthn.get', 'type is ' + clientData.type);
  check(clientData.challenge === expected.challenge, 'challenge mismatch');
  check(clientData.origin === expected.origin, 'origin mismatch: ' + clientData.origin);
  const authData = Buffer.from(cred.response.authenticatorData, 'base64url');
  const ad = parseAuthData(authData);
  check(ad.rpIdHash.equals(sha256(Buffer.from(expected.rpId))), 'rpIdHash mismatch');
  check(ad.flags.UP, 'user presence not set');
  if (expected.requireUV) check(ad.flags.UV, 'user verification not set');
  check(!ad.flags.AT, 'AT flag set on an assertion');
  check(!(ad.flags.BS && !ad.flags.BE), 'BS set without BE');
  if (expected.allowCredentialIds) check(expected.allowCredentialIds.some(id => Buffer.from(id).equals(Buffer.from(cred.rawId, 'base64url'))), 'credential not in allowCredentials');
  const sig = Buffer.from(cred.response.signature, 'base64url');
  const ok = crypto.verify('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), { key: stored.publicKey, dsaEncoding: 'der' }, sig);
  check(ok, 'signature does not verify');
  if (ad.signCount !== 0 || stored.signCount !== 0) check(ad.signCount > stored.signCount, 'signCount did not increase');
  if (stored.userHandle && cred.response.userHandle) check(Buffer.from(cred.response.userHandle, 'base64url').equals(stored.userHandle), 'userHandle mismatch');
  return { signCount: ad.signCount, flags: ad.flags };
}

module.exports = { cborDecode, cborDecodeAll, parseAuthData, coseToKeyObject, verifyRegistration, verifyAssertion, sha256 };
