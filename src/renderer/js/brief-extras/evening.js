// === Brief extra: Evening wind-down ==============================================
//
// After a set hour (vex.briefExtras.eveningHour, default 19) the brief gains a
// wind-down: what is still undone today, what is waiting in read-later, and
// tomorrow's first event. Before that hour isEnabled() is false, so the
// section is simply absent in the daytime.
//
// Sources (each optional and isolated; a failing one is named in `errors`
// rather than hidden):
//   undone      reminders not fired that were due today or earlier, and note
//               tasks (OpenTasks) due today or earlier and not done
//   read later  ReadLater items not read, newest first
//   tomorrow    the first timed calendar event tomorrow (IcsCalendar), else the
//               first reminder due tomorrow
//
// Section object for VexBrief.register: { id, title, build(), isEnabled() }.
const VexBriefEvening = {
  id: 'evening-wind-down',
  title: 'Winding down',
  icon: 'moon',
  SETTINGS_KEY: 'vex.briefExtras',
  DEFAULT_HOUR: 19,
  MAX_UNDONE: 5,
  MAX_READ_LATER: 3,

  _json(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fb : v; }
    catch { return fb; }
  },

  settings() {
    const s = this._json(this.SETTINGS_KEY, {}) || {};
    const h = Number(s.eveningHour);
    return { on: s.evening !== false, hour: Number.isInteger(h) && h >= 0 && h <= 23 ? h : this.DEFAULT_HOUR };
  },

  isEnabled(now = new Date()) {
    const s = this.settings();
    return s.on && now.getHours() >= s.hour;
  },

  _fmt(ms) { return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); },

  // Pure. Turns the raw inputs into the section lines.
  compose({ undone, readLater, tomorrow, errors = [] }) {
    const lines = [];
    if (undone.length) {
      lines.push({ text: undone.length === 1 ? '1 thing left undone' : undone.length + ' things left undone', kind: 'heading' });
      for (const u of undone.slice(0, this.MAX_UNDONE)) lines.push({ text: u.text, detail: u.detail || '', kind: 'undone', url: u.url || null });
      if (undone.length > this.MAX_UNDONE) lines.push({ text: 'and ' + (undone.length - this.MAX_UNDONE) + ' more', kind: 'more' });
    } else {
      lines.push({ text: 'Nothing left undone today', kind: 'heading' });
    }
    if (readLater.length) {
      lines.push({ text: readLater.length === 1 ? '1 saved page to read' : readLater.length + ' saved pages to read', kind: 'heading' });
      for (const r of readLater.slice(0, this.MAX_READ_LATER)) lines.push({ text: r.title, kind: 'read', url: r.url });
    }
    if (tomorrow) lines.push({ text: 'Tomorrow starts with ' + tomorrow.text, detail: tomorrow.detail || '', kind: 'tomorrow' });
    else lines.push({ text: 'Nothing scheduled to start tomorrow', kind: 'tomorrow' });
    return { lines, errors };
  },

  async build(now = new Date(), deps = {}) {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 3600 * 1000;
    const endOfTomorrow = endOfDay + 24 * 3600 * 1000;
    const errors = [];
    const undone = [];
    let readLater = [];
    let tomorrow = null;
    let reminders = [];

    try {
      const b = deps.reminders || (window.vex && window.vex.reminders);
      if (b && typeof b.list === 'function') {
        reminders = await b.list();
        for (const r of reminders) {
          if (r.firedAt || r.kind === 'review' || r.at == null || r.at >= endOfDay) continue;
          undone.push({ text: r.message, detail: 'Reminder, due ' + this._fmt(r.at), url: r.url || null, at: r.at });
        }
      }
    } catch (err) { errors.push('reminders: ' + ((err && err.message) || 'unavailable')); }

    try {
      const T = deps.openTasks || (typeof OpenTasks !== 'undefined' ? OpenTasks : null);
      if (T) {
        const notes = deps.notes ? deps.notes() : T._notes();
        for (const t of T.collect(notes, { includeDone: false, now })) {
          if (t.done || t.due == null || t.due >= endOfDay) continue;
          undone.push({ text: t.text, detail: 'Task in ' + t.noteTitle, at: t.due });
        }
      }
    } catch (err) { errors.push('tasks: ' + ((err && err.message) || 'unavailable')); }
    undone.sort((a, c) => (a.at || 0) - (c.at || 0));

    try {
      const R = deps.readLater || (typeof ReadLater !== 'undefined' ? ReadLater.items : null);
      if (Array.isArray(R)) {
        readLater = R.filter(i => i && !i.read && i.url).sort((a, c) => (c.at || 0) - (a.at || 0)).map(i => ({ title: i.title || i.url, url: i.url }));
      }
    } catch (err) { errors.push('read later: ' + ((err && err.message) || 'unavailable')); }

    try {
      const C = deps.calendar || (typeof IcsCalendar !== 'undefined' ? IcsCalendar : null);
      if (C) {
        const ev = C.between(endOfDay, endOfTomorrow).filter(e => !e.allDay).sort((a, c) => a.start - c.start)[0];
        if (ev) tomorrow = { text: ev.summary + ' at ' + this._fmt(ev.start), detail: ev.location || '' };
      }
    } catch (err) { errors.push('calendar: ' + ((err && err.message) || 'unavailable')); }
    if (!tomorrow) {
      const r = reminders.filter(x => !x.firedAt && x.at != null && x.at >= endOfDay && x.at < endOfTomorrow).sort((a, c) => a.at - c.at)[0];
      if (r) tomorrow = { text: r.message + ' at ' + this._fmt(r.at), detail: 'Reminder' };
    }

    const body = this.compose({ undone, readLater, tomorrow, errors });
    return { id: this.id, title: this.title, icon: this.icon, ...body };
  },
};

if (typeof window !== 'undefined') window.VexBriefEvening = VexBriefEvening;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBriefEvening };
