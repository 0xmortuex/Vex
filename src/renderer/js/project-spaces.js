// === Project spaces ========================================================
//
// A piece of work is more than its tabs: there is a note you keep adding to,
// a repository, a mail thread that matters this week, and a conversation with
// the AI about it. A workspace holds the tabs; the rest is scattered.
//
// A project space ties them together and switches them as one:
//   tabs         a workspace of its own (js/workspaces.js does the switching,
//                so groups, stacks, sleeping tabs and Undo all work as there)
//   notes        the notes you put in it
//   repository   a GitHub repo, one click to open
//   mail filter  words that narrow the mail list while the space is on
//   AI thread    the conversation, saved when you leave and put back when
//                you return (an empty conversation only — it never writes
//                over one you have started)
//
// One key moves to the next space (Ctrl+Alt+O, rebindable), and each space is
// a Ctrl+K command. Private and Tor tabs are never in a space, as in a
// workspace. Nothing here leaves the PC.
//
// Parsing (normalizeRepo, parseMailFilter, mailMatches, nextId) is pure.
const ProjectSpaces = {
  KEY: 'vex.projectSpaces',
  ACTIVE_KEY: 'vex.projectSpaces.active',
  MAX: 30,
  MAX_THREAD: 40,
  spaces: [],
  _mailAll: false,                 // "Show all mail" for this run

  // --- pure --------------------------------------------------------------------
  // "owner/name", or a github.com address for one → 'owner/name'; '' clears.
  normalizeRepo(input) {
    const s = String(input == null ? '' : input).trim();
    if (!s) return '';
    const url = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[\/?#].*)?$/i.exec(s);
    const m = url || /^([\w.-]+)\/([\w.-]+)$/.exec(s);
    if (!m) throw new Error('Write the repository as owner/name, or paste its github.com address');
    return m[1] + '/' + m[2];
  },

  // "from:alice invoice subject:Q3" → [{field, word}] (field '' = anywhere).
  parseMailFilter(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).map(tok => {
      const m = /^(from|subject):(.+)$/i.exec(tok);
      return m ? { field: m[1].toLowerCase(), word: m[2].toLowerCase() } : { field: '', word: tok.toLowerCase() };
    });
  },

  // A message header as main sends it: { subject, from: { name, address } }.
  mailMatches(message, filterText) {
    const clauses = this.parseMailFilter(filterText);
    if (!clauses.length) return true;
    const subject = String(message.subject || '').toLowerCase();
    const from = (String((message.from && message.from.name) || '') + ' ' + String((message.from && message.from.address) || '')).toLowerCase();
    return clauses.every(c => c.field === 'from' ? from.includes(c.word)
      : c.field === 'subject' ? subject.includes(c.word)
        : subject.includes(c.word) || from.includes(c.word));
  },

  // The space after `currentId`, wrapping; the first when none is current.
  nextId(spaces, currentId) {
    if (!spaces.length) return null;
    const i = spaces.findIndex(s => s.id === currentId);
    return spaces[(i + 1) % spaces.length].id;
  },

  // --- store -------------------------------------------------------------------
  init() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (err) { throw new Error('Could not read the project spaces: ' + err.message); }
    let list = [];
    if (raw) {
      try { list = JSON.parse(raw); } catch (err) { throw new Error('The project spaces are not valid JSON: ' + err.message); }
    }
    this.spaces = (Array.isArray(list) ? list : []).filter(s => s && typeof s.id === 'string' && typeof s.name === 'string');
    this._register();
    return this;
  },

  save() {
    this.spaces = this.spaces.slice(0, this.MAX);
    localStorage.setItem(this.KEY, JSON.stringify(this.spaces));
    this._register();
  },

  list() { return this.spaces.slice(); },
  get(id) { return this.spaces.find(s => s.id === id) || null; },
  activeId() { try { return localStorage.getItem(this.ACTIVE_KEY) || null; } catch { return null; } },
  active() { return this.get(this.activeId()); },

  // Data hook: the active space and the others, as plain data.
  snapshot() {
    const a = this.active();
    return {
      active: a ? { id: a.id, name: a.name, repo: a.repo || '', notes: (a.noteIds || []).length, mailFilter: a.mailFilter || '', hasThread: !!(a.thread && a.thread.length) } : null,
      spaces: this.spaces.map(s => ({ id: s.id, name: s.name })),
    };
  },

  // A new space with a workspace of its own. With `fromCurrentTabs` the tabs
  // open now go into it (and leave the workspace they were in when you switch).
  async create(name, { repo = '', mailFilter = '', fromCurrentTabs = false } = {}) {
    const n = String(name == null ? '' : name).trim();
    if (!n) throw new Error('Give the space a name');
    if (n.length > 80) throw new Error('That name is too long');
    if (this.spaces.some(s => s.name.toLowerCase() === n.toLowerCase())) throw new Error('There is already a space called "' + n + '"');
    if (typeof WorkspaceManager === 'undefined') throw new Error('Workspaces are not available');
    const ws = WorkspaceManager.addWorkspace(n);
    if (fromCurrentTabs) {
      ws.tabs = window.VexTabPolicy.snapshot(TabManager.tabs);
      ws.groups = TabManager.groups.map(g => ({ ...g }));
      ws.activeTabIndex = Math.max(0, ws.tabs.findIndex(t => t.id === TabManager.activeTabId));
      WorkspaceManager.save();
    }
    const space = {
      id: window.vexId('space'), name: n, workspaceId: ws.id, at: Date.now(),
      repo: this.normalizeRepo(repo), mailFilter: String(mailFilter || '').trim(), noteIds: [], thread: [],
    };
    this.spaces.unshift(space);
    this.save();
    return space;
  },

  rename(id, name) {
    const s = this.get(id);
    if (!s) throw new Error('That space is gone');
    const n = String(name == null ? '' : name).trim();
    if (!n) throw new Error('Give the space a name');
    if (this.spaces.some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error('There is already a space called "' + n + '"');
    s.name = n;
    const ws = typeof WorkspaceManager !== 'undefined' ? WorkspaceManager.workspaces.find(w => w.id === s.workspaceId) : null;
    if (ws) { ws.name = n; WorkspaceManager.save(); WorkspaceManager.render(); }
    this.save();
    return s;
  },

  // The space goes; its workspace and its notes stay (they are yours).
  removeWithUndo(id, redraw) {
    const removed = window.VexUndo.takeOut(this.spaces, s => s.id === id);
    if (!removed) return false;
    const wasActive = this.activeId() === id;
    if (wasActive) localStorage.removeItem(this.ACTIVE_KEY);
    this.save();
    if (redraw) redraw();
    window.VexUndo.offer({
      message: 'Deleted the space "' + removed.item.name + '" (its workspace and notes are kept)',
      undo: () => {
        window.VexUndo.putBack(this.spaces, removed);
        if (wasActive) localStorage.setItem(this.ACTIVE_KEY, id);
        this.save();
        if (redraw) redraw();
      },
    });
    return true;
  },

  setRepo(id, input) { const s = this.get(id); if (!s) throw new Error('That space is gone'); s.repo = this.normalizeRepo(input); this.save(); return s; },
  setMailFilter(id, text) { const s = this.get(id); if (!s) throw new Error('That space is gone'); s.mailFilter = String(text || '').trim().slice(0, 200); this._mailAll = false; this.save(); return s; },

  addNote(id, noteId) {
    const s = this.get(id);
    if (!s) throw new Error('That space is gone');
    if (!noteId) throw new Error('Open a note first');
    if (!(s.noteIds || (s.noteIds = [])).includes(noteId)) s.noteIds.push(noteId);
    this.save();
    return s;
  },
  removeNote(id, noteId) { const s = this.get(id); if (!s) throw new Error('That space is gone'); s.noteIds = (s.noteIds || []).filter(n => n !== noteId); this.save(); return s; },
  notes(id) {
    const s = this.get(id);
    if (!s) return [];
    let all = [];
    try { all = JSON.parse(localStorage.getItem('vex.notes') || '[]'); } catch (err) { throw new Error('Could not read the notes: ' + err.message); }
    const byId = new Map((Array.isArray(all) ? all : []).map(n => [n.id, n]));
    return (s.noteIds || []).map(n => byId.get(n)).filter(Boolean);
  },

  // --- the AI thread -------------------------------------------------------------
  _conv() {
    if (typeof AIPanel === 'undefined' || typeof AIPanel._getConv !== 'function') return null;
    return AIPanel._getConv();
  },

  // The conversation open now, kept with the space.
  saveThread(id) {
    const s = this.get(id);
    if (!s) throw new Error('That space is gone');
    const conv = this._conv();
    if (!conv) throw new Error('The AI panel is not available');
    s.thread = conv.filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
      .slice(-this.MAX_THREAD).map(m => ({ role: m.role, content: m.content, ...(Number.isFinite(m.at) ? { at: m.at } : {}) }));
    this.save();
    return s.thread.length;
  },

  // Only into an empty conversation: a chat you have started is never replaced.
  restoreThread(id) {
    const s = this.get(id);
    if (!s || !(s.thread && s.thread.length)) return 0;
    const conv = this._conv();
    if (!conv || conv.length) return 0;
    conv.push(...s.thread.map(m => ({ ...m })));
    if (typeof AIPanel._persistConversations === 'function') AIPanel._persistConversations();
    if (typeof AIPanel._renderMessages === 'function' && AIPanel.isOpen && AIPanel.isOpen()) AIPanel._renderMessages();
    return s.thread.length;
  },

  // --- switching -----------------------------------------------------------------
  async switchTo(id) {
    const s = this.get(id);
    if (!s) throw new Error('That space is gone');
    if (typeof WorkspaceManager === 'undefined') throw new Error('Workspaces are not available');
    if (!WorkspaceManager.workspaces.some(w => w.id === s.workspaceId)) {
      // Its workspace was deleted: make it again rather than refuse.
      s.workspaceId = WorkspaceManager.addWorkspace(s.name).id;
      this.save();
    }
    const leaving = this.active();
    if (leaving && leaving.id !== id) {
      try { this.saveThread(leaving.id); } catch (err) { window.VexProblems?.note('Project space', 'Could not keep the AI thread of "' + leaving.name + '"', err); }
    }
    await WorkspaceManager.switchTo(s.workspaceId);
    if (WorkspaceManager.activeId !== s.workspaceId) throw new Error('The switch did not happen');
    localStorage.setItem(this.ACTIVE_KEY, id);
    this._mailAll = false;
    const back = this.restoreThread(id);
    window.showToast?.('Space: ' + s.name + (s.mailFilter ? ' · mail filtered' : '') + (back ? ' · AI thread restored' : ''));
    document.dispatchEvent(new CustomEvent('vex:space-changed', { detail: { id, name: s.name } }));
    return s;
  },

  async next() {
    const id = this.nextId(this.spaces, this.activeId());
    if (!id) { window.showToast?.('No project spaces yet — make one from Ctrl+K › Project spaces'); return null; }
    if (id === this.activeId()) { window.showToast?.('This is the only space'); return this.active(); }
    return this.switchTo(id);
  },

  openRepo(id) {
    const s = this.get(id || this.activeId());
    if (!s || !s.repo) throw new Error('This space has no repository yet');
    TabManager.createTab('https://github.com/' + s.repo, true);
  },

  // --- the mail filter, used by the mail list -----------------------------------
  // → { shown, hidden, filter } for the messages about to be listed.
  filterMail(messages) {
    const s = this.active();
    if (!s || !s.mailFilter || this._mailAll) return { shown: messages, hidden: 0, filter: '' };
    const shown = messages.filter(m => this.mailMatches(m, s.mailFilter));
    return { shown, hidden: messages.length - shown.length, filter: s.mailFilter };
  },
  showAllMail(on = true) { this._mailAll = !!on; },

  // --- Ctrl+K ----------------------------------------------------------------------
  _register() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    CommandBar.commands = CommandBar.commands.filter(c => !String(c.id || '').startsWith('space:'));
    for (const s of this.spaces) {
      CommandBar.commands.push({
        id: 'space:' + s.id, label: 'Space: ' + s.name, icon: 'folder',
        hint: 'Switch to this project — its tabs, notes' + (s.repo ? ', ' + s.repo : '') + (s.mailFilter ? ', its mail' : '') + ' and AI thread',
        action: () => this.switchTo(s.id),
      });
    }
  },

  // --- the manager -----------------------------------------------------------------
  async open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body, close } = window.PageExport._sheet('Project spaces', 'vex-spaces-overlay');
    const btn = 'font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer';
    head.insertAdjacentHTML('beforeend', `<button data-new type="button" style="${btn}">New space…</button>`);
    const fail = (err) => window.showToast?.((err && err.message) || 'That did not work', 'error');

    const draw = () => {
      const active = this.activeId();
      if (!this.spaces.length) {
        body.innerHTML = window.VexUI.emptyState('folder', 'No project spaces yet', 'A space switches your tabs, notes, repository, mail filter and AI thread together.');
        return;
      }
      body.innerHTML = '<div data-rows style="padding:6px"></div>';
      const rows = body.querySelector('[data-rows]');
      for (const s of this.spaces) {
        const notes = this.notes(s.id);
        const row = document.createElement('div');
        row.style.cssText = 'padding:9px 10px;border-radius:9px;border:1px solid var(--border);margin-bottom:6px;' + (s.id === active ? 'border-color:var(--primary)' : '');
        row.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-flex;color:var(--text-muted)">${window.VexIcons.svg('folder', { size: 15 })}</span>
            <div style="flex:1;min-width:0;font-size:13px;font-weight:650">${esc(s.name)}${s.id === active ? ' <span style="font-weight:400;font-size:11px;color:var(--primary)">on now</span>' : ''}</div>
            ${s.id === active ? '' : `<button data-go type="button" style="${btn}">Switch</button>`}
            <button data-del type="button" aria-label="Delete the space ${esc(s.name)}" style="${btn};display:inline-flex">${window.VexIcons.svg('trash', { size: 12 })}</button>
          </div>
          <div style="margin-top:6px;display:grid;grid-template-columns:auto 1fr auto;gap:4px 8px;font-size:11.5px;color:var(--text-muted);align-items:center">
            <span>Repository</span><span>${s.repo ? esc(s.repo) : 'none'}</span><span><button data-repo type="button" style="${btn}">${s.repo ? 'Change' : 'Set'}</button>${s.repo ? ` <button data-openrepo type="button" style="${btn}">Open</button>` : ''}</span>
            <span>Mail filter</span><span>${s.mailFilter ? esc(s.mailFilter) : 'none'}</span><span><button data-mail type="button" style="${btn}">${s.mailFilter ? 'Change' : 'Set'}</button></span>
            <span>Notes</span><span>${notes.length ? notes.map(n => esc(n.title || 'Untitled')).join(', ') : 'none'}</span><span><button data-addnote type="button" style="${btn}">Add open note</button></span>
            <span>AI thread</span><span>${s.thread && s.thread.length ? s.thread.length + ' messages kept' : 'none'}</span><span><button data-thread type="button" style="${btn}">Keep current</button></span>
          </div>`;
        const act = (sel, fn) => row.querySelector(sel)?.addEventListener('click', async () => { try { await fn(); } catch (err) { fail(err); } });
        act('[data-go]', async () => { close(); await this.switchTo(s.id); });
        act('[data-del]', async () => {
          const ok = await vexConfirm({ title: 'Delete the space "' + s.name + '"?', message: 'Its workspace and notes stay where they are.', okLabel: 'Delete', danger: true });
          if (ok) this.removeWithUndo(s.id, draw);
        });
        act('[data-repo]', async () => {
          const v = await vexPrompt({ title: 'Repository', label: 'owner/name, or a github.com address (empty removes it)', value: s.repo || '' });
          if (v == null) return;
          this.setRepo(s.id, v); draw();
        });
        act('[data-openrepo]', async () => this.openRepo(s.id));
        act('[data-mail]', async () => {
          const v = await vexPrompt({ title: 'Mail filter', label: 'Words in the subject or sender; from:name or subject:word to be exact (empty removes it)', value: s.mailFilter || '' });
          if (v == null) return;
          this.setMailFilter(s.id, v); draw();
        });
        act('[data-addnote]', async () => {
          const noteId = typeof NotesPanel !== 'undefined' ? NotesPanel.activeNoteId : null;
          if (!noteId) throw new Error('Open a note in the Notes panel first');
          this.addNote(s.id, noteId); draw();
        });
        act('[data-thread]', async () => { const n = this.saveThread(s.id); window.showToast?.('Kept ' + n + ' messages'); draw(); });
        rows.appendChild(row);
      }
    };

    head.querySelector('[data-new]').addEventListener('click', async () => {
      try {
        const name = await vexPrompt({ title: 'New project space', label: 'Name', value: '' });
        if (name == null) return;
        const withTabs = await vexConfirm({ title: 'Start with the tabs open now?', message: 'They move into the new space. Choose No for an empty one.', okLabel: 'Move them', cancelLabel: 'Empty' });
        const s = await this.create(name, { fromCurrentTabs: !!withTabs });
        draw();
        window.showToast?.('Made the space "' + s.name + '"');
      } catch (err) { fail(err); }
    });
    draw();
    return close;
  },
};

if (typeof window !== 'undefined') window.ProjectSpaces = ProjectSpaces;
if (typeof module !== 'undefined' && module.exports) module.exports = { ProjectSpaces };
