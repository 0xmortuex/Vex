// === Vex Workspace Profiles ===

const WorkspaceManager = {
  STORAGE_KEY: 'vex.workspaces',
  activeId: 'ws_personal',
  workspaces: [],
  _switching: false,
  // Tab id -> back list, in memory only (saveCurrentState, switchTo).
  _histories: new Map(),
  COLORS: ['#6366f1','#00b4d8','#22c55e','#e2231a','#a855f7','#f59e0b','#ec4899','#14b8a6'],

  defaultWorkspaces: [
    { id: 'ws_personal', name: 'Personal', color: '#d4a574' },
    { id: 'ws_work', name: 'Work', color: '#e2231a' },
    { id: 'ws_school', name: 'School', color: '#22c55e' },
    { id: 'ws_dev', name: 'Dev', color: '#00b4d8' }
  ],

  init() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        this.workspaces = data.workspaces || [];
        this.activeId = data.activeWorkspaceId || 'ws_personal';
      } catch {}
    }
    if (this.workspaces.length === 0) {
      this.workspaces = this.defaultWorkspaces.map(w => ({ ...w, tabs: [], shortcuts: [], tools: [] }));
    }
    this.render();
    this.applyThemeColor();
  },

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
      activeWorkspaceId: this.activeId,
      workspaces: this.workspaces
    }));
  },

  reloadSyncedState() {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : { workspaces: [] };
    this.workspaces = Array.isArray(value.workspaces) ? value.workspaces : [];
    if (!this.workspaces.length) this.workspaces = this.defaultWorkspaces.map(workspace => ({ ...workspace, tabs: [], groups: [] }));
    if (!this.workspaces.some(workspace => workspace.id === this.activeId)) this.activeId = this.workspaces[0].id;
    this.render();
    this.applyThemeColor();
  },

  getActive() {
    return this.workspaces.find(w => w.id === this.activeId) || this.workspaces[0];
  },

  saveCurrentState() {
    const ws = this.getActive();
    if (!ws) return;
    const tabs = window.VexTabPolicy.snapshot(TabManager.tabs);
    ws.tabs = tabs;
    ws.groups = TabManager.groups.map(g => ({ ...g }));
    // Stacks are per-workspace state exactly like groups. Without this, a
    // workspace round-trip destroyed every stack (members came back with
    // stackId null) while the orphaned stack objects leaked into whichever
    // workspace you switched to.
    ws.stacks = (TabManager.stacks || []).map(s => ({ ...s }));
    ws.activeTabIndex = tabs.findIndex(t => t.id === TabManager.activeTabId);
    // Each tab's back list, for switching back during this run only: what is
    // saved of a workspace leaves it out (VexTabPolicy.savedHistory).
    for (const t of TabManager.tabs) {
      const history = window.VexTabPolicy.savedHistory(t);
      if (history) this._histories.set(t.id, history);
    }
    this.save();
  },

  async switchTo(id) {
    // A private window's tabs are never saved, so switching closed every one
    // of them for good (found 2026-09-29).
    if (window.VexTabPolicy?.isPrivateWindow) { window.showToast?.('A private window has no workspaces — its tabs would be lost', 'warn'); return; }
    if (id === this.activeId || this._switching || !this.workspaces.some(w => w.id === id)) return;
    this._switching = true;

    try {
      // 0. Private and Tor tabs belong to no workspace: ask whether they go
      //    (or do what "Always close them" chose).
      const closeEphemeral = await this._closeEphemeralOnSwitch();

      // 1. Show loading overlay
      this._showLoading();
      this.hideDropdown();
      await new Promise(r => setTimeout(r, 0));

      // 2. Save current workspace state before destroying anything
      this.saveCurrentState();

      // 3. Set new active workspace
      this.activeId = id;
      this.save();
      const ws = this.getActive();
      if (!ws) { this._hideLoading(); return; }

      // 4. Bulk-close all tabs (no per-tab persist, no auto-create). A
      //    private or Tor tab is never saved in a workspace, so closing it
      //    lost it for good (found 2026-10-10): it stays open unless the
      //    user chose to close it (step 0). Then each is closed as closing
      //    it by hand does, so its session (cookies, cache, Tor circuit)
      //    ends with it.
      if (closeEphemeral) this._closeEphemeralTabs();
      TabManager.closeAllTabs({ keep: (t) => this._isEphemeral(t) });
      await new Promise(r => setTimeout(r, 0));

      // 5. Update theme immediately
      this.applyThemeColor();

      // 6. Restore groups + stacks. renderGroups() is deliberately NOT called
      //    here: it hides any group with zero tabs, and at this point no tabs
      //    exist yet, so every restored group would be dropped from the DOM and
      //    its tabs would render loose. The single rebuildAllTabs() in step 8
      //    renders groups, the pinned row and stacks in the right order.
      {
        TabManager.groups = (ws.groups || []).map(g => ({ ...g }));
        await VexStorage.saveGroups(TabManager.groups);
      }
      {
        TabManager.stacks = (ws.stacks || []).map(s => ({ ...s }));
        if (typeof VexStorage.saveStacks === 'function') await VexStorage.saveStacks(TabManager.stacks);
      }

      // 7. Recreate tabs LAZILY (no webviews yet — instant). Each comes back
      //    as it was left: asleep or not, muted, its note, its stack, and its
      //    back list from this run (TabManager.addSavedTabs).
      const savedTabs = Array.isArray(ws.tabs) ? ws.tabs : [];
      const selectedTab = savedTabs[ws.activeTabIndex];
      const restored = TabManager.addSavedTabs(savedTabs.map(t => (this._histories.has(t.id) ? { ...t, history: this._histories.get(t.id) } : t)));
      if (!restored.length) {
        const blank = TabManager.createLazyTab(START_URL, null, 'New Tab');
        restored.push({ saved: null, tab: blank });
      }
      const selectedId = (restored.find(r => r.saved && r.saved.id === (selectedTab && selectedTab.id)) || {}).tab?.id || null;
      const savedToNewId = new Map(restored.filter(r => r.saved && r.saved.id).map(r => [r.saved.id, r.tab.id]));

      // Stack tops refer to the ids the workspace was saved with; tabs get
      // fresh ids on restore. Repoint each top, and drop any stack that no
      // longer has members (same prune TabManager.init does on launch).
      for (const stack of TabManager.stacks) {
        stack.topTabId = savedToNewId.get(stack.topTabId) ||
          TabManager.tabs.find(t => t.stackId === stack.id)?.id || null;
      }
      TabManager.stacks = TabManager.stacks.filter(s => TabManager.tabs.some(t => t.stackId === s.id));

      // 8. One ordered render pass, then activate the correct tab (this
      //    materializes only ONE webview).
      TabManager.rebuildAllTabs();
      TabManager.switchTab(selectedId || restored[0].tab.id);
      // Kept-awake tabs live, as at start (they stayed unloaded until clicked).
      TabManager.bringKeptAwakeLive(restored.map(r => r.tab));

      await TabManager.persistTabs();

      // 9. Done
      this.render();
      this._hideLoading();
      window.showToast?.('Workspace: ' + ws.name);
      // Park and resume (js/park.js) and the next step (js/next-step.js) follow the switch.
      document.dispatchEvent(new CustomEvent('vex:workspace-switched', { detail: { id: this.activeId } }));
    } catch (err) {
      console.error('Workspace switch error:', err);
      this._hideLoading();
      // Ensure at least one tab exists
      if (TabManager.tabs.length === 0) {
        TabManager.createTab(START_URL, true);
      }
    } finally {
      this._switching = false;
    }
  },

  // Settings › General › Workspaces: what a switch does with private and Tor
  // tabs. 'ask' (the default) or 'close' ("Always close them").
  EPHEMERAL_KEY: 'vex.workspacePrivateTabs',

  _isEphemeral(tab) { return !!tab.partition && !String(tab.partition).startsWith('persist:'); },

  ephemeralChoice() {
    return localStorage.getItem(this.EPHEMERAL_KEY) === 'close' ? 'close' : 'ask';
  },

  setEphemeralChoice(value) {
    if (value !== 'ask' && value !== 'close') throw new Error('Unknown choice for private and Tor tabs: ' + value);
    if (value === 'ask') localStorage.removeItem(this.EPHEMERAL_KEY);
    else localStorage.setItem(this.EPHEMERAL_KEY, value);
    document.dispatchEvent(new CustomEvent('vex:ws-private-choice'));
  },

  // True when the private and Tor tabs open now are to be closed by this
  // switch. Escape or a click outside the question keeps them (nothing lost).
  async _closeEphemeralOnSwitch() {
    const open = TabManager.tabs.filter(t => this._isEphemeral(t));
    if (!open.length) return false;
    if (this.ephemeralChoice() === 'close') return true;
    const t = (key, fallback) => window.VexI18n?.t(key, fallback) || fallback;
    let always = false;
    const close = await window.vexConfirm({
      title: t('wsPrivate.title', 'Private and Tor tabs are open'),
      message: open.length === 1
        ? t('wsPrivate.one', 'One private or Tor tab is open. It belongs to no workspace, so it can stay open in the next one or be closed now. A closed private or Tor tab cannot be brought back.')
        : t('wsPrivate.many', '{n} private or Tor tabs are open. They belong to no workspace, so they can stay open in the next one or be closed now. A closed private or Tor tab cannot be brought back.').replace('{n}', open.length),
      okLabel: t('wsPrivate.close', 'Close them this time'),
      cancelLabel: t('wsPrivate.keep', 'Keep them open'),
      danger: true,
      wide: true,   // the three choices in one row
      extra: { label: t('wsPrivate.always', 'Always close them'), run: () => { always = true; } },
    });
    if (always) {
      this.setEphemeralChoice('close');
      window.showToast?.(t('wsPrivate.saved', 'Private and Tor tabs will close when you switch workspace. Settings › General › Workspaces changes it back.'));
      return true;
    }
    return close;
  },

  // Each private and Tor tab closed as the close button does it.
  _closeEphemeralTabs() {
    const ids = TabManager.tabs.filter(t => this._isEphemeral(t)).map(t => t.id);
    TabManager._bulkClosing = true;
    try { for (const id of ids) TabManager.closeTab(id); }
    finally { TabManager._bulkClosing = false; }
  },

  _showLoading() {
    document.getElementById('workspace-loading')?.classList.remove('hidden');
  },

  _hideLoading() {
    document.getElementById('workspace-loading')?.classList.add('hidden');
  },

  applyThemeColor() {
    // The theme owns the accent colour. Writing the workspace colour over
    // --primary repainted every accent in the app with it - buttons, progress
    // bars, and the focus ring round the address bar - so a red workspace on a
    // green theme drew a red box inside the green address bar. The workspace
    // colour now lives on its own token, used only by the switcher that shows
    // which workspace you are in. removeProperty also heals a --primary that an
    // earlier version left inline on the root.
    const root = document.documentElement.style;
    root.removeProperty('--primary');
    root.removeProperty('--primary-hover');
    const ws = this.getActive();
    if (ws?.color) root.setProperty('--workspace-color', ws.color);
    else root.removeProperty('--workspace-color');
  },

  addWorkspace(name, color) {
    const ws = {
      id: vexId('ws_'),
      name,
      color: color || '#6366f1',
      tabs: [],
      shortcuts: [],
      tools: []
    };
    this.workspaces.push(ws);
    this.save();
    this.render();
    return ws;
  },

  // Returns what went and where, for restoreWorkspace (the Undo on the toast).
  async deleteWorkspace(id) {
    if (this.workspaces.length <= 1 || this._switching) return null;
    const wasActive = id === this.activeId;
    if (wasActive) {
      const other = this.workspaces.find(w => w.id !== id);
      if (other) await this.switchTo(other.id);
      if (this.activeId === id) return null;   // the switch did not happen
    }
    const index = this.workspaces.findIndex(w => w.id === id);
    if (index < 0) return null;
    const removed = { item: this.workspaces[index], index, prevId: index > 0 ? this.workspaces[index - 1].id : null, wasActive };
    this.workspaces.splice(index, 1);
    this.save();
    this.render();
    return removed;
  },

  // Back in its place with the tabs saved in it; back in front if it was.
  async restoreWorkspace(removed) {
    if (!removed || !removed.item) throw new Error('Nothing to put back');
    if (!this.workspaces.some(w => w.id === removed.item.id)) {
      let at = removed.prevId ? this.workspaces.findIndex(w => w.id === removed.prevId) + 1 : 0;
      if (at <= 0 && removed.prevId) at = Math.min(removed.index, this.workspaces.length);
      this.workspaces.splice(at, 0, removed.item);
      this.save();
      this.render();
    }
    if (removed.wasActive) await this.switchTo(removed.item.id);
  },

  render() {
    const btn = document.getElementById('workspace-btn');
    const dropdown = document.getElementById('workspace-dropdown');
    if (!btn || !dropdown) return;

    const ws = this.getActive();
    btn.innerHTML = `
      <span class="ws-dot" style="background:${ws?.color || '#d4a574'}"></span>
      ${this._esc(ws?.name || 'Personal')}
      <svg viewBox="0 0 10 10"><path d="M2 4L5 7L8 4" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
    `;

    dropdown.innerHTML = this.workspaces.map(w => `
      <div class="ws-item${w.id === this.activeId ? ' active' : ''}" data-id="${w.id}">
        <span class="ws-dot" style="background:${w.color}"></span>
        <span class="ws-item-name">${this._esc(w.name)}</span>
        ${w.id === this.activeId ? '<span class="ws-item-check" style="display:inline-flex">' + VexIcons.svg('check', { size: 14 }) + '</span>' : ''}
        <button class="ws-item-edit" data-edit="${w.id}" title="Rename or delete" aria-label="Edit ${this._esc(w.name)}" style="background:none;border:0;padding:2px;color:inherit;cursor:pointer;display:inline-flex;opacity:.7">${typeof VexIcons !== 'undefined' ? VexIcons.svg('edit', { size: 13 }) : ''}</button>
      </div>
    `).join('') + `
      <div class="ws-sep"></div>
      <div class="ws-add" id="ws-add-btn">+ Add Workspace</div>
    `;

    // Rename/delete lived only in showModal(id), and nothing ever passed an
    // id, so a workspace could be neither renamed nor deleted (found
    // 2026-09-29). The pencil (or a right-click) opens it for that workspace.
    const edit = (id) => { this.hideDropdown(); this.showModal(id); };
    dropdown.querySelectorAll('.ws-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.ws-item-edit')) { edit(el.dataset.id); return; }
        this.switchTo(el.dataset.id);
      });
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); edit(el.dataset.id); });
    });

    document.getElementById('ws-add-btn')?.addEventListener('click', () => {
      this.hideDropdown();
      this.showModal();
    });
  },

  showDropdown() {
    document.getElementById('workspace-dropdown')?.classList.add('visible');
    const onBlur = () => close();
    // Escape closes it like every other menu; it did nothing (found 2026-09-29).
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = (e) => {
      // No event = window blur (focus moved into the page's <webview>, whose
      // clicks never reach the host document) → always close.
      if (!e || !e.target || !e.target.closest('#workspace-switcher')) {
        this.hideDropdown();
        document.removeEventListener('click', close);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('keydown', onKey, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', close);
      window.addEventListener('blur', onBlur);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  },

  hideDropdown() {
    document.getElementById('workspace-dropdown')?.classList.remove('visible');
  },

  toggleDropdown() {
    if (window.VexTabPolicy?.isPrivateWindow) { window.showToast?.('A private window has no workspaces — its tabs would be lost', 'warn'); return; }
    const dd = document.getElementById('workspace-dropdown');
    if (dd?.classList.contains('visible')) this.hideDropdown();
    else this.showDropdown();
  },

  showModal(editId) {
    const modal = document.getElementById('workspace-modal');
    if (!modal) return;

    const editing = editId ? this.workspaces.find(w => w.id === editId) : null;

    modal.querySelector('.ws-modal-content').innerHTML = `
      <h3>${editing ? 'Edit' : 'New'} Workspace</h3>
      <label>Name</label>
      <input type="text" id="ws-modal-name" value="${editing ? this._esc(editing.name) : ''}" placeholder="Workspace name...">
      <label>Color</label>
      <div class="ws-color-picker" id="ws-color-picker">
        ${this.COLORS.map(c => `<div class="ws-color-opt${(editing?.color || '#6366f1') === c ? ' selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
      </div>
      <div class="ws-modal-actions">
        ${editing ? '<button class="ws-btn-delete" id="ws-modal-delete">Delete</button>' : ''}
        <div style="flex:1"></div>
        <button class="ws-btn-cancel" id="ws-modal-cancel">Cancel</button>
        <button class="ws-btn-save" id="ws-modal-save">Save</button>
      </div>
    `;

    let selectedColor = editing?.color || '#6366f1';

    modal.querySelectorAll('.ws-color-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        modal.querySelectorAll('.ws-color-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedColor = opt.dataset.color;
      });
    });

    modal.querySelector('#ws-modal-cancel').addEventListener('click', () => this.hideModal());
    modal.querySelector('#ws-modal-save').addEventListener('click', () => {
      const name = modal.querySelector('#ws-modal-name').value.trim();
      // A blank name did nothing and said nothing (found 2026-09-29).
      if (!name) { window.showToast?.('Give the workspace a name', 'warn'); modal.querySelector('#ws-modal-name').focus(); return; }
      if (editing) {
        editing.name = name;
        editing.color = selectedColor;
        this.save();
        if (editing.id === this.activeId) this.applyThemeColor();
        this.render();
      } else {
        this.addWorkspace(name, selectedColor);
      }
      this.hideModal();
    });

    if (editing) {
      // A workspace holds its own tabs; deleting one went without a word
      // (found 2026-09-29).
      modal.querySelector('#ws-modal-delete')?.addEventListener('click', async () => {
        if (this.workspaces.length <= 1) { window.showToast?.('The last workspace cannot be deleted'); return; }
        // Done at once; Undo on the toast brings it back with its tabs.
        this.hideModal();
        const removed = await this.deleteWorkspace(editing.id);
        if (!removed) return;
        window.VexUndo.offer({
          message: `Deleted the workspace “${removed.item.name}” and its saved tabs`,
          undo: () => this.restoreWorkspace(removed),
        });
      });
    }

    // #workspace-modal is a persistent element — wiring the backdrop click on
    // every open stacked one listener per open.
    if (!modal.dataset.backdropWired) {
      modal.dataset.backdropWired = '1';
      modal.addEventListener('click', (e) => { if (e.target === modal) this.hideModal(); });
    }
    modal.querySelector('#ws-modal-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') modal.querySelector('#ws-modal-save').click();
    });
    // Escape closes the dialog wherever focus is; it only worked from the name
    // field (found 2026-09-29). One listener per open dialog.
    if (this._modalKey) document.removeEventListener('keydown', this._modalKey, true);
    this._modalKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation();
      this.hideModal();
    };
    document.addEventListener('keydown', this._modalKey, true);

    modal.classList.add('visible');
    modal.querySelector('#ws-modal-name').focus();
  },

  hideModal() {
    if (this._modalKey) { document.removeEventListener('keydown', this._modalKey, true); this._modalKey = null; }
    document.getElementById('workspace-modal')?.classList.remove('visible');
  },

  _esc(s) { return window.escapeHtml(s); }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { WorkspaceManager };
