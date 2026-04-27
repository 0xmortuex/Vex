// === Vex Customizable Tools Sidebar ===

const VexTools = {
  STORAGE_KEY: 'vex.tools',
  tools: [],

  defaultTools: [
    { id: 'ainews', name: 'AI News', url: 'https://0xmortuex.github.io/ai-news-tracker/', desc: 'AI News Tracker', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>' },
    { id: 'flashmind', name: 'FlashMind', url: 'https://0xmortuex.github.io/FlashMind/', desc: 'AI-powered flashcard study tool', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z"/><path d="M9 22h6"/></svg>' },
    { id: 'loopholemap', name: 'LoopholeMap', url: 'https://0xmortuex.github.io/LoopholeMap/', desc: 'Legal loophole mapper', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>' },
    { id: 'aijudge', name: 'AIJudge', url: 'https://0xmortuex.github.io/AIJudge/', desc: 'AI-powered legal judgment tool', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/><path d="M2 11h4l1.5-3L12 14l4.5-6L18 11h4"/></svg>' },
    { id: 'openrouter-logs', name: 'OpenRouter Logs', url: 'https://openrouter.ai/logs', desc: 'API usage & activity logs', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6"/><path d="M7 12h7"/><path d="M7 16h10"/><path d="M7 8h4"/></svg>' },
    { id: 'billforge', name: 'BillForge', url: 'https://0xmortuex.github.io/BillForge/', desc: 'Legislative bill drafting tool', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12l-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9"/><path d="M18 9.5a4 4 0 0 0-5.5-5.5L9 7.5"/><path d="M14.5 5.5L18 2l4 4-3.5 3.5"/></svg>' }
  ],

  init() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) { try { this.tools = JSON.parse(saved); } catch {} }
    if (this.tools.length === 0) this.tools = [...this.defaultTools];
    let migrated = false;
    // Migration: ensure AI News Tracker is present for existing users, inserted above FlashMind
    if (!this.tools.some(t => t.id === 'ainews')) {
      const ainews = this.defaultTools.find(t => t.id === 'ainews');
      if (ainews) {
        const fmIdx = this.tools.findIndex(t => t.id === 'flashmind');
        const insertAt = fmIdx === -1 ? 0 : fmIdx;
        this.tools.splice(insertAt, 0, { ...ainews });
        migrated = true;
      }
    }
    // Migration: replace NetMap with OpenRouter Logs in-place (same slot, preserves user order)
    const netmapIdx = this.tools.findIndex(t => t.id === 'netmap');
    const hasOpenRouterLogs = this.tools.some(t => t.id === 'openrouter-logs');
    const orLogsDefault = this.defaultTools.find(t => t.id === 'openrouter-logs');
    if (netmapIdx !== -1) {
      if (!hasOpenRouterLogs && orLogsDefault) {
        this.tools.splice(netmapIdx, 1, { ...orLogsDefault });
      } else {
        this.tools.splice(netmapIdx, 1);
      }
      migrated = true;
    } else if (!hasOpenRouterLogs && orLogsDefault) {
      this.tools.push({ ...orLogsDefault });
      migrated = true;
    }
    // Strip retired default tools (idempotent — runs every launch, no-op once clean)
    const stale = ['netmap', 'cipherlab'];
    const before = this.tools.length;
    this.tools = this.tools.filter(t => !stale.includes(t.id));
    if (this.tools.length !== before) migrated = true;
    if (migrated) this.save();
    this.renderToolsBar();
  },

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.tools));
  },

  renderToolsBar() {
    const container = document.getElementById('tools-bar');
    if (!container) return;
    container.innerHTML = '';

    this.tools.forEach((tool, i) => {
      const btn = document.createElement('button');
      btn.className = 'tool-icon';
      btn.dataset.toolId = tool.id;
      btn.dataset.index = i;
      btn.draggable = true;
      btn.title = `${tool.name} — ${tool.desc}`;
      btn.innerHTML = tool.svg || `<span class="tool-emoji">${tool.icon || '🔧'}</span>`;

      btn.addEventListener('click', () => this.openTool(tool));
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showContextMenu(e, tool); });

      // Drag reorder
      btn.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', i); btn.classList.add('dragging'); });
      btn.addEventListener('dragend', () => btn.classList.remove('dragging'));
      btn.addEventListener('dragover', (e) => e.preventDefault());
      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        const toIdx = i;
        if (fromIdx !== toIdx) {
          const [moved] = this.tools.splice(fromIdx, 1);
          this.tools.splice(toIdx, 0, moved);
          this.save();
          this.renderToolsBar();
        }
      });

      container.appendChild(btn);
    });

    // Add button
    const addBtn = document.createElement('button');
    addBtn.className = 'tool-icon tool-add-btn';
    addBtn.title = 'Add tool';
    addBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    addBtn.addEventListener('click', () => this.showEditModal());
    container.appendChild(addBtn);
  },

  openTool(tool) {
    const existing = TabManager.tabs.find(t => t.url === tool.url || t.url.startsWith(tool.url));
    if (existing) { TabManager.switchTab(existing.id); SidebarManager.hideActivePanel(); }
    else { SidebarManager.hideActivePanel(); TabManager.createTab(tool.url, true); }
  },

  openToolById(id) {
    const tool = this.tools.find(t => t.id === id);
    if (tool) this.openTool(tool);
  },

  addTool(name, url, desc) {
    const tool = { id: 'tool_' + Date.now(), name, url, desc: desc || '', svg: '' };
    // Auto-generate a favicon-based display
    try { const domain = new URL(url).hostname; tool.faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`; } catch {}
    this.tools.push(tool);
    this.save();
    this.renderToolsBar();
  },

  removeTool(id) {
    this.tools = this.tools.filter(t => t.id !== id);
    this.save();
    this.renderToolsBar();
  },

  editTool(id, name, url, desc) {
    const tool = this.tools.find(t => t.id === id);
    if (tool) {
      tool.name = name; tool.url = url; tool.desc = desc || '';
      try { const domain = new URL(url).hostname; tool.faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`; } catch {}
      this.save();
      this.renderToolsBar();
    }
  },

  showContextMenu(e, tool) {
    document.querySelectorAll('.tab-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: 'Open in New Tab', action: () => { SidebarManager.hideActivePanel(); TabManager.createTab(tool.url, true); } },
      { label: 'Edit', action: () => this.showEditModal(tool) },
      { label: 'Remove', action: () => this.removeTool(tool.id), danger: true }
    ];

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = `tab-context-item${item.danger ? ' danger' : ''}`;
      el.textContent = item.label;
      el.addEventListener('click', () => { item.action(); menu.remove(); });
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    setTimeout(() => {
      const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 0);
  },

  showEditModal(tool) {
    // Reuse a simple prompt approach with a modal
    let existing = document.getElementById('tool-edit-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'tool-edit-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);z-index:500;display:flex;align-items:center;justify-content:center;';

    modal.innerHTML = `
      <div style="width:380px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        <h3 style="font-size:16px;font-weight:600;margin-bottom:18px;color:var(--text)">${tool ? 'Edit' : 'Add'} Tool</h3>
        <label style="display:block;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px;font-weight:500">Name</label>
        <input type="text" id="tool-modal-name" value="${tool ? this._esc(tool.name) : ''}" placeholder="Tool name..." style="width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;outline:none;margin-bottom:14px;box-sizing:border-box;font-family:'Outfit',sans-serif">
        <label style="display:block;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px;font-weight:500">URL</label>
        <input type="text" id="tool-modal-url" value="${tool ? this._esc(tool.url) : ''}" placeholder="https://..." style="width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;outline:none;margin-bottom:14px;box-sizing:border-box;font-family:'JetBrains Mono',monospace">
        <label style="display:block;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px;font-weight:500">Description</label>
        <input type="text" id="tool-modal-desc" value="${tool ? this._esc(tool.desc) : ''}" placeholder="Short description..." style="width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;outline:none;margin-bottom:18px;box-sizing:border-box;font-family:'Outfit',sans-serif">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="tool-modal-cancel" style="padding:8px 18px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Cancel</button>
          <button id="tool-modal-save" style="padding:8px 18px;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector('#tool-modal-name').focus();

    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#tool-modal-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#tool-modal-save').addEventListener('click', () => {
      const name = modal.querySelector('#tool-modal-name').value.trim();
      const url = modal.querySelector('#tool-modal-url').value.trim();
      const desc = modal.querySelector('#tool-modal-desc').value.trim();
      if (!name || !url) return;
      if (tool) { this.editTool(tool.id, name, url, desc); }
      else { this.addTool(name, url, desc); }
      modal.remove();
    });
    modal.querySelector('#tool-modal-name').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') modal.remove();
      if (e.key === 'Enter') modal.querySelector('#tool-modal-save').click();
    });
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};
