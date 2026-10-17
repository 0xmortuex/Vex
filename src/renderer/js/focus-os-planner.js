// === Focus OS: the planner =================================================
//
// Pure functions, no DOM and no storage, so every rule here is tested without
// a window. Given a goal's remaining effort and deadline, and what is already
// on the day (calendar events, reminders, quiet hours, meals, the wind-down),
// it PROPOSES work blocks. It never schedules over any of those, and it never
// decides anything: a proposal is only ever a list the user confirms.
//
//   freeWindows({...})      the stretches of the work day that are really free
//   planBlocks({...})       blocks that fit the free windows before a deadline
//   transition(b, action)   the one place a block changes state
//   dayProgress / goalProgress / weekSummary   plain counts, never penalties
//   parseGoalText(text)     "ship the release by Friday, 6 hours" -> fields
//
// Block states:  proposed -> planned -> active -> done
//                planned/active -> skipped -> planned (restore)
// "skipped" is how a block that was not done is kept: it is not counted
// against anyone, and a block whose time passed untouched becomes skipped
// (lapse) without a word.
const FocusOSPlanner = {
  MIN_MS: 60000,
  DEFAULTS: { workFrom: '09:00', workTo: '18:00', blockMin: 50, minBlockMin: 20, breakMin: 10, maxPerDay: 3, bufferMin: 5, meals: [{ from: '12:00', to: '13:00' }] },
  STATES: ['proposed', 'planned', 'active', 'done', 'skipped'],
  // action -> { from state -> to state }
  TRANSITIONS: {
    confirm: { proposed: 'planned' },
    start: { planned: 'active' },
    finish: { active: 'done' },
    skip: { planned: 'skipped', active: 'skipped', proposed: 'skipped' },
    restore: { skipped: 'planned' },
    lapse: { planned: 'skipped' },
  },

  // ---- clock helpers -------------------------------------------------------
  parseHM(s) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s == null ? '' : s).trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  },
  _needHM(s, what) {
    const v = this.parseHM(s);
    if (v === null) throw new Error((what || 'Time') + ' must look like 09:00, not "' + s + '"');
    return v;
  },
  dayStart(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); },
  atMinutes(dayMs, minutes) {
    const d = new Date(dayMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();
  },
  addDays(dayMs, n) { const d = new Date(dayMs); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); },
  dayKey(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  ceilTo(ms, stepMin) { const s = stepMin * this.MIN_MS; return Math.ceil(ms / s) * s; },

  // ---- intervals -------------------------------------------------------------
  // A daily window ('22:00'..'07:00', may cross midnight) as absolute
  // intervals between from and to. from === to means "no window".
  dailyIntervals(from, to, win) {
    if (!win) return [];
    const a = this._needHM(win.from, 'Window start');
    const b = this._needHM(win.to, 'Window end');
    if (a === b) return [];
    const out = [];
    const first = this.addDays(this.dayStart(from), -1);
    for (let d = first; d <= to; d = this.addDays(d, 1)) {
      const s = this.atMinutes(d, a);
      const e = a < b ? this.atMinutes(d, b) : this.atMinutes(this.addDays(d, 1), b);
      const cs = Math.max(s, from), ce = Math.min(e, to);
      if (ce > cs) out.push({ start: cs, end: ce });
    }
    return out;
  },

  mergeIntervals(list) {
    const xs = (list || []).filter(i => i && Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
      .map(i => ({ start: i.start, end: i.end })).sort((p, q) => p.start - q.start);
    const out = [];
    for (const i of xs) {
      const last = out[out.length - 1];
      if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
      else out.push(i);
    }
    return out;
  },

  // base minus cuts (both lists of {start,end}).
  subtract(base, cuts) {
    const c = this.mergeIntervals(cuts);
    const out = [];
    for (const b of this.mergeIntervals(base)) {
      let cur = b.start;
      for (const k of c) {
        if (k.end <= cur) continue;
        if (k.start >= b.end) break;
        if (k.start > cur) out.push({ start: cur, end: k.start });
        cur = Math.max(cur, k.end);
        if (cur >= b.end) break;
      }
      if (cur < b.end) out.push({ start: cur, end: b.end });
    }
    return out;
  },

  // Calendar events and reminders -> busy intervals. An all-day event does not
  // block the day (it is a label, not an appointment); an event with no end is
  // given half an hour.
  busyFromEvents(events) {
    const out = [];
    for (const e of events || []) {
      if (!e || e.allDay || !Number.isFinite(e.start)) continue;
      const end = Number.isFinite(e.end) && e.end > e.start ? e.end : e.start + 30 * this.MIN_MS;
      out.push({ start: e.start, end });
    }
    return out;
  },

  // The free stretches of the work day between from and to.
  //   busy     [{start,end}]     events, other blocks
  //   blocked  [{from,to}]       daily windows to keep clear: quiet hours,
  //                              meals, the wind-down
  freeWindows({ from, to, workFrom, workTo, busy = [], blocked = [], bufferMin }) {
    const d = this.DEFAULTS;
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('freeWindows needs a from and a to');
    if (to <= from) return [];
    const buf = (bufferMin == null ? d.bufferMin : bufferMin) * this.MIN_MS;
    const base = this.dailyIntervals(from, to, { from: workFrom || d.workFrom, to: workTo || d.workTo });
    const cuts = this.mergeIntervals(busy).map(i => ({ start: i.start - buf, end: i.end + buf }));
    for (const w of blocked || []) cuts.push(...this.dailyIntervals(from, to, w));
    return this.subtract(base, cuts);
  },

  // ---- the plan ------------------------------------------------------------------
  //   remainingMin   minutes of work still to place
  //   deadline, now  epoch ms
  //   busy / blocked / workFrom / workTo / bufferMin   as freeWindows
  //   existing       blocks already on the calendar: [{start,end,goalId,state}]
  //                  (skipped ones are ignored); they are kept clear of, and
  //                  this goal's own count towards maxPerDay
  //   goalId         whose per-day cap applies
  planBlocks(o) {
    const d = this.DEFAULTS;
    const blockMin = o.blockMin || d.blockMin, minBlock = o.minBlockMin || d.minBlockMin;
    const breakMin = o.breakMin == null ? d.breakMin : o.breakMin, maxPerDay = o.maxPerDay || d.maxPerDay;
    if (!Number.isFinite(o.now) || !Number.isFinite(o.deadline)) throw new Error('planBlocks needs now and a deadline');
    let remaining = Math.round(Number(o.remainingMin) || 0);
    const res = { blocks: [], plannedMin: 0, shortfallMin: Math.max(0, remaining), feasible: remaining <= 0, reason: remaining <= 0 ? 'nothing-left' : '' };
    if (remaining <= 0) return res;
    if (o.deadline <= o.now) { res.reason = 'deadline-passed'; return res; }

    const live = (o.existing || []).filter(b => b && b.state !== 'skipped' && Number.isFinite(b.start) && Number.isFinite(b.end));
    const free = this.freeWindows({
      from: this.ceilTo(o.now, 5), to: o.deadline, workFrom: o.workFrom, workTo: o.workTo,
      busy: [...(o.busy || []), ...live.map(b => ({ start: b.start, end: b.end }))], blocked: o.blocked, bufferMin: o.bufferMin,
    });
    const perDay = {};
    for (const b of live) if (o.goalId && b.goalId === o.goalId) { const k = this.dayKey(b.start); perDay[k] = (perDay[k] || 0) + 1; }

    for (const w of free) {
      let cursor = w.start;
      while (remaining > 0) {
        const k = this.dayKey(cursor);
        if ((perDay[k] || 0) >= maxPerDay) break;
        const availMin = Math.floor((w.end - cursor) / this.MIN_MS);
        if (availMin < Math.min(minBlock, remaining)) break;
        const len = Math.min(blockMin, remaining, availMin);
        res.blocks.push({ start: cursor, end: cursor + len * this.MIN_MS, minutes: len });
        remaining -= len;
        perDay[k] = (perDay[k] || 0) + 1;
        cursor += (len + breakMin) * this.MIN_MS;
      }
      if (remaining <= 0) break;
    }
    res.plannedMin = res.blocks.reduce((s, b) => s + b.minutes, 0);
    res.shortfallMin = Math.max(0, remaining);
    res.feasible = remaining <= 0;
    res.reason = res.feasible ? '' : (res.blocks.length ? 'not-enough-room' : 'no-room');
    return res;
  },

  // ---- state transitions -----------------------------------------------------------
  canTransition(block, action) {
    const t = this.TRANSITIONS[action];
    return !!(t && block && t[block.state]);
  },
  // Returns a new block; throws for a move that is not allowed.
  transition(block, action, now = Date.now()) {
    if (!block || typeof block !== 'object') throw new Error('No block to change');
    if (!this.TRANSITIONS[action]) throw new Error('Unknown block action "' + action + '"');
    const to = this.TRANSITIONS[action][block.state];
    if (!to) throw new Error('A block that is ' + block.state + ' cannot be ' + action + 'ed');
    const b = { ...block, state: to };
    if (action === 'start') { b.startedAt = now; delete b.endedAt; }
    if (action === 'finish') b.endedAt = now;
    if (action === 'skip') { b.endedAt = now; b.skippedFrom = block.state; }
    if (action === 'lapse') { b.endedAt = now; b.skippedFrom = 'planned'; b.lapsed = true; }
    if (action === 'restore') { delete b.endedAt; delete b.lapsed; delete b.startedAt; }
    return b;
  },
  // Planned blocks whose time passed untouched become skipped, quietly.
  // Returns the changed blocks (new objects); the caller stores them.
  lapse(blocks, now = Date.now()) {
    return (blocks || []).filter(b => b.state === 'planned' && b.end <= now).map(b => this.transition(b, 'lapse', now));
  },

  // The minutes a finished block actually counts for.
  doneMinutes(b) {
    if (b.state !== 'done') return 0;
    if (Number.isFinite(b.startedAt) && Number.isFinite(b.endedAt) && b.endedAt > b.startedAt) {
      return Math.max(1, Math.min(Math.round((b.endedAt - b.startedAt) / this.MIN_MS), Math.round((b.end - b.start) / this.MIN_MS) + 30));
    }
    return Math.round((b.end - b.start) / this.MIN_MS);
  },

  // ---- progress: counts, never penalties -------------------------------------------
  dayProgress(blocks, now = Date.now()) {
    const key = this.dayKey(now);
    const today = (blocks || []).filter(b => this.dayKey(b.start) === key && (b.state === 'planned' || b.state === 'active' || b.state === 'done'));
    const done = today.filter(b => b.state === 'done').length;
    const total = today.length;
    return {
      done, total, fraction: total ? done / total : 0,
      text: total ? done + ' of ' + total + ' block' + VexPlural.s(total) + ' done' : 'No blocks today',
    };
  },
  goalProgress(goal, blocks) {
    const mine = (blocks || []).filter(b => b.goalId === goal.id);
    const doneMin = mine.reduce((s, b) => s + this.doneMinutes(b), 0);
    const est = Math.max(0, Number(goal.estimateMin) || 0);
    return { doneMin, estimateMin: est, remainingMin: Math.max(0, est - doneMin), fraction: est ? Math.min(1, doneMin / est) : 0 };
  },
  remainingMinutes(goal, blocks) { return this.goalProgress(goal, blocks).remainingMin; },

  // The last seven days, as plain numbers for the weekly review.
  weekSummary(goals, blocks, now = Date.now()) {
    const from = this.addDays(this.dayStart(now), -6), to = this.addDays(this.dayStart(now), 1);
    const inWeek = (blocks || []).filter(b => b.start >= from && b.start < to);
    const done = inWeek.filter(b => b.state === 'done');
    const perGoal = new Map();
    for (const b of done) perGoal.set(b.goalId, (perGoal.get(b.goalId) || 0) + this.doneMinutes(b));
    const title = (id) => { const g = (goals || []).find(x => x.id === id); return g ? g.title : 'A goal you removed'; };
    return {
      from, to,
      blocksDone: done.length,
      blocksPlanned: inWeek.filter(b => b.state !== 'proposed').length,
      blocksSkipped: inWeek.filter(b => b.state === 'skipped').length,
      minutesDone: done.reduce((s, b) => s + this.doneMinutes(b), 0),
      goalsDone: (goals || []).filter(g => g.status === 'done' && g.completedAt >= from && g.completedAt < to).map(g => g.title),
      perGoal: [...perGoal.entries()].map(([id, minutes]) => ({ goalId: id, title: title(id), minutes })).sort((a, c) => c.minutes - a.minutes),
    };
  },

  // ---- auto-start (only for a goal that opted in) -----------------------------------
  // The planned block whose time has come, within a grace period, for a goal
  // that has autoStart on and is active. Nothing is returned while a block is
  // already running.
  dueForAutoStart(goals, blocks, now = Date.now(), graceMin = 5) {
    if ((blocks || []).some(b => b.state === 'active')) return null;
    const ok = new Set((goals || []).filter(g => g.autoStart === true && g.status === 'active').map(g => g.id));
    return (blocks || []).filter(b => b.state === 'planned' && ok.has(b.goalId) && b.start <= now && now < Math.min(b.end, b.start + graceMin * this.MIN_MS))
      .sort((a, c) => a.start - c.start)[0] || null;
  },

  // ---- "ship the release by Friday, 6 hours" -----------------------------------------
  DAYS: { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 },
  // -> { title, deadlineDay (epoch ms of that day's midnight) | null, estimateMin | null }
  parseGoalText(text, now = Date.now()) {
    let s = String(text == null ? '' : text).trim();
    let deadlineDay = null, estimateMin = null;
    const today = this.dayStart(now);
    const cut = (re) => { s = s.replace(re, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim(); };
    let m;
    if ((m = /\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i.exec(s)) && !/\bby\s*$/i.test(s.slice(0, m.index))) {
      const n = Number(m[1]);
      estimateMin = /^h/i.test(m[2]) ? Math.round(n * 60) : Math.round(n);
      cut(new RegExp('(?:,|\\bfor|\\bin|\\btakes?|\\babout|\\bapprox\\.?)?\\s*' + m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
    // "by Friday", "by 2026-11-02", "by tomorrow", or on its own "in 3 days".
    if ((m = /\b(?:by\s+(today|tonight|tomorrow|(?:next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)|\d{4}-\d{2}-\d{2}|in\s+\d+\s+days?)|(in\s+\d+\s+days?))\b/i.exec(s))) {
      const w = (m[1] || m[3]).toLowerCase();
      if (w === 'today' || w === 'tonight') deadlineDay = today;
      else if (w === 'tomorrow') deadlineDay = this.addDays(today, 1);
      else if (/^\d{4}-/.test(w)) {
        const [y, mo, da] = w.split('-').map(Number);
        const t = new Date(y, mo - 1, da);
        if (t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === da) deadlineDay = t.getTime();
      } else if (/^in\s/.test(w)) deadlineDay = this.addDays(today, Number(/\d+/.exec(w)[0]));
      else {
        const wd = this.DAYS[m[2].toLowerCase()];
        let diff = (wd - new Date(today).getDay() + 7) % 7;
        if (/^next\s/.test(w) && diff < 7) diff = diff === 0 ? 7 : diff;
        deadlineDay = this.addDays(today, diff);
      }
      if (deadlineDay != null) cut(new RegExp('\\s*,?\\s*' + m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
    return { title: s.replace(/^[,\s]+|[,\s.]+$/g, ''), deadlineDay, estimateMin };
  },

  // A day plus the end of the work day = the deadline instant.
  deadlineAt(dayMs, workTo) {
    return this.atMinutes(dayMs, this._needHM(workTo || this.DEFAULTS.workTo, 'Work day end'));
  },
};

if (typeof window !== 'undefined') window.FocusOSPlanner = FocusOSPlanner;
if (typeof module !== 'undefined' && module.exports) module.exports = { FocusOSPlanner };
