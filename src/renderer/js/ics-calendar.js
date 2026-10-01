// === Calendars you subscribe to (iCal addresses) ============================
//
// Google, Outlook and Apple calendars each publish a read-only address in
// iCal form — Google calls it the "secret address in iCal format". Paste it
// here and the events show in Vex's Calendar and in Today on the new tab.
// Read-only, and no account: Vex fetches the address, nothing more. The
// address itself is a password in all but name (anyone with it can read the
// calendar), so it stays out of reports and sync.
//
//   parse(text)           iCal text → events
//   expand(ev, from, to)  an event's occurrences between two moments, repeats
//                         included (daily / weekly / monthly / yearly, with
//                         INTERVAL, COUNT, UNTIL, weekly BYDAY and EXDATE)
//   between(from, to)     every subscribed calendar's occurrences
const IcsCalendar = {
  KEY: 'vex.calendarFeeds',
  EVERY: 30 * 60000,
  MAX_OCCURRENCES: 1000,
  _events: new Map(),        // feed url → events
  _errors: new Map(),        // feed url → why it could not be read
  _noted: new Set(),

  feeds() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  _saveFeeds(list) { localStorage.setItem(this.KEY, JSON.stringify(list)); },

  add(url, name) {
    let u = String(url || '').trim().replace(/^webcal:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(u)) throw new Error('Paste the calendar\'s iCal address — it starts with https:// or webcal://');
    const list = this.feeds();
    if (list.some(f => f.url === u)) throw new Error('That calendar is already added');
    list.push({ url: u, name: String(name || '').trim() || 'Calendar' });
    this._saveFeeds(list);
    return u;
  },

  remove(url) {
    this._saveFeeds(this.feeds().filter(f => f.url !== url));
    this._events.delete(url);
    this._errors.delete(url);
  },

  // ---- reading iCal ----------------------------------------------------------
  // Lines are folded (a line that starts with a space continues the one before).
  _lines(text) { return String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/); },

  _unescape(v) { return String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); },

  // The offset of `tz` from UTC at instant `t`, in ms.
  _offset(tz, t) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
    const g = (k) => Number(parts.find(p => p.type === k).value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - t;
  },

  // A wall-clock time in a named zone → the instant. Twice, so a time near a
  // clock change settles on the right side of it.
  _zoned(y, mo, d, h, mi, s, tz) {
    const wall = Date.UTC(y, mo - 1, d, h, mi, s);
    let t = wall;
    for (let i = 0; i < 2; i++) t = wall - this._offset(tz, t);
    return t;
  },

  // DTSTART;TZID=Europe/Paris:20260920T090000 | DTSTART:20260920T070000Z |
  // DTSTART;VALUE=DATE:20260920 | a floating time (no zone: the user's own).
  _time(params, value) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value).trim());
    if (!m) return null;
    const [, y, mo, d, h, mi, s, z] = m;
    // `tz` is the zone the event's clock runs in, so its repeats keep that
    // clock (UTC for a Z time, null for a floating one or a whole day).
    if (h == null) return { at: new Date(+y, +mo - 1, +d).getTime(), allDay: true, tz: null };
    if (z) return { at: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s), allDay: false, tz: 'UTC' };
    const tz = (/(?:^|;)TZID=([^;:]+)/.exec(params) || [])[1];
    if (tz) {
      const zone = tz.replace(/^"|"$/g, '');
      try { return { at: this._zoned(+y, +mo, +d, +h, +mi, +s, zone), allDay: false, tz: zone }; }
      catch {
        // A zone this computer does not know by that name (Outlook writes
        // Windows names): read as local time, and say so once.
        this._note('Unknown time zone "' + tz + '" — its events are shown in your own time');
      }
    }
    return { at: new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime(), allDay: false, tz: null };
  },

  // The wall clock at instant `t` in zone `tz` (the user's own when null).
  _wallParts(t, tz) {
    if (!tz) {
      const d = new Date(t);
      return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), dow: d.getDay() };
    }
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
    const g = (k) => Number(parts.find(p => p.type === k).value);
    const y = g('year'), mo = g('month') - 1, d = g('day');
    return { y, mo, d, h: g('hour'), mi: g('minute'), s: g('second'), dow: new Date(Date.UTC(y, mo, d)).getUTCDay() };
  },

  // Where a content line's name and parameters end: the first ':' outside
  // double quotes. A quoted parameter may hold one, and
  // LOCATION;ALTREP="http://x":Room 1 was read as the location '//x":Room 1'
  // (found 2026-09-29).
  _colon(line) {
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoted = !quoted;
      else if (line[i] === ':' && !quoted) return i;
    }
    return -1;
  },

  _note(message) {
    if (this._noted.has(message)) return;
    this._noted.add(message);
    window.VexProblems?.note('Calendar', message);
  },

  parse(text) {
    const events = [];
    let ev = null;
    for (const line of this._lines(text)) {
      if (line === 'BEGIN:VEVENT') { ev = { summary: '', location: '', exdates: [] }; continue; }
      if (line === 'END:VEVENT') { if (ev && ev.start) events.push(ev); ev = null; continue; }
      if (!ev) continue;
      const colon = this._colon(line);
      if (colon < 0) continue;
      const head = line.slice(0, colon), value = line.slice(colon + 1);
      const name = head.split(';')[0].toUpperCase(), params = head.slice(name.length);
      if (name === 'SUMMARY') ev.summary = this._unescape(value);
      else if (name === 'LOCATION') ev.location = this._unescape(value);
      else if (name === 'UID') ev.uid = value;
      else if (name === 'STATUS') ev.cancelled = /CANCELLED/i.test(value);
      else if (name === 'RRULE') ev.rrule = value;
      else if (name === 'RECURRENCE-ID') ev.recurrenceId = (this._time(params, value) || {}).at;
      else if (name === 'DTSTART') { const t = this._time(params, value); if (t) { ev.start = t.at; ev.allDay = t.allDay; ev.tz = t.tz; } }
      else if (name === 'DTEND') { const t = this._time(params, value); if (t) ev.end = t.at; }
      else if (name === 'EXDATE') for (const v of value.split(',')) { const t = this._time(params, v); if (t) ev.exdates.push(t.at); }
    }
    for (const e of events) if (e.end == null) e.end = e.start + (e.allDay ? 24 * 3600 * 1000 : 3600 * 1000);
    return events.filter(e => !e.cancelled);
  },

  // ---- repeats -----------------------------------------------------------------
  _rule(text) {
    const r = {};
    for (const part of String(text || '').split(';')) { const [k, v] = part.split('='); if (k) r[k.toUpperCase()] = v; }
    return r;
  },

  expand(ev, from, to) {
    const length = ev.end - ev.start;
    const out = [];
    const keep = (at) => { if (at < to && at + length > from && !ev.exdates.includes(at)) out.push({ start: at, end: at + length }); };
    if (!ev.rrule) { keep(ev.start); return out; }
    const r = this._rule(ev.rrule);
    // BYMONTH, and one BYMONTHDAY on a monthly or yearly repeat, are expanded
    // below. Both used to be ignored, so "every month on the 5th" whose first
    // time was on the 20th repeated on the 20th, and BYMONTH did nothing
    // (found 2026-09-29). BYDAY outside a weekly repeat was ignored the same
    // way; now it is shown once, like the rest Vex cannot expand.
    const months = r.BYMONTH ? r.BYMONTH.split(',').map(Number) : null;
    const monthDay = r.BYMONTHDAY ? Number(r.BYMONTHDAY) : null;
    const unsupported = ['BYSETPOS', 'BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE'].some(k => r[k])
      || (r.BYDAY && r.FREQ !== 'WEEKLY')
      || (months && !months.every(m => Number.isInteger(m) && m >= 1 && m <= 12))
      || (r.BYMONTHDAY && (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31 || (r.FREQ !== 'MONTHLY' && r.FREQ !== 'YEARLY')));
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ) || unsupported) {
      this._note('A repeating event Vex cannot expand ("' + ev.summary + '": ' + ev.rrule + ') is shown only once');
      keep(ev.start);
      return out;
    }
    const interval = Math.max(1, Number(r.INTERVAL) || 1);
    const count = r.COUNT ? Number(r.COUNT) : Infinity;
    const until = r.UNTIL ? (this._time('', r.UNTIL) || {}).at : Infinity;
    const first = new Date(ev.start);
    const days = r.FREQ === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',').map(d => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d.slice(-2))) : null;
    // Step in the event's own calendar and zone, keeping the wall-clock time
    // of the first. Stepping in the viewer's clock put a 09:00 New York
    // meeting an hour off for the weeks the two zones change their clocks on
    // different dates (found 2026-09-29). `strict` drops a day that does not
    // exist (the 31st of a 30-day month) instead of rolling over.
    const F = this._wallParts(ev.start, ev.tz);
    const wall = (y, mo, d, strict) => {
      const n = new Date(Date.UTC(y, mo, d));
      if (strict && n.getUTCDate() !== d) return NaN;
      const Y = n.getUTCFullYear(), M = n.getUTCMonth(), D = n.getUTCDate();
      return ev.tz ? this._zoned(Y, M + 1, D, F.h, F.mi, F.s, ev.tz) : new Date(Y, M, D, F.h, F.mi, F.s).getTime();
    };
    const day = monthDay || F.d;
    // With no COUNT to keep, start near the viewed range: counting from the
    // first occurrence, a daily event begun four years ago ran out of its
    // MAX_OCCURRENCES before today and never showed (found 2026-09-29). One
    // period of slack covers clock changes.
    let i0 = 0;
    if (count === Infinity) {
      const f = new Date(from - length);
      const span = r.FREQ === 'DAILY' ? (f.getTime() - ev.start) / 86400000
        : r.FREQ === 'WEEKLY' ? (f.getTime() - ev.start) / (7 * 86400000)
        : r.FREQ === 'MONTHLY' ? (f.getFullYear() - first.getFullYear()) * 12 + f.getMonth() - first.getMonth()
        : f.getFullYear() - first.getFullYear();
      i0 = Math.max(0, Math.floor(span / interval) - 1);
    }
    let made = 0;
    for (let i = i0; made < count && i < i0 + this.MAX_OCCURRENCES; i++) {
      let batch;
      // The 31st in a 30-day month (or 29 Feb in another year) rolled over
      // into the next month (found 2026-09-29); such a month has no
      // occurrence, as RFC 5545 says — hence `strict` for months and years.
      if (r.FREQ === 'DAILY') batch = [wall(F.y, F.mo, F.d + i * interval)];
      else if (r.FREQ === 'WEEKLY') {
        batch = days ? days.map(d => wall(F.y, F.mo, F.d + i * 7 * interval - F.dow + d)) : [wall(F.y, F.mo, F.d + i * 7 * interval)];
      } else if (r.FREQ === 'MONTHLY') batch = [wall(F.y, F.mo + i * interval, day, true)];
      else batch = (months ? months.map(m => m - 1) : [F.mo]).map(m => wall(F.y + i * interval, m, day, true));
      // BYMONTH on a daily, weekly or monthly repeat keeps only those months.
      if (months && r.FREQ !== 'YEARLY') batch = batch.filter(t => months.includes(this._wallParts(t, ev.tz).mo + 1));
      batch = batch.filter(t => Number.isFinite(t) && t >= ev.start).sort((a, b) => a - b);
      let past = false;
      for (const t of batch) {
        if (t > until || made >= count) { past = true; break; }
        made++;
        keep(t);
      }
      if (past || batch[0] >= to) break;
    }
    return out;
  },

  // ---- fetching ------------------------------------------------------------------
  async refresh() {
    for (const f of this.feeds()) {
      try {
        const r = await window.vex.calendarFetch(f.url);
        if (!r.ok) throw new Error(r.error);
        this._events.set(f.url, this.parse(r.text));
        this._errors.delete(f.url);
      } catch (err) {
        this._errors.set(f.url, (err && err.message) || 'could not be read');
      }
    }
    document.dispatchEvent(new CustomEvent('vex:calendar-updated'));
  },

  errors() { return [...this._errors.entries()].map(([url, error]) => ({ name: (this.feeds().find(f => f.url === url) || {}).name || 'Calendar', error })); },

  between(from, to) {
    const out = [];
    for (const f of this.feeds()) {
      // A moved single occurrence (RECURRENCE-ID) replaces the one it moved.
      const events = this._events.get(f.url) || [];
      const moved = new Map(events.filter(e => e.recurrenceId != null).map(e => [e.uid + '@' + e.recurrenceId, e]));
      for (const ev of events) {
        if (ev.recurrenceId != null) { for (const o of this.expand({ ...ev, rrule: null }, from, to)) out.push({ ...o, summary: ev.summary, location: ev.location, allDay: ev.allDay, calendar: f.name }); continue; }
        for (const o of this.expand(ev, from, to)) {
          if (moved.has(ev.uid + '@' + o.start)) continue;
          out.push({ ...o, summary: ev.summary, location: ev.location, allDay: ev.allDay, calendar: f.name });
        }
      }
    }
    return out.sort((a, b) => a.start - b.start);
  },

  start() {
    if (this._job || !this.feeds().length) return;
    this.refresh();
    this._job = VexJobs.every('Calendars', this.EVERY, () => this.refresh(), { when: 'background' });
  },
};

if (typeof window !== 'undefined') window.IcsCalendar = IcsCalendar;
if (typeof module !== 'undefined' && module.exports) module.exports = { IcsCalendar };
