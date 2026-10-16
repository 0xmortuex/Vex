// === Snooze anything =========================================================
//
// Tabs already had a snooze (js/tab-snooze.js). A story, a mail, a reminder or
// a saved page wanted the same thing: "not now, show me this tomorrow
// morning". One small list holds all of them, and the Morning Brief lists what
// has come due in its own "Snoozed, back now" section.
//
// What a snooze does, by kind:
//   tab       the tab is closed and TabSnooze brings it back (that stays the
//             one owner of tabs); this list only remembers it for the brief
//   story     the link is kept; it is shown again when due
//   page      same, for any page
//   mail      the message is hidden from the triage list until it is due
//             (js/mail-triage-actions.js asks isPending)
//   reminder  the reminder is re-created at the new time and the old one is
//             deleted (the reminder service itself fires it)
//
// Nothing here leaves this PC. The list is not one of the synced stores.
const VexSnooze = {
  KEY: 'vex.snoozeAnything',
  MAX: 300,
  KINDS: ['tab', 'story', 'page', 'mail', 'reminder'],
  // A due item stays in the brief for this long, then drops off by itself.
  KEEP_AFTER_DUE_MS: 2 * 24 * 3600 * 1000,

  // What the pickers offer. `text` goes through parseWhen like typed text.
  PRESETS: [
    { key: 'hour', label: 'In an hour', text: 'in 1 hour' },
    { key: 'evening', label: 'This evening', text: 'this evening' },
    { key: 'tomorrow', label: 'Tomorrow morning', text: 'tomorrow morning' },
    { key: 'weekend', label: 'This weekend', text: 'weekend' },
    { key: 'monday', label: 'Next week', text: 'next week' },
  ],

  _DAYS: { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 },
  _NUM: { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 },

  _at(base, hour, minute = 0) { const d = new Date(base); d.setHours(hour, minute, 0, 0); return d; },
  // The next time the clock reads that hour, today if it has not passed.
  _nextClock(now, hour, minute = 0) {
    const d = this._at(now, hour, minute);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d;
  },
  _nextWeekday(now, weekday, hour) {
    const d = this._at(now, hour);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== weekday);
    return d;
  },

  // "tomorrow morning", "in 2 hours", "monday", "tonight", "tomorrow at 8am",
  // "next week", "weekend". → { at, label } or null when it is not understood.
  // Deliberately small: a snooze is a rough intention, not an appointment.
  parseWhen(text, now = Date.now()) {
    const s = String(text == null ? '' : text).toLowerCase().replace(/[.,!]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const fmt = (d) => d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const done = (d) => (d && d.getTime() > now ? { at: d.getTime(), label: fmt(d) } : null);

    let m = /^in (\d+|an?|one|two|three|four|five|six|seven|ten) ?(min|mins|minute|minutes|hour|hours|hr|hrs|day|days|week|weeks)$/.exec(s);
    if (m) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : this._NUM[m[1]];
      const unit = m[2].startsWith('min') ? 60000 : m[2].startsWith('h') ? 3600000 : m[2].startsWith('d') ? 86400000 : 7 * 86400000;
      if (!(n > 0) || n > 400) return null;
      return done(new Date(now + n * unit));
    }

    // Turkish: "yarın sabah", "yarın 14:30", "bu akşam", "hafta sonu", "haftaya", "cuma 17:00",
    // "15 Mart" (js/vex-tr.js), before the clock below would take "14:30" for today.
    // Text that is not Turkish is not understood here, as before.
    const tr = globalThis.VexTr || (typeof require === 'function' ? require('./vex-tr.js').VexTr : null);
    if (tr) {
      const f = tr.fold(s);
      if (/^(bu )?aksam$/.test(f)) return done(this._nextClock(now, 19));
      if (/^(bu )?(ogleden sonra)$/.test(f)) return done(this._nextClock(now, 14));
      if (/^hafta sonu$/.test(f)) return done(this._nextWeekday(now, 6, 10));
      if (/^haftaya$/.test(f)) return done(this._nextWeekday(now, 1, 9));
      let when = null;
      // An impossible date ("31 Şubat") is not understood: null, like any text that is not a time.
      try { when = tr.parseWhen(String(text), new Date(now), 9); }
      catch { /* vex-allow-empty-catch: the text named a day that does not exist, so it is not understood */ return null; }
      if (when) return done(when);
    }

    // An explicit clock time: "at 5pm", "8:30", "tomorrow at 8am".
    const clock = /(?:^|\s)(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)?$/.exec(s);
    const hasDayWord = /\b(tomorrow|today|tonight)\b/.test(s);
    if (clock && (/\bat\b/.test(s) || clock[3] || clock[2] || hasDayWord) && !/^in /.test(s)) {
      let h = Number(clock[1]);
      const min = clock[2] ? Number(clock[2]) : 0;
      if (clock[3] === 'pm' && h < 12) h += 12;
      if (clock[3] === 'am' && h === 12) h = 0;
      if (h < 24 && min < 60) {
        if (/\btomorrow\b/.test(s)) { const d = this._at(now, h, min); d.setDate(d.getDate() + 1); return done(d); }
        return done(this._nextClock(now, h, min));
      }
    }

    const partHour = /morning/.test(s) ? 9 : /afternoon/.test(s) ? 14 : /(evening|tonight)/.test(s) ? 19 : null;
    if (/\btomorrow\b/.test(s)) { const d = this._at(now, partHour == null ? 9 : partHour); d.setDate(d.getDate() + 1); return done(d); }
    if (/\b(tonight|this evening)\b/.test(s)) return done(this._nextClock(now, 19));
    if (/\bthis afternoon\b/.test(s)) return done(this._nextClock(now, 14));
    if (/\b(this|in the) morning\b/.test(s) || s === 'morning') return done(this._nextClock(now, 9));
    if (/\bnext week\b/.test(s)) return done(this._nextWeekday(now, 1, 9));
    if (/\bweekend\b/.test(s)) {
      const sat = this._nextWeekday(now, 6, 10);
      // Already the weekend: the next one, not "now".
      return done(sat);
    }
    m = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(s);
    if (m) return done(this._nextWeekday(now, this._DAYS[m[1]], partHour == null ? 9 : partHour));

    return null;
  },

  // ---- the list -----------------------------------------------------------
  _read() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; }
    return Array.isArray(raw) ? raw.filter(e => e && typeof e.id === 'string' && Number.isFinite(e.at)) : [];
  },
  _write(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.MAX))); return true; }
    catch (err) { window.VexProblems?.note('Snooze', 'Could not save the snoozed items', err); return false; }
  },
  list() { return this._read(); },

  _id() { return 'sz_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },

  // Add one. `when` is typed text, a preset key, or a timestamp. Throws when it
  // cannot be saved or the time is not understood: a snooze that silently did
  // nothing would lose the thing it was meant to bring back.
  add(kind, { title, url = '', ref = '', native = false, note = '' } = {}, when, now = Date.now()) {
    if (!this.KINDS.includes(kind)) throw new Error('Cannot snooze a ' + kind);
    const at = this.resolveAt(when, now);
    if (!at) throw new Error('Say when to bring it back, like "tomorrow morning" or "in 2 hours"');
    const entry = {
      id: this._id(), kind, title: String(title || url || kind).slice(0, 200),
      url: /^https?:\/\//i.test(String(url)) ? String(url).slice(0, 2048) : '',
      ref: String(ref || '').slice(0, 300), native: !!native, note: String(note || '').slice(0, 200),
      at, createdAt: now, told: false,
    };
    const list = this._read().filter(e => !(entry.ref && e.kind === kind && e.ref === entry.ref));
    list.unshift(entry);
    if (!this._write(list)) throw new Error('The snooze could not be saved');
    return entry;
  },

  resolveAt(when, now = Date.now()) {
    if (typeof when === 'number' && Number.isFinite(when)) return when > now ? when : 0;
    const preset = this.PRESETS.find(p => p.key === when);
    const parsed = this.parseWhen(preset ? preset.text : when, now);
    return parsed ? parsed.at : 0;
  },

  remove(id) { this._write(this._read().filter(e => e.id !== id)); },
  removeRef(kind, ref) { this._write(this._read().filter(e => !(e.kind === kind && e.ref === ref))); },

  // Is this thing snoozed and not yet due? (Mail triage hides it meanwhile.)
  isPending(kind, ref, now = Date.now()) {
    return this._read().some(e => e.kind === kind && e.ref === ref && e.at > now);
  },

  // Due items, newest due first. Items older than KEEP_AFTER_DUE_MS are dropped
  // from the store here so the list cannot grow without bound.
  due(now = Date.now()) {
    const all = this._read();
    const keep = all.filter(e => e.at > now - this.KEEP_AFTER_DUE_MS);
    if (keep.length !== all.length) this._write(keep);
    return keep.filter(e => e.at <= now).sort((a, b) => b.at - a.at);
  },
  upcoming(now = Date.now()) { return this._read().filter(e => e.at > now).sort((a, b) => a.at - b.at); },

  // ---- per kind -----------------------------------------------------------
  // The tab is closed by TabSnooze (which refuses private tabs, and keeps
  // bringing it back itself); this only records it for the brief.
  snoozeTab(tabId, when, now = Date.now()) {
    if (typeof TabSnooze === 'undefined') throw new Error('Tab snooze is not loaded');
    const at = this.resolveAt(when, now);
    if (!at) throw new Error('Say when to bring the tab back');
    const e = TabSnooze.snooze(tabId, at);
    return this.add('tab', { title: e.title, url: e.url, ref: e.id, native: true }, at, now);
  },
  snoozeLink(kind, { title, url }, when, now = Date.now()) {
    if (kind !== 'story' && kind !== 'page') throw new Error('Use snoozeLink for a story or a page');
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Only a web link can be snoozed');
    return this.add(kind, { title, url, ref: url }, when, now);
  },
  // The new reminder is made first: if that fails the old one is still there.
  async snoozeReminder({ id, message }, when, now = Date.now()) {
    const api = window.vex && window.vex.reminders;
    if (!api || typeof api.create !== 'function' || typeof api.delete !== 'function') throw new Error('Reminders are not available here');
    const at = this.resolveAt(when, now);
    if (!at) throw new Error('Say when to remind you again');
    const made = await api.create(String(message || 'Reminder'), at);
    if (made && made.ok === false) throw new Error(made.error || 'The reminder could not be moved');
    if (id) await api.delete(id);
    return this.add('reminder', { title: message, ref: 'r:' + (id || at), native: true }, at, now);
  },

  // Past-due items: tell once, then leave them for the brief.
  checkDue(now = Date.now()) {
    const list = this._read();
    const fresh = list.filter(e => e.at <= now && !e.told && !e.native);
    if (!fresh.length) return [];
    this._write(list.map(e => (fresh.includes(e) ? { ...e, told: true } : e)));
    if ((typeof VexAttention === 'undefined' || VexAttention.gate('snooze-due', fresh.map(e => e.id).join(',')))) window.showToast?.(fresh.length === 1 ? 'Back as you asked: ' + fresh[0].title : fresh.length + ' snoozed items are back');
    try { document.dispatchEvent(new CustomEvent('vex:snooze-due', { detail: { count: fresh.length } })); } catch { /* no document */ }
    // The "Why did that happen?" list (js/vex-ledger.js); Undo snoozes them again for an hour.
    if (typeof VexLedger !== 'undefined') {
      VexLedger.note({
        feature: 'brief-snooze',
        what: fresh.length === 1 ? 'Brought back "' + String(fresh[0].title || 'a snoozed item').slice(0, 60) + '"' : 'Brought back ' + fresh.length + ' snoozed items',
        why: 'You snoozed ' + (fresh.length === 1 ? 'it' : 'them') + ' until about now.',
        undo: { kind: 'resnooze', ids: fresh.slice(0, 30).map(e => e.id), minutes: 60 },
      });
    }
    return fresh;
  },

  start() {
    if (this._timer) return;
    this.checkDue();
    this._timer = setInterval(() => this.checkDue(), 60000);
  },

  // ---- the picker and the brief section -----------------------------------
  // A small menu of the presets plus a typed time; resolves the chosen `when`
  // text, or null when dismissed. vexPrompt is the app's own dialog.
  async ask(title = 'Snooze until when?') {
    if (typeof window.vexPrompt !== 'function') throw new Error('The prompt dialog is not loaded');
    for (;;) {
      const text = await window.vexPrompt({ title, label: 'For example: tomorrow morning, in 2 hours, monday, this evening', value: 'tomorrow morning' });
      if (text == null) return null;
      const at = this.resolveAt(text);
      if (at) return at;
      window.showToast?.('That time was not understood', 'error');
    }
  },

  section: {
    id: 'snoozed',
    title: 'Snoozed, back now',
    icon: 'alarm',
    order: 30,
    isEnabled() { return typeof BriefActions === 'undefined' || BriefActions.isOn('snooze'); },
    build(ctx = {}) {
      const now = ctx.now || Date.now();
      const due = VexSnooze.due(now);
      if (!due.length) return null;
      const label = { tab: 'tab', story: 'story', page: 'page', mail: 'mail', reminder: 'reminder' };
      return {
        summary: due.length === 1 ? 'One thing you snoozed is back.' : due.length + ' things you snoozed are back.',
        items: due.slice(0, 8).map(e => ({ text: e.title, sub: label[e.kind] + (e.note ? ' · ' + e.note : ''), url: e.url, badge: label[e.kind], when: new Date(e.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })),
      };
    },
    // Must stay attached: BriefActions.registerAll() reads these.
    defaultOn: true, maxItems: 8,
  },
};

if (typeof VexLedger !== 'undefined') {
  VexLedger.registerUndo('resnooze', async (token) => {
    const list = VexSnooze._read();
    const back = Date.now() + (Number(token.minutes) || 60) * 60000;
    let n = 0;
    for (const e of list) if ((token.ids || []).includes(e.id)) { e.at = back; e.told = false; n++; }
    if (!n) throw new Error('Those items are no longer snoozed');
    if (!VexSnooze._write(list)) throw new Error('The snooze could not be saved');
  });
}

if (typeof window !== 'undefined') window.VexSnooze = VexSnooze;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSnooze };
