// === Deadline and commitment finder ===========================================
//
// "Submit by Friday", "registration closes 3 Nov", "free until Thursday",
// "I'll send it tomorrow": dates that live inside text and are forgotten there.
// Ctrl+K › Find deadlines reads the page in front, your recent notes, or the
// subjects of the mail accounts you chose for the Morning Brief, and lists
// what looks like a deadline, each with the SENTENCE it came from and a
// proposed reminder time you can change. Nothing becomes a reminder until you
// press Add on that row.
//
// Rules, not a model: a fixed set of patterns (below), so it runs offline,
// instantly and the same way every time, and a wrong guess shows its source
// sentence. No AI call is made anywhere in this file and nothing is sent off
// the computer. (A local-model second pass is the next step; it would go
// through AIRouter's local route only, never the cloud.)
//
//   VexDeadlines.extract(text, now)     pure: [{ kind, phrase, sentence, dueAt, remindAt }]
//   VexDeadlines.remindAt(dueAt, now)   pure: when to remind, or null if too late
//
// Dates read as the local calendar. "Friday" is the next Friday (today if it is
// Friday); a month and day already past this year mean next year; the due
// moment is 17:00 on that day and the reminder is 09:00 that morning.

const VexDeadlines = {
  PREF: 'vex.deadlines.enabled',   // 'off' hides the command
  MAX_FOUND: 20,
  MAX_TEXT: 60000,
  DUE_HOUR: 17,
  REMIND_HOUR: 9,
  WEEKDAYS: { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 },
  MONTHS: { january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11 },

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- patterns ---------------------------------------------------------------------
  _re() {
    if (this._cache) return this._cache;
    const wd = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)';
    const mo = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)';
    const trig = '(?:by|before|until|till|due(?:\\s+(?:on|by))?|deadline(?:\\s+(?:is|of|on))?|closes?(?:\\s+on)?|closing(?:\\s+on)?|ends?(?:\\s+on)?|expires?(?:\\s+on)?|submit(?:\\s+by)?|no\\s+later\\s+than|free\\s+until|valid\\s+until|open\\s+until|last\\s+day(?:\\s+is)?)';
    const day = '(\\d{1,2})(?:st|nd|rd|th)?';
    this._cache = {
      commit: new RegExp('\\b(?:i[\'\u2019]ll|i\\s+will|i[\'\u2019]m\\s+going\\s+to|i\\s+can)\\s+[^.!?\\n]{2,90}?\\s+(tomorrow|tonight|today|this\\s+evening|this\\s+afternoon|next\\s+week|(?:on|by)\\s+' + wd + ')\\b', 'i'),
      weekday: new RegExp('\\b' + trig + '\\s+(?:the\\s+)?(next\\s+)?' + wd + '\\b', 'i'),
      relative: new RegExp('\\b' + trig + '\\s+(tomorrow|today|tonight|end\\s+of\\s+(?:the\\s+)?day|eod|end\\s+of\\s+(?:the\\s+)?week|eow)\\b', 'i'),
      monthDay: new RegExp('\\b' + trig + '\\s+(?:on\\s+)?(?:(?:the\\s+)?' + day + '\\s+(?:of\\s+)?' + mo + '|' + mo + '\\s+' + day + ')(?:,?\\s+(\\d{4}))?\\b', 'i'),
      iso: new RegExp('\\b' + trig + '\\s+(?:on\\s+)?(\\d{4})-(\\d{2})-(\\d{2})\\b', 'i'),
      within: /\b(?:due\s+in|within|expires\s+in|closes\s+in|ends\s+in)\s+(\d{1,2})\s+(day|days|week|weeks|hour|hours)\b/i,
    };
    return this._cache;
  },

  _dayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d; },
  _at(date, hour) { const d = new Date(date); d.setHours(hour, 0, 0, 0); return d.getTime(); },
  _nextWeekday(now, wd, forceNext) {
    const d = this._dayStart(now);
    let add = (wd - d.getDay() + 7) % 7;
    if (forceNext && add === 0) add = 7;
    d.setDate(d.getDate() + add);
    return d;
  },

  // When to remind about a due moment, or null when that is already too late.
  remindAt(dueAt, now = Date.now()) {
    if (!Number.isFinite(dueAt) || dueAt <= now) return null;
    const dueDay = this._dayStart(dueAt).getTime();
    const today = this._dayStart(now).getTime();
    if (dueDay > today) return this._at(dueDay, this.REMIND_HOUR);
    const soon = Math.max(now + 10 * 60000, dueAt - 3600000);
    return soon < dueAt ? Math.ceil(soon / 60000) * 60000 : null;
  },

  _sentences(text) {
    return String(text || '').split(/(?<=[.!?])\s+|\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  },
  _clip(s, n = 200) { return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; },

  // The due moment a phrase means, or null.
  _due(kind, m, now) {
    const re = this._re();
    const at17 = (d) => this._at(d, this.DUE_HOUR);
    if (kind === 'weekday') return at17(this._nextWeekday(now, this.WEEKDAYS[m[2].toLowerCase()], !!m[1]));
    if (kind === 'relative') {
      const w = m[1].toLowerCase().replace(/\s+/g, ' ');
      const t = this._dayStart(now);
      if (w === 'tomorrow') { t.setDate(t.getDate() + 1); return at17(t); }
      if (w === 'tonight') return this._at(t, 21);
      if (w === 'today' || w === 'eod' || w.startsWith('end of the day') || w === 'end of day') return at17(t);
      return at17(this._nextWeekday(now, 5, false));          // end of (the) week / eow: Friday
    }
    if (kind === 'monthDay') {
      const dd = Number(m[1] || m[4]); const mm = this.MONTHS[(m[2] || m[3]).toLowerCase()];
      let y = m[5] ? Number(m[5]) : new Date(now).getFullYear();
      let d = new Date(y, mm, dd);
      if (d.getMonth() !== mm || d.getDate() !== dd) return null;           // 31 Feb
      if (!m[5] && at17(d) <= now) d = new Date(y + 1, mm, dd);
      return at17(d);
    }
    if (kind === 'iso') {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? at17(d) : null;
    }
    if (kind === 'within') {
      const n = Number(m[1]); const u = m[2].toLowerCase();
      return u.startsWith('hour') ? now + n * 3600000 : at17(new Date(this._dayStart(now).getTime() + n * (u.startsWith('week') ? 7 : 1) * 86400000));
    }
    if (kind === 'commit') {
      const w = m[1].toLowerCase().replace(/\s+/g, ' ');
      const t = this._dayStart(now);
      if (w === 'tomorrow') { t.setDate(t.getDate() + 1); return at17(t); }
      if (w === 'today' || w === 'this afternoon') return at17(t);
      if (w === 'tonight' || w === 'this evening') return this._at(t, 21);
      if (w === 'next week') return at17(this._nextWeekday(now, 1, true));
      const day = /(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)$/i.exec(w);
      return day ? at17(this._nextWeekday(now, this.WEEKDAYS[day[1].toLowerCase()], false)) : null;
    }
    return null;
  },

  // Turkish deadlines ("son tarih 15 Kasım", "en geç cuma", "teslim: yarın"), read with the Turkish
  // day parser of js/vex-tr.js. Only a trigger word
  // followed by a day counts; a date that is not real is no finding, like 31 Feb in English.
  _turkish(sentence, now) {
    if (typeof VexTr === 'undefined') return null;
    const folded = VexTr.fold(sentence).replace(/\s+/g, ' ');
    const m = /\b(?:son tarih(?:i)?|son gun(?:u)?|son basvuru(?: tarihi)?|en gec|teslim(?: tarihi)?)\b[:\s-]*(?:(?:tarihi|gunu)\s+)?(.+)$/.exec(folded);
    if (!m) return null;
    let day;
    try { day = VexTr.parseDay(m[1].replace(/\s*[.!?,;:]+(?=\s|$)/g, ' ').trim(), now); }
    catch (err) { if (/is not a real date/.test(err.message)) return null; throw err; }
    if (!day) return this._turkishPhrase(sentence, m, now);
    // A clock after the day ("yarın akşam 8'de") is the due moment itself; VexTr.parseDay stops at the day.
    if (day.rest) { const timed = this._turkishPhrase(sentence, m, now, true); if (timed) return timed; }
    return { dueAt: this._at(day.date, this.DUE_HOUR), phrase: m[0].trim() };
  },

  // What VexTr.parseDay does not read, after a Turkish trigger word: "haftaya Salı", "yarın akşam
  // 8'de", "15.11.2026 saat 17:00", "2 gün içinde". These are the phrases of VexTrParse (js/tr-parse.js),
  // which asks VexTr for the plain days and clocks, so both parsers give one answer where they overlap.
  // A date with no clock means the due hour of an English deadline (17:00).
  _turkishPhrase(sentence, m, now, timedOnly = false) {
    if (typeof VexTrParse === 'undefined' || !VexTrParse.enabled()) return null;
    const found = VexTrParse.extractDates(sentence, now)[0];
    if (!found || (timedOnly && !found.hasTime)) return null;
    const dueAt = found.hasTime ? found.at : this._at(new Date(found.at), this.DUE_HOUR);
    return { dueAt, phrase: m[0].trim() };
  },

  extract(text, now = Date.now()) {
    const re = this._re();
    const out = [];
    const seen = new Set();
    const body = String(text == null ? '' : text).slice(0, this.MAX_TEXT);
    // Commitments first: they are the more specific reading of a sentence.
    const order = ['commit', 'weekday', 'relative', 'monthDay', 'iso', 'within'];
    for (const sentence of this._sentences(body)) {
      for (const kind of order) {
        const m = re[kind].exec(sentence);
        if (!m) continue;
        const dueAt = this._due(kind, m, now);
        if (dueAt == null) continue;
        const key = sentence + '|' + dueAt;
        if (seen.has(key)) continue;
        const remind = this.remindAt(dueAt, now);
        if (remind == null) continue;
        seen.add(key);
        out.push({ kind: kind === 'commit' ? 'commitment' : 'deadline', phrase: m[0].replace(/\s+/g, ' '), sentence: this._clip(sentence), dueAt, remindAt: remind });
        break;                                    // one finding per sentence
      }
      if (out.length < this.MAX_FOUND && !out.some(o => o.sentence === this._clip(sentence))) {
        const tr = this._turkish(sentence, now);
        const remind = tr ? this.remindAt(tr.dueAt, now) : null;
        if (tr && remind != null) out.push({ kind: 'deadline', phrase: tr.phrase, sentence: this._clip(sentence), dueAt: tr.dueAt, remindAt: remind });
      }
      if (out.length >= this.MAX_FOUND) break;
    }
    return out;
  },

  // ---- where the text comes from ---------------------------------------------------------
  async fromPage() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    const tab = TabManager.getActiveTab?.();
    if (!wv || !tab) throw new Error('There is no page in front');
    if (window.VexTabPolicy && !window.VexTabPolicy.canRestore(tab)) throw new Error('Finding deadlines is off in private and Tor tabs');
    const text = await Promise.race([
      wv.executeJavaScript('(document.body ? document.body.innerText : "").slice(0, ' + this.MAX_TEXT + ')'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('The page did not answer in time')), 2500)),
    ]);
    let url = tab.url;
    try { url = wv.getURL() || url; } catch (err) { window.VexProblems?.note('Find deadlines', 'Could not ask the page for its address; using the tab record', err); }
    return { text: String(text || ''), url: /^https?:\/\//i.test(url) ? url : '', label: tab.title || url };
  },
  fromNotes() {
    const raw = localStorage.getItem('vex.notes');
    let notes = [];
    if (raw != null) { try { notes = JSON.parse(raw); } catch (err) { throw new Error('Your notes could not be read: ' + err.message); } }
    const recent = (Array.isArray(notes) ? notes : []).filter(n => n && typeof n.content === 'string').sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0)).slice(0, 30);
    return { text: recent.map(n => (n.title ? n.title + '. ' : '') + n.content).join('\n'), url: '', label: 'your recent notes' };
  },
  async fromMail() {
    if (!window.vex || !window.vex.mail) throw new Error('Mail is not available');
    const ids = typeof VexBrief !== 'undefined' ? VexBrief.prefs().mailAccounts : [];
    if (!ids.length) throw new Error('Choose a mail account in Settings › Morning Brief first. Only the subject lines are read.');
    const call = async (p) => { const r = await p; if (!r || !r.ok) throw new Error((r && r.error) || 'Mail did not answer'); return r.value; };
    const lines = [];
    for (const id of ids) {
      const inbox = await call(window.vex.mail.inbox(id, 50));
      for (const m of inbox.messages || []) if (m && m.subject) lines.push(String(m.subject) + '.');
    }
    return { text: lines.join('\n'), url: '', label: 'mail subjects' };
  },

  // ---- the list ------------------------------------------------------------------------------
  async open(sourceName = 'page') {
    if (!this.enabled()) { window.showToast?.('Finding deadlines is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('deadline-extractor');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-deadlines', title: 'Deadlines found', sub: 'Found by fixed patterns, not guessed by a model. Check the sentence, adjust the time, press Add. Nothing is added by itself.' });
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    body.append(bar, list);
    const load = async (name) => {
      list.textContent = '';
      let src, found;
      try {
        src = name === 'notes' ? this.fromNotes() : name === 'mail' ? await this.fromMail() : await this.fromPage();
        found = this.extract(src.text);
      } catch (err) { list.appendChild(VexSettingsGroups.note('Could not read ' + name + ': ' + err.message)); return; }
      let existing = [];
      try { existing = (await window.vex.reminders.list()).filter(r => !r.firedAt).map(r => r.message); } catch (err) { list.appendChild(VexSettingsGroups.note('Could not check your existing reminders: ' + err.message)); }
      if (!found.length) list.appendChild(VexSettingsGroups.note('No deadlines found in ' + src.label + '.'));
      for (const f of found) list.appendChild(this._row(f, src, existing));
    };
    for (const [name, label] of [['page', 'This page'], ['notes', 'My notes'], ['mail', 'Mail subjects']]) bar.appendChild(VexSettingsGroups.button(label, () => load(name), { label: 'Look in ' + label }));
    await load(sourceName);
  },

  _message(f) { return ('Due: ' + f.sentence).slice(0, 140); },
  _toLocalInput(ms) {
    const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  _row(f, src, existing) {
    const row = document.createElement('div');
    row.className = 'vexsr-rule';
    row.style.cssText = 'flex-wrap:wrap;align-items:flex-start';
    const text = document.createElement('div');
    text.className = 'vexsr-host';
    text.style.cssText = 'flex:1 1 260px;word-break:normal';
    text.textContent = f.sentence;
    const meta = document.createElement('div');
    meta.className = 'vexsr-mode';
    meta.style.whiteSpace = 'normal';
    meta.textContent = (f.kind === 'commitment' ? 'You said: ' : 'Found: ') + f.phrase;
    text.appendChild(meta);
    const when = document.createElement('input');
    when.type = 'datetime-local';
    when.value = this._toLocalInput(f.remindAt);
    when.setAttribute('aria-label', 'Remind me at');
    const add = VexSettingsGroups.button('Add reminder', async () => {
      const at = new Date(when.value).getTime();
      if (!Number.isFinite(at) || at <= Date.now()) { window.showToast?.('Pick a time in the future', 'error'); return; }
      try {
        await window.vex.reminders.create(this._message(f), typeof VexHolidays !== 'undefined' ? VexHolidays.reminderAt(at, f.phrase) : at, src.url ? { url: src.url } : undefined);
        add.disabled = true; add.textContent = 'Added'; no.disabled = true;
      } catch (err) { window.showToast?.('Could not add the reminder: ' + err.message, 'error'); }
    }, { primary: true, label: 'Add a reminder for: ' + f.phrase });
    const no = VexSettingsGroups.button('Skip', () => row.remove(), { label: 'Skip: ' + f.phrase });
    if (existing.includes(this._message(f))) { add.disabled = true; add.textContent = 'Already set'; }
    row.append(text, when, add, no);
    // Confirmed into the ledgers (js/follow-ups.js, js/deadline-ledger.js), one press each, only when those exist and are on.
    const ledgerBtn = (label, ready, run) => {
      if (!ready) return;
      row.appendChild(VexSettingsGroups.button(label, () => {
        try { run(); window.showToast?.('Added', 'success'); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      }, { label: label + ': ' + f.phrase }));
    };
    if (f.kind === 'commitment') {
      ledgerBtn('I owe this', typeof VexFollowUps !== 'undefined' && VexFollowUps.enabled(), () => VexFollowUps.add({ dir: 'owe', who: '', what: f.sentence.slice(0, 160), channel: 'other', due: f.dueAt || 0, url: /^https?:/i.test(src.url || '') ? src.url : '' }));
    } else {
      ledgerBtn('Add to deadlines', typeof VexDeadlineLedger !== 'undefined' && VexDeadlineLedger.enabled(), () => VexDeadlineLedger.addFromFound(f, { url: /^https?:/i.test(src.url || '') ? src.url : '' }));
    }
    return row;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Finds phrases like "by Friday", "registration closes 3 Nov" and "I\'ll send it tomorrow" in the page in front, your notes or your mail subjects, and offers a reminder for each. You confirm every one. Fixed patterns, no AI, nothing sent.'));
    el.appendChild(VexSettingsGroups.button('Find deadlines on this page', () => this.open('page'), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexDeadlines = VexDeadlines;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'deadline-extractor', title: 'Find deadlines', keywords: 'deadline due date commitment reminder extract by friday closes find', before: 'about', build: (el) => VexDeadlines.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'find-deadlines', label: 'Find deadlines', hint: 'Dates and promises in this page, your notes or mail subjects, as reminders you confirm', icon: 'flag', action: () => VexDeadlines.open('page') });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDeadlines };
