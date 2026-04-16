// === Vex Restore Tabs Prompt ===

const RestorePrompt = {
  STORAGE_KEY: 'vex.lastSessionTabs',
  _autoDismissTimer: null,
  _dismissed: false,

  saveBeforeQuit() {
    const tabs = TabManager.tabs.map(t => ({
      url: t.url, title: t.title, groupId: t.groupId, pinned: t.pinned || false
    }));
    if (tabs.length === 0) return;
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
      tabs,
      groups: TabManager.groups,
      activeTabIndex: TabManager.tabs.findIndex(t => t.id === TabManager.activeTabId),
      savedAt: new Date().toISOString()
    }));
  },

  async checkOnStartup(settings) {
    const behavior = settings.restoreOnStartup || 'ask';
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (!saved) return;

    let lastSession;
    try { lastSession = JSON.parse(saved); } catch { return; }
    if (!lastSession.tabs || lastSession.tabs.length === 0) return;

    localStorage.removeItem(this.STORAGE_KEY);

    if (behavior === 'always') {
      this._restore(lastSession);
    } else if (behavior === 'ask') {
      this._showPrompt(lastSession);
    }
  },

  _restore(session) {
    if (TabManager.tabs.length === 1 && isStartPage(TabManager.tabs[0].url)) {
      TabManager.closeAllTabs();
    }

    if (session.groups) {
      TabManager.groups = session.groups;
      VexStorage.saveGroups(TabManager.groups);
      TabManager.renderGroups();
    }

    for (const t of session.tabs) {
      TabManager.createLazyTab(t.url, t.groupId, t.title);
    }

    const idx = session.activeTabIndex >= 0 && session.activeTabIndex < TabManager.tabs.length
      ? session.activeTabIndex : 0;
    if (TabManager.tabs[idx]) {
      TabManager.switchTab(TabManager.tabs[idx].id);
    }

    window.showToast?.(`Restored ${session.tabs.length} tabs`);
  },

  _showPrompt(session) {
    this._dismissed = false;
    const el = document.getElementById('restore-prompt');
    if (!el) return;

    el.querySelector('.restore-prompt-text').innerHTML =
      `Reopen <strong>${session.tabs.length} tab${session.tabs.length !== 1 ? 's' : ''}</strong> from your last session?`;

    // Trigger show animation on next frame
    requestAnimationFrame(() => el.classList.add('show'));

    this._autoDismissTimer = setTimeout(() => this._dismiss(), 30000);

    const onReopen = () => { if (!this._dismissed) { this._dismiss(); this._restore(session); } };
    const onFresh = () => { if (!this._dismissed) { this._dismiss(); } };
    const onClose = () => { if (!this._dismissed) { this._dismiss(); } };

    el.querySelector('.restore-btn-primary')?.addEventListener('click', onReopen, { once: true });
    el.querySelector('.restore-btn-secondary')?.addEventListener('click', onFresh, { once: true });
    el.querySelector('.restore-prompt-close')?.addEventListener('click', onClose, { once: true });
  },

  _dismiss() {
    if (this._dismissed) return;
    this._dismissed = true;
    clearTimeout(this._autoDismissTimer);
    // Just remove .show — CSS handles the slide-up + visibility hidden transition
    document.getElementById('restore-prompt')?.classList.remove('show');
  }
};
