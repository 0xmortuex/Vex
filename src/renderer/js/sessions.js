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

  async restoreSession(sessionId, replace = true) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (replace) {
      // Close all current tabs. closeTab() auto-creates a START_URL tab whenever
      // the set hits zero, so without _bulkClosing this while-loop would spin
      // forever (close → auto-recreate → length still > 0 → …) and freeze the
      // browser. _bulkClosing makes closeTab skip the auto-create (same guard the
      // workspace-switch bulk close uses).
      TabManager._bulkClosing = true;
      try {
        while (TabManager.tabs.length > 0) {
          TabManager.closeTab(TabManager.tabs[0].id);
        }
      } finally {
        TabManager._bulkClosing = false;
      }
      // Restore groups
      if (session.groups) {
        TabManager.groups = session.groups.map(g => ({ ...g }));
        await VexStorage.saveGroups(TabManager.groups);
        TabManager.renderGroups();
      }
    }

    // Recreate the session's tabs LAZILY, as a workspace switch does: only the
    // tab switched to below gets a page. Creating them with createTab loaded
    // every page of the session at once (found 2026-09-29).
    const restored = [];
    let selected = null;
    for (const [index, t] of (Array.isArray(session.tabs) ? session.tabs : []).entries()) {
      if (!window.VexTabPolicy.canRestore(t)) continue;
      const tab = TabManager.createLazyTab(t.url, t.groupId, t.title, { partition: t.partition, pinned: t.pinned });
      tab.keepAwakeUntil = t.keepAwakeUntil || 0;
      // The session keeps each tab's note (VexTabPolicy.serialize); restoring
      // dropped it (found 2026-09-29).
      if (t.note) tab.note = t.note;
      tab.favicon = TabManager._persistableFavicon(t.favicon, tab.partition);
      TabManager.renderTabUpdate(tab);
      restored.push(tab);
      if (index === session.activeTabIndex) selected = tab;
    }

    // Activate correct tab
    if (selected || restored[0]) {
      TabManager.switchTab((selected || restored[0]).id);
    } else if (!TabManager.tabs.length) {
      TabManager.createTab(START_URL, true);
    }

    // A kept-awake tab has to be live, the way TabManager.init brings them
    // back at start-up: restored lazily, it stayed unloaded until clicked
    // (found 2026-09-29).
    for (const tab of restored) {
      if (tab.id === TabManager.activeTabId || !tab._lazy || !TabManager._isKeptAwake(tab)) continue;
      try { TabManager._materializeTab(tab); }
      catch (err) {
        console.error('[Sessions] could not load a kept-awake tab:', err);
        window.showToast?.('Could not load kept-awake tab ' + (tab.title || tab.url) + ': ' + err.message, 'error');
      }
    }

    this.hideOverlay();
    await TabManager.persistTabs();
    window.showToast?.('Restored: ' + session.name);
  },

  deleteSession(sessionId) {
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    this.save();
    this.renderList();
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
      const date = new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `
        <div class="session-item" data-id="${s.id}">
          <div class="session-item-info">
            <div class="session-item-name">${this._esc(s.name)}</div>
            <div class="session-item-meta">${s.tabs.length} tabs &middot; ${date}</div>
          </div>
          <div class="session-item-actions">
            <button class="sess-restore" title="Restore">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            </button>
            <button class="sess-delete danger" title="Delete">
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
