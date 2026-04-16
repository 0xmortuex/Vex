// === Vex Tab Session Manager ===

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

  saveCurrentSession(name) {
    const session = {
      id: 'sess_' + Date.now(),
      name: name || 'Session ' + new Date().toLocaleString(),
      createdAt: new Date().toISOString(),
      tabs: TabManager.tabs.map(t => ({ url: t.url, title: t.title, groupId: t.groupId })),
      groups: TabManager.groups,
      activeTabIndex: TabManager.tabs.findIndex(t => t.id === TabManager.activeTabId)
    };
    this.sessions.unshift(session);
    if (this.sessions.length > 50) this.sessions.length = 50;
    this.save();
    this.renderList();
    window.showToast?.('Session saved: ' + name);
    return session;
  },

  async restoreSession(sessionId, replace = true) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (replace) {
      // Close all current tabs
      while (TabManager.tabs.length > 0) {
        TabManager.closeTab(TabManager.tabs[0].id);
      }
      // Restore groups
      if (session.groups) {
        TabManager.groups = session.groups;
        await VexStorage.saveGroups(TabManager.groups);
        TabManager.renderGroups();
      }
    }

    // Open all tabs from session
    for (const t of session.tabs) {
      TabManager.createTab(t.url, false, t.groupId);
    }

    // Activate correct tab
    const idx = session.activeTabIndex >= 0 ? session.activeTabIndex : 0;
    if (TabManager.tabs[idx]) {
      TabManager.switchTab(TabManager.tabs[idx].id);
    }

    this.hideOverlay();
    window.showToast?.('Restored: ' + session.name);
  },

  deleteSession(sessionId) {
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    this.save();
    this.renderList();
  },

  renameSession(sessionId, newName) {
    const s = this.sessions.find(s => s.id === sessionId);
    if (s) { s.name = newName; this.save(); this.renderList(); }
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
      this.saveCurrentSession(name);
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

  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
};
