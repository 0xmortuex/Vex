// === What each feature costs, against what it said it would cost ==============
//
// Every feature manifest declares a budget (js/feature-registry.js): processor
// time on the shared timer per minute, background requests per hour, requests
// during a game (0 for most), DOM nodes in its panels, storage it owns. This
// attributes what is actually measured to the feature and compares:
//
//   timers    VexJobs reports the time each job held the interface thread, and
//             the job's feature (its manifest, or VexJobs.every's `feature`).
//   fetches   window.fetch is wrapped to COUNT (never to change) calls made
//             while a feature's job runs; VexNet.fetch goes through it. A call
//             that starts after an `await` in a job is not attributed: only the
//             synchronous start of the job is known to be that feature's.
//   IPC       VexCost.ipc(feature) is for callers that want to be counted;
//             window.vex.* cannot be wrapped from here (the bridge is frozen).
//   DOM       nodes inside the feature's panels, counted when asked.
//   storage   the size of the localStorage keys the feature owns, when asked.
//
// Two things happen with a violation: it is listed in "What is slowing my
// browser" (js/tuning-advisor-ui.js), and a SUSTAINED one (3 minutes in a row
// over the processor budget, or 3 requests during a game for a feature whose
// game budget is 0) trips the feature's breaker (js/vex-breaker.js).
//
// Counters are in memory and reset on restart. Nothing is stored or sent.
const VexCost = {
  WINDOW_MS: 60 * 1000,
  OVER_WINDOWS: 3,
  GAME_FETCHES_TO_TRIP: 3,
  HOUR_MS: 3600 * 1000,

  _f: new Map(),
  _stack: [],
  _now() { return Date.now(); },

  _rec(id) {
    let r = this._f.get(id);
    if (!r) {
      r = { runs: 0, ms: 0, maxMs: 0, fetches: 0, gameFetches: 0, ipc: 0, fetchTimes: [], winStart: this._now(), winMs: 0, lastWinMs: 0, overStreak: 0, since: this._now() };
      this._f.set(id, r);
    }
    return r;
  },

  _gaming() { return typeof GameMode !== 'undefined' && !!GameMode.gaming; },
  _budget(id) {
    if (typeof VexRegistry === 'undefined' || !VexRegistry.has(id)) return null;
    return VexRegistry.budget(id);
  },

  // ---- attribution ------------------------------------------------------------
  // Runs fn with `id` as the current feature (synchronously: the context ends when fn returns).
  run(id, fn) {
    if (!id) return fn();
    this._stack.push(id);
    try { return fn(); } finally { this._stack.pop(); }
  },
  current() { return this._stack.length ? this._stack[this._stack.length - 1] : null; },

  job(id, ms) {
    if (!id) return;
    const r = this._rec(id);
    r.runs++;
    r.ms += ms;
    r.winMs += ms;
    if (ms > r.maxMs) r.maxMs = ms;
    this._roll(id, r);
  },

  fetch(id) {
    if (!id) return;
    const r = this._rec(id);
    const now = this._now();
    r.fetches++;
    r.fetchTimes.push(now);
    if (r.fetchTimes.length > 500) r.fetchTimes.splice(0, r.fetchTimes.length - 500);
    const b = this._budget(id);
    if (this._gaming() && b && b.gameFetches === 0) {
      r.gameFetches++;
      if (r.gameFetches >= this.GAME_FETCHES_TO_TRIP && typeof VexBreaker !== 'undefined') {
        VexBreaker.trip(id, 'it made ' + r.gameFetches + ' background requests during a game, and its budget for that is none');
        r.gameFetches = 0;
      }
    }
  },

  ipc(id, n = 1) { if (id) this._rec(id).ipc += n; },

  // Close any finished minute: a feature over its processor budget for
  // OVER_WINDOWS minutes in a row is tripped. Also called by the shared timer.
  _roll(id, r) {
    const now = this._now();
    if (now - r.winStart < this.WINDOW_MS) return;
    const b = this._budget(id);
    const over = !!b && b.jobMsPerMin > 0 && r.winMs > b.jobMsPerMin;
    // A gap of whole quiet minutes since the last job breaks a streak.
    const gapped = now - r.winStart >= 2 * this.WINDOW_MS;
    r.lastWinMs = r.winMs;
    r.overStreak = over && !gapped ? r.overStreak + 1 : (over ? 1 : 0);
    r.winStart = now;
    r.winMs = 0;
    if (r.overStreak >= this.OVER_WINDOWS && typeof VexBreaker !== 'undefined') {
      VexBreaker.trip(id, 'it used more than its processor budget (' + b.jobMsPerMin + ' ms a minute) for ' + r.overStreak + ' minutes in a row');
      r.overStreak = 0;
    }
  },
  tick() { for (const [id, r] of this._f) this._roll(id, r); },

  // ---- measuring on demand -------------------------------------------------------
  domNodes(id) {
    if (typeof VexRegistry === 'undefined' || !VexRegistry.has(id) || typeof document === 'undefined') return 0;
    let n = 0;
    for (const p of VexRegistry.get(id).panels) {
      const el = document.getElementById('panel-' + p);
      if (el) n += el.getElementsByTagName('*').length;
    }
    return n;
  },

  storageBytes(id) {
    if (typeof VexRegistry === 'undefined' || !VexRegistry.has(id)) return 0;
    const keys = VexRegistry.get(id).storageKeys;
    let bytes = 0;
    for (const k of keys) {
      try {
        if (k.endsWith('.')) {
          for (let i = 0; i < localStorage.length; i++) { const name = localStorage.key(i); if (name && name.startsWith(k)) bytes += name.length + (localStorage.getItem(name) || '').length; }
        } else {
          const v = localStorage.getItem(k);
          if (v != null) bytes += k.length + v.length;
        }
      } catch (err) { console.error('[Cost] could not measure "' + k + '":', err.message); }
    }
    return bytes * 2;     // UTF-16 in storage
  },

  // ---- the report --------------------------------------------------------------------
  // One row per feature with a manifest that has been measured or declares something
  // worth showing, heaviest processor time first.
  report() {
    const now = this._now();
    const rows = [];
    const ids = new Set(this._f.keys());
    if (typeof VexRegistry !== 'undefined') for (const m of VexRegistry.all()) if (m.jobs.length || m.panels.length || m.storageKeys.length) ids.add(m.id);
    for (const id of ids) {
      const r = this._f.get(id) || this._rec(id);
      const b = this._budget(id);
      const title = typeof VexRegistry !== 'undefined' && VexRegistry.has(id) ? VexRegistry.get(id).title : id;
      const hour = r.fetchTimes.filter(t => now - t <= this.HOUR_MS).length;
      const spanMin = Math.max(1, (now - r.since) / 60000);
      const jobMsPerMin = r.ms / spanMin;
      const dom = this.domNodes(id);
      const storageKB = Math.round(this.storageBytes(id) / 102.4) / 10;
      const over = [];
      if (b) {
        if (b.jobMsPerMin > 0 && Math.max(jobMsPerMin, r.lastWinMs) > b.jobMsPerMin) over.push({ item: 'processor', used: Math.round(Math.max(jobMsPerMin, r.lastWinMs)), budget: b.jobMsPerMin, unit: 'ms a minute' });
        if (hour > b.fetchesPerHour) over.push({ item: 'requests', used: hour, budget: b.fetchesPerHour, unit: 'an hour' });
        if (b.gameFetches === 0 && r.gameFetches > 0) over.push({ item: 'requests in a game', used: r.gameFetches, budget: 0, unit: '' });
        if (dom > b.domNodes) over.push({ item: 'page elements', used: dom, budget: b.domNodes, unit: '' });
        if (storageKB > b.storageKB) over.push({ item: 'storage', used: storageKB, budget: b.storageKB, unit: 'KB' });
      }
      rows.push({
        id, title, runs: r.runs, totalMs: Math.round(r.ms), maxMs: Math.round(r.maxMs * 10) / 10, jobMsPerMin: Math.round(jobMsPerMin * 10) / 10,
        fetches: r.fetches, fetchesLastHour: hour, gameFetches: r.gameFetches, ipc: r.ipc, domNodes: dom, storageKB,
        budget: b, over,
      });
    }
    rows.sort((a, b) => b.over.length - a.over.length || b.totalMs - a.totalMs);
    return rows;
  },
  overruns() { return this.report().filter(r => r.over.length); },

  // ---- the fetch counter ---------------------------------------------------------------
  // Counts, never changes: the same arguments go to the same fetch and its result
  // comes back untouched.
  install(win = typeof window !== 'undefined' ? window : null) {
    if (!win || typeof win.fetch !== 'function' || win.fetch.__vexCounted) return false;
    const original = win.fetch;
    const counted = function (...args) {
      const id = VexCost.current();
      if (id) VexCost.fetch(id);
      return original.apply(this, args);
    };
    counted.__vexCounted = true;
    win.fetch = counted;
    return true;
  },

  _reset() { this._f.clear(); this._stack.length = 0; },
};

if (typeof window !== 'undefined') {
  window.VexCost = VexCost;
  VexCost.install();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCost };
