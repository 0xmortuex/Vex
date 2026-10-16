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

  return { add, recent, all, file };
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

module.exports = { createCrashLog, newKinds, FILE, KEEP, WEEK_MS };
