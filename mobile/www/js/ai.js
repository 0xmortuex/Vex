// === Vex Mobile — the assistant ===
//
// The desktop app's AI has three backends: a local Ollama server, an on-device
// WebGPU model, and a Cloudflare Worker you deploy yourself. A phone has no
// child processes and no WebGPU in a WebView, so Ollama and WebLLM do not come
// across — but on-device does, twice over, through VexLocalAI: a .litertlm model
// LiteRT-LM runs in this process, and Gemini Nano for the jobs the system
// exposes. Nothing here points at anyone else's backend: the worker URL is yours
// (Settings → Assistant) and so is the token, which lives in the Android
// Keystore through VexVault rather than in a preference file.
//
// Which backend answers, in order: Nano if you turned it on and the job is one
// of its three; the on-device model if you have one and said to prefer it; the
// worker otherwise. A local failure falls through to the worker unless you chose
// "on-device only", because a model that cannot load should not take the
// assistant down with it.
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

    /**
     * The page the question is about. Captured per question rather than kept, so
     * an answer is never about a tab you have since navigated away from.
     *
     * A private tab's text never goes to the worker. It can go to the model on
     * this phone, because "on-device" is not a promise about the backend — it is
     * a promise about the text, and on-device the text does not move. Without
     * this, asking about a page in a private tab got an answer about nothing,
     * which is worse than useless: it looks like the assistant is lying.
     */
    async captureContext(options = {}) {
      const tab = VexTabStore.active();
      if (!tab || !tab.url || tab.url === 'about:blank') return null;
      if (tab.incognito && !options.staysHere) return null;
      let text = '';
      try { text = await VexReader.pageText(tab.id, 6000); } catch { text = ''; }
      return { url: tab.url, title: tab.title || '', text, private: !!tab.incognito };
    },

    /**
     * Will this question be answered without leaving the phone? Asked before the
     * page is read, because the answer decides whether a private tab may be read
     * at all.
     */
    staysHere(action) {
      if (typeof VexLocalAI === 'undefined') return false;
      return VexLocalAI.nanoHandles(action) || VexLocalAI.handles(action);
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
        const action = options.action || 'chat';
        // Whether the page may be read at all depends on where the answer is
        // coming from, so that question is settled first.
        const staysHere = !silent && this.staysHere(action);
        const context = options.context === null
          ? null
          : (options.context || await this.captureContext({ staysHere }));
        state.context = context;

        // On-device first, when it is wanted and able. The agent never comes
        // here: it needs valid JSON out of a tool loop, which a 1B model on a
        // phone does not reliably produce.
        const local = !silent ? await this.locally(action, question, context, options) : null;
        if (local !== null) {
          state.messages.push({ role: 'assistant', text: local, at: Date.now(), followUps: [], onDevice: true });
          return local;
        }

        const result = await call(Object.assign({
          action: options.action || 'chat',
          message: question,
          // The invariant, stated where it would be violated: a private tab's
          // text never reaches the worker. Upstream already avoids reading it
          // unless the answer is staying on the phone; this is the line that
          // holds even if upstream is wrong.
          pageContext: context && !context.private ? context.text : '',
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

    /**
     * Try the two on-device backends. Returns the answer, or null to mean "the
     * worker should take this one".
     *
     * A thrown error here is deliberate when you asked for on-device only: in
     * that mode there is nothing to fall back to, and silently sending the page
     * to a server would be the wrong kind of helpful.
     */
    async locally(action, question, context, options = {}) {
      if (typeof VexLocalAI === 'undefined') return null;

      if (VexLocalAI.nanoHandles(action)) {
        const text = (context && context.text) || options.selectedText || '';
        if (text) {
          try { return await VexLocalAI.nanoSummarize(text, 3); }
          catch (error) {
            if (VexLocalAI.insists()) throw error;
            // Nano refusing is common — the text is too short, the language is
            // not one it knows — and the next backend may well cope.
          }
        }
      }

      if (!VexLocalAI.handles(action)) return null;
      const prompt = VexLocalAI.promptFor(action, question, context, options);
      try {
        return await VexLocalAI.generate(prompt, { onToken: options.onToken });
      } catch (error) {
        if (VexLocalAI.insists()) throw error;
        // The page was read on the understanding that it was staying here. If the
        // model failed and the worker is about to be asked instead, a private
        // tab's text must not go with the question.
        if (context && context.private) {
          state.context = null;
          context.text = '';
        }
        return null;
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
