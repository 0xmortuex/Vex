// === Time travel: a compact, local journal of how Vex looked ================
//
// The interface pushes a small description of the browser whenever it has
// changed (js/time-travel.js): which tabs are open (address, title, group),
// the active workspace, the notes (id, title, a short hash), the reminders
// that are due, and the focus state. This file decides what is kept and for
// how long:
//
//   * private, Tor, routed, temporary-session and .onion tabs are dropped here
//     whatever the interface sent (the interface filters them too, so neither
//     has to be trusted alone); only http(s) addresses are kept, without
//     credentials or a #fragment;
//   * nothing is written while a game runs or Game mode is on (isPaused);
//   * a snapshot identical to the last one is not stored, and none closer than
//     minGapMs to the previous one;
//   * retention is days AND bytes: anything older than retentionDays goes, and
//     when the journal is still over maxBytes the oldest snapshots go until it
//     fits. The newest snapshot is never dropped;
//   * note TEXT is kept only for "restore this note version", in a separate
//     file that is written only through the OS-encrypted store (seal). Without
//     OS encryption the journal still records ids, titles and hashes but keeps
//     no note text, and stats().noteRestore says so. Each note keeps at most
//     noteRevisionsPerNote versions and all notes together at most
//     noteRevisionBytes; the newest version of a note is never dropped;
//   * forget() removes the journal and every note version.
//
// All of it stays on this PC, in files of Vex's own folder. The journal is one
// line per snapshot (deflated), appended; only pruning rewrites the file.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DAY = 24 * 3600 * 1000;
const DEFAULT_LIMITS = Object.freeze({
  retentionDays: 30,
  maxBytes: 8 * 1024 * 1024,
  minGapMs: 60 * 1000,
  maxTabs: 80,
  maxNotes: 400,
  maxReminders: 60,
  noteRevisionsPerNote: 15,
  noteRevisionBytes: 6 * 1024 * 1024,
  noteMaxChars: 200000,
});
const MIN_RETENTION = 1;
const MAX_RETENTION = 365;
const MAX_URL = 2048;

// Same 32-bit FNV-1a as js/time-travel.js; plus the length so a collision
// needs two notes of equal length.
function hashText(text) {
  const s = String(text == null ? '' : text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + '-' + s.length;
}
const HASH_RE = /^[0-9a-f]{8}-\d{1,9}$/;

function clip(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

// → a clean http(s) address or null.
function cleanUrl(u) {
  if (typeof u !== 'string' || u.length > MAX_URL * 2) return null;
  let p;
  try { p = new URL(u); } catch { return null; }
  if (p.protocol !== 'https:' && p.protocol !== 'http:') return null;
  if (/\.onion$/i.test(p.hostname)) return null;
  p.username = ''; p.password = ''; p.hash = '';
  const out = p.toString();
  return out.length > MAX_URL ? null : out;
}

const ROUTED = /^persist:(?:route-|container-tor-)/;
// A tab that must never reach the journal.
function isExcludedTab(t) {
  if (!t || typeof t !== 'object') return true;
  if (t.private || t.incognito || t.tor || t.routed || t.ownSession) return true;
  const part = typeof t.partition === 'string' ? t.partition : '';
  if (part && !part.startsWith('persist:')) return true;
  if (ROUTED.test(part)) return true;
  return false;
}

function cleanTab(t) {
  if (isExcludedTab(t)) return null;
  const u = cleanUrl(t.url);
  if (!u) return null;
  const out = { u, t: clip(t.title, 200) };
  if (typeof t.groupName === 'string' && t.groupName) out.g = clip(t.groupName, 60);
  if (t.pinned) out.p = 1;
  if (t.active) out.a = 1;
  const part = typeof t.partition === 'string' ? t.partition : '';
  if (part && part !== 'persist:main') out.part = part.slice(0, 80);
  return out;
}

// The raw snapshot from the interface → { snap, noteTexts } or null.
// noteTexts: id → text, for the notes whose text was sent along.
function redactSnapshot(raw, limits = DEFAULT_LIMITS) {
  if (!raw || typeof raw !== 'object') return null;
  const tabs = [];
  const seen = new Set();
  for (const t of Array.isArray(raw.tabs) ? raw.tabs : []) {
    const c = cleanTab(t);
    if (!c) continue;
    const key = c.u + '|' + (c.part || '');
    if (seen.has(key)) continue;
    seen.add(key);
    tabs.push(c);
    if (tabs.length >= limits.maxTabs) break;
  }
  const notes = [];
  const noteTexts = new Map();
  for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
    if (!n || typeof n.id !== 'string' || !/^[\w.:-]{1,80}$/.test(n.id)) continue;
    let h = typeof n.h === 'string' && HASH_RE.test(n.h) ? n.h : null;
    if (typeof n.content === 'string') {
      const text = n.content.slice(0, limits.noteMaxChars);
      h = hashText(text);
      noteTexts.set(n.id, { title: clip(n.title, 200), content: text, h });
    }
    if (!h) continue;
    notes.push({ id: n.id, t: clip(n.title, 120), h });
    if (notes.length >= limits.maxNotes) break;
  }
  const reminders = [];
  for (const r of Array.isArray(raw.reminders) ? raw.reminders : []) {
    if (!r || typeof r !== 'object') continue;
    const due = Number(r.due);
    if (!Number.isFinite(due)) continue;
    reminders.push({ t: clip(r.title, 120), due: Math.round(due) });
    if (reminders.length >= limits.maxReminders) break;
  }
  const ws = raw.workspace && typeof raw.workspace === 'object'
    ? { id: clip(raw.workspace.id, 80), name: clip(raw.workspace.name, 60) } : null;
  const focus = raw.focus && typeof raw.focus === 'object'
    ? { on: !!raw.focus.on, label: clip(raw.focus.label, 60) } : null;
  const brief = raw.brief && typeof raw.brief === 'object' && Array.isArray(raw.brief.lines)
    ? { lines: raw.brief.lines.filter(l => typeof l === 'string').slice(0, 8).map(l => l.slice(0, 160)) } : null;
  return { snap: { tabs, ws, notes, reminders, focus, brief }, noteTexts };
}

// What a snapshot "is", ignoring the time it was taken.
function contentHash(snap) {
  return hashText(JSON.stringify([snap.tabs, snap.ws, snap.notes, snap.reminders, snap.focus, snap.brief]));
}

// → what changed from a to b (either may be null = nothing).
function diffSnapshots(a, b) {
  const A = a || { tabs: [], notes: [], reminders: [], ws: null, focus: null };
  const B = b || { tabs: [], notes: [], reminders: [], ws: null, focus: null };
  const key = t => t.u + '|' + (t.part || '');
  const aTabs = new Map((A.tabs || []).map(t => [key(t), t]));
  const bTabs = new Map((B.tabs || []).map(t => [key(t), t]));
  const added = [...bTabs.entries()].filter(([k]) => !aTabs.has(k)).map(([, t]) => t);
  const removed = [...aTabs.entries()].filter(([k]) => !bTabs.has(k)).map(([, t]) => t);
  const aNotes = new Map((A.notes || []).map(n => [n.id, n]));
  const bNotes = new Map((B.notes || []).map(n => [n.id, n]));
  const notes = {
    added: [...bNotes.values()].filter(n => !aNotes.has(n.id)),
    removed: [...aNotes.values()].filter(n => !bNotes.has(n.id)),
    changed: [...bNotes.values()].filter(n => aNotes.has(n.id) && aNotes.get(n.id).h !== n.h),
  };
  const rk = r => r.t + '|' + r.due;
  const aRem = new Set((A.reminders || []).map(rk));
  const bRem = new Set((B.reminders || []).map(rk));
  const reminders = {
    added: (B.reminders || []).filter(r => !aRem.has(rk(r))),
    removed: (A.reminders || []).filter(r => !bRem.has(rk(r))),
  };
  const wsA = A.ws && A.ws.id, wsB = B.ws && B.ws.id;
  const workspace = (wsA || wsB) && wsA !== wsB ? { from: A.ws || null, to: B.ws || null } : null;
  const fa = !!(A.focus && A.focus.on), fb = !!(B.focus && B.focus.on);
  const focus = fa !== fb ? { from: fa, to: fb } : null;
  const empty = !added.length && !removed.length && !notes.added.length && !notes.removed.length && !notes.changed.length
    && !reminders.added.length && !reminders.removed.length && !workspace && !focus;
  return { tabs: { added, removed }, notes, reminders, workspace, focus, empty };
}

const plainCodec = {
  encode: (s) => zlib.deflateSync(Buffer.from(s, 'utf8')).toString('base64'),
  decode: (s) => zlib.inflateSync(Buffer.from(s, 'base64')).toString('utf8'),
};

function createStateJournal({
  dir, now = () => Date.now(), isPaused = () => false, seal = null, unseal = null,
  encryptionAvailable = () => false, limits = {}, log = () => {},
} = {}) {
  if (!dir || typeof dir !== 'string') throw new TypeError('createStateJournal: dir is required');
  const L = { ...DEFAULT_LIMITS, ...limits };
  const file = path.join(dir, 'journal.jsonl');
  const revFile = path.join(dir, 'note-versions.vex');
  const cfgFile = path.join(dir, 'journal-config.json');
  const canSeal = () => { try { return !!encryptionAvailable() && typeof seal === 'function' && typeof unseal === 'function'; } catch { return false; } };

  let index = null;      // [{ ts, bytes, hash }] oldest first
  let cfg = null;
  let revs = null;       // { id: [{ ts, h, title, content }] } oldest first
  let chain = Promise.resolve();
  const enqueue = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

  async function loadCfg() {
    if (cfg) return cfg;
    cfg = { retentionDays: L.retentionDays, enabled: true };
    try {
      const j = JSON.parse(await fs.promises.readFile(cfgFile, 'utf8'));
      if (Number.isFinite(j.retentionDays)) cfg.retentionDays = Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, Math.round(j.retentionDays)));
      if (typeof j.enabled === 'boolean') cfg.enabled = j.enabled;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return cfg;
  }
  async function saveCfg() {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(cfgFile, JSON.stringify(cfg));
  }

  async function readLines() {
    let raw;
    try { raw = await fs.promises.readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return raw.split('\n').filter(Boolean);
  }
  function parseLine(line) {
    const o = JSON.parse(plainCodec.decode(line));
    return o;
  }

  async function loadIndex() {
    if (index) return index;
    index = [];
    for (const line of await readLines()) {
      try {
        const o = parseLine(line);
        if (Number.isFinite(o.ts) && o.snap) index.push({ ts: o.ts, bytes: Buffer.byteLength(line) + 1, hash: o.hash || '' });
      } catch (err) { log('[journal] skipped an unreadable line: ' + err.message); }
    }
    index.sort((a, b) => a.ts - b.ts);
    return index;
  }

  async function loadRevs() {
    if (revs) return revs;
    revs = {};
    let raw;
    try { raw = await fs.promises.readFile(revFile, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return revs; throw e; }
    if (!canSeal()) return revs;   // cannot be read without the OS store; kept on disk untouched
    const parsed = JSON.parse(unseal(raw));
    if (parsed && typeof parsed === 'object') revs = parsed;
    return revs;
  }
  function revBytes(r) {
    let n = 0;
    for (const list of Object.values(r)) for (const v of list) n += (v.content ? v.content.length : 0) + (v.title ? v.title.length : 0) + 40;
    return n;
  }
  async function saveRevs() {
    if (!canSeal()) return;
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = revFile + '.tmp';
    await fs.promises.writeFile(tmp, seal(JSON.stringify(revs)));
    await fs.promises.rename(tmp, revFile);
  }
  function trimRevs() {
    for (const id of Object.keys(revs)) {
      const list = revs[id];
      if (list.length > L.noteRevisionsPerNote) revs[id] = list.slice(list.length - L.noteRevisionsPerNote);
    }
    // Over the total: drop the oldest version anywhere, never a note's newest.
    while (revBytes(revs) > L.noteRevisionBytes) {
      let oldestId = null, oldestTs = Infinity;
      for (const [id, list] of Object.entries(revs)) {
        if (list.length > 1 && list[0].ts < oldestTs) { oldestTs = list[0].ts; oldestId = id; }
      }
      if (oldestId === null) break;
      revs[oldestId].shift();
    }
  }

  async function rewrite(keep) {
    if (!keep.length) { await fs.promises.rm(file, { force: true }); index = []; return; }
    const lines = await readLines();
    const byTs = new Map();
    for (const line of lines) {
      try { const o = parseLine(line); byTs.set(o.ts, line); } catch { /* unreadable: dropped */ }
    }
    const out = keep.map(e => byTs.get(e.ts)).filter(Boolean);
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, out.join('\n') + '\n');
    await fs.promises.rename(tmp, file);
    index = keep.filter(e => byTs.has(e.ts)).map(e => ({ ...e, bytes: Buffer.byteLength(byTs.get(e.ts)) + 1 }));
  }

  async function pruneNow() {
    const idx = await loadIndex();
    const c = await loadCfg();
    const cutoff = now() - c.retentionDays * DAY;
    let keep = idx.filter(e => e.ts >= cutoff);
    if (!keep.length && idx.length) keep = [idx[idx.length - 1]];     // never drop the newest
    let total = keep.reduce((s, e) => s + e.bytes, 0);
    // Over the cap: drop down to 90% of it, so a journal that is full does not
    // rewrite its whole file on every snapshot.
    if (total > L.maxBytes) {
      const target = L.maxBytes * 0.9;
      while (total > target && keep.length > 1) total -= keep.shift().bytes;
    }
    if (keep.length !== idx.length) await rewrite(keep);
    return idx.length - keep.length;
  }

  async function append(raw) {
    const c = await loadCfg();
    if (!c.enabled) return { stored: false, reason: 'off' };
    if (isPaused()) return { stored: false, reason: 'paused' };
    const red = redactSnapshot(raw, L);
    if (!red) throw new Error('A journal snapshot must be an object');
    const idx = await loadIndex();
    const t = now();
    // Note versions first: a note changed while the snapshot itself is a
    // duplicate still counts.
    let revChanged = false;
    if (red.noteTexts.size && canSeal()) {
      const r = await loadRevs();
      for (const [id, v] of red.noteTexts) {
        const list = r[id] || (r[id] = []);
        if (list.length && list[list.length - 1].h === v.h) continue;
        list.push({ ts: t, h: v.h, title: v.title, content: v.content });
        revChanged = true;
      }
      if (revChanged) { trimRevs(); await saveRevs(); }
    }
    const hash = contentHash(red.snap);
    const last = idx[idx.length - 1];
    if (last && last.hash === hash) return { stored: false, reason: 'unchanged', revisions: revChanged };
    if (last && t - last.ts < L.minGapMs) return { stored: false, reason: 'too-soon', revisions: revChanged };
    const line = plainCodec.encode(JSON.stringify({ ts: t, hash, snap: red.snap }));
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.appendFile(file, line + '\n');
    idx.push({ ts: t, bytes: Buffer.byteLength(line) + 1, hash });
    const pruned = await pruneNow();
    return { stored: true, ts: t, pruned, revisions: revChanged };
  }

  async function readEntry(ts) {
    for (const line of await readLines()) {
      let o;
      try { o = parseLine(line); } catch { continue; }
      if (o.ts === ts) return o;
    }
    return null;
  }

  async function list({ from = 0, to = Infinity } = {}) {
    const idx = await loadIndex();
    return idx.filter(e => e.ts >= from && e.ts <= to).map(e => ({ ts: e.ts, bytes: e.bytes }));
  }

  // The snapshot in force at `ts`: the newest one at or before it.
  async function at(ts) {
    const idx = await loadIndex();
    let hit = null;
    for (const e of idx) { if (e.ts <= ts) hit = e; else break; }
    if (!hit) return null;
    const o = await readEntry(hit.ts);
    if (!o) return null;
    const prev = idx[idx.indexOf(hit) - 1];
    let before = null;
    if (prev) { const p = await readEntry(prev.ts); before = p && p.snap; }
    return { ts: o.ts, snap: o.snap, diffFromPrevious: diffSnapshots(before, o.snap) };
  }

  async function diff(tsA, tsB) {
    const a = await at(tsA), b = await at(tsB);
    return { a: a && a.ts, b: b && b.ts, ...diffSnapshots(a && a.snap, b && b.snap) };
  }

  async function noteVersions(id) {
    if (typeof id !== 'string') throw new TypeError('noteVersions: id must be a string');
    const r = await loadRevs();
    return (r[id] || []).map(v => ({ ts: v.ts, h: v.h, title: v.title, chars: v.content.length }));
  }
  // The version in force at `ts` (newest at or before it).
  async function noteVersionAt(id, ts) {
    const r = await loadRevs();
    const list = r[id] || [];
    let hit = null;
    for (const v of list) { if (v.ts <= ts) hit = v; else break; }
    return hit ? { ts: hit.ts, h: hit.h, title: hit.title, content: hit.content } : null;
  }

  async function stats() {
    const idx = await loadIndex();
    const c = await loadCfg();
    let noteBytes = 0;
    try { noteBytes = (await fs.promises.stat(revFile)).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const bytes = idx.reduce((s, e) => s + e.bytes, 0);
    return {
      count: idx.length, bytes, noteBytes, totalBytes: bytes + noteBytes,
      oldest: idx.length ? idx[0].ts : null, newest: idx.length ? idx[idx.length - 1].ts : null,
      retentionDays: c.retentionDays, maxBytes: L.maxBytes, enabled: c.enabled, noteRestore: canSeal(),
    };
  }

  async function configure({ retentionDays, enabled } = {}) {
    const c = await loadCfg();
    if (retentionDays !== undefined) {
      if (!Number.isFinite(retentionDays)) throw new TypeError('retentionDays must be a number');
      c.retentionDays = Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, Math.round(retentionDays)));
    }
    if (enabled !== undefined) c.enabled = !!enabled;
    await saveCfg();
    await pruneNow();
    return stats();
  }

  async function forget() {
    await fs.promises.rm(file, { force: true });
    await fs.promises.rm(revFile, { force: true });
    index = []; revs = {};
    return stats();
  }

  const q = (fn) => (...a) => enqueue(() => fn(...a));
  return {
    append: q(append), list: q(list), at: q(at), diff: q(diff), noteVersions: q(noteVersions),
    noteVersionAt: q(noteVersionAt), stats: q(stats), configure: q(configure), forget: q(forget), prune: q(pruneNow),
    limits: L,
  };
}

module.exports = {
  createStateJournal, redactSnapshot, diffSnapshots, contentHash, hashText, cleanUrl, isExcludedTab,
  DEFAULT_LIMITS, plainCodec,
};
