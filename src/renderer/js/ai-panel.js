// === Vex AI Assistant Panel ===

const AI_WORKER_URL = 'https://vex-ai.mortuexhavoc.workers.dev';

const AIPanel = {
  _conversations: {},
  _sending: false,
  _agentMode: 'ask',

  init() {
    document.getElementById('ai-close')?.addEventListener('click', () => this.close());
    document.getElementById('ai-send')?.addEventListener('click', () => this._sendChat());
    document.getElementById('ai-clear')?.addEventListener('click', () => this._clearChat());

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
      if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('settings');
      setTimeout(() => {
        document.getElementById('personas-panel-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
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
    if (typeof AgentLoop !== 'undefined' && typeof AgentLoop.start === 'function') {
      AgentLoop.start(msg, this._agentMode).then(() => {
        document.getElementById('ai-stop-agent')?.classList.remove('visible');
        document.getElementById('ai-send-agent')?.classList.remove('running');
      }).catch(() => {
        document.getElementById('ai-stop-agent')?.classList.remove('visible');
        document.getElementById('ai-send-agent')?.classList.remove('running');
      });
    } else {
      window.showToast?.('Agent system not loaded');
      document.getElementById('ai-stop-agent')?.classList.remove('visible');
    }
  },

  open() {
    document.getElementById('ai-panel')?.classList.add('open');
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

  updatePersonaSwitcher() {
    const p = this.getActivePersona();
    if (!p) return;
    const iconEl = document.getElementById('active-persona-icon');
    const nameEl = document.getElementById('active-persona-name');
    if (iconEl) iconEl.textContent = p.icon || '\u2728';
    if (nameEl) nameEl.textContent = p.name || 'Vex';
  },

  _togglePersonaDropdown() {
    const dd = document.getElementById('persona-dropdown');
    if (!dd) return;
    if (!dd.hidden) { dd.hidden = true; return; }
    this._renderPersonaDropdown();
    dd.hidden = false;
  },

  _renderPersonaDropdown() {
    if (typeof PersonasManager === 'undefined') return;
    const list = document.getElementById('persona-list');
    if (!list) return;
    const all = PersonasManager.getAll();
    const active = this.getActivePersona();
    list.innerHTML = all.map(p => `
      <div class="persona-item ${p.id === active?.id ? 'active' : ''}" data-persona-id="${this._esc(p.id)}">
        <span class="persona-item-icon">${this._esc(p.icon)}</span>
        <div class="persona-item-info">
          <div class="persona-item-name">${this._esc(p.name)}</div>
          <div class="persona-item-desc">${this._esc(p.description || '')}</div>
        </div>
        ${p.isBuiltIn ? '<span class="persona-item-builtin">built-in</span>' : ''}
      </div>
    `).join('');
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
      hint.innerHTML = `<span>&#128161; Install <a id="open-ollama-hint">Ollama</a> to run AI locally &mdash; faster, private, works offline.</span><button class="hint-dismiss" title="Dismiss">\u00d7</button>`;
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

  close() { document.getElementById('ai-panel')?.classList.remove('open'); },

  toggle() {
    const p = document.getElementById('ai-panel');
    if (p?.classList.contains('open')) this.close(); else this.open();
  },

  isOpen() { return document.getElementById('ai-panel')?.classList.contains('open'); },

  _getTabId() { return TabManager.activeTabId; },

  _getConv(tabId) {
    const id = tabId || this._getTabId();
    if (!id) return [];
    if (!this._conversations[id]) this._conversations[id] = [];
    return this._conversations[id];
  },

  _updateTabIndicator() {
    const tab = TabManager.getActiveTab();
    const el = document.getElementById('ai-current-tab');
    if (el && tab) el.textContent = tab.title || tab.url || 'New Tab';
    // Phase 15: each tab can have its own persona — refresh the switcher
    this.updatePersonaSwitcher?.();
    this._renderPersonaQuickPrompts?.();
  },

  // Parse AI response — strip markdown fences, try JSON, fallback to plain text
  _parseResponse(raw) {
    if (!raw) return { reply: '' };
    let str = raw.trim();
    // Strip ```json ... ``` fences
    str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try {
      return JSON.parse(str);
    } catch {
      // Try to extract reply field from malformed JSON
      const m = str.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) return { reply: m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') };
      return { reply: str };
    }
  },

  async sendMessage(action, opts = {}) {
    if (this._sending) return;
    this._sending = true;

    const tabId = this._getTabId();
    const wv = WebviewManager.getActiveWebview();
    let pageContext = null;
    if (wv) { try { pageContext = await PageContext.extractPageContext(wv); } catch {} }

    const conv = this._getConv(tabId);

    // Add user message for chat
    if (action === 'chat' && opts.message) {
      conv.push({ role: 'user', content: opts.message });
      this._renderMessages();
    }

    const loadingEl = this._addLoading();

    try {
      // Phase 14: route through AIRouter for local/cloud selection.
      // Map action → feature name.
      const featureMap = { chat: 'chat', summarize: 'summarize', translate: 'translate', explain: 'explain' };
      const feature = featureMap[action] || 'chat';
      const persona = this.getActivePersona();
      const aiResult = await AIRouter.callAI(feature, {
        message: opts.message,
        pageContext,
        selectedText: opts.selectedText,
        targetLanguage: opts.targetLanguage,
        conversationHistory: conv.filter(m => m.role !== 'system').slice(-10),
        persona: persona ? {
          id: persona.id,
          systemPrompt: persona.systemPrompt,
          temperature: persona.temperature
        } : null
      });

      loadingEl?.remove();

      const parsed = this._parseResponse(aiResult.result);

      // Store assistant reply for chat history
      if (action === 'chat') {
        conv.push({ role: 'assistant', content: parsed.reply || aiResult.result, action });
      }

      this._renderResponse(action, parsed, { backend: aiResult.backend, model: aiResult.model });
    } catch (err) {
      loadingEl?.remove();
      this._addError(err.message || 'Network error');
    }

    this._sending = false;
  },

  async _sendChat() {
    const input = document.getElementById('ai-input');
    const msg = input?.value.trim();
    if (!msg) return;
    input.value = '';
    if (!this.isOpen()) this.open();

    // Phase 12: Detect "find in history" intent before anything else
    const historyIntent = /\b(find|remember|recall|where( did I)? (see|read|visit)|that (page|article|video|tab|site|thread|post) (about|on|I)|last (week|month|yesterday)|earlier today|few days ago)\b/i;
    if (historyIntent.test(msg)) {
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

  async _sendMultiTab(message, tabs) {
    const conv = this._getConv();
    conv.push({ role: 'user', content: message });
    this._renderMessages();

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

      const parsed = this._parseResponse(aiResult.result);
      conv.push({ role: 'assistant', content: parsed.reply || aiResult.result });
      this._renderMultiTabResponse(parsed, tabs, { backend: aiResult.backend, model: aiResult.model });
    } catch (err) {
      loadingEl?.remove();
      this._addError(err.message || 'Network error');
    }
  },

  _renderMultiTabResponse(parsed, tabs, backendInfo) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'ai-msg assistant';

    let html = '<div class="mt-badge">Analyzed ' + tabs.length + ' tabs</div>';

    if (parsed.reply) {
      html += '<div class="mt-reply">' + this._esc(parsed.reply).replace(/\n/g, '<br>') + '</div>';
    }

    if (parsed.perTab?.length) {
      html += '<details class="mt-per-tab"><summary>Per-tab summaries</summary>';
      parsed.perTab.forEach(t => {
        const tab = tabs[(t.tabIndex || 1) - 1];
        html += '<div class="mt-tab-sum"><strong>' + this._esc(t.title || tab?.title || '') + '</strong><br>'
          + '<span>' + this._esc(t.summary || '') + '</span></div>';
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
    this._renderMessages();
  },

  _renderMessages() {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const conv = this._getConv();

    if (conv.length === 0) {
      container.innerHTML = '<div class="ai-empty">Ask anything about the current page, or use the quick actions above.</div>';
      return;
    }

    container.innerHTML = '';
    conv.forEach(m => {
      const el = document.createElement('div');
      el.className = `ai-msg ${m.role}`;
      const contentEl = document.createElement('div');
      contentEl.className = 'ai-msg-content';
      contentEl.innerHTML = this._esc(m.content).replace(/\n/g, '<br>');
      el.appendChild(contentEl);
      if (m.role === 'assistant') el.appendChild(this._makeCopyBtn(contentEl));
      container.appendChild(el);
    });
    container.scrollTop = container.scrollHeight;
  },

  _renderResponse(action, parsed, backendInfo) {
    const container = document.getElementById('ai-messages');
    if (!container) return;

    const el = document.createElement('div');
    el.className = 'ai-msg assistant';

    const contentEl = document.createElement('div');
    contentEl.className = 'ai-msg-content';
    let html = '';

    if (action === 'chat') {
      html = this._esc(parsed.reply || '').replace(/\n/g, '<br>');
      if (parsed.citations?.length) {
        parsed.citations.forEach(c => { html += `<div class="citation">"${this._esc(c.text)}"</div>`; });
      }
    } else if (action === 'summarize') {
      html = `<strong>${this._esc(parsed.title || 'Summary')}</strong><br><br>${this._esc(parsed.summary || '').replace(/\n/g, '<br>')}`;
      if (parsed.keyPoints?.length) {
        html += '<br><br><strong>Key Points:</strong><ul>' + parsed.keyPoints.map(p => `<li>${this._esc(p)}</li>`).join('') + '</ul>';
      }
      if (parsed.readingTime) html += `<div class="ai-meta">${this._esc(parsed.readingTime)}</div>`;
    } else if (action === 'translate') {
      html = `<strong>Translation (${this._esc(parsed.targetLanguage || '')})</strong><br><br>${this._esc(parsed.translation || '').replace(/\n/g, '<br>')}`;
      if (parsed.notes) html += `<div class="ai-meta">Note: ${this._esc(parsed.notes)}</div>`;
    } else if (action === 'explain') {
      html = `<strong>Explanation</strong><br><br>${this._esc(parsed.explanation || '').replace(/\n/g, '<br>')}`;
      if (parsed.keyTerms?.length) {
        html += '<br><br><strong>Key Terms:</strong><ul>';
        parsed.keyTerms.forEach(t => { html += `<li><strong>${this._esc(t.term)}:</strong> ${this._esc(t.definition)}</li>`; });
        html += '</ul>';
      }
    }

    contentEl.innerHTML = html;
    el.appendChild(contentEl);
    el.appendChild(this._makeCopyBtn(contentEl));

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
    tag.textContent = info.backend === 'local' ? `local \u00b7 ${info.model}` : `cloud \u00b7 ${info.model}`;
    msgEl.appendChild(tag);
  },

  _makeCopyBtn(contentEl) {
    const btn = document.createElement('button');
    btn.className = 'ai-copy-btn';
    btn.title = 'Copy';
    btn.textContent = '\u{1F4CB}';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(contentEl.innerText);
        btn.textContent = '\u2713';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '\u{1F4CB}'; btn.classList.remove('copied'); }, 1500);
      } catch {}
    });
    return btn;
  },

  // Phase 12: History search triggered from the AI panel
  async _handleHistorySearch(query) {
    const conv = this._getConv();
    conv.push({ role: 'user', content: query });
    this._renderMessages();

    const loadingEl = this._addLoading();
    if (loadingEl) loadingEl.innerHTML = 'Searching your history <span class="ai-spinner"></span>';

    try {
      const all = (window.HistoryPanel && Array.isArray(HistoryPanel.entries)) ? HistoryPanel.entries : [];
      const compact = all.slice(0, 200).map(e => ({
        id: e.id, url: e.url, title: e.title,
        summary: e.summary || '', tags: e.tags || [],
        contentType: e.contentType || '', visitedAt: e.visitedAt
      }));

      const aiResult = await AIRouter.callAI('historySearch', {
        query, historyEntries: compact, timeContext: new Date().toISOString()
      });
      loadingEl?.remove();

      if (!aiResult || !aiResult.result) { this._addError('Empty response'); return; }

      let parsed;
      try {
        const str = String(aiResult.result).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        parsed = JSON.parse(str);
      } catch {
        this._addError('Could not parse search results');
        return;
      }

      this._renderHistorySearchResult(parsed, all);
    } catch (err) {
      loadingEl?.remove();
      this._addError(err.message || 'Network error');
    }
  },

  _renderHistorySearchResult(parsed, allEntries) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const msgEl = document.createElement('div');
    msgEl.className = 'ai-msg assistant history-search-response';

    let html = `<div class="history-search-header">&#128336; History Search</div>`;
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
            <img src="${host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=16` : ''}" width="14" height="14" onerror="this.style.display='none'">
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

  _addLoading() {
    const container = document.getElementById('ai-messages');
    if (!container) return null;
    const el = document.createElement('div');
    el.className = 'ai-msg assistant loading';
    el.innerHTML = 'Thinking <span class="ai-spinner"></span>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  },

  _addError(text) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'ai-msg assistant error';
    el.textContent = 'Error: ' + text;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
};
