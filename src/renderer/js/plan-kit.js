// === Small shared helpers for the daily-planning features =====================
//
// Wave 2 added a family of small planning features (left-overs, close the day,
// day shape, week skeleton, chores, triage...). They share a handful of plain
// things, kept here once instead of eleven times:
//
//   flag / setFlag      an on-by-default switch kept as 'off' in localStorage
//   readJson/writeJson  storage that RAISES when it is unreadable or full
//   day maths           local midnight, ISO day, "Tuesday 14 Oct"
//   task editing        change the @date of a task where it lives in its note
//                       (OpenTasks owns the notes; this is the one editor)
//
// Nothing here talks to the network. Nothing here runs by itself.
//
// A task's date is always written as an absolute day (@2026-10-17), never as
// "@today" or "@tomorrow": a relative word written yesterday means today again
// the next morning, which is exactly how a task evaporates without ever being
// overdue.

const VexPlanKit = {
  DAY: 24 * 3600 * 1000,
  TAG: /(^|\s)@(\d{4}-\d{2}-\d{2}|today|tomorrow)\b/i,

  // ---- switches -------------------------------------------------------------------
  flag(key) { try { return localStorage.getItem(key) !== 'off'; } catch { return true; } },
  setFlag(key, on) {
    try { localStorage.setItem(key, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },

  // ---- storage that does not hide a failure --------------------------------------------
  readJson(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    try { return JSON.parse(raw); }
    catch (err) { throw new Error('"' + key + '" could not be read: ' + err.message); }
  },
  writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { throw new Error('Could not save "' + key + '": ' + err.message); }
    return value;
  },

  // ---- days -------------------------------------------------------------------------------
  startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); },
  isoDay(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  // ISO day -> local midnight, or NaN for something that is not a real day.
  parseIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return NaN;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d.getTime() : NaN;
  },
  addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); },
  dayName(ms) {
    try { return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch { return new Date(ms).toDateString(); }
  },
  hhmm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },
  line(text, n = 120) { const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; },

  // ---- tasks (they live in notes; OpenTasks owns that) --------------------------------------
  _ot() {
    if (typeof OpenTasks === 'undefined') throw new Error('Open tasks are not loaded');
    return OpenTasks;
  },
  // Every open task: { noteId, index, text, plain, due (ms|null), noteTitle, doing }
  openTasks(now = Date.now()) {
    const OT = this._ot();
    return OT.collect(OT.notes(), { includeDone: false, now: new Date(now) }).map(t => ({
      noteId: t.noteId, index: t.index, text: t.text, plain: OT._plain(t), due: t.due, noteTitle: t.noteTitle, doing: OT.DOING.test(t.text),
    }));
  },
  // Put a date on a task, or take it off ('' = no date). `tag` is an ISO day or, to restore a
  // task as it was, one of today / tomorrow. -> the tag it had before ('' when it had none).
  setTaskDate(task, tag) {
    if (!/^(\d{4}-\d{2}-\d{2}|today|tomorrow)?$/i.test(String(tag))) throw new Error('A task date is a day like 2026-10-17');
    if (tag && /^\d/.test(tag) && Number.isNaN(this.parseIso(tag))) throw new Error('"' + tag + '" is not a real day');
    const OT = this._ot();
    const notes = OT.notes();
    const note = notes.find(n => n && n.id === task.noteId);
    if (!note) throw new Error('That note is gone');
    const lines = String(note.content || '').split('\n');
    const fenced = OT._fencedLines(note.content);
    let seen = -1;
    for (let i = 0; i < lines.length; i++) {
      if (fenced.has(i)) continue;
      const m = OT.LINE.exec(lines[i]);
      if (!m) continue;
      if (++seen !== task.index) continue;
      if (OT._plain({ text: m[3].trim() }) !== task.plain) throw new Error('That task has changed since the list was drawn');
      const before = (this.TAG.exec(m[3]) || [])[2] || '';
      let body = m[3].replace(this.TAG, '$1').replace(/\s+$/, '');
      if (tag) body += ' @' + tag;
      lines[i] = m[1] + '[' + m[2] + ']' + body;
      note.content = lines.join('\n');
      note.updatedAt = new Date().toISOString();
      OT.writeNotes(notes, note.id);
      return before;
    }
    throw new Error('That task is gone from its note');
  },

  // A line of text in the shared dialog list look.
  listRow(chip, text) {
    const row = document.createElement('div');
    row.className = 'vexsr-rule';
    const c = document.createElement('span');
    c.className = 'vexsr-mode';
    c.textContent = chip;
    c.style.minWidth = '96px';
    const t = document.createElement('span');
    t.className = 'vexsr-host';
    t.style.wordBreak = 'normal';
    t.textContent = text;
    row.append(c, t);
    return { row, chip: c, text: t };
  },
};

if (typeof window !== 'undefined') window.VexPlanKit = VexPlanKit;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPlanKit };
