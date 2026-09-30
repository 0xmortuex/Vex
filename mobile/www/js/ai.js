// === Vex Mobile — the assistant ===
//
// The desktop app's AI has three backends: a local Ollama server, an on-device
// WebGPU model, and a Cloudflare Worker you deploy yourself. A phone has
// neither of the first two — no child processes, no WebGPU in a WebView — so
// the mobile assistant is the worker path, and only that. Nothing here points
// at anyone else's backend: the URL is yours (Settings → Assistant) and so is
// the token, which lives in the Android Keystore through VexVault rather than
// in a preference file.
//
// The request shape is the desktop's, unchanged, so one worker serves both:
//   POST { action, message, pageContext, selectedText, targetLanguage,
//          conversationHistory } → { result: { reply, … } }

const VexAI = (() => {
  const TIMEOUT_MS = 45000;
  const HISTORY_LIMIT = 12;

  const state = {
    messages: [],        // { role: 'user' | 'assistant' | 'error', text, at }
    busy: false,
    context: null        // { url, title, text } captured with the question
  };

  function workerUrl() {
    return String(VexStore.get('vex.aiWorkerUrl', '') || '').trim();
  }

  async function token() {
    return VexBridge.vaultGet('vex.aiToken');
  }

  async function configured() {
    return /^https:\/\//.test(workerUrl()) && !!(await token());
  }

  async function call(body) {
    const url = workerUrl();
    if (!/^https:\/\//.test(url)) throw new Error('Add your AI Worker URL in Settings → Assistant.');
    const secret = await token();
    if (!secret) throw new Error('Add your AI access token in Settings → Assistant.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      if (controller.signal.aborted) throw new Error('The worker did not answer within 45 seconds.');
      throw new Error('Could not reach your AI Worker. Check the URL and your connection.');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.error || ('The worker returned ' + response.status + '.'));
    }
    const data = await response.json().catch(() => ({}));
    return data.result || data;
  }

  return {
    state,
    workerUrl,
    configured,

    async setWorkerUrl(url) {
      const value = String(url || '').trim();
      if (value && !/^https:\/\//.test(value)) throw new Error('The worker URL has to be https://');
      await VexStore.set('vex.aiWorkerUrl', value);
    },

    async setToken(value) {
      const secret = String(value || '').trim();
      if (secret && (secret.length < 24 || secret.length > 512)) {
        throw new Error('Use the token your worker was configured with (24–512 characters).');
      }
      await VexBridge.vaultSet('vex.aiToken', secret);
    },

    async hasToken() {
      return !!(await token());
    },

    // The page the question is about. Captured per question rather than kept,
    // so an answer is never about a tab you have since navigated away from.
    async captureContext() {
      const tab = VexTabStore.active();
      if (!tab || !tab.url || tab.url === 'about:blank') return null;
      if (tab.incognito) return null;     // a private tab is not sent anywhere
      let text = '';
      try { text = await VexReader.pageText(tab.id, 6000); } catch { text = ''; }
      return { url: tab.url, title: tab.title || '', text };
    },

    history() {
      return state.messages
        .filter(message => message.role !== 'error')
        .slice(-HISTORY_LIMIT)
        .map(message => ({ role: message.role, content: message.text }));
    },

    clear() {
      state.messages = [];
      state.context = null;
    },

    // One question. Returns the assistant's text; the panel renders it.
    async ask(text, options = {}) {
      if (state.busy) throw new Error('Still thinking about the last one.');
      const question = String(text || '').trim();
      if (!question && !options.action) return '';
      state.busy = true;
      // The history is what came BEFORE this question: `message` carries the
      // question itself, and sending it twice makes the model answer the
      // echo instead of the page.
      const history = this.history();
      // An agent step is machinery, not conversation: it does not belong in
      // the chat log, and its history is the tool results, not the messages.
      const silent = options.action === 'agent';
      // The panel has already shown the question when it carries a selection.
      if (question && !silent && !options.skipUserMessage) {
        state.messages.push({ role: 'user', text: question, at: Date.now() });
      }
      try {
        const context = options.context === null ? null : (options.context || await this.captureContext());
        state.context = context;
        const result = await call(Object.assign({
          action: options.action || 'chat',
          message: question,
          pageContext: context ? context.text : '',
          selectedText: options.selectedText || '',
          targetLanguage: options.targetLanguage || '',
          conversationHistory: history,
          // Facts you have told the assistant to remember, the way the desktop
          // carries vex.aiMemory.
          memory: VexStore.get('vex.aiMemory', [])
        }, options.extra || {}));
        // An agent step is a whole tool call, not prose: hand it back as it is.
        if (silent) return result;
        const reply = typeof result === 'string' ? result
          : (result.reply || result.summary || result.translation || result.explanation || '');
        const answer = String(reply || '').trim() || 'The worker answered with nothing.';
        state.messages.push({
          role: 'assistant',
          text: answer,
          at: Date.now(),
          followUps: Array.isArray(result.suggestedFollowUps) ? result.suggestedFollowUps.slice(0, 3) : []
        });
        return answer;
      } catch (err) {
        if (!silent) state.messages.push({ role: 'error', text: err.message, at: Date.now() });
        throw err;
      } finally {
        state.busy = false;
      }
    },

    summarize() {
      return this.ask('Summarise this page.', { action: 'summarize' });
    },

    explain(selection) {
      return this.ask('Explain this.', { action: 'explain', selectedText: selection });
    },

    translate(language) {
      return this.ask('Translate this page.', { action: 'translate', targetLanguage: language });
    },

    // Facts the assistant keeps across conversations — the desktop's AI memory.
    memory() {
      const stored = VexStore.get('vex.aiMemory', []);
      return Array.isArray(stored) ? stored : [];
    },

    async remember(fact) {
      const clean = String(fact || '').trim().slice(0, 300);
      if (!clean) return this.memory();
      const next = [...this.memory().filter(entry => entry !== clean), clean].slice(-40);
      await VexStore.set('vex.aiMemory', next);
      return next;
    },

    async forget(fact) {
      const next = this.memory().filter(entry => entry !== fact);
      await VexStore.set('vex.aiMemory', next);
      return next;
    }
  };
})();

if (typeof window !== 'undefined') window.VexAI = VexAI;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAI };
