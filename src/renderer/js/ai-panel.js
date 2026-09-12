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
    }

    document.getElementById('ai-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
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

    // Agent send button — always uses agent mode
    document.getElementById('ai-send-agent')?.addEventListener('click', () => this._sendAgent());

    // Stop agent button
    document.getElementById('ai-stop-agent')?.addEventListener('click', () => {
      if (typeof AgentLoop !== 'undefined') AgentLoop.stop();
      document.getElementById('ai-stop-agent')?.classList.remove('visible');
    });

    // Mode selector
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._agentMode = btn.dataset.mode;
        localStorage.setItem('vex.agentMode', this._agentMode);
      });
    });
    // Restore saved mode
    const savedMode = localStorage.getItem('vex.agentMode') || 'ask';
    this._agentMode = savedMode;
    document.querySelector(`.mode-btn[data-mode="${savedMode}"]`)?.classList.add('active');

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

  _sendAgent() {
    const input = document.getElementById('ai-input');
    const msg = input?.value.trim();
    if (!msg) {
      input?.focus();
      window.showToast?.('Type a task first, then click the agent button');
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
    document.getElementById('ai-send-agent')?.classList.add('running');

    // Start agent loop
    const done = () => {
      document.getElementById('ai-stop-agent')?.classList.remove('visible');
      document.getElementById('ai-send-agent')?.classList.remove('running');
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
    if (!prompts.length) { row.style.display = 'none'; row.innerHTML = ''; return; }
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
    paint('ai-expand', 'maximize', 15);
    paint('ai-close', 'x', 16);
    paint('ai-send', 'arrow-right', 17);
    paint('ai-send-agent', 'robot', 16);

    // The dimmer behind focus mode. Clicking it closes, like clicking away
    // from the docked panel.
    if (!document.getElementById('ai-backdrop')) {
      const b = document.createElement('div');
      b.id = 'ai-backdrop';
      b.addEventListener('mousedown', () => this.close());
      document.body.appendChild(b);
    }

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
    if (show) this._renderHistory();
  },

  // Conversations are stored per tab, so "recent chats" is every tab that has
  // one — including tabs that have since been closed.
  _renderHistory() {
    const list = document.getElementById('ai-history-list');
    if (!list) return;
    const current = String(this._getTabId());
    const titleOf = (tabId) => {
      const t = (typeof TabManager !== 'undefined' ? TabManager.tabs : []).find(x => String(x.id) === String(tabId));
      return t ? (t.title || t.url || 'Untitled') : 'Closed tab';
    };
    const rows = Object.entries(this._conversations || {})
      .filter(([, msgs]) => Array.isArray(msgs) && msgs.length)
      .map(([tabId, msgs]) => ({ tabId, msgs, first: msgs.find(m => m.role === 'user') }))
      .reverse();

    if (!rows.length) {
      list.innerHTML = '<div class="ai-history-empty">No conversations yet.</div>';
      return;
    }
    list.innerHTML = '';
    for (const r of rows) {
      const b = document.createElement('button');
      b.className = 'ai-history-item' + (String(r.tabId) === current ? ' current' : '');
      b.innerHTML = `<span class="t"></span><span class="m"></span>`;
      b.querySelector('.t').textContent = (r.first && r.first.content.slice(0, 70)) || titleOf(r.tabId);
      b.querySelector('.m').textContent = `${r.msgs.length} message${r.msgs.length === 1 ? '' : 's'} · ${titleOf(r.tabId)}`;
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
          .map(m => (typeof m.thinking === 'string' && m.thinking)
            ? { role: m.role, content: m.content, thinking: m.thinking.slice(0, this.MAX_THINKING_CHARS) }
            : { role: m.role, content: m.content })
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
        out[id] = msgs.slice(-this.MAX_CONV_MESSAGES).map(m => (
          m.thinking
            ? { role: m.role, content: m.content, thinking: String(m.thinking).slice(0, this.MAX_THINKING_CHARS) }
            : { role: m.role, content: m.content }
        ));
      }
      localStorage.setItem(this.CONV_KEY, JSON.stringify(out));
    } catch {}
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

      const conv = this._getConv(tabId);

      // Add user message for chat. `_noEcho` is set when retrying a failed send:
      // the bubble is already in the transcript and must not be duplicated.
      if (action === 'chat' && opts.message && !opts._noEcho) {
        conv.push({ role: 'user', content: opts.message });
        this._persistConversations();
        this._renderMessages();
      }

      loadingEl = this._addLoading();
      // Phase 14: route through AIRouter for local/cloud selection.
      // Map action → feature name.
      const featureMap = { chat: 'chat', summarize: 'summarize', translate: 'translate', explain: 'explain' };
      const feature = featureMap[action] || 'chat';
      const persona = this.getActivePersona();
      // Persistent AI memory: prepend remembered facts as a system message at the
      // FRONT of the history (kept ≤10 total so the worker's slice(-10) preserves
      // it). Additive — works on both local + cloud without changing the prompt.
      let conversationHistory = conv.filter(m => m.role !== 'system').slice(-10);
      if (feature === 'chat' && typeof AIMemory !== 'undefined') {
        const memMsg = AIMemory.historyMessage();
        if (memMsg) conversationHistory = [memMsg, ...conversationHistory.slice(-9)];
      }
      // Questions about Vex get Vex's own feature list, not the open page.
      if (feature === 'chat') {
        const vexMsg = this._vexKnowledge(opts.message);
        if (vexMsg) conversationHistory = [vexMsg, ...conversationHistory.slice(-9)];
      }
      // Only chat streams: the other actions render structured output that
      // means nothing until it is complete.
      const onToken = (feature === 'chat') ? this._liveRenderer(loadingEl) : null;
      const aiResult = await AIRouter.callAI(feature, {
        onToken,
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
      return true;
    } catch (err) {
      loadingEl?.remove();
      // The prompt is never lost: it stays in the transcript and Retry re-sends
      // it verbatim once the backend is fixed, without a duplicate bubble.
      this._addError(err.message || 'Network error', () => this.sendMessage(action, { ...opts, _noEcho: true }));
      return false;
    } finally {
      this._sending = false;
      this._setComposerBusy(false);
    }
  },

  // Visual "busy" state for the composer. Keeps a second Enter from looking
  // like it did nothing (the send is refused while one is in flight).
  _setComposerBusy(on) {
    const send = document.getElementById('ai-send');
    const agent = document.getElementById('ai-send-agent');
    if (send) send.disabled = !!on;
    if (agent) agent.disabled = !!on;
    document.getElementById('ai-panel')?.classList.toggle('ai-busy', !!on);
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

  async _sendChat() {
    const input = document.getElementById('ai-input');
    const msg = input?.value.trim();
    if (!msg) return;
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

  _clearChat() {
    const tabId = this._getTabId();
    if (tabId) this._conversations[tabId] = [];
    this._persistConversations();
    this._renderMessages();
  },

  _renderMessages() {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const conv = this._getConv();

    if (conv.length === 0) {
      container.innerHTML = '<div class="ai-empty">Ask anything about the current page, or pick a starter below.</div>';
      this._syncStarters();
      return;
    }

    container.innerHTML = '';
    conv.forEach((m, i) => {
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
      container.appendChild(el);
    });
    container.scrollTop = container.scrollHeight;
    this._syncStarters();
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

    const paint = () => {
      timer = 0;
      const { thinking, body } = pending || {};
      if (thinking) {
        if (!thinkEl) {
          thinkEl = this._thinkingBlock(thinking);
          // Open while it is the only thing happening, so the wait is legible.
          if (thinkEl) { thinkEl.open = true; loadingEl.insertBefore(thinkEl, loadingEl.firstChild); }
        } else {
          const b = thinkEl.querySelector('.ai-thinking-body');
          if (b) b.textContent = thinking;
          const label = thinkEl.querySelector('.ai-thinking-label');
          const words = thinking.trim().split(/\s+/).filter(Boolean).length;
          if (label) label.textContent = `Thinking… ${words} word${words === 1 ? '' : 's'}`;
        }
      }
      if (body) {
        if (!bodyEl) {
          bodyEl = document.createElement('div');
          bodyEl.className = 'ai-msg-content';
          loadingEl.appendChild(bodyEl);
        }
        // Plain text while streaming: markdown is rendered once at the end,
        // because half a fence or half a link renders as garbage.
        bodyEl.textContent = body;
      }
      const nearBottom = container && (container.scrollHeight - container.scrollTop - container.clientHeight < 120);
      if (container && nearBottom) container.scrollTop = container.scrollHeight;
    };

    return (_piece, full) => {
      if (!started) {
        started = true;
        // Drop the "Thinking <spinner>" placeholder text, keep the bubble.
        loadingEl.textContent = '';
        loadingEl.classList.remove('loading');
        loadingEl.classList.add('streaming');
      }
      pending = this._streamPreview(full);
      if (!timer) timer = setTimeout(paint, 50);
    };
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
  _md(s) { return this._mdRaw(this._deEmoji(s)); },
  _mdRaw(s) { return window.VexMarkdown ? VexMarkdown.render(s || '') : this._esc(s).replace(/\n/g, '<br>'); },
};

// Renderer loads this as a plain <script> (AIPanel stays a script-scope global).
// The guard only adds a require() entry point for the unit tests.
if (typeof module !== 'undefined' && module.exports) module.exports = { AIPanel };
