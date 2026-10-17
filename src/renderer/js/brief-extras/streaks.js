// === Brief extra: Streaks and goals ==============================================
//
// Three simple counters, kept on this computer only, each with a streak of
// days in a row:
//   inbox  the Mail inbox was empty of unread messages at some point that day.
//          Only counted once the inbox has been loaded in this session
//          (VexMail._state.inbox), because Vex never reads mail in the background;
//          a day it was not looked at is "not measured" and counts as missed.
//   tabs   the open tab count at the last sample of the day is at or under N
//          (goal, default 15).
//   focus  minutes of Focus mode that day reach the goal (default 25).
//
// A day that is not over yet does not break a streak (as in Habits): today
// counts if met, and otherwise the run is counted up to yesterday.
//
// Samples are taken when build() runs and, while Focus mode is on, once a
// minute (start()). State: localStorage vex.brief.streaks
//   { days: { 'YYYY-MM-DD': { inbox: bool, tabs: n, focus: minutes } } }, 90 days kept.
// Goals are in vex.briefExtras: goalTabs, goalFocus.
//
// Section object for VexBrief.register: { id, title, build(), isEnabled() }.
const VexBriefStreaks = {
  id: 'streaks-goals',
  title: 'Streaks',
  icon: 'flame',
  STATE_KEY: 'vex.brief.streaks',
  SETTINGS_KEY: 'vex.briefExtras',
  KEEP_DAYS: 90,
  DEFAULT_TABS: 15,
  DEFAULT_FOCUS: 25,
  _timer: null,

  _json(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; }
    catch { return fb; }
  },

  isEnabled() {
    const s = this._json(this.SETTINGS_KEY, {});
    if (s && s.streaks === false) return false;
    // The master level (js/vex-playfulness.js): off in Simple mode, Focus, a meeting, a game.
    return typeof VexPlayfulness === 'undefined' || VexPlayfulness.allowed('streak');
  },

  dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  goals() {
    const s = this._json(this.SETTINGS_KEY, {}) || {};
    const pos = (v, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 999 ? n : fb; };
    return { tabs: pos(s.goalTabs, this.DEFAULT_TABS), focus: pos(s.goalFocus, this.DEFAULT_FOCUS) };
  },

  days() {
    const s = this._json(this.STATE_KEY, {});
    return (s && s.days && typeof s.days === 'object') ? s.days : {};
  },

  _save(days) {
    const keys = Object.keys(days).sort().slice(-this.KEEP_DAYS);
    const out = {};
    for (const k of keys) out[k] = days[k];
    localStorage.setItem(this.STATE_KEY, JSON.stringify({ days: out }));
  },

  // Pure. Was `goal` met on that day record?
  met(day, goal, goals) {
    if (!day) return false;
    if (goal === 'inbox') return day.inbox === true;
    if (goal === 'tabs') return typeof day.tabs === 'number' && day.tabs <= goals.tabs;
    if (goal === 'focus') return (day.focus || 0) >= goals.focus;
    return false;
  },

  // Pure. Days in a row ending today (or yesterday, if today is not met yet).
  streak(days, goal, goals, now = new Date()) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let n = 0;
    if (this.met(days[this.dayKey(d)], goal, goals)) n = 1;
    for (;;) {
      d.setDate(d.getDate() - 1);
      if (!this.met(days[this.dayKey(d)], goal, goals)) break;
      n++;
      if (n > this.KEEP_DAYS) break;
    }
    return n;
  },

  // Writes today's record from what is readable now.
  sample(now = new Date(), deps = {}) {
    const days = this.days();
    const k = this.dayKey(now);
    const day = days[k] || { inbox: false, tabs: null, focus: 0 };
    const tm = deps.tabs !== undefined ? deps.tabs : (typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs) ? TabManager.tabs.length : null);
    if (typeof tm === 'number') day.tabs = tm;
    const unseen = deps.unseen !== undefined ? deps.unseen : (typeof VexMail !== 'undefined' && VexMail._state && VexMail._state.inbox ? VexMail._state.inbox.unseen : null);
    if (typeof unseen === 'number' && unseen === 0) {
      // The first time today the inbox is seen empty: sounds, levels and medals hear it once.
      if (!day.inbox && typeof document !== 'undefined') {
        try {
          document.dispatchEvent(new CustomEvent('vex:inbox-zero'));
          document.dispatchEvent(new CustomEvent('vex:fun-action', { detail: { kind: 'inbox-cleared' } }));
          document.dispatchEvent(new CustomEvent('vex:medal-signal', { detail: { id: 'inbox-zero' } }));
        } catch { /* no document */ }
      }
      day.inbox = true;
    }
    days[k] = day;
    this._save(days);
    return day;
  },

  addFocus(minutes, now = new Date()) {
    const days = this.days();
    const k = this.dayKey(now);
    const day = days[k] || { inbox: false, tabs: null, focus: 0 };
    day.focus = (day.focus || 0) + minutes;
    days[k] = day;
    this._save(days);
  },

  // One minute of Focus mode per minute it is on. Call once at start-up.
  start() {
    if (this._timer) return;
    this._timer = VexJobs.every('Focus streak minutes', 60 * 1000, () => {
      if (typeof FocusMode !== 'undefined' && FocusMode.active) this.addFocus(1);
    }, { when: 'background' });
  },
  stop() { if (this._timer) { this._timer.stop(); this._timer = null; } },

  build(now = new Date(), deps = {}) {
    this.sample(now, deps);
    const days = this.days();
    const goals = this.goals();
    const today = days[this.dayKey(now)] || {};
    const row = (goal, label, progress) => {
      const n = this.streak(days, goal, goals, now);
      // Tells js/achievement-badges.js, which counts no streaks of its own.
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('vex:streak-updated', { detail: { goal, streak: n, met: this.met(today, goal, goals), day: this.dayKey(now) } }));
      }
      return {
        text: label,
        detail: progress + (this.met(today, goal, goals) ? ' - done today' : '') + '. ' + (n === 0 ? 'No streak yet' : n === 1 ? '1 day in a row' : n + ' days in a row'),
        streak: n,
        met: this.met(today, goal, goals),
        goal,
      };
    };
    return {
      id: this.id, title: this.title, icon: this.icon,
      lines: [
        row('inbox', 'Inbox zero', today.inbox ? 'Inbox was empty today' : 'Open the Mail panel to measure it'),
        row('tabs', 'Tabs at or under ' + goals.tabs, (typeof today.tabs === 'number' ? today.tabs : '?') + ' open now'),
        row('focus', 'Focus ' + goals.focus + ' minutes', (today.focus || 0) + ' of ' + goals.focus + ' minutes'),
      ],
    };
  },
};

if (typeof window !== 'undefined') window.VexBriefStreaks = VexBriefStreaks;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBriefStreaks };
