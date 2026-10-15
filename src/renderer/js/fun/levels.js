// === Browser levels ===========================================================
//
// Points for useful things, never for time on screen. Off until turned on.
//
// Other parts of Vex (or the integrator) report a useful thing by dispatching
//   document 'vex:fun-action'  detail { kind, count? }
// or by calling VexLevels.award(kind, count). The kinds are in ACTIONS below.
// Each kind has a per-day cap, so a point is never worth grinding for, and
// nothing ever takes points away.
//
//   VexLevels.snapshot()  -> { enabled, xp, level, title, into, span, progress,
//                              nextTitle, today: { kind: count } }
const VexLevels = {
  KEY: 'vex.fun.levels',

  ACTIONS: {
    'organize':         { xp: 5,  cap: 10, label: 'Tidied tabs or groups' },
    'inbox-cleared':    { xp: 30, cap: 1,  label: 'Cleared the inbox' },
    'reading-finished': { xp: 25, cap: 1,  label: 'Finished the reading queue' },
    'note':             { xp: 5,  cap: 6,  label: 'Wrote a note' },
    'task-done':        { xp: 5,  cap: 10, label: 'Finished a task' },
    'focus':            { xp: 15, cap: 4,  label: 'Completed a focus session' },
    'challenge':        { xp: 20, cap: 1,  label: 'Did the daily challenge' },
  },

  TITLES: ['Newcomer', 'Explorer', 'Tidy', 'Organized', 'Focused', 'Navigator', 'Craftsperson', 'Curator', 'Expert', 'Master'],

  // XP needed to REACH level n (level 1 starts at 0): 0, 50, 150, 300, 500 ...
  threshold(n) {
    if (!Number.isInteger(n) || n < 1) throw new Error('A level is a whole number from 1');
    return 25 * n * (n - 1);
  },

  levelFor(xp) {
    const x = Math.max(0, Math.floor(Number(xp) || 0));
    let n = 1;
    while (this.threshold(n + 1) <= x) n++;
    return n;
  },

  titleFor(level) {
    return level <= this.TITLES.length ? this.TITLES[level - 1] : 'Level ' + level;
  },

  _state() {
    const s = VexFun.load(this.KEY, {});
    return { xp: Number(s.xp) || 0, day: s.day || '', counts: (s.counts && typeof s.counts === 'object') ? s.counts : {} };
  },

  // Adds points for one kind of useful thing. Returns null when the feature is
  // off or the daily cap for this kind is reached; throws on an unknown kind.
  award(kind, count) {
    const a = this.ACTIONS[kind];
    if (!a) throw new Error('Unknown level action: ' + kind);
    if (!VexFun.enabled('levels')) return null;
    const n = count === undefined ? 1 : Number(count);
    if (!Number.isInteger(n) || n < 1) throw new Error('The count of an action is a whole number from 1');
    const s = this._state();
    const day = VexFun.today();
    if (s.day !== day) { s.day = day; s.counts = {}; }
    const done = Number(s.counts[kind]) || 0;
    const take = Math.min(n, a.cap - done);
    if (take <= 0) return null;
    const before = this.levelFor(s.xp);
    s.counts[kind] = done + take;
    s.xp += take * a.xp;
    VexFun.save(this.KEY, s);
    const level = this.levelFor(s.xp);
    const res = { gained: take * a.xp, xp: s.xp, level, leveledUp: level > before, title: this.titleFor(level) };
    if (res.leveledUp) {
      if (level >= 5) VexFun.medal('level-5');
      if (level >= 10) VexFun.medal('level-10');
      try { document.dispatchEvent(new CustomEvent('vex:level-up', { detail: { level, title: res.title } })); } catch { /* no document */ }
      // A quiet toast, and never over a game.
      if (!VexFun.gameActive() && typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast('Level ' + level + ': ' + res.title);
      }
    }
    try { document.dispatchEvent(new CustomEvent('vex:levels-changed')); } catch { /* no document */ }
    return res;
  },

  snapshot() {
    const enabled = VexFun.enabled('levels');
    const s = this._state();
    const level = this.levelFor(s.xp);
    const base = this.threshold(level);
    const span = this.threshold(level + 1) - base;
    const day = VexFun.today();
    return {
      enabled,
      xp: s.xp,
      level,
      title: this.titleFor(level),
      into: s.xp - base,
      span,
      progress: Math.min(1, (s.xp - base) / span),
      nextTitle: this.titleFor(level + 1),
      today: s.day === day ? Object.assign({}, s.counts) : {},
    };
  },

  init() {
    if (this._wired || typeof document === 'undefined') return;
    this._wired = true;
    document.addEventListener('vex:fun-action', (e) => {
      const d = (e && e.detail) || {};
      try { this.award(d.kind, d.count); }
      catch (err) { VexFun.report('Browser levels could not count an action', err); }
    });
    // A finished focus session is announced for the pet too; count it once here.
    document.addEventListener('vex:focus-complete', () => {
      try { this.award('focus'); }
      catch (err) { VexFun.report('Browser levels could not count a focus session', err); }
    });
  },
};

if (typeof document !== 'undefined') VexLevels.init();
globalThis.VexLevels = VexLevels;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLevels };
