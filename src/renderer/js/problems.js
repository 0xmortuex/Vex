// === Quiet problems ========================================================
//
// 907 places in Vex catch an error and say nothing. That is usually right — a
// favicon that will not load is not worth a toast — but it is how the two worst
// bugs of the week stayed hidden: the screen share was REFUSED and the refusal
// was thrown away, and an agent run was never saved with the chat while nothing
// said so. Neither reached the user, and neither reached the log they could
// send me.
//
// So: anything that fails quietly says so here instead. One line per problem,
// kept in memory and in a small store, shown in the Memory panel's Health
// section, and included in the health report. Nothing is sent anywhere.
//
// Repeats collapse: the same problem again bumps a count and the time, so a
// failure every 45 seconds is one line, not sixty.
//
//   VexProblems.note('Screen share', 'Discord refused the pick', err.message)
//
// It also catches what nothing else does: an uncaught error or a rejected
// promise in the interface, which until now reached only the DevTools console.
const VexProblems = (() => {
  const KEY = 'vex.problems';
  const MAX = 60;                 // kept; the oldest go first
  const MAX_DETAIL = 300;
  let list = [];
  let loaded = false;
  // Order cannot come from the clock: eighty problems in the same millisecond
  // all carry the same timestamp, and "newest first" then depends on the sort.
  let seq = 0;
  // The Vex version running, once main has said (setVersion). Each problem
  // carries the version it happened in (`v`), so after an update the old
  // ones fold away under "From an older version" instead of reading as
  // today's: "under.click is not a function" was still listed long after it
  // was fixed (found 2026-10-09). Noted before the version is known: null,
  // stamped when it comes. Saved before stamping existed: '' (older).
  let version = '';
  // Problems noted before PersistentStorage has copied the saved list from
  // vex-persist.json into browser storage (restored()). When browser storage
  // started empty, the first problem of the start-up was saved as a one-item
  // list over the real one: hydration skips a key that is waiting to be
  // written, so the file got the one item (found 2026-10-10). They are kept
  // here, by what they are, and replayed onto the restored list.
  let early = new Map();
  let restoreDone = false;
  const keyOf = (p) => p.area + '\u0000' + p.message + '\u0000' + p.detail;

  function parse(rawText) {
    try {
      const raw = JSON.parse(rawText || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter(p => p && typeof p.message === 'string')
        .map(p => ({ seq: ++seq, at: Number(p.at) || 0, area: String(p.area || '').slice(0, 40), message: String(p.message).slice(0, 200), detail: String(p.detail || '').slice(0, MAX_DETAIL), n: Number(p.n) || 1, v: typeof p.v === 'string' ? p.v.slice(0, 40) : '' }))
        .slice(-MAX);
    } catch { return []; }
  }

  function load() {
    if (loaded) return list;
    loaded = true;
    list = parse(localStorage.getItem(KEY));
    return list;
  }

  function save() {
    // This store must never be the thing that fills the quota, and a failure
    // to save a problem is not itself worth recording.
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* full or blocked: the session's copy still shows */ }
  }

  // One line. `detail` is the machine part (an error message, a status code);
  // `message` is what went wrong in the user's terms.
  function note(area, message, detail) {
    load();
    const entry = {
      seq: ++seq,
      at: Date.now(),
      area: String(area || 'Vex').slice(0, 40),
      message: String(message == null ? 'Something failed' : message).slice(0, 200),
      detail: String(detail == null ? '' : (detail.message || detail)).slice(0, MAX_DETAIL),
      n: 1,
      v: version || null,
    };
    const same = list.find(p => p.area === entry.area && p.message === entry.message && p.detail === entry.detail);
    // Happening again now makes it a problem of this version.
    if (same) { same.n++; same.at = entry.at; same.seq = entry.seq; same.v = entry.v; }
    else { list.push(entry); if (list.length > MAX) list.splice(0, list.length - MAX); }
    if (!restoreDone) {
      const k = keyOf(entry);
      const e = early.get(k);
      if (e) { e.n++; e.at = entry.at; }
      else if (early.size < MAX) early.set(k, { ...entry });
    }
    save();
    try { document.dispatchEvent(new CustomEvent('vex:problem', { detail: same || entry })); } catch {}
    console.warn(`[Problem] ${entry.area}: ${entry.message}${entry.detail ? ' — ' + entry.detail : ''}`);
    return same || entry;
  }

  // Wraps a promise so a rejection is recorded instead of vanishing. Returns
  // `fallback` when it fails, so a caller can carry on:
  //   const tabs = await VexProblems.guard('Sync', 'could not read tabs', p, []);
  function guard(area, message, promise, fallback) {
    return Promise.resolve(promise).catch(err => { note(area, message, err); return fallback; });
  }

  function setVersion(v) {
    const next = String(v || '').slice(0, 40);
    if (!next) throw new Error('No version to stamp problems with');
    version = next;
    // Not load(): the answer comes before app.js has copied the saved list
    // into browser storage, and loading then read an empty list that the
    // next problem saved over the real one (found 2026-10-09, live).
    if (!loaded) return version;
    let stamped = false;
    for (const p of list) if (p.v === null) { p.v = version; stamped = true; }
    if (stamped) save();
    return version;
  }

  // Called by PersistentStorage once it has copied vex-persist.json into
  // browser storage, with the saved list as the file held it (a string), or
  // undefined when the file had none or was empty (a first run: browser
  // storage is then the saved copy). The file's list is the real one; what was
  // noted before this is replayed onto it, as if it had been noted after.
  function restored(rawText) {
    if (restoreDone) return 0;
    restoreDone = true;
    const replay = [...early.values()];
    early = new Map();
    // Nothing read or noted yet: load() will read the restored copy.
    if (!loaded || typeof rawText !== 'string') return 0;
    const base = parse(rawText);
    for (const e of replay) {
      const same = base.find(p => keyOf(p) === keyOf(e));
      if (same) { same.n += e.n; same.at = e.at; same.seq = ++seq; same.v = version || e.v; }
      else base.push({ ...e, seq: ++seq, v: version || e.v });
    }
    list = base.slice(-MAX);
    save();
    changed();
    return replay.length;
  }

  // From an older Vex: only once the running version is known.
  function isOlder(p) { return !!version && p.v !== null && p.v !== version; }
  function all() { return load().slice().sort((a, b) => (b.seq || 0) - (a.seq || 0)); }
  function current() { return all().filter(p => !isOlder(p)); }
  function older() { return all().filter(isOlder); }
  function since(ms) { const t = Date.now() - ms; return all().filter(p => p.at >= t); }
  // This version's problems; olderCount() for the folded ones.
  function count() { return current().reduce((n, p) => n + p.n, 0); }
  function olderCount() { return older().reduce((n, p) => n + p.n, 0); }
  function changed() { try { document.dispatchEvent(new CustomEvent('vex:problem', { detail: null })); } catch {} }
  // Returns what it took away, for restore() (the Undo of Clear).
  function clear() { const removed = load().slice(); list = []; loaded = true; save(); changed(); return removed; }
  function restore(removed) {
    if (!Array.isArray(removed)) throw new Error('Nothing to put back');
    load();
    const back = removed.filter(p => p && !list.some(q => q.area === p.area && q.message === p.message && q.detail === p.detail));
    list = back.concat(list).slice(-MAX);
    save();
    changed();
    return back.length;
  }

  // "3 minutes ago", for the Health lines.
  function ago(at) {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 60) return s + ' s ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return (s / 3600).toFixed(1) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }

  function line(p) { return `${ago(p.at)} — ${p.area}: ${p.message}${p.n > 1 ? ` (×${p.n})` : ''}${p.detail ? ' — ' + p.detail : ''}`; }
  function lines(max) { return current().slice(0, max || 12).map(line); }
  function olderLines(max) { return older().slice(0, max || 12).map(p => line(p) + (p.v ? ` (Vex ${p.v})` : '')); }

  // An uncaught error in the interface used to reach the DevTools console and
  // nowhere else, so a feature could be broken for days with no trace.
  function init() {
    if (typeof window === 'undefined' || window.__vexProblemsWired) return false;
    window.__vexProblemsWired = true;
    window.addEventListener('error', (e) => {
      if (!e) return;
      // A failed <img>/<script> load fires this too and is not a code fault.
      if (e.target && e.target !== window && e.target.nodeType === 1) return;
      const where = e.filename ? (String(e.filename).split('/').pop() + ':' + e.lineno) : '';
      note('Vex interface', (e.message || 'Uncaught error').replace(/^Uncaught\s+/, ''), where);
    }, true);
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      note('Vex interface', 'A background step failed: ' + ((r && r.message) || String(r || 'unknown')).slice(0, 160), (r && r.stack) ? String(r.stack).split('\n')[1]?.trim() : '');
    });
    if (window.vex && typeof window.vex.getAppVersion === 'function') {
      Promise.resolve(window.vex.getAppVersion()).then(setVersion)
        .catch(err => console.error('[Problems] could not learn the Vex version:', err && err.message));
    }
    return true;
  }

  return { init, note, guard, all, current, older, since, count, olderCount, clear, restore, restored, lines, olderLines, setVersion, ago, KEY, MAX };
})();

// Wired at load, before every other script: an error thrown while Vex is
// starting is exactly the one nobody sees.
if (typeof window !== 'undefined') { window.VexProblems = VexProblems; VexProblems.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexProblems };
