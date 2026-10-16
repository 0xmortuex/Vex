// === Crash-proof tabs: what is kept, and where ==============================
//
// A crash or a power cut loses the half-written comment, the long form and the
// place in a long page. Vex already restores which tabs were open; this keeps
// the rest, taken every half minute by the interface (js/tab-snapshots.js):
// the scroll position, and the text typed into plain text fields.
//
// What is stored is decided in two places, so neither has to be trusted alone:
//   * the interface never captures a password field, a field in a form that
//     has one, a card or one-time-code field, or anything from a private, Tor,
//     burner or routed tab (VexTabPolicy.canReadWebview);
//   * this file drops everything but http(s) addresses, bounds every size, and
//     writes the text only through the OS-encrypted SecretStore (Windows DPAPI
//     via safeStorage — the same helper the password vault and authenticator
//     use). When OS encryption is not available the form text is NOT stored at
//     all: only the address and scroll position, in a plain file.
//
// Entries are keyed by address, not tab id: ids are reassigned when tabs are
// restored (tabs.js _savedTabRecord).
'use strict';

const ENC_FILE = 'tab-snapshots.vex';
const PLAIN_KEY = 'tab-snapshots-lite';
const MAX_ENTRIES = 60;
const MAX_FIELDS = 40;
const MAX_VALUE = 20000;
const MAX_URL = 2048;
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
// A tab closed with typed text in it (T2-077): the text is kept this long, and for at most this many pages.
const RESCUE_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_RESCUE = 10;

function cleanUrl(u) {
  if (typeof u !== 'string' || u.length > MAX_URL) return null;
  let p;
  try { p = new URL(u); } catch { return null; }
  if (p.protocol !== 'https:' && p.protocol !== 'http:') return null;
  p.hash = '';
  return p.toString();
}

function cleanEntry(raw, withFields, now) {
  if (!raw || typeof raw !== 'object') return null;
  const url = cleanUrl(raw.url);
  if (!url) return null;
  const sx = Number(raw.scroll && raw.scroll.x), sy = Number(raw.scroll && raw.scroll.y);
  const scroll = { x: Number.isFinite(sx) && sx >= 0 ? Math.min(Math.round(sx), 1e7) : 0, y: Number.isFinite(sy) && sy >= 0 ? Math.min(Math.round(sy), 1e7) : 0 };
  const fields = [];
  if (withFields && Array.isArray(raw.fields)) {
    for (const f of raw.fields.slice(0, MAX_FIELDS)) {
      if (!f || typeof f.s !== 'string' || typeof f.v !== 'string' || !f.v) continue;
      if (f.s.length > 300 || f.v.length > MAX_VALUE) continue;
      const i = Number.isInteger(f.i) && f.i >= 0 && f.i < 1000 ? f.i : 0;
      fields.push({ s: f.s, i, v: f.v });
    }
  }
  const at = Number.isFinite(raw.at) ? raw.at : now;
  const out = { url, scroll, fields, at };
  if (typeof raw.title === 'string' && raw.title) out.title = raw.title.slice(0, 200);
  if (raw.closed === true && Number.isFinite(raw.closedAt)) { out.closed = true; out.closedAt = raw.closedAt; }
  return out;
}

function createTabSnapshots({ secrets, plain, file, encryptionAvailable, now = () => Date.now(), log }) {
  if (!secrets || !plain) throw new Error('createTabSnapshots needs a secret store and a plain store');
  const note = typeof log === 'function' ? log : () => {};
  const canEncrypt = () => { try { return !!encryptionAvailable(); } catch { return false; } };

  async function readAll() {
    if (canEncrypt()) {
      const v = await secrets.read(file);
      if (v && Array.isArray(v.entries)) return v.entries;
    }
    const lite = await plain.read(PLAIN_KEY);
    return lite && Array.isArray(lite.entries) ? lite.entries : [];
  }

  // entries: what the interface captured this round. keepUrls: addresses of
  // tabs that are open but were not captured (asleep, still loading, waiting
  // to be restored) — their earlier snapshot stays; every other old one goes.
  async function save({ entries, keepUrls = [], closedUrls = [], dropUrls = [] } = {}) {
    if (!Array.isArray(entries) || !Array.isArray(keepUrls) || !Array.isArray(closedUrls) || !Array.isArray(dropUrls)) throw new Error('A snapshot needs entries and keepUrls');
    const t = now();
    const withFields = canEncrypt();
    const fresh = [];
    const seen = new Set();
    for (const raw of entries.slice(0, MAX_ENTRIES)) {
      const e = cleanEntry(raw, withFields, t);
      if (!e || seen.has(e.url)) continue;
      seen.add(e.url);
      // Nothing to restore (top of the page, empty boxes): the address is
      // marked seen so an older snapshot of it is dropped, not kept.
      if (!e.fields.length && e.scroll.x === 0 && e.scroll.y === 0) continue;
      fresh.push({ ...e, at: t });
    }
    const keep = new Set(keepUrls.slice(0, 200).map(cleanUrl).filter(Boolean));
    // Tabs closed since the last round: what they had typed is kept as a rescue entry.
    const closed = new Set(closedUrls.slice(0, 50).map(cleanUrl).filter(Boolean));
    const drop = new Set(dropUrls.slice(0, 50).map(cleanUrl).filter(Boolean));
    const previous = (await readAll()).map(e => (e && withFields && closed.has(e.url) && !keep.has(e.url) && Array.isArray(e.fields) && e.fields.length && !e.closed ? { ...e, closed: true, closedAt: t } : e));
    const old = previous.filter(e => e && !seen.has(e.url) && !drop.has(e.url) && (
      (keep.has(e.url) && t - e.at < MAX_AGE_MS) || (e.closed === true && t - (e.closedAt || e.at) < RESCUE_AGE_MS && Array.isArray(e.fields) && e.fields.length)));
    const rescue = old.filter(e => e.closed).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0)).slice(0, MAX_RESCUE);
    const all = fresh.concat(old.filter(e => !e.closed), rescue).slice(0, MAX_ENTRIES);
    if (withFields) {
      await secrets.write(file, { v: 1, entries: all });
      // A plain copy from an earlier no-encryption run must not linger.
      await plain.remove(PLAIN_KEY).catch(() => {});
    } else {
      await plain.write(PLAIN_KEY, { v: 1, entries: all.map(e => ({ ...e, fields: [] })) });
    }
    return { ok: true, count: all.length, formsKept: withFields };
  }

  async function load() {
    const t = now();
    const list = (await readAll()).filter(e => e && typeof e.url === 'string' && (e.closed ? t - (e.closedAt || e.at || 0) < RESCUE_AGE_MS : t - (e.at || 0) < MAX_AGE_MS));
    return { entries: list, formsKept: canEncrypt() };
  }

  async function clear() {
    await secrets.clear(file);
    await plain.remove(PLAIN_KEY);
    note('[TabSnapshots] cleared');
    return { ok: true };
  }

  // Forget one rescued page (the person dismissed it, or restored it).
  async function drop(url) {
    const u = cleanUrl(url);
    if (!u) throw new Error('Not a web address');
    const list = (await readAll()).filter(e => e && e.url !== u);
    if (canEncrypt()) await secrets.write(file, { v: 1, entries: list });
    else await plain.write(PLAIN_KEY, { v: 1, entries: list.map(e => ({ ...e, fields: [] })) });
    return { ok: true, count: list.length };
  }

  return { save, load, clear, drop, cleanUrl };
}

module.exports = { createTabSnapshots, cleanUrl, cleanEntry, ENC_FILE, PLAIN_KEY };
