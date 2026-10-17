// === Exam and registration dates: yours, with reminders ========================
//
// T2-085. The dates that cost something if missed: an exam day, when an
// application window opens and closes, the late-fee window, results. They are
// typed in by you, or read from an .ics file you choose (a calendar you
// exported, one a school sent). Vex never fetches a government site, never
// signs in anywhere. The only dates that ship with Vex are the ones in
// js/exam-calendar-data.js: OSYM's own published calendar as read on a stated day,
// added by one button after a confirmation, each with its source link, that day and a
// "verify on the official site" flag. Each item carries the body it concerns
// (OSYM, MEB, YOK) and a "check it on the official site" line with a button that
// opens that site in a tab, when YOU press it.
//
// Each dated item gets reminders at 09:00, a week and a day ahead (your choice
// in the item form is not needed: the lead days are in Settings), and one on the
// day itself. Reminders are the main process's, so they fire with Vex closed.
//
// Fee cutoff and late window: an item can also carry the day the normal fee stops (feeDay) and a late
// window (lateStart to lateEnd), typed in the form, or picked out of an imported event's description when it
// says so ("fee until 2027-01-20", "late application 10.02.2027 - 15.02.2027"). They get the same reminders as
// the other days. Vex still ships no dates of its own.
const ExamCalendar = {
  KEY: 'vex.examDates',
  ON_KEY: 'vex.examDates.enabled',
  PREFS_KEY: 'vex.examDates.prefs',
  MAX_ITEMS: 300,
  MAX_ICS_BYTES: 1024 * 1024,
  MAX_IMPORT: 200,
  KINDS: [['exam', 'Exam'], ['application', 'Application window'], ['late', 'Late application window'], ['fee', 'Fee deadline'], ['result', 'Results'], ['other', 'Other']],
  BODIES: {
    osym: { label: 'OSYM', site: 'https://www.osym.gov.tr/' },
    meb: { label: 'MEB', site: 'https://www.meb.gov.tr/' },
    yok: { label: 'YOK', site: 'https://www.yok.gov.tr/' },
    other: { label: 'Other', site: '' },
  },

  enabled() { return VexLifeKit.flag(this.ON_KEY, true); },
  setEnabled(on) { VexLifeKit.setFlag(this.ON_KEY, !!on); },
  prefs() {
    const p = VexLifeKit.read(this.PREFS_KEY, null) || {};
    const lead = Array.isArray(p.lead) ? p.lead.filter(n => Number.isInteger(n) && n >= 1 && n <= 90) : [7, 1];
    return { lead: [...new Set(lead)].sort((a, b) => b - a).slice(0, 4) };
  },
  setLead(list) {
    const lead = list.map(Number);
    if (lead.some(n => !Number.isInteger(n) || n < 1 || n > 90)) throw new Error('Lead days are whole numbers from 1 to 90');
    VexLifeKit.write(this.PREFS_KEY, { lead });
  },

  // ---- storage ------------------------------------------------------------------------
  all() { const d = VexLifeKit.read(this.KEY, null); return d && Array.isArray(d.items) ? d.items : []; },
  _save(items) { VexLifeKit.write(this.KEY, { v: 1, items }); },
  sorted(now = Date.now()) {
    return this.all().map(i => ({ ...i, left: VexLifeKit.daysLeft(VexLifeKit.parseDay(i.endDay || i.day), now) })).sort((a, b) => VexLifeKit.parseDay(a.day) - VexLifeKit.parseDay(b.day));
  },
  examToday(now = Date.now()) {
    const today = VexLifeKit.dayString(now);
    return this.all().some(i => i.kind === 'exam' && i.day <= today && (i.endDay || i.day) >= today);
  },

  // ---- pure: one item from the form or from a file ---------------------------------------
  clean(input) {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('Give it a name');
    if (title.length > 120) throw new Error('The name is up to 120 characters');
    const kind = this.KINDS.some(k => k[0] === input.kind) ? input.kind : 'other';
    const body = this.BODIES[input.body] ? input.body : 'other';
    const day = VexLifeKit.dayString(VexLifeKit.parseDay(input.day));
    let endDay = String(input.endDay || '').trim();
    if (endDay) {
      endDay = VexLifeKit.dayString(VexLifeKit.parseDay(endDay));
      if (endDay < day) throw new Error('The end date is before the start date');
    }
    let url = String(input.url || '').trim();
    if (url) {
      let u;
      try { u = new URL(url); } catch (err) { throw new Error('The link is not an address', { cause: err }); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The link must be http or https');
      url = u.href;
    }
    const note = String(input.note || '').trim().slice(0, 400);
    const opt = (v, what) => { const s = String(v || '').trim(); if (!s) return ''; try { return VexLifeKit.dayString(VexLifeKit.parseDay(s)); } catch (err) { throw new Error(what + ': ' + err.message, { cause: err }); } };
    const feeDay = opt(input.feeDay, 'The fee cutoff day');
    const lateStart = opt(input.lateStart, 'The first late day');
    let lateEnd = opt(input.lateEnd, 'The last late day');
    if (lateEnd && !lateStart) throw new Error('Give the first late day too');
    if (lateStart && lateEnd && lateEnd < lateStart) throw new Error('The last late day is before the first');
    if (lateStart && !lateEnd) lateEnd = lateStart;
    const out = { id: input.id || VexLifeKit.uid('ex'), uid: input.uid ? String(input.uid).slice(0, 200) : '', kind, body, title, day, endDay, feeDay, lateStart, lateEnd, url, note, remindIds: Array.isArray(input.remindIds) ? input.remindIds : [] };
    // A date that came from a published calendar keeps where and when it was read, and that it still needs checking.
    if (input.verify === true && /^https:\/\//.test(String(input.source || '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(input.asOf || ''))) {
      out.verify = true; out.source = String(input.source).slice(0, 300); out.asOf = input.asOf;
    }
    return out;
  },

  // ---- pure: the fee cutoff and late window a description states ------------------------------------------------
  // -> { feeDay, lateStart, lateEnd } (any may be ''). Day first (10.02.2027) and ISO (2027-02-10) are read; nothing else is guessed.
  datesFromText(text) {
    const t = String(text || '');
    const D = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}[./]\\d{4})';
    const iso = (s) => { const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : s; };
    const out = { feeDay: '', lateStart: '', lateEnd: '' };
    const fee = new RegExp('(?:fee|payment|harç|ücret)[^\\d\\n]{0,40}' + D, 'i').exec(t);
    if (fee) out.feeDay = iso(fee[1]);
    const late = new RegExp('(?:late|geç)[^\\d\\n]{0,40}' + D + '(?:\\s*(?:-|–|to|until|ile|ila)\\s*' + D + ')?', 'i').exec(t);
    if (late) { out.lateStart = iso(late[1]); out.lateEnd = late[2] ? iso(late[2]) : ''; }
    for (const k of Object.keys(out)) { if (out[k]) { try { VexLifeKit.parseDay(out[k]); } catch { out[k] = ''; } } }
    return out;
  },

  // ---- pure: an .ics file -------------------------------------------------------------------
  // -> [{ uid, title, day, endDay, url, note }]. All-day (VALUE=DATE) and timed events; UTC times
  // are shown on the local day. Lines folded by the format are joined. Throws on text that is not a calendar.
  parseIcs(text) {
    const src = String(text || '');
    if (src.length > this.MAX_ICS_BYTES) throw new Error('That calendar file is too large');
    if (!/BEGIN:VCALENDAR/i.test(src)) throw new Error('That is not a calendar (.ics) file');
    const lines = src.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const unescape = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
    const toDay = (value, params) => {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
      if (!m) return '';
      if (m[7]) {
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
        return VexLifeKit.dayString(d.getTime());
      }
      return m[1] + '-' + m[2] + '-' + m[3] + (params ? '' : '');
    };
    const out = [];
    let ev = null;
    for (const line of lines) {
      if (/^BEGIN:VEVENT/i.test(line)) { ev = {}; continue; }
      if (/^END:VEVENT/i.test(line)) {
        if (ev && ev.title && ev.day) out.push(ev);
        ev = null;
        continue;
      }
      if (!ev) continue;
      const i = line.indexOf(':');
      if (i < 0) continue;
      const head = line.slice(0, i).split(';');
      const name = head[0].toUpperCase();
      const val = line.slice(i + 1);
      if (name === 'SUMMARY') ev.title = unescape(val).slice(0, 120);
      else if (name === 'UID') ev.uid = val.trim().slice(0, 200);
      else if (name === 'DTSTART') ev.day = toDay(val, head.slice(1));
      else if (name === 'DTEND') {
        let end = toDay(val, head.slice(1));
        // An all-day event ends the day AFTER its last day.
        if (end && /VALUE=DATE/i.test(head.slice(1).join(';')) && ev.day) end = VexLifeKit.dayString(VexLifeKit.addDays(VexLifeKit.parseDay(end), -1));
        ev.endDay = end && end > (ev.day || '') ? end : '';
      } else if (name === 'URL') ev.url = val.trim();
      else if (name === 'DESCRIPTION') ev.note = unescape(val).slice(0, 400);
    }
    for (const e of out) Object.assign(e, this.datesFromText(e.note));
    return out;
  },

  // ---- reminders ------------------------------------------------------------------------------
  // Reminders for the start (opens / the day) and the end (closes) of an item that is still ahead.
  // Returns { ids, failed: [text] }: a failure is reported, never hidden.
  async remindersFor(item, now = Date.now()) {
    const ids = [], failed = [];
    const targets = [[item.day, item.endDay ? 'opens' : 'is today']];
    if (item.endDay) targets.push([item.endDay, 'closes']);
    if (item.feeDay) targets.push([item.feeDay, 'normal fee ends']);
    if (item.lateStart) targets.push([item.lateStart, 'late window opens']);
    if (item.lateEnd && item.lateEnd !== item.lateStart) targets.push([item.lateEnd, 'late window closes']);
    for (const [day, what] of targets) {
      const dayMs = VexLifeKit.parseDay(day);
      const moments = [[0, 'today']];
      for (const n of this.prefs().lead) moments.push([n, 'in ' + n + ' day' + (n === 1 ? '' : 's')]);
      for (const [lead, words] of moments) {
        const when = VexLifeKit.addDays(dayMs, -lead);
        if (new Date(when).setHours(9, 0, 0, 0) <= now) continue;      // that morning has passed: nothing to set
        try {
          const r = await VexLifeKit.remind(item.title + ' ' + what + ' ' + words + '. Check the official site (' + this.BODIES[item.body].label + ').', when, { url: item.url || this.BODIES[item.body].site || undefined, now });
          if (r.id) ids.push(r.id);
        } catch (err) { failed.push(item.title + ' (' + day + '): ' + err.message); }
      }
    }
    return { ids, failed };
  },

  async add(input, { remind = true, now = Date.now() } = {}) {
    if (!this.enabled()) throw new Error('The exam calendar is switched off');
    const items = this.all();
    if (items.length >= this.MAX_ITEMS) throw new Error('The calendar holds ' + this.MAX_ITEMS + ' items; delete some');
    const item = this.clean(input);
    if (item.uid && items.some(i => i.uid === item.uid)) throw new Error('"' + item.title + '" is already in the calendar');
    let failed = [];
    if (remind) { const r = await this.remindersFor(item, now); item.remindIds = r.ids; failed = r.failed; }
    items.push(item);
    this._save(items);
    return { item, failed };
  },
  async remove(id) {
    const item = this.all().find(i => i.id === id);
    if (!item) return;
    this._save(this.all().filter(i => i.id !== id));
    const errs = [];
    for (const rid of item.remindIds || []) { try { await VexLifeKit.unremind(rid); } catch (err) { errs.push(err.message); } }
    if (errs.length) throw new Error('Removed, but ' + errs.length + ' reminder' + (errs.length === 1 ? '' : 's') + ' could not be deleted: ' + errs[0]);
  },

  // ---- importing a file the person chose ---------------------------------------------------------
  async importIcs(text, bodyKey = 'other') {
    const events = this.parseIcs(text).slice(0, this.MAX_IMPORT);
    const have = new Set(this.all().map(i => i.uid).filter(Boolean));
    const fresh = events.filter(e => !e.uid || !have.has(e.uid));
    if (!fresh.length) return { added: 0, skipped: events.length, failed: [] };
    const ok = await window.vexConfirm({ title: 'Import ' + fresh.length + ' dates?', message: 'They come from the file you chose, and are not checked against any official source. Reminders are set for the ones still ahead.', okLabel: 'Import' });
    if (!ok) return { added: 0, skipped: events.length, failed: [] };
    let added = 0;
    const failed = [];
    for (const e of fresh) {
      try { const r = await this.add({ ...e, kind: 'other', body: bodyKey }); added++; failed.push(...r.failed); }
      catch (err) { failed.push(e.title + ': ' + err.message); }
    }
    return { added, skipped: events.length - fresh.length, failed };
  },
  // The dates in exam-calendar-data.js: only after the person confirms, only the ones still ahead,
  // none twice (by uid). -> { added, skipped, failed }.
  async importOfficial(data = typeof ExamCalendarData !== 'undefined' ? ExamCalendarData : null, now = Date.now()) {
    if (!data) throw new Error('The official dates are not loaded');
    const today = VexLifeKit.dayString(now);
    const have = new Set(this.all().map(i => i.uid).filter(Boolean));
    const ahead = data.ROWS.filter(r => (r.endDay || r.day) >= today);
    const fresh = ahead.filter(r => !have.has(r.uid));
    if (!fresh.length) return { added: 0, skipped: data.ROWS.length, failed: [] };
    const ok = await window.vexConfirm({
      title: 'Add ' + fresh.length + ' dates from OSYM?',
      message: 'Typed from OSYM\'s published calendar (' + data.SOURCE + ') as read on ' + data.READ_ON + '. OSYM says dates can change, so each is marked "verify on the official site". Reminders are set for the ones still ahead. Not listed because no official date exists yet: ' + data.PENDING.join('; ') + '.',
      okLabel: 'Add them',
    });
    if (!ok) return { added: 0, skipped: data.ROWS.length, failed: [] };
    let added = 0;
    const failed = [];
    for (const r of fresh) {
      try {
        const res = await this.add({ ...r, body: data.BODY, url: data.SOURCE, source: data.SOURCE, asOf: data.READ_ON, verify: true }, { now });
        added++; failed.push(...res.failed);
      } catch (err) { failed.push(r.title + ': ' + err.message); }
    }
    return { added, skipped: data.ROWS.length - fresh.length, failed };
  },
  pickFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.ics,text/calendar';
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) { resolve(null); return; }
        if (f.size > this.MAX_ICS_BYTES) { reject(new Error('That calendar file is too large')); return; }
        f.text().then(resolve, reject);
      });
      input.click();
    });
  },

  // ---- the window ---------------------------------------------------------------------------------------
  async edit() {
    const v = await VexLifeKit.form({
      id: 'vex-exam-form', title: 'Add a date', sub: 'Typed in by you. Check it on the official site.',
      fields: [
        { name: 'title', label: 'What', required: true, placeholder: 'YKS application closes' },
        { name: 'kind', label: 'Kind', type: 'select', options: this.KINDS, value: 'exam' },
        { name: 'body', label: 'Body', type: 'select', options: Object.entries(this.BODIES).map(([k, b]) => [k, b.label]), value: 'osym' },
        { name: 'day', label: 'Date (year-month-day)', required: true, placeholder: '2027-02-10' },
        { name: 'endDay', label: 'Last day, if it is a window', placeholder: 'optional' },
        { name: 'feeDay', label: 'Last day of the normal fee', placeholder: 'optional' },
        { name: 'lateStart', label: 'Late window starts', placeholder: 'optional' },
        { name: 'lateEnd', label: 'Late window ends', placeholder: 'optional' },
        { name: 'url', label: 'Link', placeholder: 'optional' },
        { name: 'note', label: 'Note', type: 'textarea' },
      ],
      validate: (vals) => this.clean(vals),
    });
    return v ? this.add(v) : null;
  },
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('exam-calendar');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-exam-dates', title: 'Exam and registration dates', sub: 'Your own dates. Vex does not check them: confirm on the official site.' });
    const draw = () => {
      body.textContent = '';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap';
      const report = (r) => { if (r && r.failed && r.failed.length) window.showToast?.(r.failed.length + ' reminder(s) could not be set: ' + r.failed[0], 'error'); };
      bar.append(
        VexSettingsGroups.button('Add a date', async () => { try { report(await this.edit()); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true }),
        VexSettingsGroups.button('Add the OSYM dates (read ' + (typeof ExamCalendarData !== 'undefined' ? ExamCalendarData.READ_ON : '?') + ')', async () => {
          try { const r = await this.importOfficial(); window.showToast?.(r.added + ' added' + (r.skipped ? ', ' + r.skipped + ' already there or past' : '')); report(r); draw(); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }),
        VexSettingsGroups.button('Import an .ics file', async () => {
          try { const t = await this.pickFile(); if (t == null) return; const r = await this.importIcs(t); window.showToast?.(r.added + ' added' + (r.skipped ? ', ' + r.skipped + ' already there' : '')); report(r); draw(); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        }));
      body.appendChild(bar);
      const items = this.sorted();
      if (!items.length) body.appendChild(VexSettingsGroups.note('No dates yet.'));
      for (const i of items) {
        const b = this.BODIES[i.body];
        const lines = [
          i.title + ' (' + (this.KINDS.find(k => k[0] === i.kind) || [0, 'Other'])[1] + ', ' + b.label + ')',
          i.day + (i.endDay ? ' to ' + i.endDay : '') + ': ' + VexLifeKit.words(i.left) + (i.left < 0 ? ' (passed)' : ''),
          ...(i.feeDay ? ['Normal fee until ' + i.feeDay] : []),
          ...(i.lateStart ? ['Late window ' + i.lateStart + (i.lateEnd && i.lateEnd !== i.lateStart ? ' to ' + i.lateEnd : '')] : []),
          'Verify on ' + (b.site ? b.site.replace(/^https:\/\/(www\.)?|\/$/g, '') : 'the official site') + '. Not checked by Vex.',
        ];
        if (i.source) lines.push('Source: ' + i.source + ' (read ' + i.asOf + '). Dates can change: verify on the official site.');
        if (i.note) lines.push(i.note);
        const buttons = [];
        const link = i.url || b.site;
        if (link) buttons.push(VexSettingsGroups.button('Official page', () => { try { TabManager.createTab(link, true); } catch (err) { window.showToast?.(err.message, 'error'); } }));
        buttons.push(VexSettingsGroups.button('Delete', async () => {
          if (!await window.vexConfirm({ title: 'Delete this date?', message: i.title, okLabel: 'Delete', danger: true })) return;
          try { await this.remove(i.id); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }, { danger: true }));
        body.appendChild(VexLifeKit.row(lines, buttons));
      }
    };
    draw();
  },
  snapshot(now = Date.now()) { return this.sorted(now).filter(i => i.left >= 0).slice(0, 5); },
};

if (typeof window !== 'undefined') {
  window.ExamCalendar = ExamCalendar;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'exam-calendar', title: 'Exam and registration dates', keywords: 'exam osym meb yok yks registration application deadline calendar ics reminder', before: 'about',
      build: (el) => {
        el.appendChild(VexSettingsGroups.note('Dates you type in or import from an .ics file you choose, with reminders. Vex never fetches a government site or signs in anywhere.'));
        el.appendChild(VexSettingsGroups.button('Open the calendar', () => ExamCalendar.open(), { primary: true }));
      },
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'exam-calendar', label: 'Exam and registration dates', hint: 'Your dates with days left and reminders', icon: 'calendar', action: () => { if (ExamCalendar.enabled()) ExamCalendar.open(); else window.showToast?.('The exam calendar is switched off'); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ExamCalendar };
