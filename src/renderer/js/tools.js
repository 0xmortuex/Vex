// === Vex Built-In Tools ===

const VexTools = {
  tools: [
    { id: 'flashmind', name: 'FlashMind', url: 'https://0xmortuex.github.io/FlashMind/', desc: 'AI-powered flashcard study tool', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z"/><path d="M9 22h6"/></svg>' },
    { id: 'cipherlab', name: 'CipherLab', url: 'https://0xmortuex.github.io/CipherLab/', desc: 'Cryptography analysis lab', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/></svg>' },
    { id: 'loopholemap', name: 'LoopholeMap', url: 'https://0xmortuex.github.io/LoopholeMap/', desc: 'Legal loophole mapper', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>' },
    { id: 'aijudge', name: 'AIJudge', url: 'https://0xmortuex.github.io/AIJudge/', desc: 'AI-powered legal judgment tool', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/><path d="M2 11h4l1.5-3L12 14l4.5-6L18 11h4"/></svg>' },
    { id: 'netmap', name: 'NetMap', url: 'https://0xmortuex.github.io/NetMap/', desc: 'Network topology mapper', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' },
    { id: 'billforge', name: 'BillForge', url: 'https://0xmortuex.github.io/BillForge/', desc: 'Legislative bill drafting tool', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12l-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9"/><path d="M18 9.5a4 4 0 0 0-5.5-5.5L9 7.5"/><path d="M14.5 5.5L18 2l4 4-3.5 3.5"/></svg>' }
  ],

  init() {
    this.renderToolsBar();
  },

  renderToolsBar() {
    const container = document.getElementById('tools-bar');
    if (!container) return;

    this.tools.forEach(tool => {
      const btn = document.createElement('button');
      btn.className = 'tool-icon';
      btn.dataset.toolId = tool.id;
      btn.title = `${tool.name} — ${tool.desc}`;
      btn.innerHTML = tool.svg || `<span class="tool-emoji">${tool.icon || ''}</span>`;

      btn.addEventListener('click', () => this.openTool(tool));

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showToolContextMenu(e, tool);
      });

      container.appendChild(btn);
    });
  },

  openTool(tool) {
    // Check if a tab with this URL is already open
    const existing = TabManager.tabs.find(t => t.url === tool.url || t.url.startsWith(tool.url));
    if (existing) {
      TabManager.switchTab(existing.id);
      SidebarManager.hideActivePanel();
    } else {
      SidebarManager.hideActivePanel();
      TabManager.createTab(tool.url, true);
    }
  },

  openToolById(id) {
    const tool = this.tools.find(t => t.id === id);
    if (tool) this.openTool(tool);
  },

  showToolContextMenu(e, tool) {
    document.querySelectorAll('.tab-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: 'Open in New Tab', action: () => { SidebarManager.hideActivePanel(); TabManager.createTab(tool.url, true); } },
      { label: 'Pin to Tabs', action: () => { const t = TabManager.createTab(tool.url, false); t.pinned = true; TabManager.persistTabs(); } }
    ];

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'tab-context-item';
      el.textContent = item.label;
      el.addEventListener('click', () => { item.action(); menu.remove(); });
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }
};
