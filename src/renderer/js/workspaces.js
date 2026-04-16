// === Vex Workspace Profiles ===

const WorkspaceManager = {
  STORAGE_KEY: 'vex.workspaces',
  activeId: 'ws_personal',
  workspaces: [],
  COLORS: ['#6366f1','#00b4d8','#22c55e','#e2231a','#a855f7','#f59e0b','#ec4899','#14b8a6'],

  defaultWorkspaces: [
    { id: 'ws_personal', name: 'Personal', color: '#6366f1' },
    { id: 'ws_cusa', name: 'CUSA', color: '#e2231a' },
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

  getActive() {
    return this.workspaces.find(w => w.id === this.activeId) || this.workspaces[0];
  },

  saveCurrentState() {
    const ws = this.getActive();
    if (!ws) return;
    ws.tabs = TabManager.tabs.map(t => ({ url: t.url, title: t.title, groupId: t.groupId }));
    this.save();
  },

  async switchTo(id) {
    if (id === this.activeId) return;
    // Save current state
    this.saveCurrentState();

    this.activeId = id;
    this.save();

    const ws = this.getActive();
    if (!ws) return;

    // Close all tabs
    while (TabManager.tabs.length > 0) {
      TabManager.closeTab(TabManager.tabs[0].id);
    }

    // Restore workspace tabs
    if (ws.tabs && ws.tabs.length > 0) {
      for (const t of ws.tabs) {
        TabManager.createTab(t.url, false, t.groupId);
      }
      TabManager.switchTab(TabManager.tabs[0].id);
    }

    this.applyThemeColor();
    this.render();
    this.hideDropdown();
    window.showToast?.('Workspace: ' + ws.name);
  },

  applyThemeColor() {
    const ws = this.getActive();
    if (ws?.color) {
      document.documentElement.style.setProperty('--primary', ws.color);
      // Compute hover color (slightly darker)
      document.documentElement.style.setProperty('--primary-hover', ws.color + 'dd');
    }
  },

  addWorkspace(name, color) {
    const ws = {
      id: 'ws_' + Date.now(),
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

  deleteWorkspace(id) {
    if (this.workspaces.length <= 1) return;
    if (id === this.activeId) {
      const other = this.workspaces.find(w => w.id !== id);
      if (other) this.switchTo(other.id);
    }
    this.workspaces = this.workspaces.filter(w => w.id !== id);
    this.save();
    this.render();
  },

  render() {
    const btn = document.getElementById('workspace-btn');
    const dropdown = document.getElementById('workspace-dropdown');
    if (!btn || !dropdown) return;

    const ws = this.getActive();
    btn.innerHTML = `
      <span class="ws-dot" style="background:${ws?.color || '#6366f1'}"></span>
      ${this._esc(ws?.name || 'Personal')}
      <svg viewBox="0 0 10 10"><path d="M2 4L5 7L8 4" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
    `;

    dropdown.innerHTML = this.workspaces.map(w => `
      <div class="ws-item${w.id === this.activeId ? ' active' : ''}" data-id="${w.id}">
        <span class="ws-dot" style="background:${w.color}"></span>
        <span class="ws-item-name">${this._esc(w.name)}</span>
        ${w.id === this.activeId ? '<span class="ws-item-check">&#10003;</span>' : ''}
      </div>
    `).join('') + `
      <div class="ws-sep"></div>
      <div class="ws-add" id="ws-add-btn">+ Add Workspace</div>
    `;

    dropdown.querySelectorAll('.ws-item').forEach(el => {
      el.addEventListener('click', () => this.switchTo(el.dataset.id));
    });

    document.getElementById('ws-add-btn')?.addEventListener('click', () => {
      this.hideDropdown();
      this.showModal();
    });
  },

  showDropdown() {
    document.getElementById('workspace-dropdown')?.classList.add('visible');
    const close = (e) => {
      if (!e.target.closest('#workspace-switcher')) {
        this.hideDropdown();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  },

  hideDropdown() {
    document.getElementById('workspace-dropdown')?.classList.remove('visible');
  },

  toggleDropdown() {
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
      if (!name) return;
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
      modal.querySelector('#ws-modal-delete')?.addEventListener('click', () => {
        this.deleteWorkspace(editing.id);
        this.hideModal();
      });
    }

    modal.addEventListener('click', (e) => { if (e.target === modal) this.hideModal(); });
    modal.querySelector('#ws-modal-name').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideModal();
      if (e.key === 'Enter') modal.querySelector('#ws-modal-save').click();
    });

    modal.classList.add('visible');
    modal.querySelector('#ws-modal-name').focus();
  },

  hideModal() {
    document.getElementById('workspace-modal')?.classList.remove('visible');
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};
