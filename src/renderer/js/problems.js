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

  function load() {
    if (loaded) return list;
    loaded = true;
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (Array.isArray(raw)) {
        list = raw.filter(p => p && typeof p.message === 'string')
          .map(p => ({ seq: ++seq, at: Number(p.at) || 0, area: String(p.area || '').slice(0, 40), message: String(p.message).slice(0, 200), detail: String(p.detail || '').slice(0, MAX_DETAIL), n: Number(p.n) || 1 }))
          .slice(-MAX);
      }
    } catch { list = []; }
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
    };
    const same = list.find(p => p.area === entry.area && p.message === entry.message && p.detail === entry.detail);
    if (same) { same.n++; same.at = entry.at; same.seq = entry.seq; }
    else { list.push(entry); if (list.length > MAX) list.splice(0, list.length - MAX); }
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

  function all() { return load().slice().sort((a, b) => (b.seq || 0) - (a.seq || 0)); }
  function since(ms) { const t = Date.now() - ms; return all().filter(p => p.at >= t); }
  function count() { return load().reduce((n, p) => n + p.n, 0); }
  function clear() { list = []; loaded = true; save(); try { document.dispatchEvent(new CustomEvent('vex:problem', { detail: null })); } catch {} }

  // "3 minutes ago", for the Health lines.
  function ago(at) {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 60) return s + ' s ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return (s / 3600).toFixed(1) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }

  function lines(max) {
    return all().slice(0, max || 12).map(p => `${ago(p.at)} — ${p.area}: ${p.message}${p.n > 1 ? ` (×${p.n})` : ''}${p.detail ? ' — ' + p.detail : ''}`);
  }

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
    return true;
  }

  return { init, note, guard, all, since, count, clear, lines, ago, KEY, MAX };
})();

// Wired at load, before every other script: an error thrown while Vex is
// starting is exactly the one nobody sees.
if (typeof window !== 'undefined') { window.VexProblems = VexProblems; VexProblems.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { VexProblems };
