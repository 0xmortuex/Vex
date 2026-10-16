// === One attention state ====================================================
//
// Quiet hours, the wind-down, a Focus session or flow, Game mode, a meeting and
// the global quiet switch each used to keep their own flag, and every feature
// that wanted to know "is it a bad moment?" read the ones it had heard of. So
// something always pinged in a match or a call. They now publish ONE answer:
//
//   AttentionState.get() -> {
//     quiet: boolean,
//     reason: 'game' | 'exam' | 'meeting' | 'focus' | 'study' | 'away' | 'quiet-hours' | 'wind-down' | 'travel' | 'quiet-switch' | '',
//     until: number | 0,            // ms epoch when the reason ends, 0 when unknown
//     sources: [{ id, until }],     // every reason that applies, strongest first
//   }
//
// Every gate (VexAttention, VexPlayfulness, the OS toast gate in main) consults
// this and nothing else. A feature that wants to know about one mode in
// particular can read `sources`.
//
// Nothing here polls on its own. The modes tell it they changed (changed()), and
// the quiet-hours window is re-read from the main process at most every 30 s
// while somebody is asking.
//
// A source that cannot be read is reported (console + a problem) and counted as
// not quiet: a broken flag must not silence the browser for good. It is never
// hidden.
const AttentionState = {
  // Strongest first: the first one that applies is the `reason`.
  // 'sharing': the screen is being shared (js/screen-share-safe.js, T3-114).
  ORDER: ['sharing', 'game', 'exam', 'meeting', 'focus', 'study', 'away', 'quiet-hours', 'wind-down', 'travel', 'quiet-switch'],
  QUIET_HOURS_TTL_MS: 30 * 1000,

  _qh: null,           // { at, inWindow, until } from the main process
  _qhPending: false,
  _last: '',           // signature of the last published state
  _reported: new Set(),
  _now() { return Date.now(); },

  _fail(id, err) {
    if (this._reported.has(id)) return;
    this._reported.add(id);
    console.error('[AttentionState] could not read "' + id + '":', err);
    try { if (typeof VexProblems !== 'undefined') VexProblems.note('Attention', 'Could not read the ' + id + ' state', err); } catch { /* vex-allow-empty-catch: problems layer missing */ }
  },

  _read(id, fn) {
    try { return fn(); } catch (err) { this._fail(id, err); return null; }
  },

  // ---- the sources: each returns null (not quiet) or { until } ----------------
  _game() {
    if (typeof GameSession !== 'undefined' && GameSession && GameSession.active) return { until: 0 };
    if (typeof GameMode !== 'undefined' && GameMode && GameMode.gaming) return { until: 0 };
    return null;
  },
  // Your screen is being shared: nothing that is not urgent should appear on it (js/screen-share-safe.js).
  _sharing() {
    if (typeof VexScreenShareSafe !== 'undefined' && VexScreenShareSafe && typeof VexScreenShareSafe.active === 'function' && VexScreenShareSafe.active()) return { until: 0 };
    return null;
  },
  _meeting() {
    if (typeof MeetingMode !== 'undefined' && MeetingMode && typeof MeetingMode.active === 'function' && MeetingMode.active()) return { until: 0 };
    return null;
  },
  _focus() {
    if (typeof FocusMode !== 'undefined' && FocusMode && FocusMode.active) return { until: Number(FocusMode.until) || 0 };
    if (typeof FocusFlows !== 'undefined' && FocusFlows && FocusFlows._active && FocusFlows._active.flow) return { until: 0 };
    return null;
  },
  // Exam safe mode and a strict study block (js/exam-safe-mode.js, js/study-block.js) publish themselves here.
  _exam() {
    if (typeof VexExamSafeMode !== 'undefined' && VexExamSafeMode && typeof VexExamSafeMode.active === 'function' && VexExamSafeMode.active()) return { until: Number(VexExamSafeMode.until && VexExamSafeMode.until()) || 0 };
    return null;
  },
  _study() {
    if (typeof VexStudyBlock !== 'undefined' && VexStudyBlock && typeof VexStudyBlock.active === 'function' && VexStudyBlock.active()) return { until: Number(VexStudyBlock.until && VexStudyBlock.until()) || 0 };
    return null;
  },
  // "I am away" (js/away-mode.js): everything not urgent waits for the person's return.
  _away() {
    if (typeof AwayMode !== 'undefined' && AwayMode && typeof AwayMode.active === 'function' && AwayMode.active()) return { until: 0 };
    return null;
  },
  _wind() {
    if (typeof ThemeAuto === 'undefined' || !ThemeAuto || typeof ThemeAuto.windNow !== 'function') return null;
    if (!(ThemeAuto.windNow() > 0)) return null;
    let until = 0;
    try {
      const st = ThemeAuto.windState();
      until = ThemeAuto.windEndMs(ThemeAuto._clock ? ThemeAuto._clock() : new Date(), ThemeAuto.parseHM(st.start), ThemeAuto.parseHM(st.end));
    } catch (err) { this._fail('wind-down end', err); }
    return { until };
  },
  // Travel mode (js/travel-mode.js): notices that are not urgent wait while it is on.
  _travel() {
    if (typeof VexTravel !== 'undefined' && VexTravel && typeof VexTravel.quiet === 'function' && VexTravel.quiet()) return { until: 0 };
    return null;
  },
  _switch() {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('vex.fun.quiet') === '1' ? { until: 0 } : null;
  },
  // Quiet hours live in the main process (it holds the toasts). The answer is
  // kept for a short while; the first call after it expires asks again, and the
  // result arrives with the next get().
  _quietHours() {
    this._refreshQuietHours();
    return this._qh && this._qh.inWindow ? { until: this._qh.until || 0 } : null;
  },
  _refreshQuietHours() {
    const bridge = typeof window !== 'undefined' && window.vex && window.vex.quiet;
    if (!bridge || typeof bridge.get !== 'function' || this._qhPending) return;
    const now = this._now();
    if (this._qh && now - this._qh.at < this.QUIET_HOURS_TTL_MS) return;
    this._qhPending = true;
    Promise.resolve(bridge.get()).then((cfg) => {
      const inWindow = !!(cfg && cfg.enabled && cfg.inWindow);
      let until = 0;
      if (inWindow && /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(cfg.end))) {
        const d = new Date(this._now());
        const [h, m] = cfg.end.split(':').map(Number);
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
        if (t.getTime() <= d.getTime()) t.setDate(t.getDate() + 1);
        until = t.getTime();
      }
      this._qh = { at: this._now(), inWindow, until };
      this.changed();
    }).catch((err) => {
      this._qh = { at: this._now(), inWindow: false, until: 0 };
      this._fail('quiet hours', err);
    }).finally(() => { this._qhPending = false; });
  },

  get() {
    const readers = {
      sharing: () => this._sharing(), game: () => this._game(), exam: () => this._exam(), meeting: () => this._meeting(), focus: () => this._focus(), study: () => this._study(), away: () => this._away(),
      'quiet-hours': () => this._quietHours(), 'wind-down': () => this._wind(), travel: () => this._travel(), 'quiet-switch': () => this._switch(),
    };
    const sources = [];
    for (const id of this.ORDER) {
      const r = this._read(id, readers[id]);
      if (r) sources.push({ id, until: r.until || 0 });
    }
    const top = sources[0];
    return { quiet: sources.length > 0, reason: top ? top.id : '', until: top ? top.until : 0, sources };
  },

  // Is this one source quiet right now? (For a feature that only cares about it.)
  has(id) { return this.get().sources.some(s => s.id === id); },

  // Something that feeds the state changed. Publishes only when the answer did.
  changed() {
    const s = this.get();
    const sig = s.sources.map(x => x.id).join(',');
    if (sig === this._last) return s;
    this._last = sig;
    try { document.dispatchEvent(new CustomEvent('vex:attention-state', { detail: s })); } catch { /* vex-allow-empty-catch: no document: a test */ }
    this._push(s);
    return s;
  },

  // The main process gates OS notifications, so it is told too.
  _push(s) {
    const b = typeof window !== 'undefined' && window.vex && window.vex.attention;
    if (!b || typeof b.state !== 'function') return;
    // A private window may not write to the main profile (the channel is closed to it).
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return;
    Promise.resolve(b.state({ quiet: s.quiet, reason: s.reason, until: s.until })).catch((err) => {
      console.error('[AttentionState] the main process was not told:', err);
      try { if (typeof VexProblems !== 'undefined') VexProblems.note('Attention', 'The main process was not told the attention state', err); } catch { /* vex-allow-empty-catch: problems layer missing */ }
    });
  },

  // Wires the events that already exist. The modes without one call changed().
  init() {
    if (this._wired || typeof document === 'undefined') return false;
    this._wired = true;
    // Focus mode, Focus flows, Meeting mode and the theme's wind-down call changed() themselves, and the
    // quiet switch is a Play flag (vex:play-changed). Listeners for 'vex:focus-changed',
    // 'vex:meeting-changed' and 'vex:quiet-changed' were dropped: nothing ever fired them.
    for (const ev of ['vex:game-mode', 'vex:play-changed']) {
      document.addEventListener(ev, () => this.changed());
    }
    this.changed();
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.AttentionState = AttentionState;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => AttentionState.init());
    else AttentionState.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AttentionState };
