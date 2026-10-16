// === Moderator chores kit (T3-063) ==================================================
//
// For the owner when he moderates a community (the idea assumed he does; nothing in
// the data shows it, so it is off until he turns it on and does nothing until he writes
// something). Paper work only, all on this computer:
//
//   Mod log          one line per action you took ("warned Sam, spam in #general"), kept
//                    here and also appended to a Notes note called "Mod log";
//   Lookup           "has this person been here before?": the cases on that name;
//   Report queue     reports you were sent, open or done;
//   Templates        warning, rule reminder and ban-notice texts with {name}, {rule} and
//                    {reason} filled in, to COPY and paste yourself;
//   Checklists       ban review, raid response, new mod: tick them off, reset them;
//   Handover note    open reports, the last days of cases and unfinished checklist items,
//                    as one text for the next moderator;
//   Reminder         a follow-up reminder on a case.
//
// What it never does: warn, mute, kick, ban, delete, reply or change anything on Discord
// or anywhere else. It does not read your server, your mod channel or your reports from
// Discord. It records what YOU type.
//
// People's names and reasons are personal data. They stay in this computer's storage (not
// synced, because a record of other people is not Vex's to copy elsewhere), a private window
// keeps none, and you can erase one person, erase everything older than a number of days
// (default 90, a button), or erase it all. Export is "copy to the clipboard".
const ModKit = {
  KEY: 'vex.modKit',
  NOTE_TITLE: 'Mod log',
  ACTIONS: ['note', 'warn', 'timeout', 'kick', 'ban', 'unban', 'report'],
  MAX_CASES: 1000,
  MAX_REPORTS: 100,
  MAX_TEMPLATES: 30,
  KEEP_DAYS_DEFAULT: 90,
  TEMPLATE_PRESETS: [
    { name: 'Friendly warning', text: 'Hi {name}, a quick note from the moderators: {reason}. Please read {rule} again. Thank you for helping keep the community friendly.' },
    { name: 'Rule reminder', text: 'Reminder for everyone: {rule}. If you are unsure, ask a moderator.' },
    { name: 'Ban notice', text: 'Hi {name}, you have been removed from the server for: {reason}. If you think this is a mistake, you can reply to this message.' },
  ],
  CHECKLIST_PRESETS: [
    { name: 'Before a ban', items: ['Read the whole thread, not only the report', 'Check the earlier cases for this person (Lookup)', 'Was a warning given first?', 'Screenshot the evidence', 'Write the reason in the log', 'Tell the other moderators'] },
    { name: 'Raid response', items: ['Turn on slow mode or verification', 'Pause invites', 'Collect the names of the accounts', 'Ban the accounts', 'Post a calm notice to members', 'Write what happened in the log'] },
    { name: 'New moderator', items: ['Share the rules and the escalation steps', 'Share the templates', 'Explain the log and how to hand over', 'Agree what a moderator may ban alone'] },
  ],

  _now() { return Date.now(); },

  // ---- state ------------------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, cases: [], reports: [], templates: [], checklists: [], toNote: false, keepDays: this.KEEP_DAYS_DEFAULT }, 'moderator kit');
    const arr = (v) => (Array.isArray(v) ? v.filter(x => x && typeof x.id === 'string') : []);
    return { on: s.on !== false, cases: arr(s.cases), reports: arr(s.reports), templates: arr(s.templates), checklists: arr(s.checklists), toNote: s.toNote === true, keepDays: Number(s.keepDays) > 0 ? Number(s.keepDays) : this.KEEP_DAYS_DEFAULT };
  },
  _save(s) { CommsStore.write(this.KEY, s); CommsStore.emit('vex:mod-kit'); },
  enabled() { return this.state().on; },
  setEnabled(on) { const s = this.state(); s.on = !!on; this._save(s); },
  setToNote(on) { const s = this.state(); s.toNote = !!on; this._save(s); },
  setKeepDays(n) {
    const v = Math.floor(Number(n));
    if (!(v >= 7 && v <= 3650)) throw new Error('Keep days is a number from 7 to 3650');
    const s = this.state(); s.keepDays = v; this._save(s);
  },
  _guard() {
    if (!this.enabled()) throw new Error('The moderator kit is switched off in Settings');
    CommsStore.needKept('A moderator record');
  },

  // ---- the log ------------------------------------------------------------------------------------
  cases() { return this.state().cases.slice().sort((a, b) => b.ts - a.ts); },
  logLine(c) {
    const d = new Date(c.ts);
    const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return stamp + ' | ' + c.action + ' | ' + c.who + (c.reason ? ' | ' + c.reason : '');
  },
  log({ who, action = 'note', reason = '' } = {}) {
    this._guard();
    const person = CommsStore.line(who, 60);
    if (!person) throw new Error('Who is it about? Write a name or an id');
    if (!this.ACTIONS.includes(action)) throw new Error('An action is one of ' + this.ACTIONS.join(', '));
    const s = this.state();
    if (s.cases.length >= this.MAX_CASES) throw new Error('The log holds ' + this.MAX_CASES + ' cases. Erase the old ones first (Settings, Community and chat tools).');
    const c = { id: CommsStore.id('mc'), who: person, action, reason: CommsStore.line(reason, 300), ts: this._now() };
    s.cases.push(c);
    this._save(s);
    if (s.toNote) this.appendToNote(this.logLine(c));
    return c;
  },
  // Appends a line to the note "Mod log" (made if missing), through the writer the To-do list uses.
  appendToNote(line) {
    if (typeof OpenTasks === 'undefined' || typeof OpenTasks.notes !== 'function') return false;
    const notes = OpenTasks.notes();
    const now = new Date(this._now()).toISOString();
    let note = notes.find(n => n && String(n.title || '').trim().toLowerCase() === this.NOTE_TITLE.toLowerCase());
    if (!note) {
      note = { id: 'note_' + this._now() + '_' + Math.random().toString(36).slice(2, 7), title: this.NOTE_TITLE, content: '', pinned: false, tags: [], sourceUrl: '', sourceTitle: '', createdAt: now, updatedAt: now };
      notes.unshift(note);
    }
    note.content = (note.content.replace(/\s+$/, '') + (note.content.trim() ? '\n' : '') + line).replace(/^\n+/, '');
    note.updatedAt = now;
    OpenTasks.writeNotes(notes, note.id);
    return true;
  },
  removeCase(id) {
    const s = this.state();
    const next = s.cases.filter(c => c.id !== id);
    if (next.length === s.cases.length) return false;
    s.cases = next; this._save(s);
    return true;
  },
  // Has this person been here before? Whole-word, any case. -> { count, last, byAction, cases }
  lookup(who) {
    const q = CommsStore.line(who, 60).toLowerCase();
    if (q.length < 2) throw new Error('Type at least two characters of a name or id');
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^\\p{L}\\p{N}_])' + esc + '($|[^\\p{L}\\p{N}_])', 'iu');
    const hits = this.cases().filter(c => re.test(c.who));
    const byAction = {};
    for (const c of hits) byAction[c.action] = (byAction[c.action] || 0) + 1;
    return { count: hits.length, last: hits.length ? hits[0].ts : 0, byAction, cases: hits, repeat: hits.filter(c => c.action !== 'note' && c.action !== 'report').length >= 2 };
  },

  // ---- reports -------------------------------------------------------------------------------------------
  reports({ open = false } = {}) { return this.state().reports.filter(r => !open || r.status === 'open').sort((a, b) => b.ts - a.ts); },
  addReport({ about, text, from = '' } = {}) {
    this._guard();
    const t = CommsStore.line(text, 400);
    if (!t) throw new Error('Write what was reported');
    const s = this.state();
    if (s.reports.length >= this.MAX_REPORTS) throw new Error('The report queue holds ' + this.MAX_REPORTS + '. Erase done reports first.');
    const r = { id: CommsStore.id('mr'), about: CommsStore.line(about, 60), text: t, from: CommsStore.line(from, 60), status: 'open', ts: this._now() };
    s.reports.push(r); this._save(s);
    return r;
  },
  setReportDone(id, done = true) {
    const s = this.state();
    const r = s.reports.find(x => x.id === id);
    if (!r) throw new Error('That report is gone');
    r.status = done ? 'done' : 'open'; r.doneAt = done ? this._now() : 0;
    this._save(s);
  },
  removeReport(id) {
    const s = this.state();
    const next = s.reports.filter(r => r.id !== id);
    if (next.length === s.reports.length) return false;
    s.reports = next; this._save(s);
    return true;
  },

  // ---- templates --------------------------------------------------------------------------------------------
  templates() {
    const mine = this.state().templates;
    return [...this.TEMPLATE_PRESETS.map((t, i) => ({ id: 'preset-' + i, name: t.name, text: t.text, preset: true })), ...mine];
  },
  addTemplate({ name, text } = {}) {
    this._guard();
    const n = CommsStore.line(name, 40), t = CommsStore.block(text, 1500);
    if (!n || !t) throw new Error('A template needs a name and a text');
    const s = this.state();
    if (s.templates.length >= this.MAX_TEMPLATES) throw new Error('At most ' + this.MAX_TEMPLATES + ' templates');
    const rec = { id: CommsStore.id('mt'), name: n, text: t };
    s.templates.push(rec); this._save(s);
    return rec;
  },
  removeTemplate(id) {
    const s = this.state();
    const next = s.templates.filter(t => t.id !== id);
    if (next.length === s.templates.length) return false;
    s.templates = next; this._save(s);
    return true;
  },
  // {name}, {reason}, {rule}: a placeholder with no value is kept as written so it is seen, not dropped.
  fill(text, vars = {}) {
    return String(text).replace(/\{(name|reason|rule)\}/g, (m, k) => (vars[k] ? String(vars[k]) : m));
  },

  // ---- checklists -------------------------------------------------------------------------------------------------
  // A checklist made from a preset, or from your own items, with ticks.
  checklists() { return this.state().checklists; },
  startChecklist({ preset, name, items } = {}) {
    this._guard();
    let list;
    if (preset != null) {
      const p = this.CHECKLIST_PRESETS.find(x => x.name === preset);
      if (!p) throw new Error('No such checklist: ' + preset);
      list = { name: p.name, items: p.items };
    } else {
      const n = CommsStore.line(name, 60);
      const its = (Array.isArray(items) ? items : String(items || '').split('\n')).map(i => CommsStore.line(i, 120)).filter(Boolean).slice(0, 30);
      if (!n || !its.length) throw new Error('A checklist needs a name and at least one item');
      list = { name: n, items: its };
    }
    const s = this.state();
    if (s.checklists.length >= 20) throw new Error('At most 20 checklists. Remove one first.');
    const rec = { id: CommsStore.id('mk'), name: list.name, items: list.items.map(t => ({ text: t, done: false })), startedAt: this._now() };
    s.checklists.push(rec); this._save(s);
    return rec;
  },
  tick(id, index, done = true) {
    const s = this.state();
    const c = s.checklists.find(x => x.id === id);
    if (!c || !c.items[index]) throw new Error('That checklist item is gone');
    c.items[index].done = !!done; this._save(s);
  },
  removeChecklist(id) {
    const s = this.state();
    const next = s.checklists.filter(c => c.id !== id);
    if (next.length === s.checklists.length) return false;
    s.checklists = next; this._save(s);
    return true;
  },

  // ---- the handover note ---------------------------------------------------------------------------------------------------
  handoverText(days = 7, now = this._now()) {
    const s = this.state();
    const since = now - days * 86400000;
    const out = ['Moderator handover, ' + new Date(now).toISOString().slice(0, 10)];
    const open = s.reports.filter(r => r.status === 'open');
    out.push('', 'Open reports (' + open.length + '):');
    for (const r of open) out.push('- ' + (r.about ? r.about + ': ' : '') + r.text + (r.from ? ' (from ' + r.from + ')' : ''));
    if (!open.length) out.push('- none');
    const recent = s.cases.filter(c => c.ts >= since).sort((a, b) => a.ts - b.ts);
    out.push('', 'Cases in the last ' + days + ' days (' + recent.length + '):');
    for (const c of recent) out.push('- ' + this.logLine(c));
    if (!recent.length) out.push('- none');
    const pending = [];
    for (const c of s.checklists) for (const it of c.items) if (!it.done) pending.push(c.name + ': ' + it.text);
    out.push('', 'Unfinished checklist items (' + pending.length + '):');
    for (const p of pending) out.push('- ' + p);
    if (!pending.length) out.push('- none');
    return out.join('\n');
  },

  // A follow-up reminder for a case. It reminds; it does nothing else.
  async remind(caseId, when) {
    const c = this.state().cases.find(x => x.id === caseId);
    if (!c) throw new Error('That case is gone');
    if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not loaded');
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) throw new Error('That is not a real time');
    return VexQuickReminder.create('Moderator follow-up: ' + c.who + ' (' + c.action + (c.reason ? ', ' + CommsStore.line(c.reason, 60) : '') + ')', when);
  },

  // ---- erasing (personal data) ------------------------------------------------------------------------------------------------
  // Everything about one person: their cases, and reports about them.
  forgetPerson(who) {
    const q = CommsStore.line(who, 60).toLowerCase();
    if (q.length < 2) throw new Error('Type at least two characters of the name or id');
    const s = this.state();
    const c0 = s.cases.length, r0 = s.reports.length;
    s.cases = s.cases.filter(c => !c.who.toLowerCase().includes(q));
    s.reports = s.reports.filter(r => !String(r.about || '').toLowerCase().includes(q));
    this._save(s);
    return { cases: c0 - s.cases.length, reports: r0 - s.reports.length };
  },
  overdue(now = this._now()) {
    const s = this.state();
    const cut = now - s.keepDays * 86400000;
    return { cases: s.cases.filter(c => c.ts < cut).length, reports: s.reports.filter(r => r.ts < cut).length, days: s.keepDays };
  },
  purgeOld(now = this._now()) {
    const s = this.state();
    const cut = now - s.keepDays * 86400000;
    const c0 = s.cases.length, r0 = s.reports.length;
    s.cases = s.cases.filter(c => c.ts >= cut);
    s.reports = s.reports.filter(r => r.ts >= cut);
    this._save(s);
    return { cases: c0 - s.cases.length, reports: r0 - s.reports.length };
  },
  forgetAll() {
    const s = this.state();
    const n = { cases: s.cases.length, reports: s.reports.length };
    s.cases = []; s.reports = []; this._save(s);
    return n;
  },
};

if (typeof window !== 'undefined') window.ModKit = ModKit;
if (typeof module !== 'undefined' && module.exports) module.exports = { ModKit };
