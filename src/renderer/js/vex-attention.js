// === The Attention Budget: one gate for everything that speaks up ============
//
// Many features may speak up without being asked: a badge, a level, a snoozed
// item that came back, a routine Vex noticed, a backup that is due, an update.
// Each is fine on its own and together they are a storm. Everything that
// speaks up unasked asks here first (T0-019).
//
//   const d = VexAttention.request({ feature: 'backup', urgency: 'useful', id: 'weekly',
//                                    title: 'Back up your notes?', action: { label: 'Export now', key: 'export' } });
//   if (d.route === 'toast') showToast(...);
//
// or in one call:  VexAttention.notify({ ... }, () => showToast(...));
//
// FOUR URGENCY CLASSES
//   critical  reminders, alarms, a failed save, 2FA codes: always through, never counted.
//   asked     the person just pressed something, or set it up to be told (a snoozed
//             item coming back): always through, never counted.
//   useful    worth knowing, not worth interrupting for: spoken only while it is a
//             good moment and under the caps. Otherwise it waits QUIETLY in the
//             Attention Inbox (the bell), it is not lost.
//   ambient   nice to have (a medal, a level, a badge): spoken under the same
//             conditions, otherwise dropped. It is listed under "Held back" in
//             Settings so the person can see what was refused.
//
// THE RULES for useful and ambient
//   - not while AttentionState says it is a bad moment (Game mode, a meeting, a Focus
//     session, quiet hours, the wind-down, the quiet switch): js/attention-state.js;
//   - not for a feature the person said "Never" to in the inbox;
//   - the same feature + id is not repeated within REPEAT_MS;
//   - at most MAX_PER_MINUTE in any 60 s, HOUR_CAP in any hour, DAY_CAP in a day.
//     A feature the person said "Show less" to may speak once a day;
//   - every refusal is written to a short list (vex.attention.denied) with its reason.
//
// The caps are counted in vex.attention.log so a restart does not reset the day.
// Things the person asked for (they pressed a button) do not go through here at all.
//
// The OS toasts are gated in the main process the same way (src/main/notify.js);
// they are told the attention state by AttentionState.
const VexAttention = {
  CLASSES: ['critical', 'asked', 'useful', 'ambient'],
  MAX_PER_MINUTE: 3,
  HOUR_CAP: 3,
  DAY_CAP: 12,
  WINDOW_MS: 60 * 1000,
  HOUR_MS: 3600 * 1000,
  DAY_MS: 24 * 3600 * 1000,
  REPEAT_MS: 10 * 60 * 1000,
  MAX_DENIED: 50,
  MAX_LOG: 100,

  KEYS: { log: 'vex.attention.log', denied: 'vex.attention.denied', muted: 'vex.attention.muted', less: 'vex.attention.less' },

  // The older gate(kind, id) call sites, and what class each belongs to. A kind
  // that is not here is ambient.
  KIND_CLASS: {
    'level-up': 'ambient', badge: 'ambient', medal: 'ambient',
    'focus-os': 'useful', 'privacy-report': 'useful', 'routine-offer': 'useful', 'tab-reason': 'useful',
    'snooze-due': 'asked',
  },

  _seen: new Map(),       // 'feature::id' -> timestamp (this session only)
  _now() { return Date.now(); },

  // ---- storage ---------------------------------------------------------------
  _read(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try { const v = JSON.parse(raw); return v == null ? fallback : v; }
    catch (err) { throw new Error('The saved attention data "' + key + '" is not readable', { cause: err }); }
  },
  _write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },

  _list(key) { const v = this._read(key, []); return Array.isArray(v) ? v : []; },
  _map(key) { const v = this._read(key, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; },

  // ---- per-feature verbs (from the inbox) ---------------------------------------
  muted() { return Object.keys(this._map(this.KEYS.muted)); },
  isMuted(feature) { return this._map(this.KEYS.muted)[feature] != null; },
  mute(feature, label) {
    this._feature(feature);
    const m = this._map(this.KEYS.muted);
    m[feature] = { at: this._now(), label: String(label || feature).slice(0, 80) };
    this._write(this.KEYS.muted, m);
    this._emit();
  },
  unmute(feature) {
    const m = this._map(this.KEYS.muted);
    if (!(feature in m)) return false;
    delete m[feature];
    this._write(this.KEYS.muted, m);
    this._emit();
    return true;
  },
  mutedDetails() { return Object.entries(this._map(this.KEYS.muted)).map(([feature, v]) => ({ feature, label: (v && v.label) || feature, at: (v && v.at) || 0 })); },
  isLess(feature) { return this._map(this.KEYS.less)[feature] != null; },
  less(feature) {
    this._feature(feature);
    const m = this._map(this.KEYS.less);
    m[feature] = { at: this._now() };
    this._write(this.KEYS.less, m);
    this._emit();
  },
  more(feature) {
    const m = this._map(this.KEYS.less);
    if (!(feature in m)) return false;
    delete m[feature];
    this._write(this.KEYS.less, m);
    this._emit();
    return true;
  },

  _feature(f) { if (typeof f !== 'string' || !/^[a-z][a-z0-9:_-]{0,63}$/i.test(f)) throw new Error('A feature that speaks up needs a short name of letters, digits, dashes and colons'); },
  _emit() { try { document.dispatchEvent(new CustomEvent('vex:attention-changed')); } catch { /* no document: a test */ } },

  // ---- the state of the moment ---------------------------------------------------
  _state() {
    if (typeof AttentionState === 'undefined') throw new Error('AttentionState is not loaded: js/attention-state.js must come before js/vex-attention.js');
    return AttentionState.get();
  },

  // ---- the decision ----------------------------------------------------------------
  // -> { allow, route: 'toast' | 'inbox' | 'drop', reason, urgency }
  //   allow is true only for route 'toast'. A refused useful request that carries
  //   a title has already been put in the inbox (route 'inbox').
  request(opts = {}) {
    const feature = opts.feature;
    this._feature(feature);
    const urgency = opts.urgency;
    if (!this.CLASSES.includes(urgency)) throw new Error('Urgency must be one of ' + this.CLASSES.join(', '));
    if (urgency === 'critical' || urgency === 'asked') return { allow: true, route: 'toast', reason: urgency, urgency };

    const now = this._now();
    const id = String(opts.dedupeKey != null ? opts.dedupeKey : (opts.id != null ? opts.id : ''));
    const key = feature + '::' + id;

    const refuse = (reason, record = true) => {
      const wait = urgency === 'useful' && opts.title;
      if (record) this._deny({ feature, id, title: opts.title || '', reason, urgency, t: now });
      if (wait && reason !== 'muted' && reason !== 'repeat') {
        this.hold({ feature, id, title: opts.title, body: opts.body, action: opts.action, label: opts.label });
        return { allow: false, route: 'inbox', reason, urgency };
      }
      return { allow: false, route: 'drop', reason, urgency };
    };

    if (this.isMuted(feature)) return refuse('muted');
    const last = this._seen.get(key);
    if (last !== undefined && now - last < this.REPEAT_MS) return refuse('repeat', false);
    const st = this._state();
    if (st.quiet) return refuse('quiet: ' + st.reason);

    // Windows toasts (os:true) have their own budget in the main process; they
    // only count here for "show less".
    const log = this._list(this.KEYS.log).filter(e => e && now - e.t < this.DAY_MS);
    const own = log.filter(e => !e.os);
    if (own.filter(e => now - e.t < this.WINDOW_MS).length >= this.MAX_PER_MINUTE) return refuse('too many in a minute');
    if (this.isLess(feature)) {
      if (log.some(e => e.f === feature)) return refuse('shown less: once a day');
    }
    if (own.filter(e => now - e.t < this.HOUR_MS).length >= this.HOUR_CAP) return refuse('hourly limit');
    if (own.length >= this.DAY_CAP) return refuse('daily limit');

    log.push({ t: now, f: feature });
    while (log.length > this.MAX_LOG) log.shift();
    this._write(this.KEYS.log, log);
    this._seen.set(key, now);
    if (this._seen.size > 200) for (const [k, t] of this._seen) if (now - t >= this.REPEAT_MS) this._seen.delete(k);
    return { allow: true, route: 'toast', reason: 'ok', urgency };
  },

  // request() then, when it says toast, run `show`. -> the decision.
  notify(opts, show) {
    const d = this.request(opts);
    if (d.route === 'toast' && typeof show === 'function') show(d);
    return d;
  },

  // A suggestion that never needed a toast: it goes straight to the Attention
  // Inbox. The person's verbs still apply (Never, Show less); the toast caps do not.
  // -> true when it was added.
  suggest(opts = {}) {
    this._feature(opts.feature);
    if (!opts.title) throw new Error('A suggestion needs a title');
    if (this.isMuted(opts.feature)) { this._deny({ feature: opts.feature, id: String(opts.id || ''), title: opts.title, reason: 'muted', urgency: 'useful', t: this._now() }); return false; }
    if (this.isLess(opts.feature)) {
      const rows = typeof AttentionInbox !== 'undefined' ? AttentionInbox.list() : [];
      const day = this._now() - this.DAY_MS;
      if (rows.some(r => r.feature === opts.feature && r.ts > day)) return false;
    }
    return this.hold(opts);
  },

  hold(row) {
    if (typeof AttentionInbox === 'undefined') throw new Error('AttentionInbox is not loaded: js/attention-inbox.js must come before the features that suggest');
    return AttentionInbox.add(row);
  },

  // A Windows toast raised from the window (the main process judges it with the
  // same rules: src/main/notify.js). One that main held back resolves
  // { suppressed: true, reason }; a useful one with a title then waits in the
  // Attention Inbox. A feature the person muted, or asked to see less of, never
  // reaches Windows. Resolves { ok:false, reason:'no bridge' } where Windows
  // notifications do not exist (a test, a build without them).
  async osNotify(opts = {}) {
    this._feature(opts.feature);
    const urgency = opts.urgency;
    if (!this.CLASSES.includes(urgency)) throw new Error('Urgency must be one of ' + this.CLASSES.join(', '));
    if (!opts.title) throw new Error('A notification needs a title');
    const bridge = typeof window !== 'undefined' && window.vex;
    if (!bridge || typeof bridge.notify !== 'function') return { ok: false, reason: 'no bridge' };
    const now = this._now();
    const waits = (reason, record) => {
      if (record) this._deny({ feature: opts.feature, id: String(opts.id || ''), title: opts.title, reason, urgency, t: now });
      if (urgency === 'useful' && reason !== 'muted') this.hold({ feature: opts.feature, id: opts.id, title: opts.title, body: opts.body, action: opts.action, label: opts.label });
      return { ok: false, suppressed: true, reason };
    };
    if (urgency === 'useful' || urgency === 'ambient') {
      if (this.isMuted(opts.feature)) return waits('muted', true);
      if (this.isLess(opts.feature) && this._list(this.KEYS.log).some(e => e && e.f === opts.feature && now - e.t < this.DAY_MS)) return waits('shown less: once a day', true);
    }
    const res = await bridge.notify(String(opts.title).slice(0, 200), opts.body == null ? '' : String(opts.body), { urgency, feature: opts.feature, id: opts.id });
    if (res && res.suppressed) return waits(res.reason || 'held back', false);
    if (urgency === 'useful' || urgency === 'ambient') {
      const log = this._list(this.KEYS.log).filter(e => e && now - e.t < this.DAY_MS);
      log.push({ t: now, f: opts.feature, os: true });
      while (log.length > this.MAX_LOG) log.shift();
      this._write(this.KEYS.log, log);
    }
    return res;
  },

  // ---- what was refused ---------------------------------------------------------
  _deny(entry) {
    const list = this._list(this.KEYS.denied);
    const top = list[0];
    if (top && top.feature === entry.feature && top.reason === entry.reason && top.id === entry.id) {
      top.n = (top.n || 1) + 1;
      top.t = entry.t;
    } else {
      list.unshift({ feature: entry.feature, id: entry.id, title: String(entry.title || '').slice(0, 120), reason: entry.reason, urgency: entry.urgency, t: entry.t, n: 1 });
    }
    while (list.length > this.MAX_DENIED) list.pop();
    this._write(this.KEYS.denied, list);
  },
  denied() { return this._list(this.KEYS.denied); },
  clearDenied() { this._write(this.KEYS.denied, []); this._emit(); },

  // ---- the older call: gate(kind, id) -------------------------------------------
  // true when the toast may be shown now. A refused one is not queued.
  gate(kind, id) {
    if (typeof kind !== 'string' || !kind) throw new Error('A toast needs a kind to be rate-limited');
    const urgency = this.KIND_CLASS[kind] || 'ambient';
    return this.request({ feature: kind, id: id == null ? '' : String(id), urgency }).allow;
  },

  // Tests and "forget what you have said".
  reset() {
    this._seen.clear();
    for (const k of [this.KEYS.log, this.KEYS.denied]) localStorage.removeItem(k);
  },
};

if (typeof window !== 'undefined') window.VexAttention = VexAttention;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAttention };
