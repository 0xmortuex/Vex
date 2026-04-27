// === Vex Command Bar (Ctrl+K) ===

const CommandBar = {
  isOpen: false,
  selectedIndex: 0,
  results: [],

  commands: [
    { id: 'new', label: 'New Tab', hint: 'Open a new tab', shortcut: 'Ctrl+T', icon: '+', action: () => TabManager.createTab(START_URL, true) },
    { id: 'close', label: 'Close Tab', hint: 'Close the current tab', shortcut: 'Ctrl+W', icon: '×', action: () => { const t = TabManager.getActiveTab(); if (t) TabManager.closeTab(t.id); } },
    { id: 'whatsapp', label: 'WhatsApp', hint: 'Open WhatsApp panel', icon: '📱', isPrimary: true, action: () => SidebarManager.openPanel('whatsapp') },
    { id: 'claude', label: 'Claude AI', hint: 'Open Claude panel', icon: '✨', isPrimary: true, action: () => SidebarManager.openPanel('claude') },
    { id: 'spotify', label: 'Spotify', hint: 'Open Spotify panel', icon: '♪', isPrimary: true, action: () => SidebarManager.openPanel('spotify') },
    { id: 'netflix', label: 'Netflix', hint: 'Open Netflix panel', icon: '▶', isPrimary: true, action: () => SidebarManager.openPanel('netflix') },
    { id: 'cusa', label: 'CUSA Workspace', hint: 'Open CUSA workspace panel', icon: '⚖', isPrimary: true, action: () => SidebarManager.openPanel('cusa') },
    { id: 'roblox', label: 'Roblox Hub', hint: 'Open Roblox panel', icon: '🎮', isPrimary: true, action: () => SidebarManager.openPanel('roblox') },
    { id: 'github', label: 'GitHub', hint: 'Open GitHub panel', icon: '🐙', isPrimary: true, action: () => SidebarManager.openPanel('github') },
    { id: 'reload', label: 'Reload', hint: 'Reload current tab', shortcut: 'Ctrl+R', icon: '↻', action: () => WebviewManager.reload() },
    { id: 'hard-reload', label: 'Hard Reload', hint: 'Clear cache then reload', shortcut: 'Ctrl+Shift+R', icon: '⟳', action: () => WebviewManager.hardReload() },
    { id: 'history', label: 'History', hint: 'View browsing history', icon: '📋', action: () => CommandBar.showHistory() },
    { id: 'settings', label: 'Settings', hint: 'Open settings', icon: '⚙', action: () => SidebarManager.openPanel('settings') },
    { id: 'tools', label: 'Tools', hint: 'FlashMind, ReconX, CipherLab...', icon: '🔧', action: () => CommandBar.showTools() },
    { id: 'start', label: 'Start Page', hint: 'Go to start page', icon: '🏠', action: () => TabManager.createTab(START_URL, true) },
    { id: 'youtube', label: 'YouTube', hint: 'Open YouTube', icon: '▶', action: () => TabManager.createTab('https://youtube.com', true) },
    { id: 'chatgpt', label: 'ChatGPT', hint: 'Open ChatGPT', icon: '🤖', action: () => TabManager.createTab('https://chat.openai.com', true) },
    { id: 'pip', label: 'Picture-in-Picture', hint: 'Pop video into floating window', shortcut: 'Ctrl+Shift+P', icon: '📺', action: () => { if (typeof PiPManager !== 'undefined') PiPManager.toggle(); } },
    { id: 'split', label: 'Split Screen', hint: 'Toggle split-screen view', shortcut: 'Ctrl+Shift+S', icon: '⬛', action: () => SplitScreen.toggle() },
    // Tool commands
    { id: 'flashmind', label: 'FlashMind', hint: 'AI-powered flashcard study tool', icon: '💡', action: () => VexTools.openToolById('flashmind') },
    { id: 'cipherlab', label: 'CipherLab', hint: 'Cryptography analysis lab', icon: '🔐', action: () => VexTools.openToolById('cipherlab') },
    { id: 'loopholemap', label: 'LoopholeMap', hint: 'Legal loophole mapper', icon: '🗺', action: () => VexTools.openToolById('loopholemap') },
    { id: 'aijudge', label: 'AIJudge', hint: 'AI-powered legal judgment tool', icon: '⚖', action: () => VexTools.openToolById('aijudge') },
    { id: 'netmap', label: 'NetMap', hint: 'Network topology mapper', icon: '🌐', action: () => VexTools.openToolById('netmap') },
    { id: 'billforge', label: 'BillForge', hint: 'Legislative bill drafting tool', icon: '🔨', action: () => VexTools.openToolById('billforge') },
    // Phase 3 commands
    { id: 'notes', label: 'Notes', hint: 'Open notes panel', shortcut: 'Ctrl+Shift+N', icon: '📝', isPrimary: true, action: () => SidebarManager.openPanel('notes') },
    { id: 'downloads', label: 'Downloads', hint: 'Open downloads panel', icon: '⬇', isPrimary: true, action: () => SidebarManager.openPanel('downloads') },
    { id: 'session-save', label: 'Save Session', hint: 'Save current tabs as a session', icon: '💾', action: () => SessionManager.showOverlay() },
    { id: 'session-load', label: 'Load Session', hint: 'Restore a saved session', shortcut: 'Ctrl+Shift+O', icon: '📂', action: () => SessionManager.showOverlay() },
    { id: 'workspace', label: 'Switch Workspace', hint: 'Change workspace profile', icon: '🔄', action: () => WorkspaceManager.toggleDropdown() },
    // Phase 4 commands
    { id: 'reopen', label: 'Reopen Closed Tab', hint: 'Restore last closed tab', shortcut: 'Ctrl+Shift+T', icon: '↩', action: () => TabManager.reopenLastClosed() },
    { id: 'history', label: 'History', hint: 'Browsing history', shortcut: 'Ctrl+H', icon: '🕐', isPrimary: true, action: () => SidebarManager.openPanel('history') },
    { id: 'memory', label: 'Memory', hint: 'Memory usage per tab', shortcut: 'Ctrl+Shift+M', icon: '💻', isPrimary: true, action: () => SidebarManager.openPanel('memory') },
    { id: 'sleep', label: 'Sleep Tab', hint: 'Put current tab to sleep', shortcut: 'Ctrl+Shift+Z', icon: '💤', action: () => { const t = TabManager.getActiveTab(); if (t) TabManager.sleepTab(t.id); } },
    { id: 'sleep-all', label: 'Sleep All Inactive', hint: 'Sleep all non-active tabs', icon: '💤', action: () => { TabManager.sleepAllInactive(); window.showToast?.('All inactive tabs sleeping'); } },
    { id: 'wake-all', label: 'Wake All Tabs', hint: 'Wake all sleeping tabs', icon: '☀', action: () => { TabManager.wakeAllTabs(); window.showToast?.('All tabs awake'); } },
    // Phase 5 commands
    { id: 'read', label: 'Reading Mode', hint: 'Strip clutter, focus on article', shortcut: 'Ctrl+Alt+R', icon: '📖', action: () => ReadingMode.activate() },
    { id: 'translate', label: 'Translate Page', hint: 'Translate via Google Translate', icon: '🌐', action: () => { document.getElementById('translate-bar')?.classList.add('visible'); } },
    { id: 'screenshot', label: 'Screenshot', hint: 'Capture current page', shortcut: 'Ctrl+Alt+S', icon: '📷', action: () => ScreenshotTool.capture() },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', hint: 'View all shortcuts', icon: '⌨', action: () => SidebarManager.openPanel('shortcuts') },
    { id: 'theme', label: 'Theme Editor', hint: 'Customize colors and appearance', icon: '🎨', action: () => SidebarManager.openPanel('themes') },
    { id: 'zoom-in', label: 'Zoom In', hint: 'Zoom in 10%', icon: '🔍', action: () => WebviewManager.zoomIn() },
    { id: 'zoom-out', label: 'Zoom Out', hint: 'Zoom out 10%', icon: '🔍', action: () => WebviewManager.zoomOut() },
    { id: 'zoom-reset', label: 'Reset Zoom', hint: 'Reset to 100%', icon: '🔍', action: () => WebviewManager.zoomReset() },
    // Phase 6 commands
    { id: 'fullscreen', label: 'Toggle Fullscreen', hint: 'Enter/exit fullscreen', shortcut: 'F11', icon: '⛶', action: () => window.vex.toggleFullscreen?.() },
    { id: 'private', label: 'Private Window', hint: 'Open incognito window', shortcut: 'Ctrl+Shift+N', icon: '🕶', action: () => window.vex.openPrivateWindow?.() },
    { id: 'mute', label: 'Mute Tab', hint: 'Mute/unmute current tab', shortcut: 'Ctrl+M', icon: '🔇', action: () => TabManager.toggleMuteTab() },
    { id: 'mute-all', label: 'Mute All Others', hint: 'Mute all except active tab', icon: '🔇', action: () => TabManager.muteAllOtherTabs() },
    { id: 'pin', label: 'Pin/Unpin Tab', hint: 'Toggle pin on current tab', icon: '📌', action: () => TabManager.togglePinTab() },
    { id: 'export-data', label: 'Export All Data', hint: 'Download all Vex data as JSON', icon: '💾', action: () => { document.getElementById('setting-export')?.click(); } },
    // Phase 7A: AI commands
    { id: 'tabs-toggle', label: 'Toggle Tabs Sidebar', hint: 'Show/hide tabs panel', shortcut: 'Ctrl+B', icon: '◧', action: () => window.toggleTabsSidebar?.() },
    { id: 'ai', label: 'Vex AI', hint: 'Open AI assistant panel', shortcut: 'Ctrl+Shift+A', icon: '✨', isPrimary: true, action: () => AIPanel.toggle() },
    { id: 'summarize-ai', label: 'Summarize Page', hint: 'AI summary of current page', icon: '✨', action: () => { AIPanel.open(); AIPanel.sendMessage('summarize'); } },
    { id: 'translate-ai', label: 'AI Translate', hint: 'Translate page content with AI', icon: '✨', action: () => { AIPanel.open(); AIPanel.sendMessage('translate', { targetLanguage: 'English' }); } },
    { id: 'compare-tabs', label: 'Compare Tabs', hint: 'AI compares all open tabs', icon: '\u2696', action: () => { if(typeof TabSelector!=='undefined')TabSelector.setMode('all'); AIPanel.open(); AIPanel._sendMultiTab('Compare these tabs side-by-side.',TabManager.tabs); } },
    { id: 'summarize-tabs', label: 'Summarize All Tabs', hint: 'AI summary of every open tab', icon: '\u{1F4D1}', action: () => { if(typeof TabSelector!=='undefined')TabSelector.setMode('all'); AIPanel.open(); AIPanel._sendMultiTab('Summarize all tabs collectively.',TabManager.tabs); } },
    { id: 'schedules', label: 'Schedules', hint: 'View scheduled AI tasks', shortcut: 'Ctrl+Shift+L', icon: '\u23F0', isPrimary: true, action: () => SidebarManager.openPanel('schedules') },
    { id: 'explain-ai', label: 'Explain Selection', hint: 'AI explains selected text', icon: '✨', action: async () => { const wv = WebviewManager.getActiveWebview(); const sel = wv ? await PageContext.extractSelectedText(wv) : null; if (sel) { AIPanel.open(); AIPanel.sendMessage('explain', { selectedText: sel }); } else { window.showToast?.('Select some text first'); } } },
    // Phase 12: AI history search commands
    { id: 'remember', label: 'Remember... (AI History Search)', hint: 'Find a page by meaning: "that article about DPI"', shortcut: 'Ctrl+Shift+H', icon: '🧠', isPrimary: true, action: () => HistoryPanel.openInAIMode?.() },
    { id: 'reindex', label: 'Re-index Open Tabs', hint: 'Generate AI summaries for currently open tabs', icon: '🔄', action: () => { const n = HistoryIndexer?.reindexOpenTabs?.() || 0; window.showToast?.(n > 0 ? `Re-indexing ${n} tabs…` : 'No unindexed open tabs'); } },
    // Phase 15: personas
    { id: 'personas', label: 'Manage AI Personas', hint: 'Create, edit, export AI personas', icon: '🎭', action: () => { SidebarManager.openPanel('settings'); setTimeout(() => document.getElementById('personas-panel-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120); } },
    { id: 'persona-new', label: 'New Persona...', hint: 'Create a custom AI assistant', icon: '➕', action: () => { if (typeof PersonasSettings !== 'undefined') PersonasSettings.showPersonaEditor(null); } },
    // Phase 16: tab auto-grouping
    { id: 'group-tabs', label: 'Organize My Tabs', hint: 'AI clusters open tabs into groups', shortcut: 'Ctrl+Shift+G', icon: '🗂️', isPrimary: true, action: () => TabGrouper?.analyzeAndPropose() },
    { id: 'group-undo', label: 'Undo Last Grouping', hint: 'Revert the last AI group-apply', icon: '↩', action: () => TabGrouper?.undoLastGrouping() },
  ],

  init() {
    const overlay = document.getElementById('command-overlay');
    const input = document.getElementById('command-input');
    const results = document.getElementById('command-results');

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Input handling
    input.addEventListener('input', () => {
      this.search(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectPrev();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.executeSelected();
      }
    });
  },

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    const overlay = document.getElementById('command-overlay');
    const input = document.getElementById('command-input');

    overlay.style.display = 'flex';
    this.isOpen = true;
    input.value = '';
    input.focus();
    this.search('');
  },

  close() {
    document.getElementById('command-overlay').style.display = 'none';
    this.isOpen = false;
    this.selectedIndex = 0;
  },

  search(query) {
    const q = query.trim().toLowerCase();
    const resultsEl = document.getElementById('command-results');
    resultsEl.innerHTML = '';

    // Handle > commands
    if (q.startsWith('>')) {
      const cmd = q.slice(1).trim();
      this.results = this.commands.filter(c =>
        c.id.includes(cmd) || c.label.toLowerCase().includes(cmd)
      );
    } else if (q === '') {
      // Show default commands
      this.results = this.commands.slice(0, 8);
    } else {
      // Mix: search + URL + commands
      this.results = [];

      // Check if it's a URL
      if (/^https?:\/\//i.test(q) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(q)) {
        const url = q.startsWith('http') ? q : 'https://' + q;
        this.results.push({
          id: 'url',
          label: `Go to ${q}`,
          hint: url,
          icon: '→',
          isPrimary: true,
          action: () => {
            const tab = TabManager.getActiveTab();
            if (tab && isStartPage(tab.url)) {
              WebviewManager.navigate(url);
            } else {
              TabManager.createTab(url, true);
            }
          }
        });
      }

      // Search action
      this.results.push({
        id: 'search',
        label: `Search "${q}"`,
        hint: 'Google Search',
        icon: '🔍',
        action: () => {
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
          TabManager.createTab(searchUrl, true);
        }
      });

      // (AI fallback removed — use Ctrl+J for Ask Vex AI)

      // Matching commands
      const matching = this.commands.filter(c =>
        c.id.includes(q) || c.label.toLowerCase().includes(q) || (c.hint && c.hint.toLowerCase().includes(q))
      );
      this.results.push(...matching);
    }

    this.selectedIndex = 0;
    this.renderResults();
  },

  renderResults() {
    const resultsEl = document.getElementById('command-results');
    resultsEl.innerHTML = '';

    if (this.results.length === 0) {
      resultsEl.innerHTML = '<div class="command-empty">No results found</div>';
      return;
    }

    this.results.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = `command-result${i === this.selectedIndex ? ' selected' : ''}`;

      el.innerHTML = `
        <div class="command-result-icon${item.isPrimary ? ' primary' : ''}">${item.icon || '•'}</div>
        <div class="command-result-info">
          <div class="command-result-title">${item.label}</div>
          ${item.hint ? `<div class="command-result-hint">${item.hint}</div>` : ''}
        </div>
        ${item.shortcut ? `<div class="command-result-shortcut">${item.shortcut}</div>` : ''}
      `;

      el.addEventListener('click', () => {
        this.close();
        item.action();
      });

      el.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.updateSelection();
      });

      resultsEl.appendChild(el);
    });
  },

  selectNext() {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
    this.updateSelection();
  },

  selectPrev() {
    if (this.results.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
    this.updateSelection();
  },

  updateSelection() {
    document.querySelectorAll('.command-result').forEach((el, i) => {
      el.classList.toggle('selected', i === this.selectedIndex);
    });

    // Scroll into view
    const selected = document.querySelector('.command-result.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  },

  executeSelected() {
    if (this.results.length === 0) return;
    const item = this.results[this.selectedIndex];
    if (item) {
      this.close();
      item.action();
    }
  },

  async showHistory() {
    this.close();
    const history = await VexStorage.loadHistory();
    // For now, show last 10 in a new search
    const input = document.getElementById('command-input');
    this.open();
    this.results = history.slice(0, 15).map(h => ({
      id: 'hist-' + h.time,
      label: h.title || h.url,
      hint: h.url,
      icon: '🕐',
      action: () => TabManager.createTab(h.url, true)
    }));
    this.renderResults();
  },

  showTools() {
    this.close();
    this.open();
    const tools = typeof VexTools !== 'undefined' ? VexTools.tools : [];
    this.results = tools.map(t => ({
      id: 'tool-' + t.id,
      label: t.name,
      hint: t.desc,
      icon: t.icon,
      action: () => VexTools.openTool(t)
    }));
    this.renderResults();
  }
};
