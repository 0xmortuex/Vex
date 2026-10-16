// === Crashes, kept past the session they happened in ======================
//
// The Health section listed the crashes and hangs of THIS launch only, held in
// memory — so the crash that made you restart Vex was gone by the time you
// looked. They are appended here to a small file in the profile instead, with
// the version they happened under, and Health shows the last week of them.
// Nothing leaves the machine.
const path = require('path');

const FILE = 'crash-log.json';
const KEEP = 100;
const WEEK_MS = 7 * 24 * 3600 * 1000;

function createCrashLog({ dir, fs, version = '', now = () => Date.now(), log }) {
  const note = typeof log === 'function' ? log : () => {};
  const file = path.join(dir, FILE);

  function all() {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch { return []; }              // none yet, or unreadable: start again
  }

  function add(kind, detail) {
    const list = all();
    list.push({ at: now(), kind: String(kind), detail: String(detail || '').slice(0, 300), version });
    try { fs.writeFileSync(file, JSON.stringify(list.slice(-KEEP))); return true; }
    catch (err) { note('[CrashLog] could not record a crash: ' + err.message); return false; }
  }

  function recent(ms = WEEK_MS) {
    const since = now() - ms;
    return all().filter(e => e && e.at >= since);
  }

  return { add, recent, all, file, trend: (current) => trend(all(), current || version) };
}

// The kinds of crash recorded under `version` that no other version has
// recorded: [{ kind, n }]. A version with no earlier record has every kind new.
function newKinds(entries, version) {
  const earlier = new Set();
  const now = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.kind !== 'string') continue;
    if (e.version === version) now.set(e.kind, (now.get(e.kind) || 0) + 1);
    else earlier.add(e.kind);
  }
  return [...now].filter(([kind]) => !earlier.has(kind)).map(([kind, n]) => ({ kind, n }));
}


// --- Crash trend per version (T0-023) ----------------------------------------
// What a crash IS, for grouping: a helper that went away is named by the helper
// ("Utility Video Capture"), a page by why it went ("killed", "oom"), the rest
// by their kind. The address of the page is never part of it.
function family(e) {
  const kind = String((e && e.kind) || '');
  const detail = String((e && e.detail) || '');
  if (kind === 'helper process gone') {
    const m = /^(.*?)\s+—\s+/.exec(detail);
    return 'helper: ' + (m ? m[1].trim() : 'unknown');
  }
  if (kind === 'page crashed') {
    const m = /—\s+([a-z-]+)\s+\(exit/i.exec(detail);
    return 'page: ' + (m ? m[1] : 'crashed');
  }
  return kind || 'unknown';
}

function compareVersions(a, b) {
  const x = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const y = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Three or more pages killed within five seconds were not each a bug in their
// page: something took them all at once (Windows ending processes under memory
// pressure, a sleep/resume). Said as one event, newest first.
function bursts(entries, gapMs = 5000, min = 3) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length >= min) out.push({ at: run[0].at, count: run.length, family: family(run[0]), version: run[0].version || 'unknown' }); run = []; };
  const list = (Array.isArray(entries) ? entries : []).filter(e => e && Number.isFinite(e.at) && e.kind === 'page crashed').sort((a, b) => a.at - b.at);
  for (const e of list) {
    if (run.length && (e.at - run[run.length - 1].at > gapMs || family(e) !== family(run[0]))) flush();
    run.push(e);
  }
  flush();
  return out.reverse();
}

// entries: the whole crash log. current: the running version. Returns
//   versions   newest first: { version, total, families: { name: n }, first, last }
//   newKinds   families seen in `current` that no older version had
//   rising     families more frequent in `current` than in the version before it
function trend(entries, current) {
  const byVersion = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !Number.isFinite(e.at)) continue;
    const v = e.version || 'unknown';
    const g = byVersion.get(v) || { version: v, total: 0, families: {}, first: e.at, last: e.at };
    const f = family(e);
    g.total++; g.families[f] = (g.families[f] || 0) + 1;
    g.first = Math.min(g.first, e.at); g.last = Math.max(g.last, e.at);
    byVersion.set(v, g);
  }
  const versions = [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
  const now = versions.find(g => g.version === current) || null;
  const older = versions.filter(g => g.version !== current && compareVersions(g.version, current) < 0);
  const seenBefore = new Set(older.flatMap(g => Object.keys(g.families)));
  const previous = older[0] || null;
  const newKinds = now ? Object.keys(now.families).filter(f => !seenBefore.has(f)) : [];
  const rising = now && previous ? Object.keys(now.families).filter(f => seenBefore.has(f) && now.families[f] > (previous.families[f] || 0)) : [];
  return { current, versions, newKinds, rising, bursts: bursts(entries), total: versions.reduce((n, g) => n + g.total, 0) };
}

module.exports = { createCrashLog, newKinds, trend, family, bursts, compareVersions, FILE, KEEP, WEEK_MS };
