// === Study note aids: a Cornell note and margin questions ======================
//
// T3-043.
//
//   New Cornell note      Ctrl+K: makes a note with the Cornell layout (cues and questions, notes,
//                         summary), filled in with the page in front: its title, its address and today's
//                         date, and the questions you flagged on that page as the first cues.
//   Flag a question       Ctrl+K while text is selected on a page: puts a "?" on that passage. The
//                         passage and its page go on the ask-later list. Nothing is changed on the page.
//   Questions to ask      Ctrl+K: the list, newest first: open the page, copy the question, mark it
//                         answered, remove it (Undo on the toast). The count shows in the Morning Brief on
//                         the New Tab page as "Questions to ask" when there are open ones.
//
// A Markdown note cannot have a real second column in the editor, so "cues" is a section at the top
// of the note rather than a margin; the preview reads the same way. Questions stay on this computer
// (vex.studyQuestions), are not synced and are not sent anywhere. Never from a private or Tor tab or
// a banking, mail or sign-in page.

const VexStudyNotes = {
  PREF: 'vex.studyNotes.prefs',            // { enabled }
  KEY: 'vex.studyQuestions',
  FEATURE: 'study-notes',
  MAX: 200,
  MAX_TEXT: 600,

  enabled() {
    try { const raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); return !raw || raw.enabled !== false; }
    catch (err) { console.error('[StudyNotes] the setting could not be read:', err.message); return false; }
  },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!on })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return !!on;
  },

  // ---- pure -----------------------------------------------------------------------------
  _ymd(ms) { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  _label(s) { return String(s == null ? '' : s).replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim(); },

  // The Cornell layout as Markdown. cues: strings that become the first bullets under "Cues and questions".
  cornell({ title, url, cues = [], now = Date.now() } = {}) {
    const name = this._label(title) || 'Untitled';
    const source = /^https?:\/\//i.test(String(url || '')) ? '[' + name + '](' + url + ')' : name;
    const cueLines = cues.length ? cues.map(c => '- ' + this._label(c)).join('\n') : '- ';
    return [
      '# ' + name,
      '',
      'Source: ' + source + '  \nDate: ' + this._ymd(now),
      '',
      '## Cues and questions',
      '',
      cueLines,
      '',
      '## Notes',
      '',
      '',
      '## Summary',
      '',
      '',
    ].join('\n');
  },

  // ---- storage ---------------------------------------------------------------------------
  questions() {
    const raw = localStorage.getItem(this.KEY);
    if (raw == null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The ask-later list could not be read: ' + err.message, { cause: err }); }
    return Array.isArray(v) ? v.filter(q => q && typeof q.id === 'string' && typeof q.text === 'string') : [];
  },
  _save(list) {
    const kept = list.slice().sort((a, b) => b.at - a.at).slice(0, this.MAX);
    localStorage.setItem(this.KEY, JSON.stringify(kept));
    return kept;
  },
  openCount() { return this.questions().filter(q => !q.done).length; },
  forUrl(url) {
    const key = String(url || '').replace(/#.*$/, '');
    return this.questions().filter(q => !q.done && String(q.url).replace(/#.*$/, '') === key);
  },
  setDone(id, done) {
    const list = this.questions();
    const q = list.find(x => x.id === id);
    if (!q) throw new Error('That question is gone');
    q.done = !!done;
    this._save(list);
    return q;
  },
  remove(id) {
    const list = this.questions();
    const q = list.find(x => x.id === id);
    if (!q) return null;
    this._save(list.filter(x => x.id !== id));
    return q;
  },
  restore(q) {
    const list = this.questions();
    if (!list.some(x => x.id === q.id)) this._save([q, ...list]);
    return q;
  },
  addQuestion({ text, url, title, now = Date.now() }) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, this.MAX_TEXT);
    if (!t) throw new Error('Select the passage you have a question about first');
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Only a web page can be flagged');
    const list = this.questions();
    const dup = list.find(q => !q.done && q.text === t && q.url === url);
    if (dup) return { question: dup, created: false };
    const q = { id: 'q_' + now.toString(36) + Math.random().toString(36).slice(2, 6), text: t, url: String(url).slice(0, 2048), title: String(title || url).slice(0, 200), at: now, done: false };
    this._save([q, ...list]);
    return { question: q, created: true };
  },

  // ---- the page in front --------------------------------------------------------------------
  _front() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    const tab = TabManager.getActiveTab?.();
    if (!wv || !tab) throw new Error('There is no page in front');
    if (window.VexTabPolicy && !window.VexTabPolicy.canRestore(tab)) throw new Error('Study notes are off in private and Tor tabs');
    let url = tab.url, title = tab.title;
    try { url = wv.getURL() || url; title = wv.getTitle() || title; } catch (err) { window.VexProblems?.note('Study notes', 'Could not ask the page for its address; using the tab record', err); }
    const why = /^https?:\/\//i.test(String(url || '')) && typeof VexPageSensitivity !== 'undefined' ? VexPageSensitivity.reason(url) : null;
    if (why) throw new Error(why);
    return { wv, tab, url, title };
  },

  async flagSelection() {
    if (!this.enabled()) throw new Error('Study notes are switched off in Settings');
    const { wv, url, title } = this._front();
    const sel = await window.vexGuestEval(wv, '(window.getSelection() || "").toString()', false, 1500);
    const r = this.addQuestion({ text: sel, url, title });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    window.showToast?.(r.created ? 'Flagged with a ? (' + this.openCount() + ' to ask)' : 'Already on your ask-later list', 'info', 3500);
    return r;
  },

  // ---- notes ---------------------------------------------------------------------------------
  // Adds a note to Notes the way Highlights to Notes does (the stored list, then the open panel).
  addNote({ title, content, tags = [], sourceUrl = '', sourceTitle = '' }) {
    let notes;
    try { notes = JSON.parse(localStorage.getItem('vex.notes') || '[]'); } catch (err) { throw new Error('Your notes could not be read, so no note was added: ' + err.message, { cause: err }); }
    if (!Array.isArray(notes)) throw new Error('Your notes are damaged, so no note was added');
    if (typeof NotesPanel !== 'undefined' && typeof NotesPanel.flush === 'function') NotesPanel.flush();
    if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) notes = NotesPanel.notes;
    const stamp = new Date().toISOString();
    const note = { id: typeof vexId === 'function' ? vexId('note_') : 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: String(title || ''), content: String(content || ''), pinned: false, tags, sourceUrl, sourceTitle, createdAt: stamp, updatedAt: stamp };
    notes.unshift(note);
    localStorage.setItem('vex.notes', JSON.stringify(notes));
    if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) {
      NotesPanel.notes = notes;
      NotesPanel.renderList?.();
    }
    return note;
  },

  async newCornell() {
    if (!this.enabled()) throw new Error('Study notes are switched off in Settings');
    const { url, title } = this._front();
    const cues = this.forUrl(url).map(q => q.text);
    const content = this.cornell({ title, url, cues });
    const note = this.addNote({ title: 'Cornell: ' + (this._label(title) || 'Untitled').slice(0, 80), content, tags: ['cornell'], sourceUrl: /^https?:\/\//i.test(url) ? url : '', sourceTitle: this._label(title) });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    window.showToast?.('Made a Cornell note' + (cues.length ? ' with ' + cues.length + ' question' + VexPlural.s(cues.length) + ' from this page' : ''), 'info', 4000);
    return note;
  },

  // ---- the list --------------------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('Study notes are switched off in Settings', 'info'); return null; }
    const { body } = VexSettingsGroups.dialog({ id: 'vex-study-questions', title: 'Questions to ask', sub: 'Passages you flagged with a ?, newest first.' });
    const draw = () => {
      body.textContent = '';
      let list;
      try { list = this.questions(); } catch (err) { body.appendChild(VexSettingsGroups.note(err.message)); return; }
      if (!list.length) body.appendChild(VexSettingsGroups.note('Nothing flagged. Select a passage on a page and use Ctrl+K › Flag a question.'));
      for (const q of list.sort((a, b) => (a.done - b.done) || (b.at - a.at))) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        row.style.flexWrap = 'wrap';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'normal';
        text.textContent = (q.done ? '(answered) ' : '? ') + q.text + '  (' + (q.title || q.url).slice(0, 50) + ')';
        row.appendChild(text);
        row.appendChild(VexSettingsGroups.button('Open page', () => { if (typeof TabManager !== 'undefined') TabManager.createTab(q.url, true); }, { label: 'Open the page of this question' }));
        row.appendChild(VexSettingsGroups.button('Copy', async () => { try { await navigator.clipboard.writeText(q.text); window.showToast?.('Copied', 'info', 2000); } catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); } }, { label: 'Copy this question' }));
        row.appendChild(VexSettingsGroups.button(q.done ? 'Ask again' : 'Answered', () => { try { this.setDone(q.id, !q.done); draw(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { label: (q.done ? 'Mark as not answered: ' : 'Mark as answered: ') + q.text.slice(0, 40) }));
        row.appendChild(VexSettingsGroups.button('Remove', () => {
          const gone = this.remove(q.id);
          draw();
          if (gone) window.VexUndo.offer({ message: 'Removed a question', undo: () => { this.restore(gone); if (body.isConnected) draw(); } });
        }, { danger: true, label: 'Remove this question' }));
        body.appendChild(row);
      }
    };
    draw();
    return body;
  },

  // ---- Morning Brief section (the count on the New Tab page) ----------------------------------
  section() {
    return {
      id: 'study-questions', title: 'Questions to ask', icon: 'flag', order: 12, defaultOn: true, maxItems: 4, ttlMs: 30000,
      build: async () => {
        if (!this.enabled()) return null;
        const open = this.questions().filter(q => !q.done).sort((a, b) => b.at - a.at);
        if (!open.length) return null;
        return {
          summary: open.length === 1 ? '1 question to ask later' : open.length + ' questions to ask later',
          items: open.slice(0, 4).map(q => { let host = ''; try { host = new URL(q.url).hostname.replace(/^www\./, ''); } catch { host = ''; } return { text: q.text.slice(0, 120), sub: host, url: q.url }; }),
        };
      },
    };
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('A Cornell note (cues and questions, notes, summary) filled in with the page in front, and a ? you can put on a passage to ask about later. The count shows in the Morning Brief on the New Tab page. Ctrl+K › New Cornell note, Flag a question, Questions to ask.'));
    el.appendChild(VexSettingsGroups.button('New Cornell note', async () => { try { await this.newCornell(); } catch (err) { window.showToast?.(err.message, 'error'); } }, { primary: true }));
    el.appendChild(VexSettingsGroups.button('Questions to ask', () => this.open()));
  },
};

if (typeof window !== 'undefined') {
  window.VexStudyNotes = VexStudyNotes;
  if (typeof VexBrief !== 'undefined') VexBrief.register(VexStudyNotes.section());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'study-notes', title: 'Study notes', keywords: 'study cornell note cues summary question margin ask later flag exam revision', before: 'about', build: (el) => VexStudyNotes.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    const run = (fn) => async () => { try { await fn(); } catch (err) { window.showToast?.(err.message, 'error'); } };
    VexExtras.registerCommand({ id: 'cornell-note', label: 'New Cornell note', hint: 'Cues, notes and summary, filled in with this page', icon: 'note', action: run(() => VexStudyNotes.newCornell()) });
    VexExtras.registerCommand({ id: 'flag-question', label: 'Flag a question (?)', hint: 'Put a ? on the selected passage to ask about later', icon: 'flag', action: run(() => VexStudyNotes.flagSelection()) });
    VexExtras.registerCommand({ id: 'questions-to-ask', label: 'Questions to ask', hint: 'The passages you flagged with a ?', icon: 'flag', action: () => VexStudyNotes.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexStudyNotes };
