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
// "The Queue panel" of the idea is your own Telegram queue bot (a Worker with a secret). The task
// always goes where Vex's tasks already live (below). With "Also add it to my Queue" on (off until
// chosen) the same line is also sent to your queue bot's `POST /queue` route, using the address and secret
// the Queue panel already reads from your local sidebar-config.json. The deployed bot has no such route
// yet: docs/queue-bot-add-endpoint.md is the change to make to it; until then the switch says so and
// nothing is lost, because the To-do line is written first. The task goes where Vex's tasks
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
    const p = CommsStore.record(this.KEY, { on: true, due: 'tomorrow', queue: false }, 'unread-to-task settings');
    return { on: p.on !== false, due: this.DUES.some(d => d[0] === p.due) ? p.due : 'tomorrow', queue: p.queue === true };
  },
  enabled() { return this.prefs().on; },
  setEnabled(on) { const p = this.prefs(); p.on = !!on; CommsStore.write(this.KEY, p); },
  defaultDue() { return this.prefs().due; },
  queueOn() { return this.prefs().queue; },
  setQueue(on) { const p = this.prefs(); p.queue = !!on; CommsStore.write(this.KEY, p); },

  // Sends one line to your queue bot. Resolves when it took it; raises (with what to do) when it did not.
  async toQueue(line) {
    if (typeof QueuePanel === 'undefined') throw new Error('The Queue panel is not loaded');
    if (!QueuePanel.isConfigured()) await QueuePanel.loadConfig();
    if (!QueuePanel.isConfigured()) throw new Error('The Queue is not set up on this computer (queueUrl and queueSecret)');
    if (typeof buildQueueUrl !== 'function') throw new Error('The Queue panel is not loaded');
    const url = buildQueueUrl(QueuePanel.config.queueUrl, '/queue', QueuePanel.config.queueSecret);
    const f = (window.VexNet && window.VexNet.fetch) || fetch;
    const res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: String(line).slice(0, 2000), source: 'vex' }) });
    if (res.status === 404 || res.status === 405) throw new Error('Your queue bot has no way to add items yet (see docs/queue-bot-add-endpoint.md)');
    if (res.status === 403) throw new Error('The queue bot refused the secret');
    if (!res.ok) throw new Error('The queue bot answered ' + res.status);
    return true;
  },
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
    // The same line to your queue bot, when asked for. The To-do line is already written, so a refusal loses nothing.
    const queued = this.queueOn() ? this.toQueue(line).then(() => true, (err) => { window.showToast?.('The task is in your To-do note, but not in the Queue: ' + err.message, 'error', 9000); return false; }) : null;
    return { line, noteId: note.id, queued };
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
