// === Saved passwords and authenticator accounts in Vex Sync ================
//
// The sync engine runs in the window (js/sync-engine.js): it merges records
// and encrypts the whole document with the sync key. Saved passwords and
// authenticator secrets never reach the window in readable form for that:
// this module, in the main process, seals each saved login or authenticator
// account on its own with a key derived from the sync key, and the window
// carries only those sealed items. They are merged item by item like any
// other record, and opened again here, on the device that applies them. So
// the document the window keeps on disk (sync-records), a backup of it, a
// problem report or a log line holds no password and no 2FA secret, and the
// server sees only the outer encryption, as for everything else.
//
// An item: { id, t, s }
//   id  the item's identity, an HMAC of what makes it that login (site +
//       username) or that account (issuer + name + secret), so the same login
//       saved on two devices is one record, and the window learns nothing
//       about which site it is;
//   t   when it last changed (ms), so the newer change wins a conflict;
//   s   base64( iv(12) | AES-256-GCM(payload) | tag(16) ), the payload being
//       the login or account as JSON. The IV is an HMAC of the payload, so the
//       same payload seals to the same text and an unchanged item is never
//       seen as an edit (it reveals only that two items are equal).
// Both keys are derived from the sync key with HKDF (SYNC_PROTOCOL.md §4.9).
const crypto = require('crypto');

const KINDS = ['passwords', 'authenticator'];
const AAD = 'vex-secret/1';
const ID_RE = /^[a-f0-9]{32}$/;
const MAX_SEALED = 65536;

function deriveKeys(keyHex) {
  if (typeof keyHex !== 'string' || !/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error('This device has no usable sync key — sign in to Vex Sync again');
  const ikm = Buffer.from(keyHex, 'hex');
  const derive = info => Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from(info), 32));
  return { enc: derive('vex-sync secrets v1 enc'), iv: derive('vex-sync secrets v1 iv'), id: derive('vex-sync secrets v1 id') };
}
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text, 'utf8').digest();

// Each kind: what one item is (canonical, so the same item always seals the
// same), what makes it that item, when it changed, and what is valid.
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const totpSecret = value => String(value || '').replace(/[\s=]/g, '').toUpperCase();
const KIND = {
  passwords: {
    canonical: e => ({ host: e.host, username: e.username, password: e.password, ...(typeof e.note === 'string' && e.note ? { note: e.note } : {}), ...(typeof e.updatedAt === 'string' ? { updatedAt: e.updatedAt } : {}) }),
    identity: e => e.host + '\n' + e.username,
    changedAt: e => Date.parse(e.updatedAt),
    valid: e => text(e.host, 2048) && e.host.length > 0 && text(e.username, 4096) && typeof e.password === 'string' && e.password.length > 0 && e.password.length <= 16384
      && (e.note === undefined || text(e.note, 20000)) && (e.updatedAt === undefined || text(e.updatedAt, 64)),
    label: e => (e.username || '(no username)') + ' on ' + e.host,
  },
  authenticator: {
    canonical: e => ({ id: e.id, label: e.label, issuer: e.issuer, secret: e.secret, algorithm: e.algorithm || 'sha1', digits: e.digits, period: e.period, ...(typeof e.created === 'string' ? { created: e.created } : {}) }),
    identity: e => (e.issuer || '') + '\n' + (e.label || '') + '\n' + totpSecret(e.secret),
    changedAt: e => Date.parse(e.created),
    valid: e => text(e.id, 100) && e.id.length > 0 && text(e.label, 4096) && text(e.issuer, 4096) && text(e.secret, 16384)
      && ['sha1', 'sha256', 'sha512'].includes(e.algorithm) && Number.isInteger(e.digits) && Number.isInteger(e.period) && (e.created === undefined || text(e.created, 64)),
    label: e => (e.issuer ? e.issuer + ' (' + e.label + ')' : e.label),
  },
};

// stores: { passwords: { load(), save(list) }, authenticator: { load(), save(list), validate(entry) } }
// readKeyHex() -> the sync key (hex), or null when this device is not signed in.
function createSyncSecrets({ readKeyHex, isLocked, stores, randomId = () => crypto.randomUUID() }) {
  if (typeof readKeyHex !== 'function' || typeof isLocked !== 'function' || !stores) throw new Error('createSyncSecrets: missing readKeyHex, isLocked or stores');
  // What this device held when the sync engine last read it (seal), per kind:
  // id -> sealed text. A pull changes only what the merge changed against
  // this, so a login saved meanwhile is never overwritten or removed.
  const read = new Map();

  function refuseWhileLocked() {
    if (isLocked()) throw new Error('Vex is locked — passwords and authenticator codes sync after you unlock it');
  }
  async function keys() {
    const hex = await readKeyHex();
    if (!hex) throw new Error('This device is not signed in to Vex Sync');
    return deriveKeys(hex);
  }
  function kindOf(kind) {
    if (!KINDS.includes(kind)) throw new Error('Unknown kind of synced secret: ' + kind);
    return KIND[kind];
  }
  const aad = (kind, id) => Buffer.from(AAD + '\n' + kind + '\n' + id);

  function idOf(k, kind, entry) {
    return hmac(k.id, kind + '\n' + KIND[kind].identity(entry)).toString('hex').slice(0, 32);
  }
  function seal(k, kind, entry) {
    const def = KIND[kind];
    const payload = def.canonical(entry);
    const id = idOf(k, kind, payload);
    const plain = Buffer.from(JSON.stringify(payload), 'utf8');
    const iv = crypto.createHmac('sha256', k.iv).update(kind + '\n' + id + '\n').update(plain).digest().subarray(0, 12);
    const cipher = crypto.createCipheriv('aes-256-gcm', k.enc, iv);
    cipher.setAAD(aad(kind, id));
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const t = def.changedAt(payload);
    return { id, t: Number.isSafeInteger(t) && t > 0 ? t : 0, s: Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64') };
  }
  // The item an `s` holds, checked: it must open with this sync key, be valid,
  // and be the item its id says it is.
  function open(k, kind, id, s) {
    if (!ID_RE.test(String(id)) || typeof s !== 'string' || !s || s.length > MAX_SEALED) throw new Error('Invalid synced ' + kind + ' item');
    const raw = Buffer.from(s, 'base64');
    if (raw.length < 29) throw new Error('Invalid synced ' + kind + ' item');
    let entry;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', k.enc, raw.subarray(0, 12));
      decipher.setAAD(aad(kind, id));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      entry = JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8'));
    } catch {
      throw new Error('A synced ' + (kind === 'passwords' ? 'password' : 'authenticator account') + ' could not be opened with this device’s sync key');
    }
    const def = KIND[kind];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !def.valid(entry)) throw new Error('Invalid synced ' + kind + ' item');
    if (kind === 'authenticator' && stores.authenticator.validate) stores.authenticator.validate(entry);
    if (idOf(k, kind, entry) !== id) throw new Error('A synced ' + kind + ' item does not match its record');
    return def.canonical(entry);
  }
  function sealedList(k, kind, list) {
    const out = new Map();
    list.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const item = seal(k, kind, entry);
      if (!out.has(item.id)) out.set(item.id, { ...item, index });
    });
    return out;
  }
  function checkItems(kind, list) {
    if (!Array.isArray(list) || list.length > 20000) throw new Error('Invalid synced ' + kind + ' list');
    const byId = new Map();
    for (const item of list) {
      if (!item || typeof item !== 'object' || !ID_RE.test(String(item.id)) || !Number.isSafeInteger(item.t) || item.t < 0 || typeof item.s !== 'string' || !item.s || item.s.length > MAX_SEALED) {
        throw new Error('Invalid synced ' + kind + ' item');
      }
      byId.set(item.id, item.s);
    }
    return byId;
  }

  // -> { [kind]: [{ id, t, s }] } sorted by id, for each kind asked.
  async function sealKinds(kinds) {
    refuseWhileLocked();
    if (!Array.isArray(kinds) || !kinds.length) throw new Error('No kind of synced secret asked for');
    const k = await keys();
    const out = {};
    for (const kind of kinds) {
      kindOf(kind);
      const items = sealedList(k, kind, stores[kind].load());
      read.set(kind, new Map([...items].map(([id, item]) => [id, item.s])));
      out[kind] = [...items.values()].map(({ id, t, s }) => ({ id, t, s })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    return out;
  }

  // lists: { [kind]: [{ id, t, s }] }, the merged result for each kind this
  // device syncs. Only what changed since sealKinds read it is written: an
  // item gone from the list is removed here, a new or changed one put in,
  // unless this device changed that item itself in between (its own change
  // goes up on the next sync instead). -> { changed }
  async function applyKinds(lists) {
    refuseWhileLocked();
    if (!lists || typeof lists !== 'object' || Array.isArray(lists)) throw new Error('Invalid synced secrets');
    const k = await keys();
    let changed = 0;
    for (const [kind, list] of Object.entries(lists)) {
      kindOf(kind);
      const before = read.get(kind);
      if (!before) throw new Error('Vex Sync must read this device’s ' + kind + ' before it changes them');
      const incoming = checkItems(kind, list);
      const current = stores[kind].load();
      const mine = sealedList(k, kind, current);
      const remove = new Set(), put = new Map();
      for (const [id, s] of before) {
        if (!incoming.has(id) && mine.get(id)?.s === s) remove.add(id);
      }
      for (const [id, s] of incoming) {
        if (before.get(id) === s) continue;
        if (mine.get(id)?.s !== before.get(id)) continue;
        put.set(id, open(k, kind, id, s));
      }
      if (remove.size || put.size) {
        const next = writeItems(k, kind, current, remove, put);
        await stores[kind].save(next);
        changed += remove.size + put.size;
      }
      read.delete(kind);
    }
    return { changed };
  }

  // The list with the items in `remove` taken out and those in `put` set
  // (each replacing the one with its identity, or added at the end).
  function writeItems(k, kind, current, remove, put) {
    const next = [];
    const done = new Set();
    for (const entry of current) {
      const id = entry && typeof entry === 'object' ? idOf(k, kind, KIND[kind].canonical(entry)) : null;
      if (id && remove.has(id)) continue;
      if (id && put.has(id)) {
        if (!done.has(id)) next.push(put.get(id));
        done.add(id);
        continue;
      }
      next.push(entry);
    }
    for (const [id, entry] of put) if (!done.has(id)) next.push(entry);
    // Authenticator accounts are found by their own id on this device: one
    // arriving under an id another account here already has gets a new one.
    if (kind === 'authenticator') {
      const seen = new Set();
      for (let i = 0; i < next.length; i++) {
        if (seen.has(next[i].id)) next[i] = { ...next[i], id: randomId() };
        seen.add(next[i].id);
      }
    }
    return next;
  }

  // Sync conflicts name the login or account (never its password or secret):
  // items: [{ kind, id, s }] -> [{ label } | { error }].
  async function describe(items) {
    refuseWhileLocked();
    if (!Array.isArray(items)) throw new Error('Invalid synced secrets');
    const k = await keys();
    return items.map(({ kind, id, s }) => {
      try { kindOf(kind); return { label: KIND[kind].label(open(k, kind, id, s)) }; }
      catch (err) { return { error: err.message }; }
    });
  }

  // A version picked in Settings › Vex Sync › Sync conflicts, put back on
  // this device: item { id, t, s }, or null to remove the item `id`.
  async function putBack({ kind, id, item }) {
    refuseWhileLocked();
    kindOf(kind);
    if (!ID_RE.test(String(id))) throw new Error('Invalid synced ' + kind + ' item');
    if (item && (typeof item !== 'object' || item.id !== id)) throw new Error('Invalid synced ' + kind + ' item');
    const k = await keys();
    const current = stores[kind].load();
    const next = item ? writeItems(k, kind, current, new Set(), new Map([[id, open(k, kind, id, item.s)]]))
      : writeItems(k, kind, current, new Set([id]), new Map());
    await stores[kind].save(next);
    read.delete(kind);
    return { ok: true };
  }

  function register(ipcMain) {
    ipcMain.handle('sync-secrets-seal', (_e, kinds) => sealKinds(kinds));
    ipcMain.handle('sync-secrets-apply', (_e, lists) => applyKinds(lists));
    ipcMain.handle('sync-secrets-describe', (_e, items) => describe(items));
    ipcMain.handle('sync-secrets-put-back', (_e, request) => putBack(request || {}));
  }

  return { sealKinds, applyKinds, describe, putBack, register };
}

module.exports = { createSyncSecrets, deriveKeys, KINDS };
