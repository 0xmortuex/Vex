// === Due-ness: one ranked "what is due" list ==================================
//
// Four stores hold things that have a date: reminders (the main process),
// open tasks written "@2026-10-20" in notes (js/open-tasks.js), subscribed
// calendar events (js/ics-calendar.js) and scheduled tasks (js/scheduler.js).
// This reads all four and answers ONE list, most urgent first, with a reason
// chip on each row: overdue, due today (with the time when there is one), due
// this week.
//
//   VexDueness.rank(items, now, { limit })   pure: the ordering and the reasons
//   VexDueness.collect(now, sources)         async: reads the four stores. A store
//                                            that cannot be read is named in
//                                            `errors`; the others still answer.
//   Morning Brief section "Due"              the top rows (js/brief.js)
//   Ctrl+K "What is due"                     the whole list, up to 40 rows
//
// Read-only. It changes nothing in any store and sends nothing anywhere.
// Item shape: { id, kind: 'reminder'|'task'|'event'|'schedule', text, at, hasTime, url? }

const VexDueness = {
  PREF: 'vex.dueness.enabled',   // 'off' switches the section and the command off
  DAY: 24 * 3600 * 1000,
  WEEK_DAYS: 7,
  KIND_RANK: { reminder: 0, task: 1, event: 2, schedule: 3 },
  KIND_LABEL: { reminder: 'Reminder', task: 'Task', event: 'Calendar', schedule: 'Scheduled' },

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- pure ---------------------------------------------------------------------
  _startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); },
  _hhmm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },
  _span(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return m + ' min';
    const h = Math.round(m / 60);
    if (h < 48) return h + ' h';
    return Math.round(h / 24) + ' days';
  },

  // -> { group: 0 overdue | 1 today | 2 this week | 3 later, key, label } or null when it is not due within the week.
  reason(item, now = Date.now()) {
    if (!item || !Number.isFinite(item.at)) return null;
    const today = this._startOfDay(now);
    const tomorrow = today + this.DAY;
    const horizon = today + (this.WEEK_DAYS + 1) * this.DAY;
    const overdue = item.hasTime ? item.at < now : item.at < today;
    if (overdue) {
      const by = item.hasTime ? now - item.at : today - item.at;
      return { group: 0, key: 'overdue', label: 'Overdue ' + this._span(by) };
    }
    if (item.at < tomorrow) return { group: 1, key: item.hasTime ? 'today-time' : 'today', label: item.hasTime ? 'Today ' + this._hhmm(item.at) : 'Due today' };
    if (item.at < horizon) {
      let day = '';
      try { day = new Date(item.at).toLocaleDateString(undefined, { weekday: 'short' }); } catch { day = new Date(item.at).toDateString().slice(0, 3); }
      const label = item.at < tomorrow + this.DAY ? 'Tomorrow' : day;
      return { group: 2, key: 'week', label: item.hasTime ? label + ' ' + this._hhmm(item.at) : label };
    }
    return null;
  },

  // Most urgent first: overdue (oldest first), then today (timed ones in time order, then
  // the untimed), then the rest of the week. Items due beyond a week are left out.
  rank(items, now = Date.now(), { limit = Infinity } = {}) {
    const out = [];
    const seen = new Set();
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || typeof it.text !== 'string' || !it.text.trim()) continue;
      const r = this.reason(it, now);
      if (!r) continue;
      const dupe = it.kind + '|' + it.text + '|' + it.at;
      if (seen.has(dupe)) continue;
      seen.add(dupe);
      out.push({ ...it, reason: r });
    }
    const rk = (it) => this.KIND_RANK[it.kind] == null ? 9 : this.KIND_RANK[it.kind];
    out.sort((a, b) => a.reason.group - b.reason.group
      || (a.reason.group === 1 ? (b.hasTime ? 1 : 0) - (a.hasTime ? 1 : 0) : 0)
      || a.at - b.at || rk(a) - rk(b) || a.text.localeCompare(b.text));
    return out.slice(0, limit);
  },

  // ---- the four stores -------------------------------------------------------------
  _sources() {
    return {
      reminders: async () => {
        const b = typeof window !== 'undefined' && window.vex && window.vex.reminders;
        if (!b || typeof b.list !== 'function') throw new Error('reminders are not available');
        return b.list();
      },
      tasks: () => {
        if (typeof OpenTasks === 'undefined') throw new Error('open tasks are not loaded');
        return OpenTasks.collect(OpenTasks.notes());
      },
      events: (from, to) => {
        if (typeof IcsCalendar === 'undefined') return [];
        return IcsCalendar.between(from, to);
      },
      schedule: (now) => {
        if (typeof Scheduler === 'undefined' || !Scheduler.getAllTasks) throw new Error('scheduled tasks are not loaded');
        return Scheduler.getAllTasks().filter(t => t.enabled).map(t => ({ name: t.name, at: Scheduler.nextOccurrence(t, now), id: t.id }));
      },
    };
  },

  // -> { items (unranked), errors: ['reminders: ...'] }
  async collect(now = Date.now(), src = this._sources()) {
    const items = [];
    const errors = [];
    const horizon = this._startOfDay(now) + (this.WEEK_DAYS + 1) * this.DAY;
    const guard = async (name, fn) => { try { await fn(); } catch (err) { errors.push(name + ': ' + ((err && err.message) || 'unavailable')); } };
    await guard('reminders', async () => {
      for (const r of await src.reminders()) {
        if (!r || r.firedAt || r.kind === 'review' || !Number.isFinite(r.at)) continue;
        items.push({ id: 'reminder:' + r.id, kind: 'reminder', text: String(r.message || ''), at: r.at, hasTime: true, url: r.url || '' });
      }
    });
    await guard('tasks', async () => {
      for (const t of await src.tasks()) {
        if (!t || t.done || !Number.isFinite(t.due)) continue;
        items.push({ id: 'task:' + t.noteId + ':' + t.index, kind: 'task', text: OpenTasks.stripDue(t.text) || String(t.text || ''), at: t.due, hasTime: false, sub: t.noteTitle });
      }
    });
    await guard('calendar', async () => {
      for (const e of await src.events(this._startOfDay(now), horizon)) {
        if (!e || e.end <= now) continue;
        items.push({ id: 'event:' + e.summary + ':' + e.start, kind: 'event', text: String(e.summary || ''), at: e.start, hasTime: !e.allDay, sub: e.location || e.calendar || '' });
      }
    });
    await guard('scheduled tasks', async () => {
      for (const s of await src.schedule(now)) {
        if (!s || !Number.isFinite(s.at)) continue;
        items.push({ id: 'schedule:' + s.id, kind: 'schedule', text: String(s.name || ''), at: s.at, hasTime: true });
      }
    });
    // Features that have dates of their own (deadlines, follow-ups, holidays) add a source with addSource().
    for (const [name, def] of this._extra) {
      await guard(name, async () => {
        for (const it of (await def.read(now)) || []) {
          if (!it || !Number.isFinite(it.at)) continue;
          items.push({ ...it, kind: def.kind });
        }
      });
    }
    return { items, errors };
  },

  // A source beyond the four stores: addSource('deadlines', { kind: 'deadline', label: 'Deadline' }, (now) => [item]).
  // `kind` is the chip word's key; the items have the shape described at the top of this file.
  _extra: new Map(),
  addSource(name, { kind, label } = {}, read) {
    if (!name || !kind || typeof read !== 'function') throw new Error('A due-ness source needs a name, a kind and a reader');
    if (!(kind in this.KIND_LABEL)) { this.KIND_LABEL[kind] = String(label || kind); this.KIND_RANK[kind] = 5 + Object.keys(this.KIND_RANK).length; }
    this._extra.set(name, { kind, read });
    return true;
  },

  async top(limit = 5, now = Date.now(), src) {
    const { items, errors } = await this.collect(now, src);
    return { rows: this.rank(items, now, { limit }), total: this.rank(items, now).length, errors };
  },

  // ---- Morning Brief section ----------------------------------------------------------
  section() {
    return {
      id: 'dueness', title: 'Due', icon: 'calendar', order: 3, defaultOn: true, maxItems: 5, ttlMs: 30000,
      build: async (ctx = {}) => {
        if (!this.enabled()) return null;
        const now = ctx.now || Date.now();
        const { rows, total, errors } = await this.top(5, now);
        if (!rows.length && !errors.length) return null;
        return {
          summary: rows.length ? (total === 1 ? '1 thing is due' : total + ' things are due') + (total > rows.length ? ', the top ' + rows.length + ' shown' : '') : '',
          items: rows.map(r => ({ text: r.text, sub: this.KIND_LABEL[r.kind] + (r.sub ? ' · ' + r.sub : ''), badge: r.reason.label, url: /^https?:\/\//i.test(r.url || '') ? r.url : '' })),
          note: errors.length ? 'Could not read: ' + errors.join('; ') : '',
        };
      },
    };
  },

  // ---- the full list (Ctrl+K "What is due") ---------------------------------------------
  async open() {
    if (!this.enabled()) { window.showToast?.('Due-ness is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('dueness');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-dueness', title: 'What is due', sub: 'Reminders, tasks written @date in notes, calendar events and scheduled tasks, most urgent first.' });
    let res;
    try { res = await this.top(40); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not read what is due: ' + err.message)); return; }
    if (!res.rows.length) body.appendChild(VexSettingsGroups.note('Nothing is due in the next ' + this.WEEK_DAYS + ' days.'));
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    for (const r of res.rows) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      const chip = document.createElement('span');
      chip.className = 'vexsr-mode';
      chip.textContent = r.reason.label;
      chip.style.minWidth = '110px';
      const text = document.createElement('span');
      text.className = 'vexsr-host';
      text.style.wordBreak = 'normal';
      text.textContent = r.text + '  (' + this.KIND_LABEL[r.kind] + (r.sub ? ', ' + r.sub : '') + ')';
      row.append(chip, text);
      list.appendChild(row);
    }
    body.appendChild(list);
    if (res.errors.length) body.appendChild(VexSettingsGroups.note('Could not read: ' + res.errors.join('; ')));
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('One ranked list of what is due across reminders, @dated tasks, calendar events and scheduled tasks. Shown in the Morning Brief and in Ctrl+K › What is due.'));
    el.appendChild(VexSettingsGroups.button('Open what is due', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexDueness = VexDueness;
  if (typeof VexBrief !== 'undefined') VexBrief.register(VexDueness.section());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'dueness', title: 'What is due', keywords: 'due overdue today reminders tasks calendar schedule ranked list', before: 'about', build: (el) => VexDueness.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'due-now', label: 'What is due', hint: 'Reminders, tasks, events and schedules, most urgent first', icon: 'calendar', action: () => VexDueness.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDueness };
