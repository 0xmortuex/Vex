// === Vex Customizable Tools Sidebar ===

const VexTools = {
  STORAGE_KEY: 'vex.tools',
  tools: [],

  // No personal defaults shipped — the tools bar starts empty and users add
  // their own. A local, gitignored sidebar-config.json (see src/sidebar-config.js)
  // can optionally inject an "AI News" tool via applySidebarConfig().
  defaultTools: [],

  async init() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) { try { this.tools = JSON.parse(saved) || []; } catch {} }
    if (!Array.isArray(this.tools)) this.tools = [];
    await this.applySidebarConfig();
    this.renderToolsBar();
  },

  // Optional personalization via the LOCAL, gitignored sidebar-config.json
  // (fetched over IPC). If it provides aiNewsUrl, upsert an "AI News" tool
  // pointing at it — this keeps a personalized URL (which may carry a secret
  // query param) out of the public repo. No-op / returns "" when unconfigured.
  async applySidebarConfig() {
    let aiNewsUrl = "";
    try {
      if (typeof window !== "undefined" && window.vex &&
          typeof window.vex.getSidebarConfig === "function") {
        const cfg = await window.vex.getSidebarConfig();
        if (cfg && typeof cfg.aiNewsUrl === "string" && cfg.aiNewsUrl.trim()) {
          aiNewsUrl = cfg.aiNewsUrl.trim();
        }
      }
    } catch (err) {
      console.warn("[tools] sidebar-config fetch failed:", err && err.message);
    }
    if (!aiNewsUrl) return "";
    const ainews = this.tools.find(t => t.id === "ainews");
    if (ainews) {
      ainews.url = aiNewsUrl;
    } else {
      this.tools.unshift({ id: "ainews", name: "AI News", url: aiNewsUrl, desc: "AI News Tracker", svg: "" });
    }
    return aiNewsUrl;
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

if (typeof window !== 'undefined') window.VexTools = VexTools;
if (typeof module !== 'undefined' && module.exports) module.exports = VexTools;
