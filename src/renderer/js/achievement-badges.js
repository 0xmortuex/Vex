// === Achievement badges for good habits =====================================
//
// A badge layer, not a counter. Optional (off until switched on in Settings),
// kept on this computer, never shared: there is no share button, no account
// and no upload.
//
// The streak COUNTERS (inbox zero, tabs at or under a goal, focus minutes) are
// owned by js/brief-extras/streaks.js (VexBriefStreaks, branch
// worktree-agent-a3fccb50def548a72). This file does not count them again; it
// is told about them through one event, and badges follow from the streak
// lengths it is told:
//
//   document.dispatchEvent(new CustomEvent('vex:streak-updated', { detail: {
//     goal:   'inbox' | 'tabs' | 'focus'   (any string; unknown ones are fine)
//     streak: number                       days in a row, today included
//     met:    boolean                      is today's goal met
//     day:    'YYYY-MM-DD'                 optional, local date
//   } }));
//
// streaks.js does not dispatch that yet (adding it is one line after
// VexBriefStreaks.build computes `row`). Until it does, pull() reads its pure
// helpers (days(), goals(), streak()) when VexBriefStreaks exists, so the
// layer works with the module exactly as it is. Neither path writes to the
// streak module's storage.
//
// The one counter this file does own is "no late-night browsing", because no
// other module counts it: a day counts when Vex was used that day and no page
// was navigated to between midnight and 05:00 local time. It listens to
// 'vex:tab-navigated' for that, and keeps only the day marks (no addresses).
//
// State: localStorage 'vex.badges' = { earned: { id: at }, days: { day: { seen, late } } }
// Emits 'vex:badge-earned' { id, label, goal, length } once per badge.
//
// Brief-ready section: { id, title, icon, build(), isEnabled() }.
const VexBadges = {
  id: 'badges',
  title: 'Badges',
  icon: 'star',
  KEY: 'vex.badges',
  SETTING: 'badges',
  LEVELS: [3, 7, 30, 100],
  KEEP_DAYS: 120,
  LATE_UNTIL_HOUR: 5,
  GOALS: {
    inbox: 'Inbox zero',
    tabs: 'Tabs under goal',
    focus: 'Focus goal',
    'no-late-night': 'No late-night browsing',
  },

  isEnabled() {
    return typeof VexExtras !== 'undefined' && VexExtras.get(this.SETTING, false) === true;
  },

  _read() {
    let raw;
    try { raw = localStorage.getItem(this.KEY); } catch { return { earned: {}, days: {} }; }
    if (!raw) return { earned: {}, days: {} };
    let o;
    try { o = JSON.parse(raw); }
    catch (err) { throw new Error('The badges could not be read', { cause: err }); }
    return {
      earned: o && o.earned && typeof o.earned === 'object' ? o.earned : {},
      days: o && o.days && typeof o.days === 'object' ? o.days : {},
    };
  },
  _write(s) {
    const keys = Object.keys(s.days).sort().slice(-this.KEEP_DAYS);
    const days = {};
    for (const k of keys) days[k] = s.days[k];
    localStorage.setItem(this.KEY, JSON.stringify({ earned: s.earned, days }));
  },

  dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  },

  badgeId(goal, level) { return goal + ':' + level; },
  label(goal, level) { return (this.GOALS[goal] || goal) + ' - ' + level + ' days in a row'; },

  earned() {
    return Object.entries(this._read().earned)
      .map(([id, at]) => { const [goal, level] = id.split(':'); return { id, goal, level: Number(level), at, label: this.label(goal, Number(level)) }; })
      .sort((a, b) => b.at - a.at);
  },

  // The contract: somebody says a streak is `streak` days long. Returns the
  // badges earned by this call (usually none).
  observe({ goal, streak }, now = Date.now()) {
    if (typeof goal !== 'string' || !goal) throw new Error('A streak update needs a goal');
    const n = Math.floor(Number(streak));
    if (!Number.isFinite(n) || n < 0) throw new Error('A streak is a number of days');
    const s = this._read();
    const won = [];
    for (const level of this.LEVELS) {
      const id = this.badgeId(goal, level);
      if (n >= level && !s.earned[id]) { s.earned[id] = now; won.push({ id, goal, level, at: now, label: this.label(goal, level) }); }
    }
    if (won.length) {
      this._write(s);
      for (const b of won) {
        try { document.dispatchEvent(new CustomEvent('vex:badge-earned', { detail: b })); } catch { /* no document */ }
      }
    }
    return won;
  },

  // Read what the streak module computes, without letting it write.
  pull(now = new Date(), mod = (typeof VexBriefStreaks !== 'undefined' ? VexBriefStreaks : null)) {
    const won = [];
    if (!mod || typeof mod.days !== 'function' || typeof mod.streak !== 'function' || typeof mod.goals !== 'function') return won;
    const days = mod.days(), goals = mod.goals();
    for (const goal of ['inbox', 'tabs', 'focus']) won.push(...this.observe({ goal, streak: mod.streak(days, goal, goals, now) }, now.getTime()));
    return won;
  },

  // ---- the one counter that is ours --------------------------------------
  noteActivity(now = new Date()) {
    const s = this._read();
    const k = this.dayKey(now);
    const d = s.days[k] || { seen: true, late: false };
    d.seen = true;
    if (now.getHours() < this.LATE_UNTIL_HOUR) d.late = true;
    s.days[k] = d;
    this._write(s);
    return d;
  },

  // Pure over the day marks: days in a row ending today, or yesterday when
  // today is not over (a late visit today ends the run at once).
  lateNightStreak(days, now = new Date()) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const ok = (x) => !!(x && x.seen && !x.late);
    let n = 0;
    if (ok(days[this.dayKey(d)])) n = 1;
    else if (days[this.dayKey(d)] && days[this.dayKey(d)].late) return 0;
    for (let i = 0; i < this.KEEP_DAYS; i++) {
      d.setDate(d.getDate() - 1);
      if (!ok(days[this.dayKey(d)])) break;
      n++;
    }
    return n;
  },

  evaluateLateNight(now = new Date()) {
    const n = this.lateNightStreak(this._read().days, now);
    return this.observe({ goal: 'no-late-night', streak: n }, now.getTime());
  },

  _started: false,
  start() {
    if (this._started || typeof document === 'undefined') return false;
    this._started = true;
    document.addEventListener('vex:streak-updated', (e) => {
      if (!this.isEnabled()) return;
      const d = (e && e.detail) || {};
      try { this.observe(d); } catch (err) { window.VexProblems?.note('Badges', 'Ignored a streak update', err); }
    });
    document.addEventListener('vex:tab-navigated', () => {
      if (!this.isEnabled()) return;
      try { this.noteActivity(); } catch (err) { window.VexProblems?.note('Badges', 'Could not note activity', err); }
    });
    document.addEventListener('vex:badge-earned', (e) => {
      if (this.isEnabled() && e.detail && (typeof VexAttention === 'undefined' || VexAttention.gate('badge', e.detail.label))) window.showToast?.('Badge earned: ' + e.detail.label, 'success', 6000);
    });
    return true;
  },

  build(now = new Date()) {
    if (this.isEnabled()) { this.pull(now); this.evaluateLateNight(now); }
    const got = this.earned();
    const lines = got.slice(0, 5).map(b => ({ text: b.label, detail: 'Earned ' + new Date(b.at).toLocaleDateString() }));
    return { id: this.id, title: this.title, icon: this.icon, lines, count: got.length, empty: lines.length === 0 };
  },

  open(now = new Date()) {
    if (this.isEnabled()) { this.pull(now); this.evaluateLateNight(now); }
    const got = this.earned();
    return VexExtras.openReport({
      id: 'vex-badges',
      title: 'Badges',
      icon: this.icon,
      range: got.length + ' earned',
      sections: [{
        title: 'Earned',
        empty: 'None yet. Streaks of ' + this.LEVELS.join(', ') + ' days earn a badge.',
        rows: got.map(b => ({ text: b.label, sub: new Date(b.at).toLocaleDateString() })),
      }],
      footer: 'Kept on this computer. Badges are never shared or uploaded.',
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexBadges = VexBadges;
  if (typeof VexExtras !== 'undefined') {
    VexExtras.registerToggle({ key: 'badges', label: 'Achievement badges for good habits', hint: 'Badges for streaks: inbox zero, tabs under your goal, focus minutes and no late-night browsing. Kept on this computer, never shared.', def: false });
    VexExtras.registerCommand({ id: 'badges', label: 'Badges', hint: 'Streak badges you have earned', icon: 'star', action: () => VexBadges.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBadges };
