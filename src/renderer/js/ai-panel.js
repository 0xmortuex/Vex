// === Vex AI Assistant Panel ===

const AI_WORKER_URL = 'https://vex-ai.mortuexhavoc.workers.dev';

const AIPanel = {
  _conversations: {}, // tabId -> [{role, content}]
  _sending: false,

  init() {
    document.getElementById('ai-close')?.addEventListener('click', () => this.close());
    document.getElementById('ai-send')?.addEventListener('click', () => this._sendChat());
    document.getElementById('ai-clear')?.addEventListener('click', () => this._clearChat());

    document.getElementById('ai-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
    });

    document.querySelectorAll('.ai-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'summarize' || action === 'key-points') this.sendMessage('summarize');
        else if (action === 'translate') this.sendMessage('translate', { targetLanguage: 'English' });
        else if (action === 'ask') document.getElementById('ai-input')?.focus();
      });
    });
  },

  open() {
    document.getElementById('ai-panel')?.classList.add('open');
    this._renderMessages();
    this._updateTabIndicator();
    setTimeout(() => document.getElementById('ai-input')?.focus(), 150);
  },

  close() {
    document.getElementById('ai-panel')?.classList.remove('open');
  },

  toggle() {
    const p = document.getElementById('ai-panel');
    if (p?.classList.contains('open')) this.close(); else this.open();
  },

  isOpen() {
    return document.getElementById('ai-panel')?.classList.contains('open');
  },

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

  async sendMessage(action, opts = {}) {
    if (this._sending) return;
    this._sending = true;

    const tabId = this._getTabId();
    const wv = WebviewManager.getActiveWebview();
    let pageContext = null;

    if (wv) {
      try { pageContext = await PageContext.extractPageContext(wv); } catch {}
    }

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
      let parsed;
      try { parsed = JSON.parse(data.result); } catch { parsed = { reply: data.result }; }

      // Store assistant reply for chat
      if (action === 'chat') {
        conv.push({ role: 'assistant', content: parsed.reply || data.result });
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

    container.innerHTML = conv.map(m => {
      return `<div class="ai-msg ${m.role}">${this._esc(m.content)}</div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  },

  _renderResponse(action, parsed) {
    const container = document.getElementById('ai-messages');
    if (!container) return;

    const el = document.createElement('div');
    el.className = 'ai-msg assistant';
    let html = '';

    if (action === 'chat') {
      html = this._esc(parsed.reply || '');
      if (parsed.citations?.length) {
        parsed.citations.forEach(c => { html += `<div class="citation">"${this._esc(c.text)}"</div>`; });
      }
      if (parsed.suggestedFollowUps?.length) {
        html += '<div class="follow-ups">';
        parsed.suggestedFollowUps.forEach(q => { html += `<button class="follow-up-btn">${this._esc(q)}</button>`; });
        html += '</div>';
      }
    } else if (action === 'summarize') {
      html = `<strong>${this._esc(parsed.title || 'Summary')}</strong><br><br>${this._esc(parsed.summary || '')}`;
      if (parsed.keyPoints?.length) {
        html += '<br><br><strong>Key Points:</strong><ul>' + parsed.keyPoints.map(p => `<li>${this._esc(p)}</li>`).join('') + '</ul>';
      }
      if (parsed.readingTime) html += `<br><em>${this._esc(parsed.readingTime)}</em>`;
    } else if (action === 'translate') {
      html = `<strong>Translation (${this._esc(parsed.targetLanguage || '')})</strong><br><br>${this._esc(parsed.translation || '')}`;
      if (parsed.notes) html += `<br><br><em>Note: ${this._esc(parsed.notes)}</em>`;
    } else if (action === 'explain') {
      html = `<strong>Explanation</strong><br><br>${this._esc(parsed.explanation || '')}`;
      if (parsed.keyTerms?.length) {
        html += '<br><br><strong>Key Terms:</strong><ul>';
        parsed.keyTerms.forEach(t => { html += `<li><strong>${this._esc(t.term)}:</strong> ${this._esc(t.definition)}</li>`; });
        html += '</ul>';
      }
    }

    el.innerHTML = html;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;

    // Wire follow-up buttons
    el.querySelectorAll('.follow-up-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('ai-input');
        if (input) input.value = btn.textContent;
        this._sendChat();
      });
    });
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
