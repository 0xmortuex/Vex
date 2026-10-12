// === Passkey cryptography and WebAuthn data formats (main process only) =====
//
// Vex is a software WebAuthn authenticator. Everything that touches a private
// key or builds the bytes a site verifies lives here, in the main process, in
// small pure functions so each one is tested against an independent verifier
// (tests/helpers/webauthn-verify.js, written separately on purpose).
//
//   credential key   ES256: ECDSA over P-256 with SHA-256 (COSE alg -7)
//   credential id    32 random bytes
//   attestation      format "none" (no statement), AAGUID of 16 zero bytes
//   assertion        signature (DER) over authenticatorData || SHA-256(clientDataJSON)
//   clientDataJSON   built here from the frame's REAL origin, never the page's word
//
// The AAGUID is all zeros: Vex is not a certified authenticator model, and a
// zero AAGUID is what synced platform passkeys report when they do not want to
// be told apart. A site that insists on an attestation from a listed model
// (enterprise / FIDO MDS) will refuse Vex, and that is the honest outcome.
const crypto = require('crypto');

const FLAGS = Object.freeze({ UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 });
const ALG_ES256 = -7;
const AAGUID = Buffer.alloc(16);

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function fromB64u(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('Not base64url');
  return Buffer.from(text, 'base64url');
}

// --- A small CBOR encoder (RFC 8949), only what WebAuthn needs --------------
// Buffer -> byte string, string -> text string, integer -> unsigned/negative,
// Array, Map (insertion order, any key) and plain object (text keys, in order).
function head(major, n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('CBOR length out of range');
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  if (n < 0x100000000) { const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b; }
  const b = Buffer.alloc(9); b[0] = (major << 5) | 27; b.writeBigUInt64BE(BigInt(n), 1); return b;
}
function cborEncode(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) { const b = Buffer.from(value); return Buffer.concat([head(2, b.length), b]); }
  if (typeof value === 'string') { const b = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('CBOR: only integers are encoded');
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'boolean') return Buffer.from([value ? 0xf5 : 0xf4]);
  if (value === null) return Buffer.from([0xf6]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cborEncode)]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cborEncode(k), cborEncode(v)])]);
  if (value && typeof value === 'object') return cborEncode(new Map(Object.entries(value)));
  throw new Error('CBOR: unsupported value');
}

// --- Keys -------------------------------------------------------------------
// A new credential key pair: PKCS#8 private key and SPKI public key (DER), and
// the public point's coordinates for the COSE key.
function generateCredentialKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    privateKeyPkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }),
    publicKeySpki: publicKey.export({ format: 'der', type: 'spki' }),
    x: fromB64u(jwk.x), y: fromB64u(jwk.y),
  };
}
// COSE_Key for ES256 (RFC 9053): kty 2 (EC2), alg -7, crv 1 (P-256), x, y.
// Map keys in CTAP2 canonical order: 1, 3, -1, -2, -3.
function coseKeyEs256(x, y) {
  if (x.length !== 32 || y.length !== 32) throw new Error('A P-256 coordinate must be 32 bytes');
  return cborEncode(new Map([[1, 2], [3, ALG_ES256], [-1, 1], [-2, x], [-3, y]]));
}
function coseKeyFromSpki(spki) {
  const jwk = crypto.createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' }).export({ format: 'jwk' });
  return coseKeyEs256(fromB64u(jwk.x), fromB64u(jwk.y));
}

// --- authenticatorData ------------------------------------------------------
// rpIdHash(32) | flags(1) | signCount(4, big endian) | [attested credential data]
// attested credential data: aaguid(16) | credentialIdLength(2) | credentialId | COSE key
function rpIdHash(rpId) { return crypto.createHash('sha256').update(rpId, 'utf8').digest(); }
function buildAuthData({ rpId, userPresent = true, userVerified = false, backupEligible = false, backupState = false, signCount = 0, credentialId = null, coseKey = null }) {
  if (backupState && !backupEligible) throw new Error('A credential that is not backup eligible cannot be backed up');
  let flags = 0;
  if (userPresent) flags |= FLAGS.UP;
  if (userVerified) flags |= FLAGS.UV;
  if (backupEligible) flags |= FLAGS.BE;
  if (backupState) flags |= FLAGS.BS;
  const count = Buffer.alloc(4);
  if (!Number.isInteger(signCount) || signCount < 0 || signCount > 0xffffffff) throw new Error('signCount out of range');
  count.writeUInt32BE(signCount);
  const parts = [rpIdHash(rpId), Buffer.alloc(1), count];
  if (credentialId) {
    if (!coseKey) throw new Error('Attested credential data needs a public key');
    if (credentialId.length < 16 || credentialId.length > 1023) throw new Error('Credential id length out of range');
    flags |= FLAGS.AT;
    const len = Buffer.alloc(2); len.writeUInt16BE(credentialId.length);
    parts.push(AAGUID, len, Buffer.from(credentialId), coseKey);
  }
  parts[1][0] = flags;
  return Buffer.concat(parts);
}

// The registration answer's attestationObject, attestation format "none".
function attestationObjectNone(authData) {
  return cborEncode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
}

// --- clientDataJSON ---------------------------------------------------------
// `challenge` is base64url text of the bytes the page gave. Key order is the
// one browsers emit, so a site that compares the raw string sees what it expects.
function buildClientDataJSON({ type, challenge, origin, crossOrigin = false, topOrigin = null }) {
  if (type !== 'webauthn.create' && type !== 'webauthn.get') throw new Error('Unknown clientData type');
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]+$/.test(challenge)) throw new Error('Invalid challenge');
  const data = { type, challenge, origin, crossOrigin: !!crossOrigin };
  if (crossOrigin && topOrigin) data.topOrigin = topOrigin;
  return Buffer.from(JSON.stringify(data), 'utf8');
}

// --- Signing ----------------------------------------------------------------
// ECDSA P-256 / SHA-256 over authData || SHA-256(clientDataJSON), DER encoded.
function signAssertion(privateKeyPkcs8, authData, clientDataJSON) {
  const key = crypto.createPrivateKey({ key: Buffer.from(privateKeyPkcs8), format: 'der', type: 'pkcs8' });
  const hash = crypto.createHash('sha256').update(clientDataJSON).digest();
  return crypto.sign('sha256', Buffer.concat([authData, hash]), { key, dsaEncoding: 'der' });
}

// --- Relying party id and origin rules --------------------------------------
// WebAuthn level 3 §5.1.3 steps 7-9 / §5.1.4.1: the rp id must be the page's
// host or a domain it sits under, and may not be a public suffix. Vex has no
// full Public Suffix List in the main process, so the rule is: at least two
// labels (a bare TLD, "com", never passes), not on the short list of shared
// suffixes below (country second levels, and the hosting names whose
// sub-sites belong to different people), and never an IP address. The page's
// own host must also sit under the rp id, so this list can only ever make
// Vex stricter than a site's own claim, never let a page speak for another.
const SHARED_SUFFIX = /^(?:(?:com|co|org|net|gov|edu|ac|or|ne|go|gob|mil|nom|sch|ltd|plc|gouv|ind|biz|info)\.[a-z]{2}|(?:github|gitlab|bitbucket)\.io|herokuapp\.com|vercel\.app|netlify\.app|pages\.dev|workers\.dev|web\.app|firebaseapp\.com|appspot\.com|blogspot\.com|azurewebsites\.net|cloudfront\.net|amazonaws\.com|s3\.amazonaws\.com|ngrok\.io|ngrok-free\.app|onrender\.com|fly\.dev|repl\.co|glitch\.me|surge\.sh|myshopify\.com|trycloudflare\.com|duckdns\.org|no-ip\.org|dyndns\.org)$/;
function isIpHost(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':') || /^\[.*\]$/.test(host);
}
class PasskeyError extends Error {
  constructor(name, message) { super(message); this.name = name; }
}
// The page's origin for WebAuthn, or a PasskeyError. `pageUrl` is the asking
// frame's own URL as main sees it.
function originOf(pageUrl) {
  let u;
  try { u = new URL(pageUrl); } catch { throw new PasskeyError('SecurityError', 'The page address cannot be read'); }
  const host = u.hostname.toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new PasskeyError('SecurityError', 'Passkeys need a secure (https) page');
  }
  if (!host) throw new PasskeyError('SecurityError', 'The page has no host name');
  return { origin: u.origin, host, local };
}
// The rp id to use: the requested one (validated) or the page's host.
function resolveRpId(requested, pageUrl) {
  const { origin, host } = originOf(pageUrl);
  if (isIpHost(host)) throw new PasskeyError('SecurityError', 'An IP address cannot be a passkey site');
  let rpId = host;
  if (requested !== undefined && requested !== null) {
    if (typeof requested !== 'string' || !requested || requested.length > 253) throw new PasskeyError('SecurityError', 'The relying party id is not valid');
    let asHost;
    try { asHost = new URL('https://' + requested).hostname.toLowerCase(); } catch { throw new PasskeyError('SecurityError', 'The relying party id is not valid'); }
    if (asHost !== requested.toLowerCase() || isIpHost(asHost) || /[/:@?#\s]/.test(requested)) throw new PasskeyError('SecurityError', 'The relying party id is not a domain name');
    if (!(host === asHost || host.endsWith('.' + asHost))) throw new PasskeyError('SecurityError', 'The relying party id does not match this site');
    rpId = asHost;
  }
  const labels = rpId.split('.');
  if (rpId !== 'localhost' && !rpId.endsWith('.localhost') && (labels.length < 2 || SHARED_SUFFIX.test(rpId) || labels.some(l => !l))) {
    throw new PasskeyError('SecurityError', 'The relying party id is a public suffix');
  }
  return { rpId, origin, host };
}

module.exports = {
  FLAGS, ALG_ES256, AAGUID, PasskeyError,
  b64u, fromB64u, cborEncode,
  generateCredentialKey, coseKeyEs256, coseKeyFromSpki,
  rpIdHash, buildAuthData, attestationObjectNone, buildClientDataJSON, signAssertion,
  originOf, resolveRpId, isIpHost,
};
