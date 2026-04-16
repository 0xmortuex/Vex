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
        if (action === 'summarize' || action === 'key-points') this.sendMessage('summarize');
        else if (action === 'translate') this.sendMessage('translate', { targetLanguage: 'English' });
        else if (action === 'ask') document.getElementById('ai-input')?.focus();
      });
    });
  },

  _sendAgent() {
    const input = document.getElementById('ai-input');
    const msg = input?.value.trim();
    if (!msg) return;
    input.value = '';
    if (!this.isOpen()) this.open();

    // Add user message to chat
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

    // Show stop button
    document.getElementById('ai-stop-agent')?.classList.add('visible');

    // Start agent loop
    if (typeof AgentLoop !== 'undefined') {
      AgentLoop.start(msg, this._agentMode).then(() => {
        document.getElementById('ai-stop-agent')?.classList.remove('visible');
      });
    }
  },

  open() {
    document.getElementById('ai-panel')?.classList.add('open');
    this._renderMessages();
    this._updateTabIndicator();
    setTimeout(() => document.getElementById('ai-input')?.focus(), 150);
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
      const res = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          message: opts.message,
          pageContext,
          selectedText: opts.selectedText,
          targetLanguage: opts.targetLanguage,
          conversationHistory: conv.filter(m => m.role !== 'system').slice(-10)
        })
      });

      loadingEl?.remove();

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed (' + res.status + ')' }));
        this._addError(err.error || 'Request failed');
        this._sending = false;
        return;
      }

      const data = await res.json();
      const parsed = this._parseResponse(data.result);

      // Store assistant reply for chat history
      if (action === 'chat') {
        conv.push({ role: 'assistant', content: parsed.reply || data.result, action });
      }

      this._renderResponse(action, parsed);
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
    await this.sendMessage('chat', { message: msg });
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

  _renderResponse(action, parsed) {
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

    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
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
