// === Meeting mode ==========================================================
//
// A call starts and three things go wrong at once: a reminder pops up while
// you are sharing your screen, a tab somewhere starts playing something, and
// what was agreed is written down nowhere.
//
// Meeting mode does those three: reminders are held until you are done, every
// other tab making a sound is muted, and a note is opened for this meeting
// with the time on it. A line typed during the meeting goes in with the time
// it was said; an action item goes in as a task, so it turns up in Open Tasks
// with everything else rather than dying in the note.
//
// Nothing is recorded, listened to or transcribed. This writes down what you
// type and nothing else.
const MeetingMode = {
  KEY: 'vex.meeting',
  HOLD_MS: 4 * 60 * 60 * 1000,        // reminders wait at most this long

  state() { try { const o = JSON.parse(localStorage.getItem(this.KEY) || 'null'); return o && o.noteId ? o : null; } catch { return null; } },
  _save(state) { try { if (state) localStorage.setItem(this.KEY, JSON.stringify(state)); else localStorage.removeItem(this.KEY); } catch {} },
  active() { return !!this.state(); },

  clock(at = Date.now()) {
    const d = new Date(at);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },

  title(at = Date.now()) {
    const d = new Date(at);
    return 'Meeting — ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + this.clock(at);
  },

  // How long it went on, in words a person would use.
  lasted(ms) {
    const mins = Math.max(1, Math.round(ms / 60000));
    if (mins < 60) return mins + ' minute' + (mins === 1 ? '' : 's');
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return hours + ' hour' + (hours === 1 ? '' : 's') + (rest ? ' ' + rest + ' minutes' : '');
  },

  // --- the note ------------------------------------------------------------

  _tasks() {
    if (typeof OpenTasks === 'undefined') throw new Error('Notes are not ready yet');
    return OpenTasks;
  },

  _newNote(at) {
    const tasks = this._tasks();
    const notes = tasks.notes();
    const now = new Date(at).toISOString();
    const note = {
      id: 'note_' + at + '_' + Math.random().toString(36).slice(2, 7),
      title: this.title(at),
      content: this.clock(at) + '  Started.',
      pinned: false, tags: ['meeting'], sourceUrl: '', sourceTitle: '',
      createdAt: now, updatedAt: now,
    };
    notes.unshift(note);
    tasks.writeNotes(notes, note.id);
    return note;
  },

  // Adds a line to this meeting's note. Returns the note, or throws if the
  // note has been deleted since — which ends the meeting rather than writing
  // into a note that is not there.
  append(line) {
    const state = this.state();
    if (!state) throw new Error('No meeting is running');
    const tasks = this._tasks();
    const notes = tasks.notes();
    const note = notes.find(n => n && n.id === state.noteId);
    if (!note) { this._save(null); throw new Error('That meeting’s note is gone, so the meeting has ended'); }
    note.content = note.content.replace(/\s+$/, '') + '\n' + line;
    note.updatedAt = new Date().toISOString();
    tasks.writeNotes(notes, note.id);
    return note;
  },

  jot(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('Write the line first');
    this.append(this.clock() + '  ' + t);
    window.showToast?.('Added to the meeting note');
    return t;
  },

  // An action item is a task: written as one, it shows up in Open Tasks.
  action(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('Write the action first');
    this.append('- [ ] ' + t);
    window.showToast?.('Action item saved — it is in your tasks too');
    return t;
  },

  // --- the quiet part ------------------------------------------------------

  // Every tab making a sound except the one you are in: a call is in the tab
  // you are looking at. Muting is remembered so an already-muted tab is not
  // unmuted afterwards.
  _muteOthers() {
    if (typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return [];
    const muted = [];
    for (const tab of TabManager.tabs) {
      if (tab.id === TabManager.activeTabId || tab.muted || !tab.audible) continue;
      const wv = WebviewManager.webviews.get(tab.id);
      if (!wv || typeof wv.setAudioMuted !== 'function') continue;
      try { wv.setAudioMuted(true); tab.muted = true; TabManager.renderTabUpdate(tab); muted.push(tab.id); } catch { /* the tab went */ }
    }
    return muted;
  },

  _unmute(ids) {
    if (typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return;
    for (const id of ids || []) {
      const tab = TabManager.tabs.find(t => t.id === id);
      const wv = WebviewManager.webviews.get(id);
      if (!tab || !wv || typeof wv.setAudioMuted !== 'function') continue;
      try { wv.setAudioMuted(false); tab.muted = false; TabManager.renderTabUpdate(tab); } catch { /* the tab went */ }
    }
  },

  _holdReminders(untilMs) {
    const b = window.vex && window.vex.reminders;
    if (!b || typeof b.hold !== 'function') return Promise.resolve();
    return Promise.resolve(b.hold(untilMs)).catch(err =>
      window.VexProblems?.note('Meeting mode', 'Could not hold your reminders for the meeting', err));
  },

  // --- start and stop ------------------------------------------------------

  start() {
    if (this.active()) throw new Error('A meeting is already running');
    const at = Date.now();
    const note = this._newNote(at);
    const muted = this._muteOthers();
    this._save({ noteId: note.id, startedAt: at, muted });
    this._holdReminders(at + this.HOLD_MS);
    document.body.classList.add('meeting-mode');
    window.showToast?.('Meeting mode on — reminders held, other tabs muted, note open');
    return note;
  },

  stop() {
    const state = this.state();
    if (!state) throw new Error('No meeting is running');
    const ran = Date.now() - state.startedAt;
    let items = 0;
    try {
      const note = this.append(this.clock() + '  Ended, after ' + this.lasted(ran) + '.');
      items = (note.content.match(/^- \[ \]/gm) || []).length;
    } catch { /* the note was deleted; the meeting still ends */ }
    this._unmute(state.muted);
    this._holdReminders(0);
    this._save(null);
    document.body.classList.remove('meeting-mode');
    window.showToast?.(items
      ? 'Meeting over — ' + items + ' action item' + (items === 1 ? '' : 's') + ' waiting in your tasks'
      : 'Meeting over — reminders are back on');
    return { minutes: Math.round(ran / 60000), items };
  },

  toggle() { return this.active() ? this.stop() : this.start(); },

  // Vex was closed mid-meeting: the note and the hold outlive the window, so
  // put the window back the way the meeting left it.
  init() {
    if (this.active()) {
      document.body.classList.add('meeting-mode');
      this._holdReminders(Date.now() + this.HOLD_MS);
    }
    return this;
  },

  // Opens the meeting's note in the Notes panel.
  showNote() {
    const state = this.state();
    if (!state) throw new Error('No meeting is running');
    if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('notes');
    if (typeof NotesPanel !== 'undefined' && NotesPanel.selectNote) NotesPanel.selectNote(state.noteId);
    return state.noteId;
  },
};

if (typeof window !== 'undefined') window.MeetingMode = MeetingMode;
if (typeof module !== 'undefined' && module.exports) module.exports = { MeetingMode };
