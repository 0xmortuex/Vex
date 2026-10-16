// === Noticing a routine ====================================================
//
// Most mornings start the same way: the mail, then the tracker, then the
// news. Typing those three addresses is not hard, which is exactly why
// nobody ever sets anything up for it.
//
// This watches the order in which you first open sites, and when the same
// run of three or more turns up in the morning on several different days it
// says so, once, and offers to keep it as a named command chain. It never
// opens anything itself.
//
// What it keeps: a host, a path without its query, and a time — on this PC,
// for 30 days, in your own profile only. Private, Tor and routed tabs are
// never recorded. "Turn off" in the offer, or setMode('off'), stops the
// recording and clears the log.
//
// The result is a plain suggestion object { name, steps }, with `steps` in
// the command-chain line format ("open:https://host/path"). Running a chain
// is not done here: `onSuggestion` / the 'vex:routine-suggested' event hand
// the object to whoever owns chains.
const RoutineDetect = {
  LOG_KEY: 'vex.routine.log',
  MODE_KEY: 'vex.routine.mode',               // 'on' (default) | 'off'
  DISMISSED_KEY: 'vex.routine.dismissed',     // { signature: untilMs }
  MAX_LOG: 3000,
  KEEP_DAYS: 30,
  BURST_GAP_MS: 20 * 60 * 1000,
  MORNING: [5, 12],                           // [from, to) hour
  MIN_SITES: 3,
  MAX_SITES: 6,
  MIN_DAYS: 3,
  SNOOZE_DAYS: 14,
  EVERY_MS: 30 * 60 * 1000,

  // --- recording ---------------------------------------------------------------
  // → the normalised entry, or null for anything that is not a site to keep.
  entryFor(url, now = Date.now()) {
    let u;
    try { u = new URL(String(url)); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (!host || /^(localhost|127\.|10\.|192\.168\.)/.test(host)) return null;
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
    return { h: host, u: u.protocol + '//' + u.host + (path.length <= 60 ? path : ''), t: now };
  },

  // Adds to a log (a plain array) → the same array. The same site twice in a
  // row, or again within two minutes, is one visit.
  append(log, entry) {
    const last = log[log.length - 1];
    if (last && last.h === entry.h && entry.t - last.t < 2 * 60000) return log;
    log.push(entry);
    const cutoff = entry.t - this.KEEP_DAYS * 86400000;
    let i = 0;
    while (i < log.length && log[i].t < cutoff) i++;
    if (i) log.splice(0, i);
    if (log.length > this.MAX_LOG) log.splice(0, log.length - this.MAX_LOG);
    return log;
  },

  // --- detecting ---------------------------------------------------------------
  _dayKey(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },

  // The first run of sites opened each morning, in order.
  morningRuns(log) {
    const byDay = new Map();
    let burst = null;
    const flush = () => {
      if (!burst) return;
      const h = new Date(burst[0].t).getHours();
      const day = this._dayKey(burst[0].t);
      if (h >= this.MORNING[0] && h < this.MORNING[1] && !byDay.has(day)) byDay.set(day, burst);
      burst = null;
    };
    for (const e of log) {
      if (burst && e.t - burst[burst.length - 1].t > this.BURST_GAP_MS) flush();
      if (!burst) burst = [];
      burst.push(e);
    }
    flush();
    return byDay;
  },

  // → the best repeated run as { signature, hosts, days, urls } or null.
  // Contiguous in the order opened; a longer run beats a shorter one, then
  // more days beats fewer. `skip` is a Set of signatures not to offer.
  find(log, { skip = new Set() } = {}) {
    const runs = this.morningRuns(log);
    const seqs = [];
    for (const [day, burst] of runs) {
      const hosts = [];
      for (const e of burst) if (!hosts.includes(e.h)) hosts.push(e.h);
      seqs.push({ day, hosts: hosts.slice(0, 10), entries: burst });
    }
    let best = null;
    for (let n = this.MAX_SITES; n >= this.MIN_SITES; n--) {
      const grams = new Map();                          // signature -> Set of days
      for (const s of seqs) {
        const seen = new Set();
        for (let i = 0; i + n <= s.hosts.length; i++) {
          const sig = s.hosts.slice(i, i + n).join('>');
          if (seen.has(sig)) continue;
          seen.add(sig);
          if (!grams.has(sig)) grams.set(sig, new Set());
          grams.get(sig).add(s.day);
        }
      }
      for (const [sig, days] of grams) {
        if (days.size < this.MIN_DAYS || skip.has(sig)) continue;
        if (!best || days.size > best.days.size) best = { sig, days };
      }
      if (best) break;                                   // the longest length that has one
    }
    if (!best) return null;
    const hosts = best.sig.split('>');
    // The address to open for each site: the one used most on those days.
    const urls = hosts.map(h => {
      const count = new Map();
      for (const s of seqs) if (best.days.has(s.day)) for (const e of s.entries) if (e.h === h) count.set(e.u, (count.get(e.u) || 0) + 1);
      return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    });
    return { signature: best.sig, hosts, days: [...best.days].sort(), urls };
  },

  short(host) {
    const parts = host.split('.');
    if (parts.length <= 2) return parts[0];
    return parts[parts.length - 2].length > 3 ? parts[parts.length - 2] : parts[0];
  },

  // The object other code consumes.
  suggestion(found) {
    const name = ('Morning: ' + found.hosts.map(h => this.short(h)).join(', ')).slice(0, 60);
    return {
      name,
      steps: found.urls.map(u => 'open:' + u),
      signature: found.signature,
      days: found.days.length,
      sites: found.hosts,
    };
  },

  // --- the live parts ----------------------------------------------------------
  mode() { try { return localStorage.getItem(this.MODE_KEY) === 'off' ? 'off' : 'on'; } catch { return 'on'; } },
  setMode(v) {
    if (v !== 'on' && v !== 'off') throw new Error('Unknown routine mode: ' + v);
    localStorage.setItem(this.MODE_KEY, v);
    if (v === 'off') this.forget();
  },
  forget() { localStorage.removeItem(this.LOG_KEY); },

  _log() {
    let raw;
    try { raw = localStorage.getItem(this.LOG_KEY); } catch (err) { throw new Error('Could not read the routine log: ' + err.message); }
    if (!raw) return [];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; }
    catch (err) { throw new Error('The routine log is not valid JSON: ' + err.message); }
  },

  _dismissed(now = Date.now()) {
    try {
      const o = JSON.parse(localStorage.getItem(this.DISMISSED_KEY) || '{}');
      return new Set(Object.entries(o).filter(([, until]) => until > now).map(([sig]) => sig));
    } catch { return new Set(); }
  },
  dismiss(signature, now = Date.now()) {
    let o = {};
    try { o = JSON.parse(localStorage.getItem(this.DISMISSED_KEY) || '{}'); } catch { o = {}; }
    o[signature] = now + this.SNOOZE_DAYS * 86400000;
    localStorage.setItem(this.DISMISSED_KEY, JSON.stringify(o));
  },

  // Called with each address a tab goes to (vex:tab-navigated).
  record(url, tab, now = Date.now()) {
    if (this.mode() === 'off') return false;
    if (window.VexTabPolicy && (window.VexTabPolicy.isPrivateWindow || (tab && !window.VexTabPolicy.canPersist(tab)) || (tab && window.VexTabPolicy.isRouted && window.VexTabPolicy.isRouted(tab.partition)))) return false;
    const entry = this.entryFor(url, now);
    if (!entry) return false;
    const log = this.append(this._log(), entry);
    localStorage.setItem(this.LOG_KEY, JSON.stringify(log));
    return true;
  },

  // Data hook: the routine as things stand, or null. Changes nothing.
  snapshot(now = Date.now()) {
    const found = this.find(this._log(), { skip: this._dismissed(now) });
    return found ? this.suggestion(found) : null;
  },

  _listeners: [],
  onSuggestion(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(f => f !== fn); }; },

  // → the suggestion handed out, or null. Each is offered once per snooze.
  check(now = Date.now()) {
    if (this.mode() === 'off') return null;
    const s = this.snapshot(now);
    if (!s) return null;
    this.dismiss(s.signature, now);                    // asked once; "Not now" and "Save" both stay quiet
    for (const fn of this._listeners) fn(s);
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('vex:routine-suggested', { detail: s }));
    return s;
  },

  // Whoever owns command chains registers a keeper: (suggestion) => boolean.
  // Until one is set the suggestion is data only and the offer has no Save
  // button, so there is never a button that does nothing.
  _keeper: null,
  setKeeper(fn) {
    if (fn != null && typeof fn !== 'function') throw new Error('The keeper must be a function');
    this._keeper = fn || null;
  },

  // The offer.
  offer(s) {
    const text = 'You open ' + s.sites.map(h => this.short(h)).join(', ') + ' in this order most mornings (' + s.days + ' days).';
    // The offer waits in the Attention Inbox: Save, or Never for this feature.
    if (typeof VexAttention !== 'undefined') {
      if (typeof AttentionInbox !== 'undefined') {
        AttentionInbox.handle('routine', (key) => {
          if (key === 'save' && this._keeper) return this._keeper(s);
          if (key === 'off') { this.setMode('off'); window.showToast?.('Vex will not watch for routines. The log is cleared.'); return null; }
          throw new Error('Unknown routine action ' + key);
        });
      }
      VexAttention.suggest({ feature: 'routine', label: 'Routine detection', id: s.sites.join(','), title: text, action: this._keeper ? { label: 'Save as a command chain', key: 'save' } : { label: 'Turn off', key: 'off' } });
      return null;
    }
    const actions = [];
    if (this._keeper) actions.push({ label: 'Save as a command chain', run: () => this._keeper(s) });
    actions.push({ label: 'Turn off', run: () => { this.setMode('off'); window.showToast?.('Vex will not watch for routines. The log is cleared.'); } });
    return window.showToast(
      'You open ' + s.sites.map(h => this.short(h)).join(', ') + ' in this order most mornings (' + s.days + ' days).',
      'info', 15000, { actions });
  },

  start() {
    if (this._started) return;
    this._started = true;
    this.onSuggestion((s) => this.offer(s));
    this._nav = (e) => {
      const d = e.detail || {};
      const tab = typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs) ? TabManager.tabs.find(t => t.id === d.tabId) : null;
      try { this.record(d.url, tab); }
      catch (err) { window.VexProblems?.note('Routine', 'Could not record a visit', err); }
    };
    document.addEventListener('vex:tab-navigated', this._nav);
    if (typeof VexJobs !== 'undefined') {
      this._job = VexJobs.every('Routine check', this.EVERY_MS, () => {
        try { this.check(); } catch (err) { window.VexProblems?.note('Routine', 'Could not look for a routine', err); }
      }, { when: 'background', deferOnBattery: true });
    }
  },
};

if (typeof window !== 'undefined') window.RoutineDetect = RoutineDetect;
if (typeof module !== 'undefined' && module.exports) module.exports = { RoutineDetect };
