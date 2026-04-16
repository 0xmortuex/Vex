// === Vex Built-In Tools ===

const VexTools = {
  tools: [
    { id: 'flashmind', name: 'FlashMind', url: 'https://0xmortuex.github.io/FlashMind/', icon: '\u{1F9E0}', desc: 'AI-powered flashcard study tool' },
    { id: 'reconx', name: 'ReconX', url: 'https://0xmortuex.github.io/ReconX/', icon: '\u{1F50D}', desc: 'OSINT reconnaissance toolkit' },
    { id: 'cipherlab', name: 'CipherLab', url: 'https://0xmortuex.github.io/CipherLab/', icon: '\u{1F510}', desc: 'Cryptography analysis lab' },
    { id: 'loopholemap', name: 'LoopholeMap', url: 'https://0xmortuex.github.io/LoopholeMap/', icon: '\u{1F5FA}', desc: 'Legal loophole mapper' },
    { id: 'aijudge', name: 'AIJudge', url: 'https://0xmortuex.github.io/AIJudge/', icon: '\u{2696}', desc: 'AI-powered legal judgment tool' },
    { id: 'netmap', name: 'NetMap', url: 'https://0xmortuex.github.io/NetMap/', icon: '\u{1F310}', desc: 'Network topology mapper' },
    { id: 'billforge', name: 'BillForge', url: 'https://0xmortuex.github.io/BillForge/', icon: '\u{1F528}', desc: 'Legislative bill drafting tool' }
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
      btn.innerHTML = `<span class="tool-emoji">${tool.icon}</span>`;

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
