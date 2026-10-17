// === Weekly note ===========================================================
//
// "Clip to Notes" (ClipToNotes in js/readlater.js) already writes a selection
// or link, with the page's address and the time, into the Clippings note. This
// keeps a small structured record of each clip as well (address, title, time,
// the first 600 characters) so a note for the week can be written from them:
//
//   Week of 2026-10-12
//     clips by day, with links back  ·  pages read from Read later
//     watched pages that changed     ·  notes you wrote or changed
//
// The note is an ordinary note ("Week of <Monday>") in the Notes panel. Only
// the block between two comment markers is Vex's: run it again and that block
// is rewritten, whatever you wrote above or below it stays.
//
// Nothing leaves the computer; nothing is read that is not already stored.
const VexWeeklyNote = {
  LOG_KEY: 'vex.clips.log',
  NOTES_KEY: 'vex.notes',
  MAX_LOG: 500,
  START: '<!-- vex-weekly:start -->',
  END: '<!-- vex-weekly:end -->',
  _job: null,

  enabled() { return window.VexWorkflow.pref('weeklyNote', true) !== false; },
  autoOn() { return window.VexWorkflow.pref('weeklyNoteAuto', false) === true; },

  // ---- the clip log ----------------------------------------------------------
  log() {
    try { const a = JSON.parse(localStorage.getItem(this.LOG_KEY) || '[]'); return Array.isArray(a) ? a.filter(c => c && c.url && c.at) : []; }
    catch { return []; }
  },
  recordClip({ url, title, text }) {
    if (!this.enabled()) return false;
    if (!/^https?:/i.test(String(url || ''))) return false;
    const list = this.log();
    list.push({ url: String(url).slice(0, 2000), title: String(title || url).slice(0, 200), text: String(text || '').slice(0, 600), at: Date.now() });
    try { localStorage.setItem(this.LOG_KEY, JSON.stringify(list.slice(-this.MAX_LOG))); return true; }
    catch (err) { window.VexProblems?.note('Weekly note', 'Could not record the clip', err); return false; }
  },

  // ---- the week ------------------------------------------------------------------
  // Monday 00:00 of the week `ref` is in.
  weekStart(ref = new Date()) {
    const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  },
  _ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  title(ref) { return 'Week of ' + this._ymd(this.weekStart(ref)); },

  // The numbers and lists the note is written from.
  collect(ref = new Date()) {
    const from = this.weekStart(ref).getTime();
    const to = from + 7 * 24 * 3600000;
    const inWeek = (ms) => ms >= from && ms < to;
    const out = { from, to, clips: [], read: [], changed: [], notes: [] };
    out.clips = this.log().filter(c => inWeek(c.at)).sort((a, b) => a.at - b.at);
    try {
      if (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) {
        out.read = ReadLater.items.filter(i => i.read && inWeek(i.at)).map(i => ({ title: i.title || i.url, url: i.url }));
      }
    } catch { /* section stays empty */ }
    try {
      if (window.PageWatch && typeof window.PageWatch.list === 'function') {
        out.changed = window.PageWatch.list().filter(w => w.lastChangedAt && inWeek(w.lastChangedAt)).map(w => ({ title: w.title || w.url, url: w.url }));
      }
    } catch { /* section stays empty */ }
    try {
      const notes = this._notes();
      if (Array.isArray(notes)) {
        out.notes = notes.filter(n => n && n.title && !/^Week of /.test(n.title) && n.title !== 'Clippings' && inWeek(Date.parse(n.updatedAt || '') || 0)).map(n => ({ title: n.title }));
      }
    } catch { /* section stays empty */ }
    return out;
  },

  _md(s) { return String(s).replace(/[\[\]]/g, ''); },

  // The generated block, markers included.
  build(data) {
    const day = (ms) => new Date(ms).toLocaleDateString((window.VexI18n?.dateLocale('en-US') || 'en-US'), { weekday: 'long', day: 'numeric', month: 'short' });
    const L = [this.START, '## Your week', ''];
    L.push('### Clips (' + data.clips.length + ')');
    if (!data.clips.length) L.push('Nothing clipped this week.');
    let lastDay = '';
    for (const c of data.clips) {
      const d = day(c.at);
      if (d !== lastDay) { L.push('', '**' + d + '**'); lastDay = d; }
      L.push('- ' + (c.text ? '“' + this._md(c.text.replace(/\s+/g, ' ').slice(0, 160)) + '” — ' : '') + '[' + this._md(c.title) + '](' + c.url + ')');
    }
    L.push('', '### Read (' + data.read.length + ')');
    if (!data.read.length) L.push('Nothing marked read.');
    for (const r of data.read) L.push('- [' + this._md(r.title) + '](' + r.url + ')');
    L.push('', '### Pages that changed (' + data.changed.length + ')');
    if (!data.changed.length) L.push('None.');
    for (const r of data.changed) L.push('- [' + this._md(r.title) + '](' + r.url + ')');
    L.push('', '### Notes you worked on (' + data.notes.length + ')');
    if (!data.notes.length) L.push('None.');
    for (const n of data.notes) L.push('- ' + this._md(n.title));
    L.push(this.END);
    return L.join('\n');
  },

  // Put the block into content, replacing an earlier block and keeping the rest.
  merge(existing, block) {
    const s = String(existing || '');
    const a = s.indexOf(this.START), b = s.indexOf(this.END);
    if (a >= 0 && b > a) return s.slice(0, a) + block + s.slice(b + this.END.length);
    return s ? s.replace(/\s+$/, '') + '\n\n' + block + '\n' : block + '\n';
  },

  // The notes as the Notes panel holds them when it is loaded (its copy is the
  // live one), else as stored.
  _notes() {
    if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes) && NotesPanel.notes.length) return NotesPanel.notes;
    const a = JSON.parse(localStorage.getItem(this.NOTES_KEY) || '[]');
    if (!Array.isArray(a)) throw new Error('not a list');
    return a;
  },

  // Write (or rewrite) this week's note. → { note, created, counts }
  generate(ref = new Date()) {
    if (!this.enabled()) throw new Error('The weekly note is off in Settings › Workflow');
    const data = this.collect(ref);
    const block = this.build(data);
    let notes;
    try { notes = this._notes(); } catch { notes = null; }
    if (!Array.isArray(notes)) throw new Error('Your notes could not be read, so nothing was written');
    const title = this.title(ref);
    const now = new Date().toISOString();
    let note = notes.find(n => n && n.title === title);
    const created = !note;
    if (!note) {
      note = { id: typeof vexId === 'function' ? vexId('note_') : 'note_' + Date.now(), title, content: '', pinned: false, tags: ['weekly'], sourceUrl: '', sourceTitle: '', createdAt: now, updatedAt: now };
      notes.unshift(note);
    }
    note.content = this.merge(note.content, block);
    note.updatedAt = now;
    // Written through the panel's own copy when it is open, so its next save
    // does not write the old list back over this one.
    if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) {
      NotesPanel.notes = notes;
      try { NotesPanel.save && NotesPanel.save(); } catch { /* the direct write below still lands */ }
      try { NotesPanel.renderList && NotesPanel.renderList(); } catch { /* panel not showing */ }
    }
    try { localStorage.setItem(this.NOTES_KEY, JSON.stringify(notes)); }
    catch (err) { throw new Error('The note could not be saved: ' + err.message); }
    return { note, created, counts: { clips: data.clips.length, read: data.read.length, changed: data.changed.length, notes: data.notes.length } };
  },

  async _command() {
    try {
      const r = this.generate();
      window.showToast?.((r.created ? 'Wrote “' : 'Updated “') + r.note.title + '” — ' + r.counts.clips + ' clip' + (r.counts.clips === 1 ? '' : 's'));
      if (typeof SidebarManager !== 'undefined') { try { SidebarManager.showPanel('notes'); } catch { /* notes panel name differs */ } }
    } catch (err) { window.showToast?.(err.message, 'error'); }
  },

  // Once a week, on Friday from 17:00 (the weekly review's time), when asked for.
  _tick(now = new Date()) {
    if (!this.enabled() || !this.autoOn()) return false;
    if (now.getDay() !== 5 || now.getHours() < 17) return false;
    const key = this._ymd(this.weekStart(now));
    if (window.VexWorkflow.pref('weeklyNoteDone', '') === key) return false;
    try { this.generate(now); window.VexWorkflow.setPref('weeklyNoteDone', key); return true; }
    catch (err) { window.VexProblems?.note('Weekly note', 'The automatic weekly note failed', err); return false; }
  },

  snapshot() {
    const d = this.collect();
    return { enabled: this.enabled(), auto: this.autoOn(), title: this.title(), clips: d.clips.length, read: d.read.length, changed: d.changed.length, notes: d.notes.length };
  },

  render(box) {
    box.appendChild(window.VexWorkflow.toggleRow('Keep a record of what I clip, for the weekly note', 'address, title, time and the first 600 characters', this.enabled(), (on) => {
      if (!window.VexWorkflow.setPref('weeklyNote', on)) window.showToast?.('The choice could not be saved', 'error');
      this.init();
    }));
    box.appendChild(window.VexWorkflow.toggleRow('Write the weekly note by itself', 'Fridays from 17:00', this.autoOn(), (on) => {
      if (!window.VexWorkflow.setPref('weeklyNoteAuto', on)) window.showToast?.('The choice could not be saved', 'error');
    }));
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-secondary'; b.style.marginTop = '6px';
    b.textContent = 'Write this week’s note now';
    b.addEventListener('click', () => this._command());
    box.appendChild(b);
    const c = document.createElement('button');
    c.type = 'button'; c.className = 'btn-danger'; c.style.cssText = 'margin:6px 0 0 8px';
    c.textContent = 'Forget the clip record';
    c.addEventListener('click', async () => {
      const n = this.log().length;
      if (!n) { window.showToast?.('There is no clip record', 'info'); return; }
      const ok = await window.vexConfirm({ title: 'Forget the clip record?', message: n + ' clip' + (n === 1 ? '' : 's') + ' are kept for the weekly note. Your notes are not touched.', okLabel: 'Forget', danger: true });
      if (!ok) return;
      try { localStorage.removeItem(this.LOG_KEY); window.showToast?.('Clip record cleared'); } catch (err) { window.showToast?.('Could not clear it: ' + err.message, 'error'); }
    });
    box.appendChild(c);
  },

  init() {
    if (!this.enabled()) {
      if (this._job) { this._job.stop(); this._job = null; }
      if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) CommandBar.commands = CommandBar.commands.filter(c => c.id !== 'weekly-note');
      return false;
    }
    window.VexWorkflow.addCommand({ id: 'weekly-note', label: 'Write this week’s note', hint: 'Clips, pages read and notes of the week as a note, with links back', icon: 'note', action: () => this._command() });
    if (!this._job && typeof VexJobs !== 'undefined') this._job = VexJobs.every('Weekly note', 3600000, () => this._tick(), { when: 'background' });
    return true;
  },
};

window.VexWorkflow.register({
  id: 'weeklyNote', title: 'Clips and the weekly note', icon: 'note',
  render: (box) => VexWeeklyNote.render(box),
  snapshot: () => VexWeeklyNote.snapshot(),
});

if (typeof window !== 'undefined') window.VexWeeklyNote = VexWeeklyNote;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWeeklyNote };
