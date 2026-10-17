// === Vex Tab Session Manager ===
//
// Save/restore named snapshots of the current tabs + groups. Stored in
// localStorage under 'vex.sessions' (mirrored to disk via PersistentStorage).
// Restore can replace the current tab set or merge into it.
// Public API: SessionManager (singleton — init, saveCurrentSession,
// restoreSession, deleteSession, renameSession, toggle/show/hideOverlay).
// Depends on TabManager, VexStorage, window.showToast.

const SessionManager = {
  sessions: [],
  STORAGE_KEY: 'vex.sessions',

  async init() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) { try { this.sessions = JSON.parse(saved); } catch {} }
    this.buildUI();
  },

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.sessions));
  },

  // `onlyTabs` saves a subset — a tab group saved as a session, from the
  // group's own right-click menu. `auto` is Settings › "Auto-save session
  // every 10 minutes": it keeps one session, replaced each time, says nothing,
  // and is never one of the 50 kept of your own. Each autosave used to be a
  // new session with a toast, so after about eight hours they had pushed
  // every session you named out of the list (found 2026-10-09).
  saveCurrentSession(name, onlyTabs, { auto = false } = {}) {
    // No tab of a private window is ever collected, so this said "Session
    // saved" over a session with no tabs in it (found 2026-09-29).
    if (window.VexTabPolicy.isPrivateWindow) throw new Error('A private window is never saved — its tabs are forgotten when it closes');
    const tabs = window.VexTabPolicy.snapshot(onlyTabs || TabManager.tabs);
    // Only when saving a chosen set (a tab group): "save this group" that
    // silently saves nothing is worse than an error. Saving the window as it
    // is keeps its old behaviour, empty or not.
    if (onlyTabs && !tabs.length) throw new Error('There is nothing to save — a private tab is never collected');
    const session = {
      id: vexId('sess_'),
      name: name || 'Session ' + new Date().toLocaleString(),
      createdAt: new Date().toISOString(),
      tabs,
      groups: TabManager.groups.map(g => ({ ...g })),
      // Stacks, as a workspace keeps them: a session lost them, each member
      // coming back a loose tab (found 2026-10-10).
      stacks: (TabManager.stacks || []).filter(s => tabs.some(t => t.stackId === s.id)).map(s => ({ ...s })),
      activeTabIndex: tabs.findIndex(t => t.id === TabManager.activeTabId),
      ...(auto ? { auto: true } : {})
    };
    if (auto) this.sessions = this.sessions.filter(s => !s.auto);
    this.sessions.unshift(session);
    const named = this.sessions.filter(s => !s.auto);
    if (named.length > 50) { const dropped = new Set(named.slice(50)); this.sessions = this.sessions.filter(s => !dropped.has(s)); }
    this.save();
    this.renderList();
    if (!auto) window.showToast?.('Session saved: ' + name);
    return session;
  },

  // Opening a session adds its tabs beside the ones open now. With replace
  // ("Replace my tabs") the tabs open now are closed as Close Others closes
  // them: into Recently Closed, with Undo on the toast, which also takes the
  // session's tabs away again. Replacing closed every tab at once, with no
  // word, no Undo and nothing in Recently Closed, and was what the one button
  // did (found 2026-10-10). Private and Tor tabs are left open either way:
  // they could never come back.
  async restoreSession(sessionId, replace = false) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;
    const ephemeral = (t) => !!t.partition && !String(t.partition).startsWith('persist:');
    const before = TabManager.tabs.filter(t => !ephemeral(t)).map(t => t.id);
    const wasActive = TabManager.activeTabId;

    // Its groups, beside the ones open now (one open now is shared).
    const added = { groups: new Set(), stacks: new Set() };
    for (const g of Array.isArray(session.groups) ? session.groups : []) {
      if (g && g.id && !TabManager.groups.some(x => x.id === g.id)) { TabManager.groups.push({ ...g }); added.groups.add(g.id); }
    }
    // Its stacks, as a workspace switch puts them back. A stack whose id is
    // open now is given a new one, so two sets never merge into one.
    const stackIds = new Map();
    for (const s of Array.isArray(session.stacks) ? session.stacks : []) {
      if (!s || !s.id) continue;
      const id = TabManager.stacks.some(x => x.id === s.id) ? TabManager._newStackId() : s.id;
      stackIds.set(s.id, id);
      added.stacks.add(id);
      TabManager.stacks.push({ ...s, id });
    }
    const savedTabs = (Array.isArray(session.tabs) ? session.tabs : [])
      .map(t => (t && t.stackId ? { ...t, stackId: stackIds.get(t.stackId) || null } : t));

    // Recreate the session's tabs LAZILY, as a workspace switch does: only the
    // tab switched to below gets a page. Creating them with createTab loaded
    // every page of the session at once (found 2026-09-29).
    const restored = TabManager.addSavedTabs(savedTabs);
    const restoredTabs = restored.map(r => r.tab);
    for (const [oldId, id] of stackIds) {
      const stack = TabManager.stacks.find(s => s.id === id);
      const old = (session.stacks || []).find(s => s.id === oldId);
      const top = restored.find(r => r.saved.id === (old && old.topTabId) && r.tab.stackId === id);
      stack.topTabId = top ? top.tab.id : (TabManager.tabs.find(t => t.stackId === id) || {}).id || null;
    }
    this._dropEmpty(added);
    await VexStorage.saveGroups(TabManager.groups);
    if (typeof VexStorage.saveStacks === 'function') await VexStorage.saveStacks(TabManager.stacks);
    // One drawing pass with the groups and stacks there first: groups were
    // drawn before their tabs existed, which hides an empty group, so the
    // tabs landed loose in the side list (found 2026-10-10).
    TabManager.rebuildAllTabs();

    // Activate correct tab
    const selected = restored.find(r => r.saved === savedTabs[session.activeTabIndex]);
    if (selected || restored[0]) {
      TabManager.switchTab((selected || restored[0]).tab.id);
    } else if (!TabManager.tabs.length) {
      TabManager.createTab(START_URL, true);
    }

    // A kept-awake tab has to be live, the way TabManager.init brings them
    // back at start-up (found 2026-09-29).
    TabManager.bringKeptAwakeLive(restoredTabs);

    this.hideOverlay();
    await TabManager.persistTabs();

    const old = before.filter(id => TabManager.tabs.some(t => t.id === id));
    if (replace && restoredTabs.length && old.length) {
      TabManager.closeTabsWithUndo(old, `Replaced ${old.length} tab${VexPlural.s(old.length)} with “${session.name}”`, {
        onUndo: () => this._takeBack(restoredTabs, wasActive, added),
      });
    } else {
      window.showToast?.('Opened: ' + session.name);
    }
  },

  // Undo of "Replace my tabs": the session's tabs close again (they are not
  // "recently closed", they were only just opened), with any group or stack
  // they brought, and the tab in front before goes back in front.
  _takeBack(tabs, wasActive, added) {
    TabManager._bulkClosing = true;
    try { for (const tab of tabs) TabManager.closeTab(tab.id); }
    finally { TabManager._bulkClosing = false; }
    this._dropEmpty(added);
    VexStorage.saveGroups(TabManager.groups);
    if (typeof VexStorage.saveStacks === 'function') VexStorage.saveStacks(TabManager.stacks);
    if (!TabManager.tabs.length) TabManager.createTab(START_URL, true);
    TabManager.rebuildAllTabs();
    const front = TabManager.tabs.find(t => t.id === wasActive) || TabManager.tabs[0];
    TabManager.switchTab(front.id);
    TabManager.persistTabs();
  },

  // The groups and stacks a session brought that have no tab in them.
  _dropEmpty(added) {
    const used = (key, id) => TabManager.tabs.some(t => t[key] === id);
    TabManager.groups = TabManager.groups.filter(g => !added.groups.has(g.id) || used('groupId', g.id));
    TabManager.stacks = TabManager.stacks.filter(s => !added.stacks.has(s.id) || used('stackId', s.id));
  },

  // Gone at once, with Undo on the toast (it went without a word).
  deleteSession(sessionId) {
    const index = this.sessions.findIndex(s => s.id === sessionId);
    if (index < 0) return null;
    const [removed] = this.sessions.splice(index, 1);
    this.save();
    this.renderList();
    window.VexUndo.offer({
      message: `Deleted the session “${removed.name}”`,
      undo: () => {
        if (this.sessions.some(s => s.id === removed.id)) return;
        this.sessions.splice(Math.min(index, this.sessions.length), 0, removed);
        this.save();
        this.renderList();
      },
    });
    return removed;
  },

  renameSession(sessionId, newName) {
    const s = this.sessions.find(s => s.id === sessionId);
    // A renamed autosave is yours: the next autosave no longer replaces it.
    if (s) { s.name = newName; delete s.auto; this.save(); this.renderList(); }
  },

  buildUI() {
    const overlay = document.getElementById('sessions-overlay');
    if (!overlay) return;

    overlay.innerHTML = `
      <div id="sessions-panel">
        <div class="sessions-header">
          <h3>Sessions</h3>
          <button class="sessions-close" id="sessions-close-btn">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="sessions-save-row">
          <input type="text" id="session-name-input" placeholder="Session name..." spellcheck="false">
          <button id="session-save-btn">Save</button>
        </div>
        <div class="sessions-list" id="sessions-list"></div>
      </div>
    `;

    document.getElementById('sessions-close-btn').addEventListener('click', () => this.hideOverlay());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hideOverlay(); });

    document.getElementById('session-save-btn').addEventListener('click', () => {
      const input = document.getElementById('session-name-input');
      const name = input.value.trim() || 'Session ' + new Date().toLocaleString();
      try { this.saveCurrentSession(name); }
      catch (err) { window.showToast?.(err.message, 'error'); return; }
      input.value = '';
    });

    document.getElementById('session-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('session-save-btn').click();
      if (e.key === 'Escape') this.hideOverlay();
    });

    this.renderList();
  },

  renderList() {
    const list = document.getElementById('sessions-list');
    if (!list) return;

    if (this.sessions.length === 0) {
      list.innerHTML = '<div class="sessions-empty">No saved sessions yet</div>';
      return;
    }

    list.innerHTML = this.sessions.map(s => {
      const date = new Date(s.createdAt).toLocaleDateString((window.VexI18n?.dateLocale('en-US') || 'en-US'), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="session-item" data-id="${s.id}">
          <div class="session-item-info">
            <div class="session-item-name">${this._esc(s.name)}</div>
            <div class="session-item-meta">${s.tabs.length} tabs &middot; ${date}</div>
          </div>
          <div class="session-item-actions">
            <button class="sess-restore" title="Open beside your tabs" aria-label="Open ${this._esc(s.name)} beside your tabs">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            </button>
            <button class="sess-replace" title="Replace my tabs (Undo brings them back)" aria-label="Replace my tabs with ${this._esc(s.name)}">${VexIcons.svg('swap', { size: 14 })}</button>
            <button class="sess-delete danger" title="Delete" aria-label="Delete ${this._esc(s.name)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.sess-restore').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.session-item').dataset.id;
        this.restoreSession(id);
      });
    });

    list.querySelectorAll('.sess-replace').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.session-item').dataset.id;
        this.restoreSession(id, true);
      });
    });

    list.querySelectorAll('.sess-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.session-item').dataset.id;
        this.deleteSession(id);
      });
    });
  },

  showOverlay() {
    document.getElementById('sessions-overlay')?.classList.add('visible');
    document.getElementById('session-name-input')?.focus();
  },

  hideOverlay() {
    document.getElementById('sessions-overlay')?.classList.remove('visible');
  },

  toggle() {
    const overlay = document.getElementById('sessions-overlay');
    if (overlay?.classList.contains('visible')) this.hideOverlay();
    else this.showOverlay();
  },

  _esc(s) { return window.escapeHtml(s); }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { SessionManager };
if (typeof window !== 'undefined') window.addEventListener('vex-sync-data-applied', () => {
  const saved = JSON.parse(localStorage.getItem(SessionManager.STORAGE_KEY) || '[]');
  SessionManager.sessions = Array.isArray(saved) ? saved : [];
  SessionManager.renderList();
});
