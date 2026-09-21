// === Vex AI Assistant Panel ===

// Cloud AI routing lives in ai-router.js (AIRouter.cloudWorkerUrl(), backed by
// VexConfig / Settings). Kept for backward-compat; reads the configured URL.
const AI_WORKER_URL = (typeof window !== 'undefined' && window.VexConfig) ? window.VexConfig.aiWorkerUrl() : '';

const AIPanel = {
  _conversations: {},
  // Which conversations came from a private tab (never persisted), and which
  // conversation the panel is currently showing when it is not the active
  // tab's own. Closing a tab no longer deletes its chat, so Recent chats can
  // reopen one whose tab is long gone.
  _convPrivate: {},
  _viewingId: null,
  _sending: false,
  _agentMode: 'ask',

  init() {
    this._loadConversations();
    this._initShell();
    document.getElementById('ai-close')?.addEventListener('click', () => this.close());
    document.getElementById('ai-send')?.addEventListener('click', () => this._sendChat());
    document.getElementById('ai-clear')?.addEventListener('click', () => this._clearChat());

    // Markdown links: a plain <a> click inside the chrome document would
    // navigate the whole app window — intercept once (delegated) and open
    // left/middle clicks in a new tab instead.
    const msgsEl = document.getElementById('ai-messages');
    if (msgsEl) {
      const openMdLink = (e) => {
        const a = e.target?.closest?.('a.vex-md-link');
        if (!a) return;
        e.preventDefault();
        if (e.button !== 0 && e.button !== 1) return;
        if (typeof TabManager !== 'undefined') TabManager.createTab(a.href, true);
      };
      msgsEl.addEventListener('click', openMdLink);
      msgsEl.addEventListener('auxclick', openMdLink);
      // Resting on a source an answer cites shows what is there, so you do not
      // have to open a tab to find out whether it is worth opening a tab.
      msgsEl.addEventListener('mouseover', (e) => {
        const a = e.target?.closest?.('a.vex-md-link');
        if (a) this._previewSource(a);
      });
      // A [m:ss] in an answer about a video jumps the video there.
      msgsEl.addEventListener('click', (e) => {
        const b = e.target?.closest?.('.ai-stamp');
        if (!b) return;
        VideoChat.seek(Number(b.dataset.t)).catch(err => window.showToast?.(err.message, 'error'));
      });
    }

    document.getElementById('ai-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
    });

    // Paste or drop a picture into the box: it goes with the next question
    // (the same path as right-click › Ask Vex about this image).
    document.getElementById('ai-input')?.addEventListener('paste', (e) => {
      const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => i.kind === 'file' && /^image\//.test(i.type));
      if (!item) return;
      e.preventDefault();
      this._attachImage(item.getAsFile());
    });
    const aiPanelEl = document.getElementById('ai-panel');
    aiPanelEl?.addEventListener('dragover', (e) => {
      if ([...((e.dataTransfer && e.dataTransfer.items) || [])].some(i => i.kind === 'file' && /^image\//.test(i.type))) e.preventDefault();
    });
    aiPanelEl?.addEventListener('drop', (e) => {
      const file = [...((e.dataTransfer && e.dataTransfer.files) || [])].find(f => /^image\//.test(f.type));
      if (!file) return;
      e.preventDefault();
      this._attachImage(file);
    });

    // Phase 15: Persona switcher
    document.getElementById('active-persona-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePersonaDropdown();
    });
    document.getElementById('manage-personas-btn')?.addEventListener('click', () => {
      document.getElementById('persona-dropdown').hidden = true;
      if (window.SettingsUI?.openSection) {
        SettingsUI.openSection('personas-panel-content');
      } else if (typeof SidebarManager !== 'undefined') {
        SidebarManager.openPanel('settings');
      }
    });
    document.addEventListener('click', (e) => {
      const dd = document.getElementById('persona-dropdown');
      const btn = document.getElementById('active-persona-btn');
      if (dd && !dd.hidden && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
        dd.hidden = true;
      }
    });
    // @mention detection — switches persona when user types @name<space>
    document.getElementById('ai-input')?.addEventListener('input', (e) => {
      if (typeof PersonasManager === 'undefined') return;
      const val = e.target.value;
      // Only trigger after the @word is terminated (space or end of trailing word with more than 2 chars)
      const m = val.match(/@([A-Za-z0-9_]{2,})(\s|$)/);
      if (!m) return;
      const mention = PersonasManager.findByMention('@' + m[1]);
      if (!mention) return;
      const tab = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
      PersonasManager.setActiveForTab(tab?.id, mention.id);
      this.updatePersonaSwitcher();
      this._renderPersonaQuickPrompts();
      // Strip the first @word from the input
      e.target.value = val.replace(/@[A-Za-z0-9_]+\s*/, '').trim();
      if (typeof window.showToast === 'function') window.showToast(`Switched to ${mention.name}`, 'info');
    });

    // Stop agent button
    document.getElementById('ai-stop-agent')?.addEventListener('click', () => {
      if (typeof AgentLoop !== 'undefined') AgentLoop.stop();
      document.getElementById('ai-stop-agent')?.classList.remove('visible');
      document.getElementById('ai-pause-agent')?.classList.remove('visible');
    });

    // Pause / continue, and saying something while it is held: the run waits
    // between steps and takes what you say as its next instruction.
    document.getElementById('ai-pause-agent')?.addEventListener('click', async () => {
      if (typeof AgentLoop === 'undefined' || !AgentLoop.isRunning()) return;
      if (AgentLoop.isPaused()) { AgentLoop.resume(); return; }
      AgentLoop.pause();
      const say = await window.vexPrompt({
        title: 'Paused',
        message: 'It stops after the step it is on. Add something for it to take into account, or leave this empty and press Continue.',
        label: 'What should it do differently?',
        okLabel: 'Continue',
      });
      if (!AgentLoop.isRunning()) return;
      if (say && say.trim()) { try { AgentLoop.nudge(say); } catch (err) { window.showToast?.(err.message, 'error'); } }
      AgentLoop.resume();
    });

    this._initAgentPermission();

    document.querySelectorAll('.ai-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'compare') {
          if (typeof TabSelector !== 'undefined') TabSelector.setMode('all');
          const allTabs = TabManager.tabs;
          if (allTabs.length < 2) { window.showToast?.('Need 2+ tabs to compare'); return; }
          this._sendMultiTab('Compare these tabs side-by-side. Show key differences in a table.', allTabs);
        } else if (action === 'summarize') {
          const sel = typeof TabSelector !== 'undefined' ? TabSelector.getSelectedTabs() : [];
          if (sel.length > 1) {
            this._sendMultiTab('Summarize all these tabs collectively. Highlight main topics and common themes.', sel);
          } else {
            this.sendMessage('summarize');
          }
        } else if (action === 'translate') this.sendMessage('translate', { targetLanguage: 'English' });
        else if (action === 'ask') document.getElementById('ai-input')?.focus();
        else if (action === 'group-tabs') { if (typeof TabGrouper !== 'undefined') TabGrouper.analyzeAndPropose(); }
      });
    });
  },

  // ---- How the agent asks for permission ---------------------------------
  // 'ask' = approve manually, 'plan' = plan first, 'auto' = auto-approve
  // (the ids AgentLoop has always used; vex.agentMode). Until a choice has
  // been made (vex.agentModeChosen) the first task sent opens this menu instead
  // of running, so the agent never starts clicking under a default nobody
  // picked.
  AGENT_MODES: { ask: 'Approve manually', plan: 'Plan first', auto: 'Auto-approve' },

  _initAgentPermission() {
    const saved = localStorage.getItem('vex.agentMode');
    this._agentMode = this.AGENT_MODES[saved] ? saved : 'ask';
    this._paintAgentPermission();
    const toggle = document.getElementById('agent-perm-toggle');
    const menu = document.getElementById('agent-perm-menu');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', (e) => { e.stopPropagation(); this._openAgentPermission(menu.hidden); });
    menu.querySelectorAll('.agent-perm-item').forEach(item => {
      item.addEventListener('click', () => {
        this.setAgentMode(item.dataset.mode);
        this._openAgentPermission(false);
        const pending = this._pendingAgentRun;
        this._pendingAgentRun = false;
        if (pending) this._sendAgent();
      });
    });
    // A click elsewhere closes it — but not the click that opened it (the pill,
    // or the first task asking on first use), which reaches here as well.
    document.addEventListener('click', (e) => {
      if (menu.hidden || menu.contains(e.target)) return;
      if (e.target instanceof Element && e.target.closest('#agent-perm-toggle, #ai-send')) return;
      this._pendingAgentRun = false;
      this._openAgentPermission(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { this._pendingAgentRun = false; this._openAgentPermission(false); } });
  },

  setAgentMode(mode) {
    if (!this.AGENT_MODES[mode]) throw new Error('Unknown agent permission mode: ' + mode);
    this._agentMode = mode;
    try { localStorage.setItem('vex.agentMode', mode); localStorage.setItem('vex.agentModeChosen', '1'); } catch {}
    this._paintAgentPermission();
  },

  _agentModeChosen() {
    try { return localStorage.getItem('vex.agentModeChosen') === '1'; } catch { return true; }
  },

  _paintAgentPermission() {
    const label = document.getElementById('agent-perm-label');
    if (label) label.textContent = this.AGENT_MODES[this._agentMode];
    document.querySelectorAll('#agent-perm-menu .agent-perm-item').forEach(item => {
      const on = item.dataset.mode === this._agentMode;
      item.classList.toggle('active', on);
      item.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  },

  _openAgentPermission(open, asking) {
    const menu = document.getElementById('agent-perm-menu');
    const toggle = document.getElementById('agent-perm-toggle');
    if (!menu) return;
    menu.hidden = !open;
    menu.classList.toggle('asking', !!(open && asking));
    const head = document.getElementById('agent-perm-head');
    if (head) head.textContent = asking ? 'Before the agent starts — how should it ask for permission?' : 'How should the agent ask for permission?';
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    // The pill can sit at the panel's right edge, where a menu opening to the
    // right ran 100px off the window. Shift it back inside the panel.
    menu.style.left = '';
    if (open) {
      const panel = document.getElementById('ai-panel');
      const bounds = panel ? panel.getBoundingClientRect() : { left: 0, right: window.innerWidth };
      const box = menu.getBoundingClientRect();
      const over = box.right - (Math.min(bounds.right, window.innerWidth) - 8);
      if (over > 0) menu.style.left = -Math.min(over, Math.max(0, box.left - bounds.left - 8)) + 'px';
    }
  },

  _sendAgent() {
    const input = document.getElementById('ai-input');
    const msg = input?.value.trim();
    if (!msg) {
      input?.focus();
      window.showToast?.('Type a task first');
      return;
    }
    // First use: ask how it may act before it acts at all. The task stays in
    // the box and runs as soon as a mode is picked.
    if (!this._agentModeChosen() && document.getElementById('agent-perm-menu')) {
      this._pendingAgentRun = true;
      this._openAgentPermission(true, true);
      return;
    }
    // Don't clear the box for a run that can't start: the agent is already busy,
    // or the agent module never loaded.
    if (typeof AgentLoop === 'undefined' || typeof AgentLoop.start !== 'function') {
      window.showToast?.('Agent system not loaded', 'error');
      return;
    }
    if (AgentLoop.isRunning?.()) {
      window.showToast?.('The agent is already running — stop it first', 'info');
      return;
    }
    input.value = '';
    if (!this.isOpen()) this.open();

    // The run belongs to this tab's conversation. It used to exist only on
    // screen: reopening the panel redrew from an empty conversation, so the
    // question, every step and the answer were gone — and Recent chats had
    // nothing to list.
    const tabId = this._getTabId();
    this._viewingId = null;
    const conv = this._getConv(tabId);
    conv.push({ role: 'user', content: msg });
    this._persistConversations();
    this._agentTabId = tabId;

    // Clear empty state and add user message
    const container = document.getElementById('ai-messages');
    if (container) {
      const emptyState = container.querySelector('.ai-empty');
      if (emptyState) emptyState.remove();
      const el = document.createElement('div');
      el.className = 'ai-msg user';
      const c = document.createElement('div'); c.className = 'ai-msg-content'; c.textContent = msg;
      el.appendChild(c);
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
    }

    // Show stop button + running indicator
    document.getElementById('ai-stop-agent')?.classList.add('visible');
    document.getElementById('ai-pause-agent')?.classList.add('visible');

    // Start agent loop
    const done = () => {
      document.getElementById('ai-stop-agent')?.classList.remove('visible');
      // Keep the outcome with the chat; the steps stay with the saved run.
      const run = (typeof AgentLoop !== 'undefined' && AgentLoop.lastRun && AgentLoop.lastRun.goal === msg) ? AgentLoop.lastRun : null;
      conv.push({ role: 'assistant', content: (run && run.final) || '*The agent stopped without an answer.*', ...(run ? { agentRun: run.id } : {}) });
      this._agentTabId = null;
      this._persistConversations();
    };
    AgentLoop.start(msg, this._agentMode).then(done, (err) => {
      // A rejection here used to vanish: the buttons reset and the user was
      // left with no idea why nothing happened.
      this._addError(err?.message || 'The agent stopped unexpectedly');
      done();
    });
  },

  open() {
    this._initShell();
    document.getElementById('ai-panel')?.classList.add('open');
    // The mark that says an answer arrived while this was shut has done its job.
    document.getElementById('btn-toggle-ai')?.classList.remove('answered');
    this._bindDismiss();
    this._syncBackdrop();
    this._syncStarters();
    this._renderMessages();
    this._updateTabIndicator();
    this.updatePersonaSwitcher();
    this._renderPersonaQuickPrompts();
    this._maybeShowOllamaHint();
    setTimeout(() => document.getElementById('ai-input')?.focus(), 150);
  },

  // === Phase 15: Persona switcher ===
  getActivePersona() {
    if (typeof PersonasManager === 'undefined') return null;
    const tab = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
    return PersonasManager.getActiveForTab(tab?.id) || null;
  },

  // Persona icons are VexIcons names ('sparkles', 'flask', \u2026). A custom persona
  // may still hold a literal glyph the user typed, which markup() passes through.
  _personaIcon(p, size) {
    const raw = (p && p.icon) || 'sparkles';
    // Never hand an imported persona's icon to innerHTML unescaped — only a
    // known icon NAME may become markup.
    if (window.VexIcons && VexIcons.has(raw)) return VexIcons.svg(raw, { size: size || 14 });
    return this._esc(raw);
  },

  updatePersonaSwitcher() {
    const p = this.getActivePersona();
    if (!p) return;
    const iconEl = document.getElementById('active-persona-icon');
    const nameEl = document.getElementById('active-persona-name');
    if (iconEl) iconEl.innerHTML = this._personaIcon(p, 14);
    if (nameEl) nameEl.textContent = p.name || 'Vex';
  },

  _togglePersonaDropdown() {
    const dd = document.getElementById('persona-dropdown');
    if (!dd) return;
    if (!dd.hidden) { dd.hidden = true; return; }
    this._renderPersonaDropdown();
    dd.hidden = false;
  },

  // The search box, created once, above the list.
  _mountPersonaSearch() {
    const dd = document.getElementById('persona-dropdown');
    if (!dd || dd.querySelector('#persona-search')) return;
    const wrap = document.createElement('div');
    wrap.className = 'persona-search-wrap';
    const input = document.createElement('input');
    input.id = 'persona-search';
    input.type = 'search';
    input.placeholder = 'Filter personas…';
    input.autocomplete = 'off';
    input.addEventListener('input', () => {
      this._personaFilter = input.value;
      this._renderPersonaDropdown();
      // Re-rendering the list does not touch this input, so focus is kept.
      input.focus();
    });
    // Escape clears the filter before the dropdown-closing handler sees it.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.stopPropagation();
        input.value = '';
        this._personaFilter = '';
        this._renderPersonaDropdown();
        input.focus();
      }
    });
    wrap.appendChild(input);
    dd.insertBefore(wrap, dd.firstChild);
  },

  // Filter, so 25 personas is a search rather than a scroll.
  _personaFilter: '',

  _renderPersonaDropdown() {
    if (typeof PersonasManager === 'undefined') return;
    const list = document.getElementById('persona-list');
    if (!list) return;
    this._mountPersonaSearch();
    const q = String(this._personaFilter || '').trim().toLowerCase();
    const all = PersonasManager.getAll().filter(p => !q
      || String(p.name || '').toLowerCase().includes(q)
      || String(p.description || '').toLowerCase().includes(q));
    const active = this.getActivePersona();
    list.innerHTML = all.map(p => `
      <div class="persona-item ${p.id === active?.id ? 'active' : ''}" data-persona-id="${this._esc(p.id)}">
        <span class="persona-item-icon">${this._personaIcon(p, 16)}</span>
        <div class="persona-item-info">
          <div class="persona-item-name">${this._esc(p.name)}</div>
          <div class="persona-item-desc">${this._esc(p.description || '')}</div>
        </div>
        ${p.isBuiltIn ? '<span class="persona-item-builtin">built-in</span>' : ''}
      </div>
    `).join('');
    if (!all.length) list.innerHTML = '<div class="persona-item-desc" style="padding:10px">No persona matches that.</div>';
    list.querySelectorAll('.persona-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.personaId;
        const tab = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
        PersonasManager.setActiveForTab(tab?.id, id);
        this.updatePersonaSwitcher();
        this._renderPersonaQuickPrompts();
        document.getElementById('persona-dropdown').hidden = true;
        if (typeof window.showToast === 'function') {
          window.showToast(`Switched to ${PersonasManager.getById(id).name}`, 'info');
        }
      });
    });
  },

  _renderPersonaQuickPrompts() {
    const row = document.getElementById('persona-prompts-row');
    if (!row) return;
    const p = this.getActivePersona();
    const prompts = (p && Array.isArray(p.quickPrompts)) ? p.quickPrompts.slice(0, 5) : [];
    // Somewhere to begin is only useful before you have begun. This ran AFTER
    // _syncStarters had hidden the row, so three suggestions sat under every
    // conversation for its whole life, pushing the answers up the panel.
    if (!prompts.length || this._getConv().length) { row.style.display = 'none'; row.innerHTML = ''; return; }
    row.style.display = 'flex';
    row.innerHTML = prompts.map(pt => {
      const label = pt.length > 44 ? pt.substring(0, 42) + '\u2026' : pt;
      return `<button class="persona-prompt" data-prompt="${this._esc(pt)}">${this._esc(label)}</button>`;
    }).join('');
    row.querySelectorAll('.persona-prompt').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('ai-input');
        if (!input) return;
        input.value = btn.dataset.prompt;
        this._sendChat();
      });
    });
  },

  _maybeShowOllamaHint() {
    try {
      if (typeof AIRouter === 'undefined') return;
      if (AIRouter.isOllamaAvailable()) return;
      if (localStorage.getItem('vex.ollamaHintShown') === 'true') return;
      const msgs = document.getElementById('ai-messages');
      if (!msgs || msgs.querySelector('.ollama-hint')) return;
      const hint = document.createElement('div');
      hint.className = 'ollama-hint';
      hint.innerHTML = `<span>${this._icon('bulb', 14)} Install <a id="open-ollama-hint">Ollama</a> to run AI locally &mdash; faster, private, works offline.</span>`
        + `<button class="hint-dismiss" type="button" title="Dismiss" aria-label="Dismiss">${this._icon('x', 13)}</button>`;
      msgs.insertBefore(hint, msgs.firstChild);
      hint.querySelector('#open-ollama-hint').addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof TabManager !== 'undefined') TabManager.createTab('https://ollama.com/download', true);
      });
      hint.querySelector('.hint-dismiss').addEventListener('click', () => {
        hint.remove();
        try { localStorage.setItem('vex.ollamaHintShown', 'true'); } catch {}
      });
    } catch {}
  },

  // === Shell: modes, dismissal, chats =====================================
  //
  // Docked is the column on the right. Focus mode (#ai-panel.expanded) takes
  // the window and centres the conversation, for when the chat IS the task
  // rather than a note in the margin. The choice is remembered.

  MODE_KEY: 'vex.aiMode',
  _shellReady: false,

  _icon(name, size) {
    return (window.VexIcons && VexIcons.has(name)) ? VexIcons.svg(name, { size: size || 15 }) : '';
  },

  _initShell() {
    if (this._shellReady) return;
    this._shellReady = true;

    // Header and composer icons, drawn from the icon set so they follow the theme.
    const paint = (id, icon, size) => { const el = document.getElementById(id); if (el && !el.innerHTML.trim()) el.innerHTML = this._icon(icon, size); };
    paint('ai-new-chat', 'plus', 16);
    paint('ai-history-btn', 'history', 15);
    // Export and Clear sit with the other whole-conversation actions now,
    // rather than on a row of their own under the box you type in.
    paint('ai-export', 'download', 15);
    paint('ai-clear', 'trash', 15);
    paint('ai-expand', 'maximize', 15);
    paint('ai-close', 'x', 16);
    paint('ai-send', 'arrow-right', 17);

    // The dimmer behind focus mode. Clicking it closes, like clicking away
    // from the docked panel.
    if (!document.getElementById('ai-backdrop')) {
      const b = document.createElement('div');
      b.id = 'ai-backdrop';
      b.addEventListener('mousedown', () => this.close());
      document.body.appendChild(b);
    }

    // Show thinking: off by default because it makes a local reasoning model
    // several times slower. The button says which it is, and what it costs.
    paint('ai-think-toggle', 'brain', 15);
    const thinkBtn = document.getElementById('ai-think-toggle');
    const drawThink = () => {
      if (!thinkBtn) return;
      const on = typeof AIRouter !== 'undefined' && AIRouter.showThinking && AIRouter.showThinking();
      thinkBtn.classList.toggle('active', !!on);
      thinkBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      thinkBtn.title = on
        ? 'Show thinking: ON — you see the model think as a live line. Replies from a reasoning model are several times slower. Click to turn off.'
        : 'Show thinking: off — replies are fast. Click to watch a reasoning model (like qwen3.5) think as it works; replies get several times slower.';
    };
    thinkBtn?.addEventListener('click', () => {
      if (typeof AIRouter === 'undefined' || !AIRouter.setShowThinking) return;
      const on = AIRouter.setShowThinking(!AIRouter.showThinking());
      window.showToast?.(on ? 'Show thinking on — a reasoning model will think out loud, and take longer' : 'Show thinking off — back to quick replies');
    });
    document.addEventListener('vex:show-thinking', drawThink);
    drawThink();

    document.getElementById('ai-expand')?.addEventListener('click', () => this.toggleMode());
    document.getElementById('ai-new-chat')?.addEventListener('click', () => this.newChat());
    document.getElementById('ai-history-btn')?.addEventListener('click', () => this.toggleHistory());
    document.getElementById('ai-history-close')?.addEventListener('click', () => this.toggleHistory(false));
    document.getElementById('ai-export')?.addEventListener('click', () => this.exportChat());

    // Grow the composer with what is typed, up to the CSS max-height.
    const input = document.getElementById('ai-input');
    if (input) {
      const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 240) + 'px'; };
      input.addEventListener('input', grow);
      this._growInput = grow;
    }

    this.setMode(this._savedMode(), { silent: true });
  },

  _savedMode() {
    try { return localStorage.getItem(this.MODE_KEY) === 'expanded' ? 'expanded' : 'docked'; } catch { return 'docked'; }
  },

  // 'docked' | 'expanded'
  setMode(mode, opts) {
    const panel = document.getElementById('ai-panel');
    if (!panel) return;
    const expanded = mode === 'expanded';
    panel.classList.toggle('expanded', expanded);
    const btn = document.getElementById('ai-expand');
    if (btn) {
      btn.classList.toggle('active', expanded);
      btn.title = expanded ? 'Exit full screen (Ctrl+Shift+F)' : 'Full screen (Ctrl+Shift+F)';
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = this._icon(expanded ? 'compress' : 'maximize', 15);
    }
    if (!(opts && opts.silent)) {
      try { localStorage.setItem(this.MODE_KEY, expanded ? 'expanded' : 'docked'); } catch {}
    }
    this._syncBackdrop();
  },

  toggleMode() {
    this.setMode(document.getElementById('ai-panel')?.classList.contains('expanded') ? 'docked' : 'expanded');
    setTimeout(() => document.getElementById('ai-input')?.focus(), 60);
  },

  _syncBackdrop() {
    const panel = document.getElementById('ai-panel');
    const b = document.getElementById('ai-backdrop');
    if (!panel || !b) return;
    b.classList.toggle('show', panel.classList.contains('open') && panel.classList.contains('expanded'));
  },

  // Close when the user clicks away or presses Escape.
  //
  // A click inside a page happens in a <webview>, which never reaches this
  // document — so window blur is watched too, exactly as the other popups in
  // Vex do it. Without that, clicking the page left the panel stuck open.
  _bindDismiss() {
    if (this._onDocDown) return;
    const panel = document.getElementById('ai-panel');
    this._onDocDown = (e) => {
      if (!this.isOpen()) return;
      if (panel && panel.contains(e.target)) return;
      // The buttons that open it must stay a toggle, not close-then-reopen.
      if (e.target?.closest?.('#btn-toggle-ai, .vex-job-btn, #ai-backdrop')) return;
      this.close();
    };
    this._onEsc = (e) => {
      if (e.key !== 'Escape' || !this.isOpen()) return;
      const dd = document.getElementById('persona-dropdown');
      const td = document.getElementById('tab-selector-dropdown');
      if (dd && !dd.hidden) { dd.hidden = true; return; }
      if (td && !td.hidden) { td.hidden = true; return; }
      this.close();
    };
    // Window blur fires for two different things: clicking into a page (the
    // click happens in a <webview> and never reaches this document) and
    // switching to another application. Only the first should dismiss the
    // panel — closing on alt-tab loses your place for no reason.
    //
    // They are told apart by where focus went: into a webview, or out of the
    // window entirely. The check is deferred a tick because activeElement is
    // not updated until after blur.
    this._onWinBlur = () => {
      if (!this.isOpen()) return;
      setTimeout(() => {
        if (!this.isOpen()) return;
        const el = document.activeElement;
        const intoPage = !!el && el.tagName === 'WEBVIEW';
        const leftTheApp = typeof document.hasFocus === 'function' && !document.hasFocus();
        if (intoPage || !leftTheApp) this.close();
      }, 0);
    };
    // A page click that focuses the guest directly, without a window blur.
    this._onFocusIn = (e) => {
      if (!this.isOpen()) return;
      if (e.target && e.target.tagName === 'WEBVIEW') this.close();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', this._onDocDown, true);
      document.addEventListener('keydown', this._onEsc, true);
      window.addEventListener('blur', this._onWinBlur);
      document.addEventListener('focusin', this._onFocusIn, true);
    }, 0);
  },

  _unbindDismiss() {
    if (this._onDocDown) document.removeEventListener('mousedown', this._onDocDown, true);
    if (this._onEsc) document.removeEventListener('keydown', this._onEsc, true);
    if (this._onWinBlur) window.removeEventListener('blur', this._onWinBlur);
    if (this._onFocusIn) document.removeEventListener('focusin', this._onFocusIn, true);
    this._onDocDown = this._onEsc = this._onWinBlur = this._onFocusIn = null;
  },

  // Starters belong to an empty conversation; once there is a thread they are
  // clutter sitting between the user and the composer.
  _syncStarters() {
    const empty = this._getConv().length === 0;
    const qa = document.getElementById('ai-quick-actions');
    if (qa) qa.hidden = !empty;
    const pr = document.getElementById('persona-prompts-row');
    if (pr && !empty) pr.style.display = 'none';
  },

  // === Chats ==============================================================

  newChat() {
    this._viewingId = null;
    this._syncViewingBanner();
    const id = this._getTabId();
    if (id != null) { this._conversations[id] = []; this._persistConversations(); }
    this._renderMessages();
    this._syncStarters();
    this._renderPersonaQuickPrompts();
    document.getElementById('ai-input')?.focus();
  },

  // Say plainly when the panel is showing a past chat rather than this tab's,
  // with a way back. Without this the header would claim to be "talking about"
  // the current page while showing someone else's conversation.
  _syncViewingBanner() {
    const panel = document.getElementById('ai-panel');
    if (!panel) return;
    let bar = document.getElementById('ai-viewing');
    if (!this._viewingId) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'ai-viewing';
      bar.className = 'ai-viewing';
      const label = document.createElement('span');
      label.className = 'ai-viewing-label';
      const back = document.createElement('button');
      back.className = 'btn-link';
      back.textContent = 'Back to this tab';
      back.addEventListener('click', () => {
        this._viewingId = null;
        this._syncViewingBanner();
        this._renderMessages();
        this._syncStarters();
      });
      bar.appendChild(label);
      bar.appendChild(back);
      const body = panel.querySelector('.ai-body');
      if (body) panel.insertBefore(bar, body); else panel.appendChild(bar);
    }
    const tab = (typeof TabManager !== 'undefined' && TabManager.tabs)
      ? TabManager.tabs.find(t => String(t.id) === String(this._viewingId)) : null;
    bar.querySelector('.ai-viewing-label').textContent =
      tab ? `Earlier chat — ${tab.title || tab.url || 'another tab'}` : 'Earlier chat — from a tab you have since closed';
  },

  toggleHistory(force) {
    const el = document.getElementById('ai-history');
    if (!el) return;
    const show = typeof force === 'boolean' ? force : el.hidden;
    el.hidden = !show;
    document.getElementById('ai-history-btn')?.classList.toggle('active', show);
    if (show) {
      this._renderHistory();
      const box = document.getElementById('ai-history-search');
      if (box && !box.dataset.wired) { box.dataset.wired = '1'; box.addEventListener('input', () => this._renderHistory()); }
    }
  },

  // Conversations are stored per tab, so "recent chats" is every tab that has
  // one — including tabs that have since been closed.
  // What is typed in the box above the list: chats whose words match, with
  // the line that matched (searching every chat was otherwise impossible —
  // they are one per tab and a closed tab's chat is unreachable by browsing).
  _historyQuery() { return (document.getElementById('ai-history-search')?.value || '').trim().toLowerCase(); },

  // → the first message that matches, or null. Exported shape for the tests.
  matchInChat(msgs, query) {
    if (!query) return null;
    for (const m of msgs) {
      const i = String(m.content || '').toLowerCase().indexOf(query);
      if (i >= 0) return { role: m.role, text: String(m.content).slice(Math.max(0, i - 30), i + 90).trim() };
    }
    return null;
  },

  _renderHistory() {
    const list = document.getElementById('ai-history-list');
    if (!list) return;
    const query = this._historyQuery();
    const current = String(this._getTabId());
    const titleOf = (tabId) => {
      const t = (typeof TabManager !== 'undefined' ? TabManager.tabs : []).find(x => String(x.id) === String(tabId));
      return t ? (t.title || t.url || 'Untitled') : 'Closed tab';
    };
    const meta = this._chatMeta();
    // Newest first, pinned chats above the rest.
    const rows = Object.entries(this._conversations || {})
      .filter(([, msgs]) => Array.isArray(msgs) && msgs.length)
      .map(([tabId, msgs]) => ({ tabId, msgs, first: msgs.find(m => m.role === 'user'), meta: meta[tabId] || {}, hit: this.matchInChat(msgs, query) }))
      .filter(r => !query || r.hit)
      .reverse()
      .sort((a, b) => (b.meta.pinned ? 1 : 0) - (a.meta.pinned ? 1 : 0));

    const runs = query ? [] : ((typeof AgentLoop !== 'undefined' && typeof AgentLoop.runs === 'function') ? AgentLoop.runs() : []);
    if (!rows.length && !runs.length) {
      list.innerHTML = `<div class="ai-history-empty">${query ? 'No chat mentions “' + this._esc(query) + '”.' : 'No conversations yet.'}</div>`;
      return;
    }
    list.innerHTML = '';
    // Agent runs: the goal, how it ended, and the whole run back on a click.
    if (runs.length) {
      const head = document.createElement('div');
      head.className = 'ai-history-sub';
      head.textContent = 'Agent runs';
      list.appendChild(head);
      for (const run of runs) {
        const b = document.createElement('button');
        b.className = 'ai-history-item ai-history-run';
        b.innerHTML = '<span class="t"></span><span class="m"></span>';
        b.querySelector('.t').textContent = String(run.goal || '').slice(0, 70);
        b.querySelector('.m').textContent = [run.final ? 'Answered' : 'No answer', (run.steps || []).length + ' steps', (run.seconds || 0) + ' s', run.backend || '', new Date(run.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean).join(' · ');
        // What it MADE can be unmade — only Vex's own things (js/agent-loop.js).
        if ((run.undo || []).length) {
          const undo = document.createElement('button');
          undo.className = 'ai-history-undo';
          undo.textContent = 'Undo';
          undo.title = 'Remove what this run made: ' + run.undo.map(u => u.label).join(', ');
          undo.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const made = run.undo.map(u => '• ' + u.label).join('\n');
            const ok = await vexConfirm({
              title: 'Undo this run?',
              message: 'This removes what it made:\n\n' + made + '\n\nWhat it did on a web page cannot be taken back from here.',
              okLabel: 'Undo', danger: true,
            });
            if (!ok) return;
            try {
              const r = await AgentLoop.undoRun(run.id);
              window.showToast?.(r.undone.length ? 'Removed ' + r.undone.join(', ') + (r.failed.length ? ' — could not remove ' + r.failed.join(', ') : '') : 'Nothing was left to remove', r.failed.length ? 'error' : undefined);
            } catch (err) { window.showToast?.((err && err.message) || 'Could not undo it', 'error'); }
            this._renderHistory();
          });
          b.appendChild(undo);
        }
        // A run that worked is a recipe: keep it and repeat it without the AI.
        if ((run.calls || []).length && typeof AgentLoop.saveAsMacro === 'function') {
          const keep = document.createElement('button');
          keep.className = 'ai-history-undo';
          keep.textContent = 'Save as a task';
          keep.title = 'Repeat these ' + run.calls.length + ' steps later without asking the AI';
          keep.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const name = await vexPrompt({ title: 'Name this task', message: 'You will run it from Ctrl+K. It repeats the same steps, with no AI.', value: String(run.goal || '').slice(0, 60), okLabel: 'Save' });
            if (name == null) return;
            try { AgentLoop.saveAsMacro(run.id, name); window.showToast?.('Saved — Ctrl+K → Repeat a task'); }
            catch (err) { window.showToast?.((err && err.message) || 'Could not save it', 'error'); }
            this._renderHistory();
          });
          b.appendChild(keep);
        }
        b.addEventListener('click', () => {
          if (AgentLoop.isRunning()) { window.showToast?.('The agent is running — stop it first'); return; }
          this.toggleHistory(false);
          try { AgentLoop.showRun(run.id); } catch (err) { window.showToast?.((err && err.message) || 'Could not open that run', 'error'); }
        });
        list.appendChild(b);
      }
      if (rows.length) { const head2 = document.createElement('div'); head2.className = 'ai-history-sub'; head2.textContent = 'Chats'; list.appendChild(head2); }
    }
    for (const r of rows) {
      const b = document.createElement('button');
      b.className = 'ai-history-item' + (String(r.tabId) === current ? ' current' : '');
      b.innerHTML = `<span class="t"></span><span class="m"></span>`;
      b.querySelector('.t').textContent = (r.meta.pinned ? 'Pinned · ' : '') + (r.meta.title || (r.first && r.first.content.slice(0, 70)) || titleOf(r.tabId));
      b.querySelector('.m').textContent = r.hit ? (r.hit.role === 'user' ? 'You: ' : 'Vex: ') + r.hit.text : `${r.msgs.length} message${r.msgs.length === 1 ? '' : 's'} · ${titleOf(r.tabId)}`;
      // Pin, rename, or keep the whole conversation as a note.
      const tool = (label, title, fn) => {
        const x = document.createElement('button');
        x.className = 'ai-history-undo'; x.type = 'button'; x.textContent = label; x.title = title;
        x.addEventListener('click', async (ev) => { ev.stopPropagation(); await fn(); });
        b.appendChild(x);
      };
      tool(r.meta.pinned ? 'Unpin' : 'Pin', r.meta.pinned ? 'Stop keeping this chat at the top' : 'Keep this chat at the top', () => { this._setChatMeta(r.tabId, { pinned: !r.meta.pinned }); this._renderHistory(); });
      tool('Rename', 'Give this chat a name', async () => {
        const name = await vexPrompt({ title: 'Name this chat', value: r.meta.title || (r.first && r.first.content.slice(0, 60)) || '', okLabel: 'Rename' });
        if (name == null) return;
        this._setChatMeta(r.tabId, { title: String(name).replace(/\s+/g, ' ').trim().slice(0, 80) || undefined });
        this._renderHistory();
      });
      tool('To note', 'Save the whole conversation as a note', () => {
        const text = r.msgs.filter(m => m.role !== 'system').map(m => `**${m.role === 'user' ? 'You' : 'Vex AI'}:** ${m.content}`).join('\n\n');
        try { AgentTools.saveNote((r.meta.title || (r.first && r.first.content) || 'AI chat').replace(/\s+/g, ' ').slice(0, 80), text); window.showToast?.('Saved to Notes'); }
        catch (err) { window.showToast?.((err && err.message) || 'Could not save the note', 'error'); }
      });
      b.addEventListener('click', () => {
        // Open the chat here rather than hunting for its tab. Chats outlive
        // tabs now, so "that tab is closed" is no longer a dead end.
        this._viewingId = String(r.tabId) === String(this._getTabId()) ? null : r.tabId;
        this.toggleHistory(false);
        this._renderMessages();
        this._syncStarters();
        this._syncViewingBanner();
      });
      list.appendChild(b);
    }
  },

  exportChat() {
    const conv = this._getConv();
    if (!conv.length) { window.showToast?.('Nothing to export yet'); return; }
    const when = new Date();
    const lines = [`# Vex AI — ${when.toLocaleString()}`, ''];
    for (const m of conv) lines.push(`**${m.role === 'user' ? 'You' : 'Vex AI'}:** ${m.content}`, '');
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vex-ai-${when.toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },

  // A picture attached to the next question, as a data URL.
  _pendingImage: null,
  MAX_IMAGE_BYTES: 8 * 1024 * 1024,
  _attachImage(file) {
    if (!file) return;
    if (file.size > this.MAX_IMAGE_BYTES) { window.showToast?.('That picture is over 8 MB — use a smaller one or a screenshot of the part that matters', 'error'); return; }
    const reader = new FileReader();
    reader.onerror = () => window.showToast?.('That picture could not be read: ' + ((reader.error && reader.error.message) || ''), 'error');
    reader.onload = () => {
      this._pendingImage = String(reader.result);
      const input = document.getElementById('ai-input');
      document.getElementById('ai-attach')?.remove();
      const chip = document.createElement('div');
      chip.id = 'ai-attach';
      chip.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 10px 6px;padding:4px 6px 4px 4px;border:1px solid var(--border);border-radius:8px;background:var(--surface);font-size:11.5px;color:var(--text)';
      chip.innerHTML = `<img alt="" style="width:34px;height:34px;object-fit:cover;border-radius:5px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><button type="button" aria-label="Remove the picture" title="Remove the picture" style="display:inline-flex;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:3px">${this._icon('x', 12)}</button>`;
      chip.querySelector('img').src = this._pendingImage;
      chip.querySelector('span').textContent = 'Picture attached — ask about it, or just press Enter';
      chip.querySelector('button').addEventListener('click', () => this._clearAttachment());
      const anchor = input && (input.closest('.ai-input-row, .ai-input-wrap, form') || input.parentElement);
      if (anchor) anchor.insertAdjacentElement('beforebegin', chip);
      input?.focus();
    };
    reader.readAsDataURL(file);
  },
  _clearAttachment() {
    this._pendingImage = null;
    document.getElementById('ai-attach')?.remove();
  },

  // Names and pins for chats in the history list, by conversation id.
  // How many messages of a chat are sent with a question (the rest is out of
  // the model's reach — AIPanel._renderMessages draws the line).
  HISTORY_SENT: 10,
  _CHAT_META_KEY: 'vex.aiChatMeta',
  _chatMeta() {
    try { const o = JSON.parse(localStorage.getItem(this._CHAT_META_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; }
    catch (err) { window.showToast?.('Chat names and pins could not be read', 'error'); return {}; }
  },
  _setChatMeta(id, patch) {
    const all = this._chatMeta();
    const next = { ...(all[id] || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === false) delete next[k];
    if (Object.keys(next).length) all[id] = next; else delete all[id];
    localStorage.setItem(this._CHAT_META_KEY, JSON.stringify(all));
  },

  // The links an answer cites, in order, without repeats.
  _linksIn(text) {
    const seen = new Set();
    for (const u of String(text || '').match(/https?:\/\/[^\s<>"')\]]+/g) || []) seen.add(u.replace(/[.,;:!?]+$/, ''));
    return [...seen];
  },

  // "Dig deeper" and "Open sources" under the latest answer.
  _nextChips(m) {
    const box = document.createElement('div');
    box.className = 'follow-ups ai-next-chips';
    const chip = (label, fn) => {
      const b = document.createElement('button');
      b.className = 'follow-up-btn'; b.type = 'button'; b.textContent = label;
      b.addEventListener('click', fn);
      box.appendChild(b);
    };
    chip('Dig deeper', () => this.sendMessage('chat', { message: 'Go deeper on that: more detail, concrete examples, and anything I should watch out for.' }));
    const links = this._linksIn(m.content);
    if (links.length) {
      chip(links.length === 1 ? 'Open the source' : 'Open the ' + Math.min(links.length, 5) + ' sources', () => {
        for (const u of links.slice(0, 5)) TabManager.createTab(u, false);
        window.showToast?.('Opened ' + Math.min(links.length, 5) + ' tab' + (links.length === 1 ? '' : 's') + ' in the background');
      });
    }
    return box;
  },

  // Copy / retry, per message.
  _msgActions(m, index, contentEl) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg-actions';

    const act = (icon, title, fn) => {
      const b = document.createElement('button');
      b.className = 'ai-msg-act';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = this._icon(icon, 13);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
      wrap.appendChild(b);
      return b;
    };

    act('copy', 'Copy', async (b) => {
      try {
        await navigator.clipboard.writeText(m.content);
        b.classList.add('done');
        b.innerHTML = this._icon('check', 13);
        setTimeout(() => { b.classList.remove('done'); b.innerHTML = this._icon('copy', 13); }, 1400);
      } catch (err) {
        window.showToast?.('Could not copy: ' + ((err && err.message) || 'clipboard unavailable'), 'error');
      }
    });

    if (m.role === 'assistant') {
      // Any answer — a comparison table, a plan, an explanation — kept as a
      // note, titled with the question that produced it.
      act('note', 'Save as note', (b) => {
        const conv = this._getConv();
        let ask = '';
        for (let i = index - 1; i >= 0; i--) if (conv[i] && conv[i].role === 'user') { ask = conv[i].content; break; }
        try {
          AgentTools.saveNote((ask || 'AI answer').replace(/\s+/g, ' ').trim().slice(0, 80), m.content);
          b.innerHTML = this._icon('check', 13); b.title = 'Saved to Notes';
          window.showToast?.('Saved to Notes');
        } catch (err) { window.showToast?.((err && err.message) || 'Could not save the note', 'error'); }
      });
      act('refresh', 'Try this answer again', () => {
        const conv = this._getConv();
        // The prompt that produced this answer is the user turn before it.
        let ask = null;
        for (let i = index - 1; i >= 0; i--) if (conv[i].role === 'user') { ask = conv[i].content; break; }
        if (!ask) { window.showToast?.('Nothing to retry — no question above this answer'); return; }
        conv.splice(index, 1);
        this._persistConversations();
        this._renderMessages();
        this.sendMessage('chat', { message: ask });
      });
    } else {
      act('edit', 'Edit and ask again', () => {
        const input = document.getElementById('ai-input');
        if (!input) return;
        input.value = m.content;
        input.focus();
        if (this._growInput) this._growInput();
      });
    }
    return wrap;
  },

  close() {
    document.getElementById('ai-panel')?.classList.remove('open');
    this.toggleHistory(false);
    this._viewingId = null;
    this._syncViewingBanner();
    this._unbindDismiss();
    this._syncBackdrop();
  },

  toggle() {
    const p = document.getElementById('ai-panel');
    if (p?.classList.contains('open')) this.close(); else this.open();
  },

  isOpen() { return document.getElementById('ai-panel')?.classList.contains('open'); },

  _getTabId() { return TabManager.activeTabId; },

  _getConv(tabId) {
    // When a past chat is open from Recent chats, that is the conversation —
    // otherwise it is the active tab's.
    const id = tabId || this._viewingId || this._getTabId();
    if (!id) return [];
    if (!this._conversations[id]) {
      this._conversations[id] = [];
      // Decide privacy now: once the tab closes there is nothing left to ask.
      try {
        const tab = (typeof TabManager !== 'undefined' && TabManager.tabs)
          ? TabManager.tabs.find(t => String(t.id) === String(id)) : null;
        if (tab && window.VexTabPolicy && !window.VexTabPolicy.canPersist(tab)) this._convPrivate[id] = true;
      } catch {}
    }
    return this._conversations[id];
  },

  // === Conversation persistence ===
  // Chats used to live only in memory: quitting Vex (or a crash) lost every
  // thread. They're stored per tab, capped, and pruned to tabs that still exist
  // so closed tabs can't grow the store forever.
  CONV_KEY: 'vex.aiConversations',
  MAX_CONV_MESSAGES: 40,
  MAX_THINKING_CHARS: 4000,
  MAX_CONV_TABS: 20,

  _loadConversations() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.CONV_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return;
      for (const [tabId, msgs] of Object.entries(raw)) {
        if (!Array.isArray(msgs)) continue;
        this._conversations[tabId] = msgs
          .filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
          .map(m => ({
            role: m.role, content: m.content,
            ...((typeof m.thinking === 'string' && m.thinking) ? { thinking: m.thinking.slice(0, this.MAX_THINKING_CHARS) } : {}),
            ...((typeof m.agentRun === 'string' && m.agentRun) ? { agentRun: m.agentRun } : {}),
          }))
          .slice(-this.MAX_CONV_MESSAGES);
      }
    } catch {}
  },

  _persistConversations() {
    try {
      const out = {};
      let kept = 0;
      const ids = Object.keys(this._conversations).reverse(); // newest first
      for (const id of ids) {
        // A chat about a private page must never reach disk. Privacy is
        // recorded when the conversation is created, because by the time it is
        // saved the tab may be gone and there is nothing left to ask.
        if (this._convPrivate[id]) continue;
        const msgs = this._conversations[id];
        if (!Array.isArray(msgs) || !msgs.length) continue;
        if (++kept > this.MAX_CONV_TABS) break;
        // Reasoning travels with its turn, capped: a long chain of thought is
        // far bigger than the answer and this store is a localStorage budget.
        out[id] = msgs.slice(-this.MAX_CONV_MESSAGES).map(m => ({
          role: m.role, content: m.content,
          ...(m.thinking ? { thinking: String(m.thinking).slice(0, this.MAX_THINKING_CHARS) } : {}),
          ...(m.agentRun ? { agentRun: String(m.agentRun) } : {}),
        }));
      }
      localStorage.setItem(this.CONV_KEY, JSON.stringify(out));
    } catch (err) {
      // A chat that cannot be saved is gone the moment the panel redraws, and
      // this catch used to be the end of it.
      if (typeof VexProblems !== 'undefined') VexProblems.note('AI chat', 'This conversation could not be saved', err);
    }
  },

  _updateTabIndicator() {
    const tab = TabManager.getActiveTab();
    const el = document.getElementById('ai-current-tab');
    if (el && tab) el.textContent = tab.title || tab.url || 'New Tab';
    // Phase 15: each tab can have its own persona — refresh the switcher
    this.updatePersonaSwitcher?.();
    this._renderPersonaQuickPrompts?.();
  },

  // Parse AI response — strip markdown fences, try JSON, fallback to plain text.
  //
  // Small local models return all sorts of near-JSON. Every shape has to end up
  // as an object, because every caller reads fields off the result:
  //   '"hi"' / '42'        JSON.parse succeeds but yields a scalar — treating
  //                        that as the parsed object left `.reply` undefined and
  //                        rendered an empty assistant bubble.
  //   '{"reply": "half     truncated mid-generation: the closing quote never
  //   a sentence'          arrives, so the strict regex missed it and the raw
  //                        JSON text was shown to the user.
  // Reasoning models (qwen3, deepseek-r1 and others) put their working in a
  // <think> block before the answer. Left in place it breaks JSON.parse, so the
  // parser fell through to a regex that scrapes "reply" out of the raw text —
  // fragile, and it threw the reasoning away. Pull it out first and hand it
  // back, so the panel can show it.
  _extractThinking(input) {
    let str = String(input);
    let thinking = '';
    const keep = (inner) => { thinking += (thinking ? '\n\n' : '') + String(inner).trim(); return ''; };
    str = str.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner) => keep(inner));
    str = str.replace(/<thinking>([\s\S]*?)<\/thinking>/gi, (_m, inner) => keep(inner));
    str = str.replace(/<reasoning>([\s\S]*?)<\/reasoning>/gi, (_m, inner) => keep(inner));
    // An unterminated block means generation stopped mid-thought: everything
    // after the opening tag is reasoning, and no answer arrived.
    const open = str.match(/<(?:think|thinking|reasoning)>([\s\S]*)$/i);
    if (open) {
      keep(open[1]);
      str = str.slice(0, open.index);
    }
    return { text: str.trim(), thinking: thinking.trim() };
  },

  _parseResponse(raw) {
    if (!raw) return { reply: '' };
    let str = String(raw).trim();
    const split = this._extractThinking(str);
    str = split.text;
    const withThinking = (obj) => { if (split.thinking) obj.thinking = split.thinking; return obj; };
    // A model that spent its whole budget thinking leaves no answer behind.
    if (!str) return withThinking({ reply: '', thinkingOnly: true });
    // Strip ```json ... ``` fences
    str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try {
      const parsed = JSON.parse(str);
      // Only a plain object carries the fields the renderers read. A scalar or
      // an array is just the model's answer in JSON clothing.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return withThinking(parsed);
      return withThinking({ reply: typeof parsed === 'string' ? parsed : str });
    } catch {
      // Malformed/truncated JSON — recover the reply field if it started.
      const closed = str.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (closed) return withThinking({ reply: this._unescapeJsonString(closed[1]) });
      const openReply = str.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)$/);
      if (openReply) return withThinking({ reply: this._unescapeJsonString(openReply[1]), truncated: true });
      return withThinking({ reply: str });
    }
  },

  // `s` is the body of a JSON string (escapes still escaped). Re-quoting and
  // parsing turns \n, \", \uXXXX back into real characters; a truncated tail can
  // end on a dangling backslash, hence the manual fallback.
  _unescapeJsonString(s) {
    try { return JSON.parse('"' + String(s) + '"'); }
    catch { return String(s).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\$/, ''); }
  },

  // Resolves to true when the answer (or a rendered error) reached the panel,
  // false when the request never ran — the caller then restores the draft.
  async sendMessage(action, opts = {}) {
    if (this._sending) {
      window.showToast?.('Vex is still answering — one moment', 'info');
      return false;
    }
    this._sending = true;
    this._setComposerBusy(true);

    // Everything runs inside the try so a throw in the pre-work (getConv,
    // renderMessages, addLoading) can't latch _sending=true forever and lock out
    // every future send. finally always clears it.
    let loadingEl = null;
    try {
      const tabId = this._getTabId();
      const wv = WebviewManager.getActiveWebview();
      let pageContext = null;
      if (wv) { try { pageContext = await PageContext.extractPageContext(wv); } catch {} }
      // On a YouTube video: what was said in it, not the page around it.
      pageContext = await VideoChat.contextFor(pageContext);

      const conv = this._getConv(tabId);

      // Add user message for chat. `_noEcho` is set when retrying a failed send:
      // the bubble is already in the transcript and must not be duplicated.
      if (action === 'chat' && opts.message && !opts._noEcho) {
        conv.push({ role: 'user', content: opts.message });
        this._persistConversations();
        this._renderMessages();
      }

      loadingEl = this._addLoading();
      // The bubble an answer is being written into, and which chat it belongs
      // to. _renderMessages empties the list to redraw it, which used to take
      // this element with it: closing and reopening the panel, or switching
      // tab, left the answer streaming into a node that was no longer on
      // screen — it looked exactly as though the answer had stopped. The
      // node is put back now instead of being abandoned (_restoreLive).
      this._live = { tabId: this._viewingId || tabId, el: loadingEl };
      // Phase 14: route through AIRouter for local/cloud selection.
      // Map action → feature name.
      const featureMap = { chat: 'chat', summarize: 'summarize', translate: 'translate', explain: 'explain' };
      const feature = featureMap[action] || 'chat';
      const persona = this.getActivePersona();
      // Persistent AI memory: prepend remembered facts as a system message at the
      // FRONT of the history (kept ≤10 total so the worker's slice(-10) preserves
      // it). Additive — works on both local + cloud without changing the prompt.
      let conversationHistory = conv.filter(m => m.role !== 'system').slice(-this.HISTORY_SENT);
      if (feature === 'chat' && typeof AIMemory !== 'undefined') {
        const memMsg = AIMemory.historyMessage();
        if (memMsg) conversationHistory = [memMsg, ...conversationHistory.slice(-9)];
      }
      // Questions about Vex get Vex's own feature list, not the open page.
      if (feature === 'chat') {
        const vexMsg = this._vexKnowledge(opts.message);
        if (vexMsg) conversationHistory = [vexMsg, ...conversationHistory.slice(-9)];
      }
      // A file dropped on the panel (js/chat-file.js) goes in front of the
      // question, marked as material rather than instructions.
      if (feature === 'chat' && typeof ChatFile !== 'undefined') {
        const fileMsg = ChatFile.historyMessage();
        if (fileMsg) conversationHistory = [fileMsg, ...conversationHistory.slice(-9)];
      }
      // Only chat streams: the other actions render structured output that
      // means nothing until it is complete.
      const onToken = (feature === 'chat') ? this._liveRenderer(loadingEl) : null;
      const aiResult = await AIRouter.callAI(feature, {
        onToken,
        // A local answer about to be slow: say why above the reply, with a
        // smaller model or the cloud to switch to.
        onSlow: (feature === 'chat' && loadingEl) ? (why, advice) => {
          const note = document.createElement('div');
          note.className = 'ai-msg assistant agent-step-warn ai-slow-note';
          note.textContent = why;
          const choices = advice && AIHealth.choices(advice, 'chat');
          if (choices) note.appendChild(choices);
          loadingEl.before(note);
        } : null,
        // Show thinking (the switch in this panel): the thoughts stream into
        // the subtitle line. The router only asks for them when it is on.
        onThinking: onToken ? onToken.onThinking : null,
        image: opts.image || null,
        message: opts.message,
        pageContext,
        selectedText: opts.selectedText,
        targetLanguage: opts.targetLanguage,
        conversationHistory,
        persona: persona ? {
          id: persona.id,
          systemPrompt: persona.systemPrompt,
          temperature: persona.temperature
        } : null
      });

      loadingEl?.remove();

      if (!aiResult || aiResult.result == null || aiResult.result === '') {
        throw new Error('The AI backend returned an empty response. Try again, or pick a different backend in Settings → AI.');
      }

      const parsed = this._parseResponse(aiResult.result);
      // Thoughts that streamed separately are kept with the answer, so the
      // "Thought for N words" fold is there afterwards too.
      if (!parsed.thinking && onToken && onToken.thinking()) parsed.thinking = onToken.thinking();
      // A valid JSON object with no usable text (e.g. {"answer":"…"} from a
      // small local model) must not render as an empty bubble. `reply` doubles
      // as the last-resort text for every renderer below.
      if (!parsed.reply) parsed.reply = String(aiResult.result);

      // Store assistant reply for chat history
      if (action === 'chat') {
        conv.push({ role: 'assistant', content: parsed.reply, action, thinking: parsed.thinking || undefined });
        this._persistConversations();
      }

      this._renderResponse(action, parsed, { backend: aiResult.backend, model: aiResult.model });
      // Answered while you were somewhere else: say so, rather than leaving it
      // sitting in a closed panel. The answer is already saved either way.
      if (!this.isOpen()) {
        window.showToast?.('Vex has answered — Ctrl+Shift+A to read it', 'info', 6000);
        document.getElementById('btn-toggle-ai')?.classList.add('answered');
      }
      return true;
    } catch (err) {
      loadingEl?.remove();
      // The prompt is never lost: it stays in the transcript and Retry re-sends
      // it verbatim once the backend is fixed, without a duplicate bubble.
      this._addError(err.message || 'Network error', () => this.sendMessage(action, { ...opts, _noEcho: true }));
      return false;
    } finally {
      this._live = null;
      this._sending = false;
      this._setComposerBusy(false);
    }
  },

  // Visual "busy" state for the composer. Keeps a second Enter from looking
  // like it did nothing (the send is refused while one is in flight).
  _setComposerBusy(on) {
    const send = document.getElementById('ai-send');
    if (send) send.disabled = !!on;
    document.getElementById('ai-panel')?.classList.toggle('ai-busy', !!on);
    // And outside the panel, because the panel is often shut while Vex is
    // still answering: the toolbar button marks itself, so a closed panel
    // never looks like a stopped answer.
    const btn = document.getElementById('btn-toggle-ai');
    if (btn) {
      btn.classList.toggle('working', !!on);
      if (on) { btn.dataset.idleTitle = btn.dataset.idleTitle || btn.title; btn.title = 'Vex is answering — click to watch'; }
      else if (btn.dataset.idleTitle) { btn.title = btn.dataset.idleTitle; }
    }
  },

  // True only when the message is clearly about the user's own browsing past.
  // Exported (and unit-tested) because getting this wrong leaks history.
  isHistoryIntent(msg) {
    const s = String(msg || '');
    // 1. Explicit: names the history itself.
    if (/\b(my|browser|browsing)\s+history\b/i.test(s)) return true;
    if (/\bin my history\b/i.test(s)) return true;
    // 2. "where did I see/read/find/open/visit …", "what was that site I …".
    if (/\bwhere (did|have) i (see|saw|seen|read|find|found|visit|visited|open|opened|been)\b/i.test(s)) return true;
    // 3. "that article I read", "the page I visited yesterday", "the video I watched".
    if (/\b(that|the)\s+(page|article|video|tab|site|website|thread|post|link|blog|paper|recipe|doc|documentation)\b[\s\S]{0,40}\bi\s+(read|saw|visited|opened|was on|looked at|watched|found)\b/i.test(s)) return true;
    // 4. "find/recall the page I was reading last week" — a lookup verb plus an
    //    explicit past-visit reference, never a lookup verb on its own.
    if (/\b(find|show|reopen|recall|remember|look up)\b/i.test(s)
      && /\bi\s+(read|saw|visited|opened|was (on|reading|watching)|looked at|watched|browsed)\b/i.test(s)) return true;
    return false;
  },

  // Does this message need DOING, or just answering? Send used to be chat
  // only, with a separate robot button for the agent — the user had to know
  // in advance which one a request needed. Now Send decides:
  //   a task (open, click, fill in, start a timer, remind me, bookmark, group
  //   my tabs…), or a question about the live world that a chat model can only
  //   guess at (latest, today, price, weather, news) → the agent;
  //   anything about this page, writing, explaining, code → chat.
  // "/agent …" and "/chat …" force one or the other.
  // → { agent: boolean, text: the message without a prefix }
  routeMessage(raw) {
    const s = String(raw || '').trim();
    const forced = s.match(/^\/(agent|chat)\s+([\s\S]+)$/i);
    if (forced) {
      const agent = forced[1].toLowerCase() === 'agent';
      const text = forced[2].trim();
      // You saying which it is, is the answer. When the rules would have said
      // otherwise, that correction is remembered (js/route-learn.js) so the
      // same kind of sentence goes the right way next time.
      if (typeof RouteLearn !== 'undefined' && this._guessAgent(text) !== agent) RouteLearn.learn(text, agent);
      return { agent, text };
    }
    const guess = this._guessAgent(s);
    const decided = (typeof RouteLearn !== 'undefined') ? RouteLearn.decide(s, guess) : { agent: guess };
    return { agent: decided.agent, text: s, learned: !!decided.changed };
  },

  // The rules alone, with nothing learned applied — so a correction can be
  // compared against what would have happened without it.
  _guessAgent(raw) {
    const s = String(raw || '').trim();
    // "hey vex, can you please open…" is "open…".
    let t = s.toLowerCase(), before;
    do { before = t; t = t.replace(/^(hey|hi|hello|ok|okay|please|pls|vex|can you|could you|would you|will you|i want you to|i need you to|i'd like you to|go ahead and|just)\b[\s,]*/, ''); } while (t !== before);
    // About the page in front, or a writing/explaining job: chat, even with a verb in it.
    const aboutPage = /\b(this|the|current) (page|article|site|video|tab|text|post|thread|document|pdf|code|selection|paragraph)\b|\b(summari[sz]e|tl;?dr|explain|rewrite|rephrase|proofread|translate|paraphrase|what does (this|that|it) mean)\b/.test(t);
    // An order starts with a verb. The list was missing a pile of ordinary
    // ones — delete, clear, copy, move, export, print, zoom, install — so
    // "delete these bookmarks" was answered with an explanation of how to
    // delete bookmarks rather than being done (reported 2026-09-21).
    const task = /^(open|go to|goto|navigate|visit|launch|click|press|tap|type|enter|fill|scroll|log ?in|sign ?in|sign ?up|book|order|buy|purchase|add|download|play|pause|search|google|look up|lookup|find out|find me|research|investigate|check|start|stop|cancel|set|create|make|save|bookmark|remind|close|group|ungroup|rename|organi[sz]e|sort|pin|unpin|mute|unmute|switch|reload|refresh|take|compare prices|subscribe|send|post|reply|schedule|turn (on|off)|enable|disable|delete|remove|clear|empty|wipe|copy|cut|paste|move|duplicate|export|import|print|zoom|install|uninstall|update|upgrade|restart|hide|show|split|sleep|wake|snooze|archive|tidy|clean ?up|upload|record|capture|screenshot|highlight|annotate|jump)\b/.test(t);
    const vexThing = /\b(timer|alarm|stopwatch|reminder|remind me|bookmark|tab group|my tabs|new tab|split view|screenshot|a note|note titled|in my notes)\b/.test(t);
    const liveWorld = /\b(latest|newest|current(ly)?|right now|today|tonight|tomorrow|this (week|month|year)|recent(ly)?|news|price of|how much (is|does|are)|stock price|weather|forecast|score|who won|release date|is .{2,40} (down|open|out yet)|search the web|on the web|online)\b/.test(t);
    if (task && !(aboutPage && /^(search|find|check|compare|save|take|translate)\b/.test(t) && !vexThing && !liveWorld)) return true;
    if (vexThing && /\b(start|set|create|make|add|save|cancel|stop|open|show|group|rename|close|take)\b/.test(t)) return true;
    if (liveWorld && !aboutPage) return true;
    return false;
  },

  // Right-click any image → "Ask Vex about this image". The model can see now
  // (v2.31.86), so this is a question about the picture, not about its address.
  async askAboutImage(srcUrl, question) {
    if (!this.isOpen()) this.open();
    let image;
    try { image = await this._imageAsData(srcUrl); }
    catch (err) {
      this._addError('That image could not be read: ' + ((err && err.message) || ''));
      VexProblems?.note('AI', 'Could not read an image for the AI', err);
      return false;
    }
    const ask = question || 'What is in this image?';
    await this.sendMessage('chat', { message: ask, image });
    return true;
  },

  // Fetched through main, because the page's own image is on its origin and
  // the interface is a file:// document — and shrunk, because a model does not
  // need four megapixels to answer.
  async _imageAsData(srcUrl) {
    if (/^data:image\//.test(srcUrl)) return this._shrinkImage(srcUrl);
    if (!window.vex || typeof window.vex.apiRequest !== 'function') throw new Error('Vex cannot fetch images in this build');
    // A User-Agent is not optional: Wikimedia and others answer a request
    // without one with 400 and an HTML error page — which then read as "that
    // address is not an image" instead of what actually happened.
    const r = await window.vex.apiRequest({ url: srcUrl, binary: true, headers: { 'User-Agent': navigator.userAgent, Accept: 'image/*,*/*;q=0.8' } });
    if (!r || !r.ok) throw new Error((r && r.error) || 'the request failed');
    // `ok` means the request completed, not that the server was happy.
    if (r.status >= 400) throw new Error('the site answered ' + r.status + ' (' + (r.statusText || 'error') + ')');
    const type = String((r.headers && (r.headers['content-type'] || r.headers['Content-Type'])) || 'image/png').split(';')[0];
    if (!/^image\//.test(type)) throw new Error('that address gave back ' + type + ', not an image');
    const base64 = r.base64 || r.body;
    if (!base64) throw new Error('nothing came back');
    return this._shrinkImage('data:' + type + ';base64,' + base64);
  },

  _shrinkImage(dataUrl, max = 1024) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.width * scale));
          c.height = Math.max(1, Math.round(im.height * scale));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.75));
        } catch (err) { reject(err); }
      };
      im.onerror = () => reject(new Error('the image could not be decoded'));
      im.src = dataUrl;
    });
  },

  async _sendChat() {
    const input = document.getElementById('ai-input');
    const typed = input?.value.trim();
    // A picture pasted or dropped into the box goes with this question (or on
    // its own: "what is in this image?").
    if (this._pendingImage) {
      if (this._sending) { window.showToast?.('Vex is still answering — one moment', 'info'); return; }
      const image = this._pendingImage;
      this._clearAttachment();
      input.value = '';
      if (!this.isOpen()) this.open();
      await this.sendMessage('chat', { message: typed || 'What is in this image?', image });
      return;
    }
    if (!typed) return;
    // "How do I …?" about Vex itself is answered from Vex's own feature list,
    // with the thing one press away — and without loading a model.
    if (typeof VexGuide !== 'undefined' && VexGuide.isAbout(typed)) {
      const guided = VexGuide.answer(typed);
      if (guided.found) {
        input.value = '';
        if (!this.isOpen()) this.open();
        this._renderGuide(typed, guided);
        return;
      }
    }
    // Send decides whether this is a task for the agent (see routeMessage).
    // The text stays in the box until the run really starts.
    const route = this.routeMessage(typed);
    const msg = route.text;
    if (route.agent && typeof AgentLoop !== 'undefined' && typeof AgentLoop.start === 'function' && !this._sending) { input.value = msg; this._sendAgent(); return; }
    // A send that never starts (one already in flight) must hand the text back
    // rather than swallow it — the old code cleared the box and dropped it.
    if (this._sending) {
      window.showToast?.('Vex is still answering — one moment', 'info');
      return;
    }
    input.value = '';
    if (!this.isOpen()) this.open();

    // Phase 12: Detect "find in history" intent before anything else.
    //
    // This must be a HIGH bar: a match sends up to 200 history entries (titles,
    // URLs, summaries) to the AI backend. The old pattern matched a bare "find",
    // "remember" or "recall" anywhere in the message, so an ordinary question —
    // "how do I find the average of a list?" — quietly shipped the user's
    // browsing history to the cloud worker and answered with a history search.
    // Now the message has to actually be about something the user visited.
    if (AIPanel.isHistoryIntent(msg)) {
      await this._handleHistorySearch(msg);
      return;
    }

    // Auto-detect multi-tab intent
    const multiTrigger = /\b(all my tabs|these tabs|across (my |the )?tabs|compare (these|my|all) tabs|every tab|every open tab)\b/i;
    if (multiTrigger.test(msg) && typeof TabSelector !== 'undefined' && TabSelector.getCurrentMode() === 'current') {
      TabSelector.setMode('all');
    }

    // Route: multi-tab if >1 tab selected
    const selectedTabs = typeof TabSelector !== 'undefined' ? TabSelector.getSelectedTabs() : [];
    if (selectedTabs.length > 1) {
      await this._sendMultiTab(msg, selectedTabs);
    } else {
      await this.sendMessage('chat', { message: msg });
    }
  },

  async _sendMultiTab(message, tabs, opts = {}) {
    // Shares the in-flight latch with sendMessage: two concurrent AI requests
    // rendered their loading rows and replies into each other.
    if (this._sending) { window.showToast?.('Vex is still answering — one moment', 'info'); return false; }
    this._sending = true;
    this._setComposerBusy(true);

    const conv = this._getConv();
    if (!opts._noEcho) {
      conv.push({ role: 'user', content: message });
      this._persistConversations();
      this._renderMessages();
    }

    const loadingEl = this._addLoading();
    try {
      loadingEl.innerHTML = 'Reading ' + tabs.length + ' tabs <span class="ai-spinner"></span>';
      const tabContexts = await MultiTabContext.extractContextFromTabs(tabs);
      loadingEl.innerHTML = 'Thinking <span class="ai-spinner"></span>';

      // Phase 14/15: multi-tab is cloud-quality; still respects persona voice.
      const persona = this.getActivePersona();
      const aiResult = await AIRouter.callAI('multiTab', {
        message, tabContexts,
        conversationHistory: conv.filter(m => m.role !== 'system').slice(-6),
        persona: persona ? { id: persona.id, systemPrompt: persona.systemPrompt, temperature: persona.temperature } : null
      });
      loadingEl?.remove();

      if (!aiResult || aiResult.result == null || aiResult.result === '') {
        throw new Error('The AI backend returned an empty response. Try again, or pick a different backend in Settings → AI.');
      }
      const parsed = this._parseResponse(aiResult.result);
      conv.push({ role: 'assistant', content: parsed.reply || String(aiResult.result) });
      this._persistConversations();
      this._renderMultiTabResponse(parsed, tabs, { backend: aiResult.backend, model: aiResult.model });
      return true;
    } catch (err) {
      loadingEl?.remove();
      this._addError(err.message || 'Network error', () => this._sendMultiTab(message, tabs, { _noEcho: true }));
      return false;
    } finally {
      this._sending = false;
      this._setComposerBusy(false);
    }
  },

  _renderMultiTabResponse(parsed, tabs, backendInfo) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'ai-msg assistant';

    let html = '<div class="mt-badge">Analyzed ' + tabs.length + ' tabs</div>';

    if (parsed.reply) {
      html += '<div class="mt-reply">' + this._md(parsed.reply) + '</div>';
    }

    if (parsed.perTab?.length) {
      html += '<details class="mt-per-tab"><summary>Per-tab summaries</summary>';
      parsed.perTab.forEach(t => {
        const tab = tabs[(t.tabIndex || 1) - 1];
        html += '<div class="mt-tab-sum"><strong>' + this._esc(t.title || tab?.title || '') + '</strong>'
          + '<div class="mt-tab-sum-body">' + this._md(t.summary || '') + '</div></div>';
      });
      html += '</details>';
    }

    if (parsed.comparisons?.length) {
      html += '<table class="mt-table"><thead><tr><th></th>';
      tabs.forEach((_, i) => { html += '<th>Tab ' + (i + 1) + '</th>'; });
      html += '</tr></thead><tbody>';
      parsed.comparisons.forEach(c => {
        html += '<tr><td><strong>' + this._esc(c.dimension) + '</strong></td>';
        tabs.forEach((_, i) => {
          const v = c.values?.find(x => x.tab === i + 1)?.value || '\u2014';
          html += '<td>' + this._esc(String(v)) + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    if (parsed.recommendation) {
      html += '<div class="mt-rec">' + this._esc(parsed.recommendation) + '</div>';
    }

    if (parsed.suggestedFollowUps?.length) {
      html += '<div class="follow-ups">';
      parsed.suggestedFollowUps.forEach(q => { html += '<button class="follow-up-btn">' + this._esc(q) + '</button>'; });
      html += '</div>';
    }

    const contentEl = document.createElement('div');
    contentEl.className = 'ai-msg-content';
    contentEl.innerHTML = html;
    el.appendChild(contentEl);
    el.appendChild(this._makeCopyBtn(contentEl));

    el.querySelectorAll('.follow-up-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('ai-input').value = btn.textContent;
        this._sendChat();
      });
    });

    this._appendBackendTag(el, backendInfo);
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  // The title and the first line of a cited page, in a card under the link.
  // Fetched once per address and kept for the session.
  _SOURCE_CACHE: new Map(),
  async _previewSource(a) {
    const url = a.href;
    if (!/^https?:/i.test(url) || a.dataset.previewing) return;
    a.dataset.previewing = '1';
    const show = (text) => {
      if (!a.isConnected || !a.matches(':hover')) return;
      document.querySelectorAll('.ai-source-card').forEach(c => c.remove());
      const card = document.createElement('div');
      card.className = 'ai-source-card';
      card.textContent = text;
      const r = a.getBoundingClientRect();
      card.style.left = Math.max(8, Math.min(window.innerWidth - 320, r.left)) + 'px';
      card.style.top = (r.bottom + 6) + 'px';
      document.body.appendChild(card);
      const away = () => { card.remove(); a.removeEventListener('mouseleave', away); };
      a.addEventListener('mouseleave', away);
    };
    if (this._SOURCE_CACHE.has(url)) { show(this._SOURCE_CACHE.get(url)); return; }
    try {
      const page = await AgentTools.readUrl(url);
      const text = (page.title || new URL(url).hostname) + ' — ' + String(page.text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      this._SOURCE_CACHE.set(url, text);
      show(text);
    } catch (err) {
      const text = 'Could not read it: ' + ((err && err.message) || 'unavailable');
      this._SOURCE_CACHE.set(url, text);
      show(text);
    } finally { delete a.dataset.previewing; }
  },

  // The guide's answer as a card: what it is, the steps, and buttons that do
  // it rather than describe it. "Ask the AI anyway" is always there, because
  // the match is words, not understanding, and it can be wrong.
  _renderGuide(question, a) {
    const container = document.getElementById('ai-messages');
    if (!container) return null;
    const you = document.createElement('div');
    you.className = 'ai-msg user';
    you.innerHTML = '<div class="ai-msg-content"></div>';
    you.querySelector('.ai-msg-content').textContent = question;
    container.appendChild(you);

    const el = document.createElement('div');
    el.className = 'ai-msg assistant vex-guide-card';
    const head = document.createElement('div');
    head.className = 'ai-msg-content';
    head.textContent = a.headline;
    const list = document.createElement('ol');
    list.className = 'vex-guide-steps';
    for (const s of a.steps) { const li = document.createElement('li'); li.textContent = s; list.append(li); }
    const bar = document.createElement('div');
    bar.className = 'agent-final-actions';
    const button = (label, title, run) => {
      const b = document.createElement('button');
      b.className = 'agent-final-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', async () => {
        try { await run(); } catch (err) { window.showToast?.((err && err.message) || 'That did not work', 'error'); }
      });
      bar.appendChild(b);
      return b;
    };
    if (VexFeatures.command(a.entry) || a.entry.panel) button('Do it', 'Run it now', () => VexGuide.run(a.entry));
    if (a.entry.sel || a.entry.setting) button('Show me', 'Point at it on screen', () => VexGuide.show(a.entry));
    if (a.entry.steps) button('Step me through it', 'One step at a time', () => VexGuide.walk(a.entry));
    // Three lines is the answer; the Library entry is the whole thing — where
    // it lives, every step, and what sits next to it (js/feature-library.js).
    if (typeof FeatureLibrary !== 'undefined' && a.entry.id) button('Read the whole entry', 'Open it in the Library', () => FeatureLibrary.openAt(a.entry.id));
    button('Ask the AI anyway', 'Send the question to the model instead', () => this.sendMessage('chat', { message: question }));
    el.append(head, list, bar);
    if (a.others.length) {
      const also = document.createElement('div');
      also.className = 'vex-guide-also';
      also.textContent = 'Also in Vex: ' + a.others.join(', ');
      el.appendChild(also);
    }
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  },

  _clearChat() {
    const tabId = this._getTabId();
    if (tabId) this._conversations[tabId] = [];
    this._persistConversations();
    this._renderMessages();
  },

  _renderMessages() {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    // The agent's steps are drawn live and live nowhere else until it ends:
    // closing and reopening the panel mid-run must not wipe them.
    if (typeof AgentLoop !== 'undefined' && AgentLoop.isRunning?.() && this._agentTabId != null
      && String(this._viewingId || this._getTabId()) === String(this._agentTabId) && container.querySelector('[class*="agent-step"]')) return;
    const conv = this._getConv();

    if (conv.length === 0) {
      container.innerHTML = '<div class="ai-empty">Ask anything about the current page, or pick a starter below.</div>';
      this._syncStarters();
      return;
    }

    container.innerHTML = '';
    // Only the last HISTORY_SENT messages go to the model; a line says where
    // its memory of this chat begins, so an answer that "forgot" what you said
    // earlier has a visible reason.
    const forgotten = Math.max(0, conv.filter(m => m.role !== 'system').length - this.HISTORY_SENT);
    conv.forEach((m, i) => {
      if (forgotten && i === forgotten) {
        const mark = document.createElement('div');
        mark.className = 'ai-context-mark';
        mark.textContent = 'The model only sees the messages below this line';
        mark.title = 'Vex sends the last ' + this.HISTORY_SENT + ' messages of a chat, so older ones cannot be referred to.';
        container.appendChild(mark);
      }
      const el = document.createElement('div');
      el.className = `ai-msg ${m.role}`;
      // Reasoning is kept with the turn, so reopening a chat still shows it.
      if (m.role === 'assistant' && m.thinking) {
        const think = this._thinkingBlock(m.thinking);
        if (think) el.appendChild(think);
      }
      const contentEl = document.createElement('div');
      contentEl.className = 'ai-msg-content';
      contentEl.innerHTML = m.role === 'assistant'
        ? this._md(m.content)
        : this._esc(m.content).replace(/\n/g, '<br>');
      el.appendChild(contentEl);
      // Copy on every message; retry on an answer, edit-and-resend on a question.
      el.appendChild(this._msgActions(m, i, contentEl));
      // Under the latest answer: where to go next.
      if (m.role === 'assistant' && i === conv.length - 1) {
        const chips = this._nextChips(m);
        if (chips) el.appendChild(chips);
      }
      if (m.agentRun && typeof AgentLoop !== 'undefined' && AgentLoop.runs().some(r => r.id === m.agentRun)) {
        const steps = document.createElement('button');
        steps.className = 'ai-agent-steps-link';
        steps.textContent = 'Show what the agent did';
        steps.addEventListener('click', () => { try { AgentLoop.showRun(m.agentRun); } catch (err) { window.showToast?.((err && err.message) || 'Could not open that run', 'error'); } });
        el.appendChild(steps);
      }
      container.appendChild(el);
    });
    this._restoreLive(container);
    container.scrollTop = container.scrollHeight;
    this._syncStarters();
  },

  // An answer still being written belongs to a chat, not to a screen. When the
  // list is redrawn — reopening the panel, switching tab, loading a past chat
  // — the bubble goes back in if this is the chat it belongs to: the same
  // element, so every token still arriving lands in it. If it belongs to
  // another chat it is not shown here, and it is still running — the answer
  // is saved to that chat when it finishes.
  _restoreLive(container) {
    const live = this._live;
    if (!live || !live.el) return false;
    if (String(live.tabId) !== String(this._viewingId || this._getTabId())) return false;
    container.appendChild(live.el);
    return true;
  },

  // === Live answers ========================================================
  //
  // The local backend streams NDJSON, so the answer can be shown as it is
  // written instead of appearing all at once after a long wait. This turns the
  // "Thinking" bubble into the answer in place.
  //
  // Two things make it more than a cosmetic change:
  //   - a reasoning model's <think> block arrives FIRST, so the thinking panel
  //     fills in live and the user can see it is working, not stuck;
  //   - the model usually answers in JSON ({"reply": "..."}), which is
  //     unreadable mid-stream, so partial text is un-wrapped before display.

  // Pull something human-readable out of a half-finished response.
  _streamPreview(raw) {
    const split = this._extractThinking(String(raw || ''));
    let body = split.text.replace(/^```(?:json)?\s*/i, '');
    // '{"reply": "half a sent' -> 'half a sent'
    const inReply = body.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (inReply) body = this._unescapeJsonString(inReply[1]);
    else if (/^\s*\{/.test(body)) body = '';   // JSON started but no reply yet
    return { thinking: split.thinking, body: body.trim() };
  },

  // Markdown of an answer that is still being written. The worry that kept
  // this as plain text was a half-written code fence swallowing the rest —
  // so the fence is closed for the render and opened again by the next token.
  // Everything else (a half-typed **bold**, a link with no closing bracket)
  // renders as the literal characters for a moment and fixes itself as the
  // rest arrives, which is what every other chat does.
  _streamMarkdown(text) {
    const body = String(text == null ? '' : text);
    const fences = (body.match(/^\s*```/gm) || []).length;
    return this._md(fences % 2 ? body + '\n```' : body);
  },

  // Turn the loading bubble into a live one and return the token handler.
  _liveRenderer(loadingEl) {
    if (!loadingEl) return null;
    const container = document.getElementById('ai-messages');
    let started = false;
    let thinkEl = null;
    let bodyEl = null;
    // A timer, not requestAnimationFrame: rAF is throttled when the window is
    // not actively rendering, so the live view silently never updated — the
    // answer arrived all at once at the end, which is the thing this exists to
    // avoid. ~50ms is below the eye's threshold for "appearing as typed".
    let timer = 0;
    let pending = null;
    // Thoughts that arrive in their own stream (Ollama's `thinking` field,
    // with Show thinking on), as opposed to <think> tags inside the answer.
    let streamedThinking = '';

    const paint = () => {
      timer = 0;
      const { body } = pending || {};
      const thinking = streamedThinking || (pending && pending.thinking) || '';
      if (thinking) {
        if (!thinkEl) {
          thinkEl = this._thinkingBlock(thinking);
          if (thinkEl) {
            // One line that keeps changing, like a subtitle; the whole of it
            // is one click away. (Open only if the user left it open before.)
            // Inside the <summary>: a closed <details> hides everything else,
            // and closed is exactly when the subtitle is the point.
            const live = document.createElement('span');
            live.className = 'ai-thinking-live';
            live.setAttribute('aria-live', 'polite');
            thinkEl.querySelector('summary')?.appendChild(live);
            if (!started) {
              // The block says "Thinking…" itself; the placeholder beside it
              // was squeezed into a column of letters in a live run.
              loadingEl.textContent = '';
              loadingEl.classList.add('is-thinking');
            }
            loadingEl.insertBefore(thinkEl, loadingEl.firstChild);
          }
        }
        if (thinkEl) {
          const b = thinkEl.querySelector('.ai-thinking-body');
          if (b) b.textContent = thinking;
          const label = thinkEl.querySelector('.ai-thinking-label');
          const words = thinking.trim().split(/\s+/).filter(Boolean).length;
          if (label) label.textContent = body ? `Thought for ${words} word${words === 1 ? '' : 's'}` : `Thinking… ${words} word${words === 1 ? '' : 's'}`;
          const live = thinkEl.querySelector('.ai-thinking-live');
          // Once the answer is being written, the thinking is over.
          if (live) { live.textContent = body ? '' : this._thoughtSubtitle(thinking); live.hidden = !!body; }
        }
      }
      if (body) {
        if (!bodyEl) {
          bodyEl = document.createElement('div');
          bodyEl.className = 'ai-msg-content';
          loadingEl.appendChild(bodyEl);
        }
        // Formatted AS IT IS WRITTEN. It used to be plain text until the
        // answer finished, and then re-rendered — so while you were reading
        // it there were no headings, no bold, no lists, and no way to see
        // what the important parts were until it was over.
        bodyEl.innerHTML = this._streamMarkdown(body);
      }
      const nearBottom = container && (container.scrollHeight - container.scrollTop - container.clientHeight < 120);
      if (container && nearBottom) container.scrollTop = container.scrollHeight;
    };

    const onToken = (_piece, full) => {
      if (!started) {
        started = true;
        // Drop the "Thinking <spinner>" placeholder text, keep the bubble —
        // and the thoughts already shown in it, which arrived first.
        loadingEl.textContent = '';
        if (thinkEl) loadingEl.appendChild(thinkEl);
        loadingEl.classList.remove('loading');
        loadingEl.classList.add('streaming');
      }
      pending = this._streamPreview(full);
      // 50 ms reads as "typing"; past a few thousand characters the render
      // costs more than the eye gains, so it eases off rather than stuttering.
      const every = String(full || '').length > 6000 ? 120 : 50;
      if (!timer) timer = setTimeout(paint, every);
    };
    onToken.onThinking = (_piece, full) => {
      streamedThinking = String(full || '');
      if (!timer) timer = setTimeout(paint, 50);
    };
    onToken.thinking = () => streamedThinking;
    return onToken;
  },

  // The latest thing the model is thinking, as one short line: the last line
  // it wrote, without the markdown it writes its notes in.
  _thoughtSubtitle(thinking) {
    const lines = String(thinking || '').split(/\n+/).map(l => l
      .replace(/[*_`#>]+/g, '')
      .replace(/^\s*(?:[-•]|\d+\.)\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()).filter(Boolean);
    const last = lines.length ? lines[lines.length - 1] : '';
    return last.length > 140 ? '…' + last.slice(-139) : last;
  },

  // When the answer names a Vex feature, offer the way in.
  //
  // The model is given the catalogue, so it describes real features by their
  // real names — and the catalogue also knows how to open each one. Reading
  // "Vex has Recall" and then having to go find Recall is a pointless step.
  //
  // Only exact feature names are matched, longest first, so "Tabs" inside "Tab
  // stacks" does not produce a second, wrong chip.
  MAX_FEATURE_CHIPS: 4,

  _featureChips(answerText) {
    const F = (typeof VexFeatures !== 'undefined' && VexFeatures) || window.VexFeatures;
    if (!F || !Array.isArray(F.ITEMS) || !answerText) return null;
    const hay = String(answerText).toLowerCase();

    const hits = [];
    const taken = [];
    // Only features that can actually be opened are candidates. A manual-only
    // entry ("you do this with the mouse") can never become a chip, and
    // counting it toward the cap below used to crowd out the ones that can —
    // an answer naming several features then offered none at all.
    const openable = F.ITEMS.filter(f => {
      const cmd = (typeof F.command === 'function') ? F.command(f) : null;
      return !!cmd || !!f.setting || !!f.panel;
    });
    const byLength = openable.sort((a, b) => (b.name || '').length - (a.name || '').length);
    for (const f of byLength) {
      const name = String(f.name || '');
      if (name.length < 4) continue;
      const at = hay.indexOf(name.toLowerCase());
      if (at === -1) continue;
      // Skip a name sitting inside one already matched.
      if (taken.some(([s, e]) => at >= s && at < e)) continue;
      taken.push([at, at + name.length]);
      hits.push({ f, at });
      if (hits.length >= this.MAX_FEATURE_CHIPS * 2) break;
    }
    if (!hits.length) return null;

    // In the order they appear in the answer.
    hits.sort((a, b) => a.at - b.at);

    const row = document.createElement('div');
    row.className = 'ai-feature-chips';
    let added = 0;
    for (const { f } of hits) {
      if (added >= this.MAX_FEATURE_CHIPS) break;
      const cmd = (typeof F.command === 'function') ? F.command(f) : null;
      const b = document.createElement('button');
      b.className = 'ai-feature-chip';
      b.type = 'button';
      const icon = (typeof F.iconOf === 'function' && window.VexIcons) ? F.iconOf(f) : null;
      b.innerHTML = (icon && VexIcons.has(icon)) ? VexIcons.svg(icon, { size: 12 }) : '';
      b.appendChild(document.createTextNode('Open ' + f.name));
      b.title = f.what || ('Open ' + f.name);
      b.addEventListener('click', () => {
        try {
          if (window.VexDiscover && typeof VexDiscover.openFeature === 'function') {
            VexDiscover.openFeature(f.id);
          } else if (cmd) { cmd.action(); }
          else { window.showToast?.('Could not open ' + f.name, 'error'); }
        } catch (err) {
          window.showToast?.('Could not open ' + f.name + ': ' + ((err && err.message) || 'unknown error'), 'error');
        }
      });
      row.appendChild(b);
      added++;
    }
    return added ? row : null;
  },

  // What Vex itself can do.
  //
  // Asked "what features does Vex have?", the model only ever had the text
  // scraped off whatever page was open — so on a new tab it answered by reading
  // the new tab, and listed the shortcut bar as though that were the browser.
  // Vex ships a catalogue of its own 137 features; this hands the relevant part
  // of it over as grounding, so the answer describes the browser instead of the
  // wallpaper.
  VEX_KNOWLEDGE_LIMIT: 5000,

  _asksAboutVex(question) {
    const q = String(question || '');
    if (!q) return false;
    return /\bvex\b/i.test(q) || /\b(this|the|your) browser\b/i.test(q);
  },

  _vexKnowledge(question) {
    const F = (typeof VexFeatures !== 'undefined' && VexFeatures) || window.VexFeatures;
    if (!F || !Array.isArray(F.ITEMS) || !F.ITEMS.length) return null;
    if (!this._asksAboutVex(question)) return null;

    const lines = ['Vex is the browser this conversation is happening inside. Its actual feature set:'];

    // Anything matching the question gets its full description — that is the
    // part the user is asking about.
    let matched = [];
    try { matched = (typeof F.search === 'function' ? F.search(question) : []) || []; } catch { matched = []; }
    if (matched.length) {
      lines.push('', 'Most relevant:');
      for (const f of matched.slice(0, 8)) lines.push(`- ${f.name}: ${f.what}`);
    }

    // Plus the shape of the whole thing, by category, so the model can answer
    // "what else" without being handed all 137 descriptions.
    lines.push('', 'Everything else, by area:');
    const cats = Array.isArray(F.CATS) ? F.CATS : [];
    const seen = new Set(matched.map(f => f.id));
    for (const c of cats) {
      const names = F.ITEMS.filter(f => f.cat === c.id && !seen.has(f.id)).map(f => f.name);
      if (!names.length) continue;
      lines.push(`- ${c.name} — ${names.join(', ')}`);
    }

    lines.push('', 'Describe only what is listed here. If something is not in this list, say you are not sure rather than guessing from the page.');
    const text = lines.join('\n');
    return { role: 'system', content: text.slice(0, this.VEX_KNOWLEDGE_LIMIT) };
  },

  // The model's working, folded away. Collapsed by default: it is context for
  // when an answer looks wrong, not the answer itself.
  _thinkingBlock(text) {
    if (!text) return null;
    const wrap = document.createElement('details');
    wrap.className = 'ai-thinking';

    const sum = document.createElement('summary');
    sum.className = 'ai-thinking-summary';
    const icon = (window.VexIcons && VexIcons.has('brain')) ? VexIcons.svg('brain', { size: 13 }) : '';
    sum.innerHTML = `<span class="ai-thinking-ico">${icon}</span><span class="ai-thinking-label"></span><span class="ai-thinking-chev">${(window.VexIcons && VexIcons.has('arrow-right')) ? VexIcons.svg('arrow-right', { size: 12 }) : ''}</span>`;
    const words = String(text).trim().split(/\s+/).filter(Boolean).length;
    sum.querySelector('.ai-thinking-label').textContent = `Thought for ${words} word${words === 1 ? '' : 's'}`;
    wrap.appendChild(sum);

    const body = document.createElement('div');
    body.className = 'ai-thinking-body';
    // Reasoning is model output, so it is inserted as TEXT. Rendering it as
    // markdown would let a page that steered the model inject markup here.
    body.textContent = String(text);
    wrap.appendChild(body);

    // Remember whether the user likes it open.
    try { wrap.open = localStorage.getItem('vex.aiThinkingOpen') === '1'; } catch {}
    wrap.addEventListener('toggle', () => {
      try { localStorage.setItem('vex.aiThinkingOpen', wrap.open ? '1' : '0'); } catch {}
    });
    return wrap;
  },

  _renderResponse(action, parsed, backendInfo) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    this._clearEmptyState();

    const el = document.createElement('div');
    el.className = 'ai-msg assistant';

    const think = this._thinkingBlock(parsed.thinking);
    if (think) el.appendChild(think);

    const contentEl = document.createElement('div');
    contentEl.className = 'ai-msg-content';
    let html = '';

    if (action === 'chat') {
      html = this._md(parsed.reply || '');
      if (parsed.citations?.length) {
        parsed.citations.forEach(c => { html += `<div class="citation">"${this._esc(c.text)}"</div>`; });
      }
    } else if (action === 'summarize') {
      // A model that answers in prose instead of the JSON schema used to render
      // as a bare "Summary" heading with nothing under it. `reply` holds the raw
      // answer in that case (see sendMessage).
      html = `<strong>${this._esc(parsed.title || 'Summary')}</strong><br><br>${this._md(parsed.summary || parsed.reply || '')}`;
      if (parsed.keyPoints?.length) {
        html += '<br><br><strong>Key Points:</strong><ul>' + parsed.keyPoints.map(p => `<li>${this._esc(p)}</li>`).join('') + '</ul>';
      }
      if (parsed.readingTime) html += `<div class="ai-meta">${this._esc(parsed.readingTime)}</div>`;
    } else if (action === 'translate') {
      const lang = parsed.targetLanguage ? ` (${this._esc(parsed.targetLanguage)})` : '';
      html = `<strong>Translation${lang}</strong><br><br>${this._esc(parsed.translation || parsed.reply || '').replace(/\n/g, '<br>')}`;
      if (parsed.notes) html += `<div class="ai-meta">Note: ${this._esc(parsed.notes)}</div>`;
    } else if (action === 'explain') {
      html = `<strong>Explanation</strong><br><br>${this._md(parsed.explanation || parsed.reply || '')}`;
      if (parsed.keyTerms?.length) {
        html += '<br><br><strong>Key Terms:</strong><ul>';
        parsed.keyTerms.forEach(t => { html += `<li><strong>${this._esc(t.term)}:</strong> ${this._esc(t.definition)}</li>`; });
        html += '</ul>';
      }
    }

    contentEl.innerHTML = html;
    el.appendChild(contentEl);
    el.appendChild(this._makeCopyBtn(contentEl));

    const chips = this._featureChips(parsed.reply || parsed.summary || parsed.explanation || '');
    if (chips) el.appendChild(chips);

    // Follow-up buttons (outside content, not copyable)
    if (parsed.suggestedFollowUps?.length) {
      const fups = document.createElement('div');
      fups.className = 'follow-ups';
      parsed.suggestedFollowUps.forEach(q => {
        const btn = document.createElement('button');
        btn.className = 'follow-up-btn';
        btn.textContent = q;
        btn.addEventListener('click', () => {
          document.getElementById('ai-input').value = q;
          this._sendChat();
        });
        fups.appendChild(btn);
      });
      el.appendChild(fups);
    }

    this._appendBackendTag(el, backendInfo);
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  _appendBackendTag(msgEl, info) {
    if (!info || !info.backend) return;
    const tag = document.createElement('div');
    tag.className = `backend-tag ${info.backend}`;
    // An on-device (WebGPU) answer used to be labelled "cloud" because only
    // 'local' was special-cased \u2014 the badge claimed the opposite of the truth.
    const label = info.backend === 'local' ? 'local'
      : info.backend === 'ondevice' ? 'on-device'
        : info.backend === 'cloud' ? 'cloud' : String(info.backend);
    tag.textContent = info.model ? `${label} \u00b7 ${info.model}` : label;
    msgEl.appendChild(tag);
  },

  _icon(name, size) {
    return window.VexIcons ? VexIcons.svg(name, { size: size || 13 }) : '';
  },

  _makeCopyBtn(contentEl) {
    const btn = document.createElement('button');
    btn.className = 'ai-copy-btn';
    btn.type = 'button';
    btn.title = 'Copy';
    btn.setAttribute('aria-label', 'Copy this reply');
    btn.innerHTML = this._icon('copy');
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(contentEl.innerText);
        btn.innerHTML = this._icon('check');
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = this._icon('copy'); btn.classList.remove('copied'); }, 1500);
      } catch (err) {
        window.showToast?.('Could not copy: ' + (err?.message || 'clipboard unavailable'), 'error');
      }
    });
    return btn;
  },

  // Phase 12: History search triggered from the AI panel
  async _handleHistorySearch(query, opts = {}) {
    if (this._sending) { window.showToast?.('Vex is still answering — one moment', 'info'); return false; }
    const all = (window.HistoryPanel && Array.isArray(HistoryPanel.entries)) ? HistoryPanel.entries : [];

    if (!opts._noEcho) {
      const conv = this._getConv();
      conv.push({ role: 'user', content: query });
      this._persistConversations();
      this._renderMessages();
    }

    // Nothing to search — never spend a request (and never send an empty
    // history payload) just to be told there are no matches.
    if (!all.length) {
      this._addError('There is nothing in your history to search yet.');
      return false;
    }

    this._sending = true;
    this._setComposerBusy(true);
    const loadingEl = this._addLoading();
    if (loadingEl) loadingEl.innerHTML = 'Searching your history <span class="ai-spinner"></span>';

    try {
      const compact = all.slice(0, 200).map(e => ({
        id: e.id, url: e.url, title: e.title,
        summary: e.summary || '', tags: e.tags || [],
        contentType: e.contentType || '', visitedAt: e.visitedAt
      }));

      const aiResult = await AIRouter.callAI('historySearch', {
        query, historyEntries: compact, timeContext: new Date().toISOString()
      });
      loadingEl?.remove();

      if (!aiResult || !aiResult.result) {
        this._addError('The AI backend returned an empty response.', () => this._handleHistorySearch(query, { _noEcho: true }));
        return false;
      }

      const parsed = this._parseResponse(aiResult.result);
      if (!parsed || !Array.isArray(parsed.matches)) {
        this._addError('The AI did not return usable search results.', () => this._handleHistorySearch(query, { _noEcho: true }));
        return false;
      }

      this._renderHistorySearchResult(parsed, all);
      return true;
    } catch (err) {
      loadingEl?.remove();
      this._addError(err.message || 'Network error', () => this._handleHistorySearch(query, { _noEcho: true }));
      return false;
    } finally {
      this._sending = false;
      this._setComposerBusy(false);
    }
  },

  _renderHistorySearchResult(parsed, allEntries) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const msgEl = document.createElement('div');
    msgEl.className = 'ai-msg assistant history-search-response';

    let html = `<div class="history-search-header">${this._icon('history', 14)} History Search</div>`;
    if (parsed?.interpretation) {
      html += `<div class="mt-reply">${this._esc(parsed.interpretation)}</div>`;
    }
    if (!parsed?.matches || parsed.matches.length === 0) {
      html += `<div class="no-matches">No matching pages found in your history.</div>`;
    } else {
      html += '<div class="chat-history-results">';
      for (const match of parsed.matches.slice(0, 5)) {
        const entry = allEntries.find(e => e.id === match.id);
        if (!entry) continue;
        let host = ''; try { host = new URL(entry.url).hostname; } catch {}
        const summary = entry.summary ? (entry.summary.length > 120 ? entry.summary.substring(0, 120) + '…' : entry.summary) : '';
        html += `
          <div class="chat-history-item" data-url="${this._esc(entry.url)}">
            <img src="${host ? `https://${encodeURIComponent(host)}/favicon.ico` : ''}" width="14" height="14" data-image-fallback="hide">
            <div class="chat-history-content">
              <div class="chat-history-title">${this._esc(entry.title || 'Untitled')}</div>
              ${summary ? `<div class="chat-history-summary">${this._esc(summary)}</div>` : ''}
            </div>
          </div>
        `;
      }
      html += '</div>';
    }

    msgEl.innerHTML = html;
    msgEl.querySelectorAll('.chat-history-item').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.dataset.url;
        if (url && typeof TabManager !== 'undefined') TabManager.createTab(url, true);
      });
    });
    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
  },

  // "Ask anything about the current page…" must go once a request starts, or a
  // Summarize result renders underneath the empty state.
  _clearEmptyState() {
    document.getElementById('ai-messages')?.querySelector('.ai-empty')?.remove();
  },

  _addLoading() {
    const container = document.getElementById('ai-messages');
    if (!container) return null;
    this._clearEmptyState();
    const el = document.createElement('div');
    el.className = 'ai-msg assistant loading';
    el.innerHTML = 'Thinking <span class="ai-spinner"></span>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  },

  _addError(text, onRetry) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    this._clearEmptyState();
    const el = document.createElement('div');
    el.className = 'ai-msg assistant error';
    const msg = document.createElement('div');
    msg.textContent = 'Error: ' + text;
    el.appendChild(msg);
    if (typeof onRetry === 'function') {
      const btn = document.createElement('button');
      btn.className = 'ai-retry-btn';
      btn.type = 'button';
      btn.innerHTML = (window.VexIcons ? VexIcons.svg('refresh', { size: 13 }) : '') + '<span>Retry</span>';
      btn.addEventListener('click', () => { el.remove(); onRetry(); });
      el.appendChild(btn);
    }
    // "The AI stopped working" has a dozen causes and one symptom. This asks
    // every part — the worker, the internet, Ollama, the model, the graphics
    // card — and says which one it actually is (js/ai-health.js).
    if (typeof AIHealth !== 'undefined') {
      const why = document.createElement('button');
      why.className = 'ai-why-btn';
      why.type = 'button';
      why.textContent = 'Why did that fail?';
      why.addEventListener('click', async () => {
        why.disabled = true; why.textContent = 'Checking…';
        let out;
        try { out = await AIHealth.explain(text); }
        catch (err) { out = { headline: 'The check itself failed: ' + ((err && err.message) || ''), lines: [] }; }
        why.remove();
        const box = document.createElement('div');
        box.className = 'ai-why';
        box.innerHTML = '<div class="ai-why-head"></div><div class="ai-why-lines"></div>';
        box.querySelector('.ai-why-head').textContent = out.headline;
        box.querySelector('.ai-why-lines').textContent = out.lines.join('\n');
        el.appendChild(box);
      });
      el.appendChild(why);
    }
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  _esc(s) { return window.escapeHtml(s || ''); },

  // Free-text AI output → sanitized markdown HTML. Falls back to the plain
  // escape path if vex-markdown.js failed to load (never raw HTML).
  // Vex's own interface has no emoji — everything is a drawn icon. A model does
  // not know that and will happily open with a smiley, which looks out of place
  // next to an interface that deliberately has none.
  //
  // This is the model's own text, so it is a preference rather than a rule, and
  // it is stripping only: nothing is reworded. Copy still yields what the model
  // actually said, because the message content is left untouched.
  STRIP_EMOJI_KEY: 'vex.aiStripEmoji',

  _stripEmojiEnabled() {
    try {
      const v = localStorage.getItem(this.STRIP_EMOJI_KEY);
      return v === null ? true : v === '1';   // on unless turned off
    } catch { return true; }
  },

  _deEmoji(text) {
    if (!text || !this._stripEmojiEnabled()) return text;
    return String(text)
      // Keep ©®™, which are ordinary in prose; drop pictographs, skin tones,
      // flags, the variation selector and ZWJ joiners that glue them together.
      .replace(/(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]|\uFE0F|\u200D|\u20E3/gu, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([.,!?;:])/g, '$1')
      .replace(/^[ \t]+$/gm, '');
  },

  // Every assistant answer renders through here, so this is the one place the
  // emoji preference has to be applied.
  _md(s) {
    const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === TabManager.activeTabId) : null;
    const html = this._mdRaw(this._deEmoji(s));
    // Guarded because this now runs on every token of an answer that is still
    // being written: a throw here would stop the answer being drawn at all.
    return typeof VideoChat !== 'undefined' ? VideoChat.linkify(html, tab && tab.url) : html;
  },
  _mdRaw(s) { return window.VexMarkdown ? VexMarkdown.render(s || '') : this._esc(s).replace(/\n/g, '<br>'); },
};

// Renderer loads this as a plain <script> (AIPanel stays a script-scope global).
// The guard only adds a require() entry point for the unit tests.
if (typeof module !== 'undefined' && module.exports) module.exports = { AIPanel };
