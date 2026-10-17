// === Day shape and week load (T2-037) ===========================================
//
// "What does today look like?" is answered by opening three places. This puts
// the answer in one: a bar from 07:00 to 24:00 with the busy stretches, the
// LARGEST FREE GAP named, and seven cells for the week so a crushed Thursday is
// seen on Monday.
//
//   busy = subscribed calendar events + timed reminders (a quarter of an hour
//          each: a reminder is a moment, not a slot) + Focus OS blocks you
//          confirmed (planned or running)
//   load of a day = its busy minutes + half an hour for each task dated that day
//                    + the counted work the Deadline ledger asks of that day: its hours as they are and its
//                    "tasks" at half an hour each (pages, cards and items cannot be turned into minutes, so
//                    they are listed next to the day, never added)
//   Light < 3 h · Steady < 5 h · Heavy < 7 h · Crushed from 7 h
//
//   VexDayShape.segments / largestGap / bar / level     pure
//   VexDayShape.day(dayStart, now) / week(now)           async: read the stores
//   Morning Brief section "Day shape": the bar as text, the gap, the week
//   Ctrl+K "Day shape": the real bar and the seven cells
//
// It reads and shows. It writes nothing and sends nothing; a store that cannot be
// read is named in the answer instead of being treated as an empty one.

const VexDayShape = {
  PREF: 'vex.dayShape.enabled',
  FROM_H: 7,
  TO_H: 24,
  REMINDER_MIN: 15,
  TASK_MIN: 30,
  LEVELS: [
    { key: 'light', label: 'Light', max: 180 },
    { key: 'steady', label: 'Steady', max: 300 },
    { key: 'heavy', label: 'Heavy', max: 420 },
    { key: 'crushed', label: 'Crushed', max: Infinity },
  ],

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) { return VexPlanKit.setFlag(this.PREF, on); },

  // ---- pure ---------------------------------------------------------------------------
  windowOf(dayStart) { return { from: dayStart + this.FROM_H * 3600000, to: dayStart + this.TO_H * 3600000 }; },

  // Items { start, end } clipped to the window of the day and merged where they touch.
  segments(items, dayStart) {
    const w = this.windowOf(dayStart);
    const list = (Array.isArray(items) ? items : [])
      .filter(i => i && Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
      .map(i => ({ start: Math.max(i.start, w.from), end: Math.min(i.end, w.to) }))
      .filter(i => i.end > i.start)
      .sort((a, b) => a.start - b.start);
    const out = [];
    for (const i of list) {
      const last = out[out.length - 1];
      if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
      else out.push({ ...i });
    }
    return out;
  },
  busyMinutes(segs) { return Math.round(segs.reduce((n, s) => n + (s.end - s.start), 0) / 60000); },

  // The longest stretch with nothing in it, from `after` (default: the start of the window).
  largestGap(segs, dayStart, after = 0) {
    const w = this.windowOf(dayStart);
    let cursor = Math.max(w.from, after || 0);
    let best = null;
    const take = (a, b) => { if (b > a && (!best || b - a > best.end - best.start)) best = { start: a, end: b }; };
    for (const s of segs) {
      if (s.end <= cursor) continue;
      take(cursor, Math.max(cursor, s.start));
      cursor = Math.max(cursor, s.end);
    }
    take(cursor, w.to);
    return best ? { ...best, minutes: Math.round((best.end - best.start) / 60000) } : null;
  },

  // One character per hour: '#' when any of that hour is busy, '.' when it is free.
  bar(segs, dayStart) {
    const w = this.windowOf(dayStart);
    let out = '';
    for (let t = w.from; t < w.to; t += 3600000) out += segs.some(s => s.start < t + 3600000 && s.end > t) ? '#' : '.';
    return out;
  },

  level(minutes) { return this.LEVELS.find(l => minutes < l.max); },
  span(min) { return min < 60 ? min + ' min' : (Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '')); },
  range(g) { return VexPlanKit.hhmm(g.start) + ' to ' + (g.end - VexPlanKit.startOfDay(g.start) >= 24 * 3600000 ? '24:00' : VexPlanKit.hhmm(g.end)); },

  // ---- the stores ---------------------------------------------------------------------------
  _src() {
    return {
      events: (from, to) => (typeof IcsCalendar !== 'undefined' && typeof IcsCalendar.between === 'function' ? IcsCalendar.between(from, to) : []),
      reminders: async () => {
        const b = typeof window !== 'undefined' && window.vex && window.vex.reminders;
        if (!b || typeof b.list !== 'function') throw new Error('reminders are not available');
        return b.list();
      },
      occurrences: (r, from, to) => (typeof Calendar !== 'undefined' && typeof Calendar.occurrences === 'function' ? Calendar.occurrences(r, from, to) : (r.at >= from && r.at < to ? [r.at] : [])),
      blocks: () => (typeof FocusOS !== 'undefined' && typeof FocusOS.state === 'function' ? FocusOS.state().blocks : []),
      tasks: (now) => VexPlanKit.openTasks(now),
    };
  },

  // -> { items: [{start,end,kind}], taskDays: Map(isoDay -> count), errors }
  async collect(from, to, now = Date.now(), src = this._src()) {
    const items = [];
    const errors = [];
    const taskDays = new Map();
    const guard = async (name, fn) => { try { await fn(); } catch (err) { errors.push(name + ': ' + ((err && err.message) || 'unavailable')); } };
    await guard('calendar', async () => {
      for (const e of await src.events(from, to)) {
        if (!e || e.allDay || !Number.isFinite(e.start) || !Number.isFinite(e.end)) continue;
        items.push({ start: e.start, end: e.end, kind: 'event' });
      }
    });
    await guard('reminders', async () => {
      for (const r of (await src.reminders()) || []) {
        if (!r || r.firedAt && !r.repeat || (r.kind && r.kind !== 'reminder') || r.focusOsBlock) continue;
        for (const at of await src.occurrences(r, from, to)) items.push({ start: at, end: at + this.REMINDER_MIN * 60000, kind: 'reminder' });
      }
    });
    await guard('focus blocks', async () => {
      for (const b of await src.blocks()) {
        if (!b || (b.state !== 'planned' && b.state !== 'active') || !(b.end > from) || !(b.start < to)) continue;
        items.push({ start: b.start, end: b.end, kind: 'focus' });
      }
    });
    await guard('tasks', async () => {
      for (const t of await src.tasks(now)) {
        if (!Number.isFinite(t.due) || t.due < from || t.due >= to) continue;
        const k = VexPlanKit.isoDay(t.due);
        taskDays.set(k, (taskDays.get(k) || 0) + 1);
      }
    });
    return { items, taskDays, errors };
  },

  // One day. `read` is a collect() result for a span that includes it.
  // counted: { hours, tasks, pages, ... } from the Deadline ledger for that day (optional).
  countedMinutes(counted) {
    return Math.round(((counted && counted.hours) || 0) * 60) + Math.round((counted && counted.tasks) || 0) * this.TASK_MIN;
  },
  countedText(counted) {
    return Object.entries(counted || {}).filter(([, n]) => n > 0).map(([unit, n]) => n + ' ' + unit).join(', ');
  },
  shapeOf(read, dayStart, now = Date.now(), counted = {}) {
    const segs = this.segments(read.items, dayStart);
    const tasks = read.taskDays.get(VexPlanKit.isoDay(dayStart)) || 0;
    const busy = this.busyMinutes(segs);
    const load = busy + tasks * this.TASK_MIN + this.countedMinutes(counted);
    const isToday = VexPlanKit.startOfDay(now) === dayStart;
    return { dayStart, segs, busy, tasks, counted, load, level: this.level(load), bar: this.bar(segs, dayStart), gap: this.largestGap(segs, dayStart, isToday ? now : 0) };
  },

  async week(now = Date.now(), src) {
    const start = VexPlanKit.startOfDay(now);
    const end = VexPlanKit.addDays(start, 7);
    const read = await this.collect(start, end, now, src);
    const days = [];
    const ledger = typeof VexDeadlineLedger !== 'undefined' && VexDeadlineLedger.enabled() ? VexDeadlineLedger : null;
    for (let i = 0; i < 7; i++) {
      const ds = VexPlanKit.addDays(start, i);
      days.push(this.shapeOf(read, ds, now, ledger ? ledger.shareOn(ds, now) : {}));
    }
    return { days, errors: read.errors };
  },

  // ---- Morning Brief ------------------------------------------------------------------------------
  briefModule() {
    return {
      id: 'day-shape', title: 'Shape of the day', icon: 'calendar',
      isEnabled: () => this.enabled(),
      build: async () => {
        const now = Date.now();
        const { days, errors } = await this.week(now);
        const t = days[0];
        const lines = [{
          text: String(this.FROM_H).padStart(2, '0') + ' ' + t.bar + ' 24',
          detail: t.busy ? 'Busy ' + this.span(t.busy) + (t.gap ? ' · largest free gap ' + this.range(t.gap) + ' (' + this.span(t.gap.minutes) + ')' : ' · no free gap left') : 'Nothing booked today' + (t.gap ? ' · free ' + this.range(t.gap) : ''),
        }];
        const counted = this.countedText(t.counted);
        if (counted) lines.push({ text: 'Counted work today', detail: counted + ' (from your deadlines)' });
        lines.push({ text: 'This week', detail: days.map((d, i) => (i === 0 ? 'today' : VexPlanKit.dayName(d.dayStart).split(' ')[0].replace(',', '')) + ' ' + d.level.label.toLowerCase()).join(' · ') });
        const hot = days.filter(d => d.level.key === 'crushed' && d !== days[0]);
        return { summary: hot.length ? VexPlanKit.dayName(hot[0].dayStart) + ' looks crushed.' : '', lines, note: errors.length ? 'Could not read: ' + errors.join('; ') : '' };
      },
    };
  },

  // ---- the dialog ----------------------------------------------------------------------------------------
  async open() {
    if (!this.enabled()) { window.showToast?.('Day shape is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('day-shape');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-day-shape', title: 'Shape of the day', sub: 'Calendar events, timed reminders and Focus OS blocks between 07:00 and 24:00.' });
    let res;
    try { res = await this.week(); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not read your day: ' + err.message)); return; }
    const t = res.days[0];
    const track = document.createElement('div');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', 'Today from 07:00 to 24:00. Busy ' + this.span(t.busy) + (t.gap ? '. Largest free gap ' + this.range(t.gap) : ''));
    track.style.cssText = 'position:relative;height:22px;border-radius:6px;background:var(--surface);border:1px solid var(--border);overflow:hidden;margin:8px 0';
    const w = this.windowOf(t.dayStart);
    const total = w.to - w.from;
    for (const s of t.segs) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;top:0;bottom:0;background:var(--primary);opacity:0.8;left:' + ((s.start - w.from) / total * 100) + '%;width:' + ((s.end - s.start) / total * 100) + '%';
      track.appendChild(d);
    }
    body.appendChild(track);
    const marks = document.createElement('div');
    marks.className = 'vex-platform-note';
    marks.textContent = '07:00' + ' '.repeat(2) + '...' + ' '.repeat(2) + '24:00';
    body.appendChild(marks);
    body.appendChild(VexSettingsGroups.note(t.busy ? 'Busy ' + this.span(t.busy) + (t.gap ? '. Largest free gap: ' + this.range(t.gap) + ' (' + this.span(t.gap.minutes) + ').' : '. No free gap left today.') : 'Nothing booked today.' + (t.gap ? ' Free ' + this.range(t.gap) + '.' : '')));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin:10px 0';
    res.days.forEach((d, i) => {
      const cell = document.createElement('div');
      const strength = { light: 0.15, steady: 0.35, heavy: 0.6, crushed: 0.9 }[d.level.key];
      cell.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:6px;text-align:center;font-size:11.5px;background:color-mix(in srgb, var(--primary) ' + Math.round(strength * 100) + '%, transparent)';
      cell.setAttribute('aria-label', VexPlanKit.dayName(d.dayStart) + ': ' + d.level.label + ', ' + this.span(d.busy) + ' booked' + (d.tasks ? ', ' + d.tasks + ' tasks' : '') + (this.countedText(d.counted) ? ', ' + this.countedText(d.counted) + ' counted' : ''));
      const a = document.createElement('div'); a.textContent = i === 0 ? 'Today' : new Date(d.dayStart).toLocaleDateString(undefined, { weekday: 'short' });
      const b = document.createElement('div'); b.style.fontWeight = '650'; b.textContent = d.level.label;
      const c = document.createElement('div'); c.style.opacity = '0.8'; c.textContent = this.span(d.busy);
      cell.append(a, b, c);
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    const countedToday = this.countedText(t.counted);
    if (countedToday) body.appendChild(VexSettingsGroups.note('Counted work today, from your deadlines: ' + countedToday + '. Hours and tasks are in the load above; pages, cards and items are only listed.'));
    if (res.errors.length) body.appendChild(VexSettingsGroups.note('Could not read: ' + res.errors.join('; ')));
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('A bar for today from 07:00 to 24:00 with the largest free gap, and a Light / Steady / Heavy / Crushed cell for each of the next seven days. Shown in the Morning Brief and in Ctrl+K › Day shape.'));
    el.appendChild(VexSettingsGroups.button('Show my day', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexDayShape = VexDayShape;
  window.VexBriefModules = window.VexBriefModules || [];
  window.VexBriefModules.push(VexDayShape.briefModule());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'day-shape', title: 'Shape of the day', keywords: 'day shape busy free gap week load calendar crushed', before: 'about', build: (el) => VexDayShape.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'day-shape', label: 'Shape of the day', hint: 'Busy bar, largest free gap and the week load', icon: 'calendar', action: () => VexDayShape.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDayShape };
