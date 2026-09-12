// === Vex AI Assistant Panel ===

// Cloud AI routing lives in ai-router.js (AIRouter.cloudWorkerUrl(), backed by
// VexConfig / Settings). Kept for backward-compat; reads the configured URL.
const AI_WORKER_URL = (typeof window !== 'undefined' && window.VexConfig) ? window.VexConfig.aiWorkerUrl() : '';

const AIPanel = {
  _conversations: {},
  _sending: false,
  _agentMode: 'ask',

  init() {
    this._loadConversations();
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

  _renderPersonaDropdown() {
    if (typeof PersonasManager === 'undefined') return;
    const list = document.getElementById('persona-list');
    if (!list) return;
    const all = PersonasManager.getAll();
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

  // === Conversation persistence ===
  // Chats used to live only in memory: quitting Vex (or a crash) lost every
  // thread. They're stored per tab, capped, and pruned to tabs that still exist
  // so closed tabs can't grow the store forever.
  CONV_KEY: 'vex.aiConversations',
  MAX_CONV_MESSAGES: 40,
  MAX_CONV_TABS: 20,

  _loadConversations() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.CONV_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return;
      for (const [tabId, msgs] of Object.entries(raw)) {
        if (!Array.isArray(msgs)) continue;
        this._conversations[tabId] = msgs
          .filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
          .slice(-this.MAX_CONV_MESSAGES);
      }
    } catch {}
  },

  _persistConversations() {
    try {
      // Private/incognito tabs are excluded the same way tab restore excludes
      // them — a chat about a private page must not survive on disk.
      const liveIds = (typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs))
        ? new Set(TabManager.tabs.filter(t => !window.VexTabPolicy || window.VexTabPolicy.canPersist(t)).map(t => t.id))
        : null;
      const out = {};
      let kept = 0;
      const ids = Object.keys(this._conversations).reverse(); // newest tabs first
      for (const id of ids) {
        if (liveIds && !liveIds.has(id)) continue;            // tab was closed
        const msgs = this._conversations[id];
        if (!Array.isArray(msgs) || !msgs.length) continue;
        if (++kept > this.MAX_CONV_TABS) break;
        out[id] = msgs.slice(-this.MAX_CONV_MESSAGES).map(m => ({ role: m.role, content: m.content }));
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
  _parseResponse(raw) {
    if (!raw) return { reply: '' };
    let str = String(raw).trim();
    // Strip ```json ... ``` fences
    str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try {
      const parsed = JSON.parse(str);
      // Only a plain object carries the fields the renderers read. A scalar or
      // an array is just the model's answer in JSON clothing.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      return { reply: typeof parsed === 'string' ? parsed : str };
    } catch {
      // Malformed/truncated JSON — recover the reply field if it started.
      const closed = str.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (closed) return { reply: this._unescapeJsonString(closed[1]) };
      const open = str.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)$/);
      if (open) return { reply: this._unescapeJsonString(open[1]), truncated: true };
      return { reply: str };
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
      const aiResult = await AIRouter.callAI(feature, {
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
        conv.push({ role: 'assistant', content: parsed.reply, action });
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
      container.innerHTML = '<div class="ai-empty">Ask anything about the current page, or use the quick actions above.</div>';
      return;
    }

    container.innerHTML = '';
    conv.forEach(m => {
      const el = document.createElement('div');
      el.className = `ai-msg ${m.role}`;
      const contentEl = document.createElement('div');
      contentEl.className = 'ai-msg-content';
      contentEl.innerHTML = m.role === 'assistant'
        ? this._md(m.content)
        : this._esc(m.content).replace(/\n/g, '<br>');
      el.appendChild(contentEl);
      if (m.role === 'assistant') el.appendChild(this._makeCopyBtn(contentEl));
      container.appendChild(el);
    });
    container.scrollTop = container.scrollHeight;
  },

  _renderResponse(action, parsed, backendInfo) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    this._clearEmptyState();

    const el = document.createElement('div');
    el.className = 'ai-msg assistant';

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
  _md(s) { return window.VexMarkdown ? VexMarkdown.render(s || '') : this._esc(s).replace(/\n/g, '<br>'); }
};

// Renderer loads this as a plain <script> (AIPanel stays a script-scope global).
// The guard only adds a require() entry point for the unit tests.
if (typeof module !== 'undefined' && module.exports) module.exports = { AIPanel };
