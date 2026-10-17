// === Holiday-aware planner (Turkey) ==========================================
//
// Reminders and focus blocks that land on a bayram are noise, and a Friday
// between a holiday and the weekend is a day you would rather plan around.
// This knows the Turkish public holidays and the bridge days between them, and
// tells the places that plan things.
//
// No network. The fixed holidays are computed for any year (1 Jan, 23 Apr,
// 1 May, 19 May, 15 Jul, 30 Aug, 29 Oct and the half-day eve of 28 Oct). The
// two bayrams move with the lunar calendar, so their dates are BUNDLED for the
// years below, taken from the Diyanet calendar; a year that is not bundled gets
// the fixed holidays only and says so. Dates marked `confirm` are ones to check
// against the Diyanet calendar once it is published. Your own calendar file
// (.ics, whole-day events) can add or correct days, and you can add a day by hand
// (the "ara tatil" a decree adds, say).
//
//   VexHolidays.on(date)              the holiday on that day, or null
//   VexHolidays.isOff(date)           weekend or a whole-day holiday
//   VexHolidays.bridges(from, to)     [{ date, name }] workdays between a day off and a day off
//   VexHolidays.busyIntervals(a, b)   [{ start, end }] for Focus OS, one per holiday (half days from 13:00)
//   VexHolidays.shiftToWorkday(ms)    the same time on the next workday
//   VexHolidays.parseIcs(text)        pure: whole-day events -> [{ date, name }]

const VexHolidays = {
  PREF: 'vex.holidays.enabled',        // 'off' stops it reaching Focus OS and What is due
  FOCUS_PREF: 'vex.holidays.skipFocus', // 'off': Focus OS keeps planning on holidays
  USER_KEY: 'vex.holidays.user',       // [{ date, name }] from your calendar file or by hand
  MAX_USER: 300,
  DAY: 24 * 3600 * 1000,

  // Movable (lunar) holidays, by year. `half` is the arife afternoon (from 13:00).
  MOVABLE: {
    2026: [
      { from: '2026-03-20', to: '2026-03-22', name: 'Ramazan Bayramı', half: '2026-03-19' },
      { from: '2026-05-27', to: '2026-05-30', name: 'Kurban Bayramı', half: '2026-05-26' },
    ],
    2027: [
      { from: '2027-03-09', to: '2027-03-11', name: 'Ramazan Bayramı', half: '2027-03-08', confirm: true },
      { from: '2027-05-16', to: '2027-05-19', name: 'Kurban Bayramı', half: '2027-05-15', confirm: true },
    ],
  },
  FIXED: [
    ['01-01', 'Yılbaşı'],
    ['04-23', 'Ulusal Egemenlik ve Çocuk Bayramı'],
    ['05-01', 'Emek ve Dayanışma Günü'],
    ['05-19', 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı'],
    ['07-15', 'Demokrasi ve Millî Birlik Günü'],
    ['08-30', 'Zafer Bayramı'],
    ['10-29', 'Cumhuriyet Bayramı'],
  ],
  HALF_FIXED: [['10-28', 'Cumhuriyet Bayramı arifesi']],

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },
  skipsFocus() { try { return localStorage.getItem(this.FOCUS_PREF) !== 'off'; } catch { return true; } },
  setSkipsFocus(on) {
    try { localStorage.setItem(this.FOCUS_PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- dates -----------------------------------------------------------------------
  key(d) {
    const x = typeof d === 'number' ? new Date(d) : d;
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  },
  parseKey(k) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k));
    if (!m) throw new Error('Not a day: ' + k);
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) throw new Error('Not a day: ' + k);
    return d;
  },
  _addDays(k, n) { const d = this.parseKey(k); d.setDate(d.getDate() + n); return this.key(d); },
  _toKey(date) { return typeof date === 'string' ? date : this.key(date); },

  // ---- user days ---------------------------------------------------------------------
  userDays() {
    const raw = localStorage.getItem(this.USER_KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('Your holiday days could not be read: ' + err.message); }
    return Array.isArray(v) ? v.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && typeof x.name === 'string') : [];
  },
  _saveUser(list) {
    const kept = list.slice(0, this.MAX_USER);
    try { localStorage.setItem(this.USER_KEY, JSON.stringify(kept)); }
    catch (err) { throw new Error('Your holiday days could not be saved: ' + err.message); }
    this._cache = null;
    return kept;
  },
  addUserDay(date, name) {
    this.parseKey(date);
    const label = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label) throw new Error('Give the day a name');
    const list = this.userDays().filter(x => x.date !== date);
    list.push({ date, name: label });
    return this._saveUser(list.sort((a, b) => a.date.localeCompare(b.date)));
  },
  removeUserDay(date) {
    const list = this.userDays();
    if (!list.some(x => x.date === date)) throw new Error('That day is not on your list');
    return this._saveUser(list.filter(x => x.date !== date));
  },

  // Whole-day events of an .ics file. Line folding is undone; a timed event is not a holiday and is skipped.
  parseIcs(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const out = [];
    let cur = null;
    for (const line of lines) {
      if (/^BEGIN:VEVENT/i.test(line)) { cur = { date: '', name: '' }; continue; }
      if (/^END:VEVENT/i.test(line)) {
        if (cur && cur.date && cur.name) out.push(cur);
        cur = null;
        continue;
      }
      if (!cur) continue;
      let m = /^DTSTART(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})$/i.exec(line);
      if (m && (/VALUE=DATE(?!-)/i.test(line) || !/T/.test(line))) { cur.date = m[1] + '-' + m[2] + '-' + m[3]; continue; }
      m = /^SUMMARY(?:;[^:]*)?:(.*)$/i.exec(line);
      if (m) cur.name = m[1].replace(/\\([,;nN\\])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c)).trim().slice(0, 80);
    }
    return out.filter(e => { try { this.parseKey(e.date); return true; } catch { return false; } });
  },
  // Adds what the file holds to your days. -> how many were new.
  importIcs(text) {
    const found = this.parseIcs(text);
    if (!found.length) throw new Error('That file has no whole-day events to use as holidays');
    const have = new Map(this.userDays().map(x => [x.date, x]));
    let added = 0;
    for (const e of found) { if (!have.has(e.date)) added++; have.set(e.date, { date: e.date, name: e.name }); }
    this._saveUser([...have.values()].sort((a, b) => a.date.localeCompare(b.date)));
    return added;
  },

  // ---- the calendar --------------------------------------------------------------------
  // Every day of a year that is not an ordinary day: { date -> { name, kind, confirm? } }.
  yearMap(year) {
    const out = new Map();
    for (const [md, name] of this.FIXED) out.set(year + '-' + md, { name, kind: 'public' });
    for (const [md, name] of this.HALF_FIXED) out.set(year + '-' + md, { name, kind: 'half' });
    for (const h of this.MOVABLE[year] || []) {
      for (let k = h.from; k <= h.to; k = this._addDays(k, 1)) out.set(k, { name: h.name, kind: 'public', ...(h.confirm ? { confirm: true } : {}) });
      if (h.half) out.set(h.half, { name: h.name + ' arifesi', kind: 'half', ...(h.confirm ? { confirm: true } : {}) });
    }
    return out;
  },
  _maps: {},
  _map(year) { return this._maps[year] || (this._maps[year] = this.yearMap(year)); },
  _user() {
    if (!this._cache) this._cache = new Map(this.userDays().map(x => [x.date, { name: x.name, kind: 'user' }]));
    return this._cache;
  },
  // True when the movable holidays of that year are bundled.
  hasMovable(year) { return !!this.MOVABLE[year]; },

  on(date) {
    const k = this._toKey(date);
    const y = Number(k.slice(0, 4));
    return this._user().get(k) || this._map(y).get(k) || null;
  },
  isWeekend(date) { const g = this.parseKey(this._toKey(date)).getDay(); return g === 0 || g === 6; },
  // A day you are not at work: weekend, a public holiday or a day of your own. A half day is a working day.
  isOff(date) {
    const h = this.on(date);
    return this.isWeekend(date) || !!(h && h.kind !== 'half');
  },

  // Workdays that sit between two days off with at least one of them a holiday ("köprü").
  bridges(from, to) {
    const a = this._toKey(from), b = this._toKey(to);
    const out = [];
    for (let k = a; k <= b; k = this._addDays(k, 1)) {
      if (this.isOff(k)) continue;
      const before = this._addDays(k, -1), after = this._addDays(k, 1);
      if (!this.isOff(before) || !this.isOff(after)) continue;
      const hb = this.on(before), ha = this.on(after);
      const holiday = (hb && hb.kind !== 'half' ? hb : null) || (ha && ha.kind !== 'half' ? ha : null);
      if (holiday) out.push({ date: k, name: holiday.name });
    }
    return out;
  },

  // Holidays and bridge days in the next `days` days, soonest first.
  upcoming(fromMs = Date.now(), days = 60) {
    const start = this.key(fromMs), end = this.key(fromMs + days * this.DAY);
    const rows = [];
    for (let k = start; k <= end; k = this._addDays(k, 1)) {
      const h = this.on(k);
      if (h) rows.push({ date: k, name: h.name, kind: h.kind, ...(h.confirm ? { confirm: true } : {}) });
    }
    for (const b of this.bridges(start, end)) rows.push({ date: b.date, name: 'Bridge day before or after ' + b.name, kind: 'bridge' });
    return rows.sort((x, y) => x.date.localeCompare(y.date));
  },

  // Intervals Focus OS treats as busy: a whole day for a holiday, from 13:00 for a half day.
  busyIntervals(fromMs, toMs) {
    const out = [];
    for (let k = this.key(fromMs); k <= this.key(toMs); k = this._addDays(k, 1)) {
      const h = this.on(k);
      if (!h) continue;
      const d = this.parseKey(k);
      const start = h.kind === 'half' ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 13, 0).getTime() : d.getTime();
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      out.push({ start, end });
    }
    return out;
  },

  // The same time of day on the next workday (today if it already is one).
  shiftToWorkday(ms) {
    const d = new Date(ms);
    for (let i = 0; i < 20; i++) {
      if (!this.isOff(d)) return d.getTime();
      d.setDate(d.getDate() + 1);
    }
    throw new Error('No workday found in the next 20 days');
  },

  // ---- What is due ---------------------------------------------------------------------
  _dueRows(now) {
    return this.upcoming(now, 7).filter(r => r.kind !== 'half').map(r => {
      const d = this.parseKey(r.date);
      return { id: 'holiday:' + r.date, kind: 'holiday', text: (r.kind === 'bridge' ? 'Bridge day: ' : 'Holiday: ') + r.name.replace(/^Bridge day before or after /, ''), at: d.getTime(), hasTime: false };
    });
  },

  // ---- the screen ----------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('Holidays are switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('holiday-planner');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-holidays', title: 'Holidays', sub: 'Turkish public holidays and bridge days, from a list kept in Vex. Your own days and calendar file are added to it.' });
    const draw = () => {
      body.textContent = '';
      const now = Date.now();
      const y = new Date(now).getFullYear();
      let rows;
      try { rows = this.upcoming(now, 400); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      for (const yr of [y, y + 1]) {
        if (!this.hasMovable(yr)) body.appendChild(VexSettingsGroups.note('The bayram dates for ' + yr + ' are not in this version of Vex. Add them below or import your calendar file; the fixed holidays are shown.'));
      }
      if (rows.some(r => r.confirm)) body.appendChild(VexSettingsGroups.note('A date marked "check" is from the bundled list and is worth confirming against the Diyanet calendar.'));
      const list = document.createElement('div');
      list.className = 'vexsr-list';
      for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const chip = document.createElement('span');
        chip.className = 'vexsr-mode';
        chip.style.minWidth = '110px';
        chip.textContent = new Date(r.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = r.name + (r.kind === 'half' ? ' (half day)' : '') + (r.kind === 'user' ? ' (yours)' : '') + (r.confirm ? ' (check)' : '');
        row.append(chip, text);
        if (r.kind === 'user') row.appendChild(VexSettingsGroups.button('Remove', () => { try { this.removeUserDay(r.date); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { danger: true, label: 'Remove ' + r.name }));
        list.appendChild(row);
      }
      body.appendChild(list);
      const form = document.createElement('div');
      form.className = 'vexsr-rule';
      const day = document.createElement('input'); day.type = 'date'; day.setAttribute('aria-label', 'Day');
      const nm = document.createElement('input'); nm.type = 'text'; nm.placeholder = 'Name, like Ara tatil'; nm.maxLength = 80; nm.setAttribute('aria-label', 'Name');
      form.append(day, nm, VexSettingsGroups.button('Add a day', () => {
        try { this.addUserDay(day.value, nm.value); draw(); } catch (err) { window.showToast?.(err.message, 'error'); }
      }));
      body.appendChild(form);
      const file = document.createElement('input'); file.type = 'file'; file.accept = '.ics,text/calendar'; file.setAttribute('aria-label', 'Calendar file');
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        try {
          if (f.size > 2 * 1024 * 1024) throw new Error('That file is over 2 MB; a holiday calendar is much smaller');
          const n = this.importIcs(await f.text());
          window.showToast?.(n + ' new day' + VexPlural.s(n) + ' added', 'success');
          draw();
        } catch (err) { window.showToast?.(err.message, 'error'); }
      });
      body.appendChild(file);
    };
    draw();
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Turkish public holidays and the bridge days between them, with no network. Focus OS plans around them, and What is due shows the ones this week. Add your own calendar file for days a decree adds.'));
    el.appendChild(VexSettingsGroups.button('See the holidays', () => this.open(), { primary: true }));
    const row = document.createElement('label');
    row.className = 'vexsr-rule';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = this.skipsFocus();
    cb.addEventListener('change', () => { try { this.setSkipsFocus(cb.checked); } catch (err) { cb.checked = !cb.checked; window.showToast?.(err.message, 'error'); } });
    row.append(cb, document.createTextNode(' Focus OS plans no blocks on holidays'));
    el.appendChild(row);
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexDueness !== 'undefined' && typeof VexDueness.addSource === 'function') {
      VexDueness.addSource('holidays', { kind: 'holiday', label: 'Holiday' }, (now) => (this.enabled() ? this._dueRows(now) : []));
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexHolidays = VexHolidays;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'holiday-planner', title: 'Holidays', keywords: 'holiday bayram tatil bridge köprü ara tatil focus ics calendar turkey', before: 'about', build: (el) => VexHolidays.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'holidays', label: 'Holidays and bridge days', hint: 'Turkish public holidays, bridge days and your own days off', icon: 'calendar', action: () => VexHolidays.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexHolidays };
