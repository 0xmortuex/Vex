// === Vex Tab Selector for Multi-Tab AI ===

const TabSelector = {
  _mode: 'current',
  _customIds: new Set(),

  init() {
    document.getElementById('tab-selector-toggle')?.addEventListener('click', () => this.toggle());

    document.querySelectorAll('.selector-mode').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });
  },

  toggle() {
    const dd = document.getElementById('tab-selector-dropdown');
    const wrap = document.querySelector('.ai-tab-selector');
    if (!dd) return;
    const isOpen = !dd.hidden;
    dd.hidden = isOpen;
    wrap?.classList.toggle('open', !isOpen);
    if (!isOpen && this._mode === 'custom') this._renderCustomList();
  },

  setMode(mode) {
    this._mode = mode;
    document.querySelectorAll('.selector-mode').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const tabList = document.getElementById('selector-tab-list');
    if (tabList) {
      tabList.hidden = mode !== 'custom';
      if (mode === 'custom') this._renderCustomList();
    }
    this._updateSummary();
  },

  getSelectedTabs() {
    switch (this._mode) {
      case 'current': {
        const t = TabManager.getActiveTab();
        return t ? [t] : [];
      }
      case 'all': return TabManager.tabs.slice();
      case 'group': {
        const active = TabManager.getActiveTab();
        if (!active?.groupId) return active ? [active] : [];
        return TabManager.tabs.filter(t => t.groupId === active.groupId);
      }
      case 'workspace': return TabManager.tabs.slice();
      case 'custom': return TabManager.tabs.filter(t => this._customIds.has(t.id));
      default: return [];
    }
  },

  getCurrentMode() { return this._mode; },

  _renderCustomList() {
    const c = document.getElementById('selector-tab-list');
    if (!c) return;
    c.innerHTML = TabManager.tabs.map(t => `
      <label class="selector-tab-item">
        <input type="checkbox" data-tab-id="${t.id}" ${this._customIds.has(t.id) ? 'checked' : ''}>
        <span class="tab-title">${this._esc(t.title || 'Untitled')}</span>
      </label>
    `).join('');

    c.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) this._customIds.add(cb.dataset.tabId);
        else this._customIds.delete(cb.dataset.tabId);
        this._updateSummary();
      });
    });
  },

  _updateSummary() {
    const count = this.getSelectedTabs().length;
    const el = document.getElementById('selector-count');
    const summary = document.getElementById('selector-summary');
    const labels = {
      current: 'Current tab', all: `All tabs (${count})`,
      group: `Current group (${count})`, workspace: `Workspace (${count})`,
      custom: `${count} tab${count !== 1 ? 's' : ''} selected`
    };
    if (el) el.textContent = labels[this._mode] || 'Current tab';
    if (summary) summary.textContent = `${count} tab${count !== 1 ? 's' : ''} included`;
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};
