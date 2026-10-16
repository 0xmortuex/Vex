// === Unread to task (T3-021) ====================================================
//
// A message you cannot answer now, a line on a page you must act on: one click
// turns it into a task with where it came from and a day, so it stops living
// in an unread badge.
//
//   - from a kept panel notification (js/panel-capture.js): "Make a task" on its row;
//   - from text you selected on any page: right-click > "Make a task from this",
//     or Ctrl+K > "Task from the selection".
//
// "The Queue panel" of the idea is the Telegram queue, which is another person's
// service with a secret; nothing here writes to it. The task goes where Vex's tasks
// already live: a "- [ ] ..." line in the To-do note (js/open-tasks.js), which the
// Tasks list, the board and the reminders already read. With a day it carries
// "@2026-10-17", so it is due, sorts by it and can be reminded from there.
// Nothing is read from a page except the text you selected.
const UnreadTask = {
  KEY: 'vex.unreadTask',
  MAX_LINE: 500,
  DUES: [['none', 'No day'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'In a week']],

  _now() { return new Date(); },

  prefs() {
    const p = CommsStore.record(this.KEY, { on: true, due: 'tomorrow' }, 'unread-to-task settings');
    return { on: p.on !== false, due: this.DUES.some(d => d[0] === p.due) ? p.due : 'tomorrow' };
  },
  enabled() { return this.prefs().on; },
  setEnabled(on) { const p = this.prefs(); p.on = !!on; CommsStore.write(this.KEY, p); },
  defaultDue() { return this.prefs().due; },
  setDefaultDue(due) {
    if (!this.DUES.some(d => d[0] === due)) throw new Error('A day is none, today, tomorrow or week');
    const p = this.prefs(); p.due = due; CommsStore.write(this.KEY, p);
  },

  _ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  // 'none' | 'today' | 'tomorrow' | 'week' | 'YYYY-MM-DD' -> '@2026-10-17' or ''
  dueTag(due, now = this._now()) {
    if (!due || due === 'none') return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return '@' + due;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (due === 'today') return '@' + this._ymd(d);
    if (due === 'tomorrow') { d.setDate(d.getDate() + 1); return '@' + this._ymd(d); }
    if (due === 'week') { d.setDate(d.getDate() + 7); return '@' + this._ymd(d); }
    throw new Error('A day is none, today, tomorrow, week or a date like 2026-10-17');
  },

  // The task's one line: the text, where it is from, a day. Cut to fit (a long message keeps its start).
  line({ text, source = '', url = '', due } = {}, now = this._now()) {
    const body = CommsStore.line(text, 2000);
    if (!body) throw new Error('There is no text to make a task from');
    const from = CommsStore.line(source, 40);
    const link = /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
    const tail = [from && link ? '(' + from + ': ' + link + ')' : from ? '(from ' + from + ')' : link ? '(' + link + ')' : '', this.dueTag(due == null ? this.defaultDue() : due, now)].filter(Boolean).join(' ');
    const room = this.MAX_LINE - (tail ? tail.length + 1 : 0);
    if (room < 20) throw new Error('The address is too long to keep in a task');
    const head = body.length > room ? body.slice(0, room - 1).trimEnd() + '…' : body;
    return tail ? head + ' ' + tail : head;
  },

  add(spec) {
    if (!this.enabled()) throw new Error('Unread to task is switched off in Settings');
    CommsStore.needKept('A task');
    if (typeof OpenTasks === 'undefined') throw new Error('Tasks are not loaded');
    const line = this.line(spec);
    const note = OpenTasks.add(line);
    CommsStore.emit('vex:unread-task', { line });
    if (typeof VexUsage !== 'undefined') VexUsage.touch('unread-task');
    return { line, noteId: note.id };
  },

  fromNotification(id) {
    if (typeof PanelCapture === 'undefined') throw new Error('Kept notifications are not loaded');
    const n = PanelCapture.list({ includeMuted: true }).find(i => i.id === id);
    if (!n) throw new Error('That notification is gone');
    const text = n.title + (n.body ? ': ' + n.body : '');
    return this.add({ text, source: PanelCapture.label(n.source) });
  },

  async fromSelection() {
    if (typeof VexCopySource === 'undefined' || typeof VexCopySource._selection !== 'function') throw new Error('Reading the selection is not loaded');
    const sel = await VexCopySource._selection();
    if (!sel.text.trim()) throw new Error('Select some text on the page first');
    return this.add({ text: sel.text, source: sel.title || '', url: sel.url });
  },
};

if (typeof window !== 'undefined') window.UnreadTask = UnreadTask;
if (typeof module !== 'undefined' && module.exports) module.exports = { UnreadTask };
