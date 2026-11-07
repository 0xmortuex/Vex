// An independent signature on the update feed (latest.yml).
//
// Why: the updater trusts the installer's sha512 that latest.yml gives, and
// latest.yml comes from the SAME GitHub release as the installer. Whoever can
// write to that release (a stolen GitHub account or token) could publish a
// matching pair and every installed Vex would run it. So the owner signs
// latest.yml OFFLINE with an Ed25519 key that never touches GitHub
// (scripts/sign-update-feed.js writes latest.yml.sig), and the app carries the
// matching PUBLIC key(s) (update-pubkeys.json). A feed with no valid signature
// from one of those keys is refused.
//
// Formats (deliberately tiny, so there is little to get wrong):
//   public key  base64 of the 32 raw key bytes (44 characters)
//   latest.yml.sig  one line: base64 of the 64-byte signature of the EXACT
//                   bytes of latest.yml (surrounding whitespace is ignored)
// A list of up to MAX_KEYS public keys allows rotation: the new key is added
// in one release, signing switches to it in a later one, and the old key is
// removed after that.
//
// TRANSITION SAFETY: with an empty key list nothing is verified (the updater
// behaves exactly as before); the moment one key is embedded, verification is
// mandatory. This module never decides that on its own: see keysFrom().
'use strict';
const crypto = require('crypto');

const MAX_KEYS = 4;
const MAX_FEED_BYTES = 256 * 1024;   // same cap the updater reads latest.yml with
const MAX_SIG_BYTES = 1024;
// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw bytes follow.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

class SignatureError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function rawPublicKey(b64) {
  const text = String(b64 || '').trim();
  if (text.length !== 44 || !B64.test(text)) throw new SignatureError('bad-key', 'An update public key must be 44 base64 characters (32 bytes).');
  const raw = Buffer.from(text, 'base64');
  if (raw.length !== 32) throw new SignatureError('bad-key', 'An update public key must be 32 bytes.');
  return raw;
}
function toKeyObject(b64) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, rawPublicKey(b64)]), format: 'der', type: 'spki' });
}
// The base64 raw public key and a short id of it, from a KeyObject (key generation).
function publicKeyToB64(keyObject) {
  const der = keyObject.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('base64');
}
const keyId = b64 => crypto.createHash('sha256').update(rawPublicKey(b64)).digest('hex').slice(0, 12);

// The key list from the parsed update-pubkeys.json. A file that is present but
// malformed throws: silently treating a broken list as "no keys" would turn
// verification off, which is the one failure this feature must not have.
function keysFrom(data) {
  if (data == null) return [];
  if (typeof data !== 'object' || !Array.isArray(data.keys)) throw new SignatureError('bad-key-file', 'update-pubkeys.json must be {"keys": [...]}.');
  if (data.keys.length > MAX_KEYS) throw new SignatureError('bad-key-file', 'update-pubkeys.json lists more than ' + MAX_KEYS + ' keys.');
  const seen = new Set();
  return data.keys.map(entry => {
    const b64 = typeof entry === 'string' ? entry : entry && entry.key;
    rawPublicKey(b64);
    if (seen.has(b64)) throw new SignatureError('bad-key-file', 'update-pubkeys.json lists the same key twice.');
    seen.add(b64);
    return b64;
  });
}

// Throws SignatureError unless `sigText` is a valid signature of `feedBytes`
// by one of `keys`. Returns the id of the key that matched.
function verifyFeed(feedBytes, sigText, keys) {
  if (!Array.isArray(keys) || !keys.length) throw new SignatureError('no-keys', 'No update public key is embedded, so there is nothing to verify against.');
  if (!Buffer.isBuffer(feedBytes)) throw new SignatureError('bad-feed', 'The update feed was not read as bytes.');
  if (feedBytes.length > MAX_FEED_BYTES) throw new SignatureError('too-large', 'The update feed is larger than expected, so it was not checked.');
  if (sigText == null) throw new SignatureError('missing', 'The release has no signature file (latest.yml.sig).');
  const text = Buffer.isBuffer(sigText) ? sigText.toString('latin1') : String(sigText);
  if (text.length > MAX_SIG_BYTES) throw new SignatureError('malformed', 'The signature file is too large to be a signature.');
  const b64 = text.trim();
  if (b64.length !== 88 || !B64.test(b64)) throw new SignatureError('malformed', 'The signature file is not a base64 Ed25519 signature.');
  const sig = Buffer.from(b64, 'base64');
  if (sig.length !== 64) throw new SignatureError('malformed', 'The signature is not 64 bytes.');
  for (const key of keys) {
    // A key that cannot be loaded must not make a good key unusable, but it must not pass either.
    let ok = false;
    try { ok = crypto.verify(null, feedBytes, toKeyObject(key), sig); }
    catch { /* vex-allow-empty-catch: a bad embedded key is reported by keysFrom() at start; here it simply does not match */ }
    if (ok) return keyId(key);
  }
  throw new SignatureError('invalid', 'The update feed\'s signature does not match any Vex update key.');
}

module.exports = { verifyFeed, keysFrom, toKeyObject, publicKeyToB64, keyId, rawPublicKey, SignatureError, MAX_KEYS, MAX_FEED_BYTES, SPKI_PREFIX };
