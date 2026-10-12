// === Vex Mobile — saved passwords and 2FA codes in Vex Sync ===
//
// The desktop's main/sync-secrets.js, for the phone (SYNC_PROTOCOL.md §4.9):
// each saved login and each authenticator account is sealed on its own with
// keys derived from the sync key, inside the encrypted document — so the
// document the phone keeps on disk, a backup of it or a log line holds no
// password and no 2FA secret, and the worker sees only the outer encryption.
//
// An item: { id, t, s }
//   id  HMAC of what makes it that login (site + username) or that account
//       (issuer + name + secret): the same login on two devices is one record
//   t   when it last changed (ms): of two devices' changes the newer wins
//   s   base64( iv(12) | AES-256-GCM(payload) | tag(16) ), AAD
//       "vex-secret/1\n<kind>\n<id>", the IV an HMAC of the payload — so an
//       unchanged item seals to the same text and is never seen as an edit
//
// The payloads, field for field and in this order (the id and the IV hang on
// the exact JSON text, so the order is the format):
//   login    { host, username, password, note?, updatedAt? }
//   account  { id, label, issuer, secret, algorithm, digits, period, created? }
//
// The phone's vault keeps a login and its 2FA secret in one entry; here each
// entry becomes a login item when it has a password, and an account item when
// it has a secret. What is needed to seal an entry the same way every time
// (its updatedAt, its account's id, name and issuer) is kept on the entry.

const VexSyncSecrets = (() => {
  const KINDS = ['passwords', 'authenticator'];
  const SOURCES = { 'secret:passwords': 'passwords', 'secret:authenticator': 'authenticator' };
  const AAD = 'vex-secret/1';
  const ID_RE = /^[a-f0-9]{32}$/;
  const MAX_SEALED = 65536;

  const utf8 = text => new TextEncoder().encode(text);
  const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const fromHex = text => new Uint8Array(String(text).match(/../g).map(pair => parseInt(pair, 16)));
  function concat(...parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  }
  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  function fromBase64(text) {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  async function deriveKeys(keyHex) {
    if (typeof keyHex !== 'string' || !/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error('This phone has no usable sync key — sign in to Vex Sync again');
    const ikm = await crypto.subtle.importKey('raw', fromHex(keyHex.toLowerCase()), 'HKDF', false, ['deriveBits']);
    const derive = async info => new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) }, ikm, 256));
    const [enc, iv, id] = await Promise.all([derive('vex-sync secrets v1 enc'), derive('vex-sync secrets v1 iv'), derive('vex-sync secrets v1 id')]);
    const hmacKey = raw => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return {
      enc: await crypto.subtle.importKey('raw', enc, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
      iv: await hmacKey(iv),
      id: await hmacKey(id)
    };
  }
  const hmac = async (key, bytes) => new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));

  // What one item is, what makes it that item, when it changed, what is valid:
  // the desktop's KIND table, word for word.
  const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
  const totpSecret = value => String(value || '').replace(/[\s=]/g, '').toUpperCase();
  const KIND = {
    passwords: {
      canonical: e => ({ host: e.host, username: e.username, password: e.password, ...(typeof e.note === 'string' && e.note ? { note: e.note } : {}), ...(typeof e.updatedAt === 'string' ? { updatedAt: e.updatedAt } : {}) }),
      identity: e => e.host + '\n' + e.username,
      changedAt: e => Date.parse(e.updatedAt),
      valid: e => text(e.host, 2048) && e.host.length > 0 && text(e.username, 4096) && typeof e.password === 'string' && e.password.length > 0 && e.password.length <= 16384
        && (e.note === undefined || text(e.note, 20000)) && (e.updatedAt === undefined || text(e.updatedAt, 64))
    },
    authenticator: {
      canonical: e => ({ id: e.id, label: e.label, issuer: e.issuer, secret: e.secret, algorithm: e.algorithm || 'sha1', digits: e.digits, period: e.period, ...(typeof e.created === 'string' ? { created: e.created } : {}) }),
      identity: e => (e.issuer || '') + '\n' + (e.label || '') + '\n' + totpSecret(e.secret),
      changedAt: e => Date.parse(e.created),
      valid: e => text(e.id, 100) && e.id.length > 0 && text(e.label, 4096) && text(e.issuer, 4096) && text(e.secret, 16384)
        && ['sha1', 'sha256', 'sha512'].includes(e.algorithm) && Number.isInteger(e.digits) && Number.isInteger(e.period) && (e.created === undefined || text(e.created, 64))
    }
  };
  function kindOf(kind) {
    if (!KINDS.includes(kind)) throw new Error('Unknown kind of synced secret: ' + kind);
    return KIND[kind];
  }

  async function idOf(keys, kind, payload) {
    return hex(await hmac(keys.id, utf8(kind + '\n' + KIND[kind].identity(payload)))).slice(0, 32);
  }

  /** One login or account → { id, t, s }. */
  async function seal(keys, kind, entry) {
    const def = kindOf(kind);
    const payload = def.canonical(entry);
    if (!def.valid(payload)) throw new Error('Invalid ' + kind + ' item');
    const id = await idOf(keys, kind, payload);
    const plain = utf8(JSON.stringify(payload));
    const iv = (await hmac(keys.iv, concat(utf8(kind + '\n' + id + '\n'), plain))).slice(0, 12);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(AAD + '\n' + kind + '\n' + id) }, keys.enc, plain));
    const t = def.changedAt(payload);
    return { id, t: Number.isSafeInteger(t) && t > 0 ? t : 0, s: toBase64(concat(iv, sealed)) };
  }

  /** The item an `s` holds, checked: it opens with this key, is valid, and is the item its id says. */
  async function open(keys, kind, id, s) {
    const def = kindOf(kind);
    if (!ID_RE.test(String(id)) || typeof s !== 'string' || !s || s.length > MAX_SEALED) throw new Error('Invalid synced ' + kind + ' item');
    const raw = fromBase64(s);
    if (raw.length < 29) throw new Error('Invalid synced ' + kind + ' item');
    let entry;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: utf8(AAD + '\n' + kind + '\n' + id) }, keys.enc, raw.subarray(12));
      entry = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error('A synced ' + (kind === 'passwords' ? 'password' : 'authenticator account') + ' could not be opened with this phone’s sync key');
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !def.valid(entry)) throw new Error('Invalid synced ' + kind + ' item');
    if ((await idOf(keys, kind, entry)) !== id) throw new Error('A synced ' + kind + ' item does not match its record');
    return def.canonical(entry);
  }

  /** A sealed list's shape, as the desktop checks it (sealedItems). */
  function checkItems(kind, list) {
    if (!Array.isArray(list) || list.length > 20000) throw new Error('Invalid synced ' + kind);
    for (const item of list) {
      if (!item || typeof item !== 'object' || !ID_RE.test(String(item.id)) || !Number.isSafeInteger(item.t) || item.t < 0
        || typeof item.s !== 'string' || !item.s || item.s.length > MAX_SEALED) throw new Error('Invalid synced ' + kind);
    }
    return list.map(({ id, t, s }) => ({ id, t, s }));
  }

  // ── The phone's vault entries, as items ──────────────────────────────────
  const normalHost = host => String(host || '').trim().toLowerCase().replace(/^www\./, '');
  const iso = ms => new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now()).toISOString();

  /** A vault entry's login payload, or null (no password: a 2FA-only entry). */
  function loginOf(entry) {
    if (!entry || !entry.password || !normalHost(entry.host)) return null;
    return KIND.passwords.canonical({
      host: normalHost(entry.host), username: String(entry.username || ''), password: String(entry.password),
      note: typeof entry.note === 'string' ? entry.note : undefined,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : iso(entry.at)
    });
  }

  /** A vault entry's authenticator payload, or null (no 2FA secret). */
  function accountOf(entry) {
    if (!entry || !entry.secret) return null;
    const auth = entry.auth || {};
    const algorithm = String(entry.algorithm || 'SHA1').toLowerCase().replace(/^sha-?/, 'sha');
    return KIND.authenticator.canonical({
      id: String(auth.id || 'ph-' + entry.id),
      label: String(auth.label != null ? auth.label : (entry.username || entry.label || entry.host || '')),
      issuer: String(auth.issuer != null ? auth.issuer : (entry.label && entry.label !== entry.host ? entry.label : (entry.host || ''))),
      secret: String(entry.secret),
      algorithm: ['sha1', 'sha256', 'sha512'].includes(algorithm) ? algorithm : 'sha1',
      digits: Number(entry.digits) || 6,
      period: Number(entry.period) || 30,
      created: typeof auth.created === 'string' ? auth.created : iso(entry.at)
    });
  }

  /**
   * Every vault entry of one kind, sealed: Map id → { id, t, s, entryId }.
   * Two entries that are the same login keep the first, as the desktop does.
   */
  async function sealVault(keys, kind, entries) {
    const out = new Map();
    for (const entry of entries) {
      const payload = kind === 'passwords' ? loginOf(entry) : accountOf(entry);
      if (!payload || !KIND[kind].valid(payload)) continue;
      const item = await seal(keys, kind, payload);
      if (!out.has(item.id)) out.set(item.id, { ...item, entryId: entry.id });
    }
    return out;
  }

  return {
    KINDS, SOURCES, deriveKeys, seal, open, idOf, checkItems, sealVault, loginOf, accountOf, normalHost,
    // For tests: the canonical payload of a kind.
    canonical: (kind, entry) => kindOf(kind).canonical(entry)
  };
})();

if (typeof window !== 'undefined') window.VexSyncSecrets = VexSyncSecrets;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSyncSecrets };
