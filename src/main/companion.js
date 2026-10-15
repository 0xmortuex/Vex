// === Companion web view: pairing and publishing (main process) ==============
//
// A phone browser that has no Vex app can see the Devices view (every device
// and its open tabs) and open links, read only, from a static page
// (companion/). docs/COMPANION_PROTOCOL.md is the contract; the relay it talks
// to is workers/companion/ (source only, the owner deploys it).
//
// What the phone never gets: the sync key, the sync session, or anything the
// Devices view would not show on this computer. This module publishes a
// snapshot sealed with a key that exists only in the pairing code shown on
// this screen, and the relay stores ciphertext it cannot read.
//
//   code    12 characters of Crockford base32 (60 bits), valid 5 minutes, once
//   master  PBKDF2-HMAC-SHA256(code, salt "vex-companion/1", 100000, 32 bytes)
//   lookup  HKDF-SHA256(master, info "vex-companion lookup")  -> sent to the relay
//   key     HKDF-SHA256(master, info "vex-companion key")     -> never leaves
//   blob    base64( iv(12) | AES-256-GCM(JSON) | tag(16) ), AAD "vex-companion/1"
//           (the container of docs/SYNC_PROTOCOL.md §3.2, with an AAD)
const crypto = require('crypto');
const liveSession = require('../renderer/js/live-session');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;
const PAIR_WINDOW_MS = 5 * 60 * 1000;
const PBKDF2_ROUNDS = 100000;
const SALT = 'vex-companion/1';
const AAD = Buffer.from('vex-companion/1');
const MAX_PAYLOAD = 48 * 1024;            // JSON, before sealing
const MIN_PUBLISH_GAP_MS = 5000;
const READ_TTL_SECONDS = 3600;             // how long the phone may keep reading

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
function generateCode(randomInt = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
const formatCode = code => normalizeCode(code).replace(/(.{4})(?=.)/g, '$1-');

function deriveKeys(code) {
  const normal = normalizeCode(code);
  if (!new RegExp('^[' + ALPHABET + ']{' + CODE_LENGTH + '}$').test(normal)) throw new Error('That is not a pairing code');
  const master = crypto.pbkdf2Sync(normal, SALT, PBKDF2_ROUNDS, 32, 'sha256');
  const hkdf = info => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(info), 32));
  return { lookup: hkdf('vex-companion lookup').toString('hex'), key: hkdf('vex-companion key') };
}

function seal(key, value, iv = crypto.randomBytes(12)) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64');
}
function open(key, blob) {
  const raw = Buffer.from(String(blob), 'base64');
  if (raw.length < 12 + 16) throw new Error('The snapshot is too short');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(AAD);
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8'));
}

// A relay is https, or http on this computer (the local stand-in).
function relayBase(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw new Error('Set the companion relay address first (Settings › Vex Sync › Phone browser)'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new Error('The companion relay must be an https address');
  if (u.username || u.password) throw new Error('The companion relay address must not contain a password');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

// What a snapshot may hold, whatever the window asked for: the Devices-view
// contract (live-session.js devicesView), every address re-checked here.
function cleanSnapshot(input, now) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.devices) || input.devices.length > 20) throw new Error('Not a Devices view');
  const text = (v, n) => String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, n);
  const devices = input.devices.map(d => {
    if (!d || typeof d !== 'object') throw new Error('Not a Devices view');
    const tabs = (Array.isArray(d.tabs) ? d.tabs : []).slice(0, 100)
      .filter(t => t && liveSession.shareableUrl(String(t.url)) !== null)
      .map(t => ({
        url: String(t.url), title: text(t.title || t.url, 300),
        ...(typeof t.favicon === 'string' && /^https?:\/\//i.test(t.favicon) && t.favicon.length <= 512 ? { favicon: t.favicon } : {}),
        ...(t.group ? { group: text(t.group, 60) } : {}), pinned: !!t.pinned,
        lastActive: Number.isSafeInteger(t.lastActive) ? t.lastActive : 0,
      }));
    return {
      deviceId: text(d.deviceId, 80), name: text(d.name, 60) || 'Unnamed device', kind: d.kind === 'phone' ? 'phone' : 'computer',
      self: !!d.self, lastSeen: Number.isSafeInteger(d.lastSeen) ? d.lastSeen : null,
      lastActive: Number.isSafeInteger(d.lastActive) ? d.lastActive : 0, tabCount: tabs.length, tabs,
    };
  });
  const readingQueue = (Array.isArray(input.readingQueue) ? input.readingQueue : []).slice(0, 100)
    .filter(i => i && liveSession.shareableUrl(String(i.url)) !== null)
    .map(i => ({ url: String(i.url), title: text(i.title || i.url, 300) }));
  const payload = { v: 1, generatedAt: now, devices, readingQueue };
  if (JSON.stringify(payload).length > MAX_PAYLOAD) throw new Error('The Devices view is too large to publish');
  return payload;
}

// deps: { fetch, now(), randomInt, relayUrl() }
function createCompanion(deps = {}) {
  const now = deps.now || Date.now;
  let session = null;   // { base, lookup, key, publishToken, expiresAt (pairing), pairedAt, lastPublish, lastPayloadAt }

  async function call(base, path, { method = 'GET', body, headers = {} } = {}) {
    const doFetch = deps.fetch || require('electron').net.fetch;
    const r = await doFetch(base + path, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || 'The companion relay answered ' + r.status);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  async function start({ relayUrl, devices }) {
    if (session) await stop().catch(() => {});
    const base = relayBase(relayUrl);
    const code = generateCode(deps.randomInt);
    const { lookup, key } = deriveKeys(code);
    const publishToken = crypto.randomBytes(32).toString('hex');
    const payload = cleanSnapshot(devices, now());
    await call(base, '/companion/v1/pair', {
      method: 'POST',
      body: { lookup, publishHash: crypto.createHash('sha256').update(publishToken).digest('hex'), blob: seal(key, payload), readTtl: READ_TTL_SECONDS },
    });
    session = { base, lookup, key, publishToken, expiresAt: now() + PAIR_WINDOW_MS, lastPublish: now() };
    return { code: formatCode(code), expiresAt: session.expiresAt, relay: base };
  }

  async function publish(input) {
    if (!session) throw new Error('No phone is paired');
    if (now() - session.lastPublish < MIN_PUBLISH_GAP_MS) return { ok: true, skipped: true };
    const payload = cleanSnapshot(input, now());
    await call(session.base, '/companion/v1/snapshot', {
      method: 'PUT', headers: { 'X-Vex-Publish': session.publishToken }, body: { lookup: session.lookup, blob: seal(session.key, payload) },
    });
    session.lastPublish = now();
    return { ok: true };
  }

  async function stop() {
    if (!session) return { ok: true };
    const s = session;
    session = null;
    await call(s.base, '/companion/v1/pair', { method: 'DELETE', headers: { 'X-Vex-Publish': s.publishToken }, body: { lookup: s.lookup } });
    return { ok: true };
  }

  const status = () => (session
    ? { paired: true, pairingOpen: now() < session.expiresAt, expiresAt: session.expiresAt, relay: session.base }
    : { paired: false, pairingOpen: false, expiresAt: 0, relay: '' });

  return { start, publish, stop, status };
}

module.exports = { createCompanion, generateCode, formatCode, normalizeCode, deriveKeys, seal, open, relayBase, cleanSnapshot, PAIR_WINDOW_MS, CODE_LENGTH, ALPHABET };
