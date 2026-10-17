// === Study-session ledger by subject (T3-029) ====================================
//
// Time spent studying, kept per subject, shown against what you planned for the week.
//
//   - A subject timer ("Start studying Calculus ... Stop"), or a line you write by hand
//     ("45 minutes of Chemistry yesterday"). Nothing is measured behind your back: a session
//     exists because you started it, wrote it, or ran a strict study block (js/study-block.js
//     is read, never written, and a block counts once).
//   - A planned number of minutes per subject per week, which you set.
//   - The weekly review (js/weekly-review.js) gets a "Study time" section: planned against
//     actual per subject, and the one line you wrote about what you learned that week.
//
// Local only: vex.studyLedger. Weeks start on Monday.
//
//   VexStudyLedger.weekStart(now)               pure
//   VexStudyLedger.summary(now)                 { weekStart, rows:[{subject, minutes, planned}], total }
//   VexStudyLedger.blocksFromLog(log, seen)     pure: sessions out of a study-block log
const VexStudyLedger = {
  KEY: 'vex.studyLedger',
  PREF: 'vex.studyLedger.enabled',
  MAX: 3000,

  _flag: null,
  _f() { return this._flag || (this._flag = VexStudyKit.flag(this.PREF)); },
  enabled() { return this._f().enabled(); },
  setEnabled(on) { this._f().set(on); },

  _st() { return VexStudyKit.store(this.KEY, { v: 1, sessions: [], targets: {}, learned: {}, running: null, seenBlocks: [] }); },
  _read() {
    const d = this._st().get();
    if (!d || !Array.isArray(d.sessions)) throw new Error('The study ledger is damaged and was left as it is');
    d.targets = d.targets && typeof d.targets === 'object' ? d.targets : {};
    d.learned = d.learned && typeof d.learned === 'object' ? d.learned : {};
    d.seenBlocks = Array.isArray(d.seenBlocks) ? d.seenBlocks : [];
    return d;
  },
  _write(d) {
    if (d.sessions.length > this.MAX) d.sessions = d.sessions.slice(-this.MAX);
    if (d.seenBlocks.length > 500) d.seenBlocks = d.seenBlocks.slice(-500);
    this._st().set(d);
    try { document.dispatchEvent(new CustomEvent('vex:study-ledger')); } catch (err) { console.error('[StudyLedger] event failed:', err); }
  },

  _subject(s) {
    const t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
    if (!t) throw new Error('Name the subject first');
    if (t.length > 60) throw new Error('A subject name is 60 letters at most');
    return t;
  },

  weekStart(now = Date.now()) {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7;            // Monday = 0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
  },
  weekKey(now = Date.now()) { const d = new Date(this.weekStart(now)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },

  // ---- recording ------------------------------------------------------------------------
  running() { return this._read().running; },
  start(subject, now = Date.now()) {
    const d = this._read();
    if (d.running) throw new Error('A timer is already running for ' + d.running.subject + '. Stop it first.');
    d.running = { subject: this._subject(subject), start: now };
    this._write(d);
    return d.running;
  },
  stop(now = Date.now()) {
    const d = this._read();
    if (!d.running) throw new Error('No timer is running');
    const r = d.running;
    d.running = null;
    const minutes = Math.round((now - r.start) / 60000);
    let s = null;
    if (minutes >= 1) {
      s = { id: 's' + now.toString(36), subject: r.subject, start: r.start, minutes: Math.min(minutes, 12 * 60), source: 'timer' };
      d.sessions.push(s);
    }
    this._write(d);
    return s;
  },
  log(subject, minutes, when = Date.now()) {
    const m = Math.round(Number(minutes));
    if (!Number.isFinite(m) || m < 1 || m > 12 * 60) throw new Error('Minutes must be a number from 1 to 720');
    if (!Number.isFinite(when) || when > Date.now() + 60000) throw new Error('A session cannot be in the future');
    const d = this._read();
    const s = { id: 's' + when.toString(36) + Math.random().toString(36).slice(2, 4), subject: this._subject(subject), start: when, minutes: m, source: 'manual' };
    d.sessions.push(s);
    this._write(d);
    return s;
  },
  remove(id) {
    const d = this._read();
    const n = d.sessions.length;
    d.sessions = d.sessions.filter(s => s.id !== id);
    if (d.sessions.length === n) return false;
    this._write(d);
    return true;
  },
  setTarget(subject, minutesPerWeek) {
    const d = this._read();
    const s = this._subject(subject);
    const m = Math.round(Number(minutesPerWeek));
    if (!Number.isFinite(m) || m < 0 || m > 7 * 24 * 60) throw new Error('Planned minutes must be a number from 0 to 10080');
    if (m === 0) delete d.targets[s]; else d.targets[s] = m;
    this._write(d);
  },
  setLearned(text, now = Date.now()) {
    const d = this._read();
    const t = String(text == null ? '' : text).trim().slice(0, 400);
    if (t) d.learned[this.weekKey(now)] = t; else delete d.learned[this.weekKey(now)];
    const keys = Object.keys(d.learned).sort();
    while (keys.length > 60) delete d.learned[keys.shift()];
    this._write(d);
  },

  // A strict study block that ended becomes a session once. `seen` is the list of block
  // start times already counted.
  blocksFromLog(log, seen) {
    const out = [];
    const open = new Map();
    for (const e of Array.isArray(log) ? log : []) {
      if (!e || typeof e.at !== 'number') continue;
      if (e.kind === 'started') open.set(e.name, e);
      else if (e.kind === 'ended' && open.has(e.name)) {
        const s = open.get(e.name);
        open.delete(e.name);
        if (seen.includes(s.at)) continue;
        const minutes = Math.round((e.at - s.at) / 60000);
        if (minutes >= 1 && minutes <= 12 * 60) out.push({ id: 'b' + s.at.toString(36), subject: String(e.name || 'Study').slice(0, 60), start: s.at, minutes, source: 'study-block', blockAt: s.at });
      }
    }
    return out;
  },
  importBlocks() {
    if (typeof VexStudyBlock === 'undefined' || typeof VexStudyBlock.log !== 'function') return 0;
    const d = this._read();
    const add = this.blocksFromLog(VexStudyBlock.log(), d.seenBlocks);
    if (!add.length) return 0;
    for (const s of add) { d.sessions.push(s); d.seenBlocks.push(s.blockAt); }
    this._write(d);
    return add.length;
  },

  // ---- reading --------------------------------------------------------------------------
  summary(now = Date.now(), data) {
    const d = data || this._read();
    const from = this.weekStart(now), to = from + 7 * 86400000;
    const by = new Map();
    for (const s of d.sessions) if (s.start >= from && s.start < to) by.set(s.subject, (by.get(s.subject) || 0) + s.minutes);
    for (const sub of Object.keys(d.targets)) if (!by.has(sub)) by.set(sub, 0);
    const rows = [...by.entries()].map(([subject, minutes]) => ({ subject, minutes, planned: d.targets[subject] || 0 })).sort((a, b) => b.minutes - a.minutes || a.subject.localeCompare(b.subject));
    return { weekStart: from, rows, total: rows.reduce((n, r) => n + r.minutes, 0), learned: d.learned[this.weekKey(now)] || '' };
  },
  // Minutes studied whose session started in [from, to) (ms). Used by the pre-game checklist.
  minutesBetween(from, to) {
    let n = 0;
    for (const s of this._read().sessions) if (s.start >= from && s.start < to) n += s.minutes;
    return n;
  },
  fmt(min) { const h = Math.floor(min / 60), m = min % 60; return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min'; },

  // The weekly review section (js/weekly-review.js addSection).
  reviewSection(now = Date.now()) {
    if (!this.enabled()) return null;
    try { this.importBlocks(); } catch (err) { console.error('[StudyLedger] study blocks not imported:', err); }
    const s = this.summary(now);
    if (!s.rows.length && !s.learned) return null;
    const items = s.rows.map(r => ({ text: r.subject + ': ' + this.fmt(r.minutes) + (r.planned ? ' of ' + this.fmt(r.planned) + ' planned' + (r.minutes >= r.planned ? ' (done)' : '') : ''), sub: r.planned ? Math.min(100, Math.round(100 * r.minutes / r.planned)) + '%' : '' }));
    if (s.learned) items.push({ text: 'What I learned: ' + s.learned });
    return { summary: this.fmt(s.total) + ' of study this week', items };
  },

  // ---- screen ---------------------------------------------------------------------------
  _subjectsKnown() {
    const set = new Set(Object.keys(this._read().targets));
    for (const s of this._read().sessions) set.add(s.subject);
    try { if (typeof VexCourseSpaces !== 'undefined') for (const c of VexCourseSpaces.list()) set.add(c.name); } catch (err) { console.error('[StudyLedger] courses unreadable:', err); }
    return [...set].sort();
  },
  openScreen() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('study-ledger');
    const K = VexStudyKit, G = VexSettingsGroups;
    try { this.importBlocks(); } catch (err) { window.showToast?.(err.message, 'error'); }
    const { body } = G.dialog({ id: 'vex-study-ledger', title: 'Study time', sub: 'This week, by subject. Local only.' });
    const ask = async (title, label, placeholder, value) => window.vexPrompt({ title, label, placeholder, value, okLabel: 'OK' });
    const draw = () => {
      body.textContent = '';
      const run = this.running();
      if (run) {
        body.appendChild(K.el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:10px' }, K.el('strong', { text: 'Studying ' + run.subject + ' since ' + new Date(run.start).toLocaleTimeString() }),
          G.button('Stop', K.guard(() => { const s = this.stop(); window.showToast?.(s ? s.minutes + ' min of ' + s.subject + ' saved' : 'Under a minute: nothing saved'); draw(); }), { primary: true })));
      } else {
        body.appendChild(G.button('Start a timer', K.guard(async () => { const s = await ask('Start a timer', 'Subject', this._subjectsKnown()[0] || 'Calculus'); if (s != null) { this.start(s); draw(); } }), { primary: true }));
      }
      body.appendChild(K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0' },
        G.button('Add a session by hand', K.guard(async () => {
          const s = await ask('Add a session', 'Subject', this._subjectsKnown()[0] || 'Chemistry'); if (s == null) return;
          const m = await ask('Add a session', 'Minutes', '45'); if (m == null) return;
          this.log(s, m); draw();
        })),
        G.button('Plan minutes for a subject', K.guard(async () => {
          const s = await ask('Plan a week', 'Subject', this._subjectsKnown()[0] || 'Calculus'); if (s == null) return;
          const m = await ask('Plan a week', 'Minutes per week (0 removes the plan)', '300'); if (m == null) return;
          this.setTarget(s, m); draw();
        })),
        G.button('What I learned this week', K.guard(async () => {
          const t = await window.vexPrompt({ title: 'What I actually learned this week', label: 'One or two lines', value: this.summary().learned, multiline: true, okLabel: 'Save' });
          if (t != null) { this.setLearned(t); draw(); }
        }))));
      const s = this.summary();
      body.appendChild(K.el('h3', { text: 'Week of ' + new Date(s.weekStart).toLocaleDateString() + ': ' + this.fmt(s.total), style: 'margin:10px 0 4px' }));
      if (!s.rows.length) body.appendChild(G.note('No study time yet this week.'));
      const max = Math.max(1, ...s.rows.map(r => Math.max(r.minutes, r.planned)));
      for (const r of s.rows) {
        const bar = K.el('div', { style: 'position:relative;height:10px;border-radius:5px;background:var(--bg-tertiary,rgba(128,128,128,.2));margin:4px 0 10px' },
          K.el('div', { style: 'position:absolute;inset:0 auto 0 0;border-radius:5px;background:var(--accent,#7c5cff);width:' + Math.round(100 * r.minutes / max) + '%' }));
        if (r.planned) bar.appendChild(K.el('div', { title: 'Planned', style: 'position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--text-primary,#fff);left:' + Math.round(100 * r.planned / max) + '%' }));
        body.appendChild(K.el('div', {}, K.el('div', { text: r.subject + ': ' + this.fmt(r.minutes) + (r.planned ? ' of ' + this.fmt(r.planned) + ' planned' : '') }), bar));
      }
      if (s.learned) body.appendChild(G.note('What I learned: ' + s.learned));
    };
    draw();
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Study time per subject against what you planned, in the weekly review. You start the timer or write the session yourself; strict study blocks count too.'));
    el.appendChild(G.button('Study time', () => this.openScreen(), { primary: true }));
    const run = this.running();
    if (run) el.appendChild(G.note('Timer running: ' + run.subject));
  },
};

if (typeof window !== 'undefined') {
  window.VexStudyLedger = VexStudyLedger;
  if (typeof VexReview !== 'undefined' && typeof VexReview.addSection === 'function') {
    VexReview.addSection({ id: 'study-ledger', title: 'Study time', build: (now) => VexStudyLedger.reviewSection(now) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStudyLedger };
