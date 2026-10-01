// === Vex Mobile — the AI that never leaves the phone ===
//
// Two backends, and they are not interchangeable:
//
//   • A .litertlm model you put on the device, run by LiteRT-LM inside Vex's own
//     process. Answers anything, works with the aeroplane mode on, costs between
//     half a gigabyte and three of storage and seconds per reply.
//   • Gemini Nano, through ML Kit. Instant, nothing to store — the weights
//     belong to the system, not to Vex — but it does three fixed jobs:
//     summarise, proofread, rewrite. Only on a phone with AICore: a Galaxy S25
//     or a Pixel 9 has one, a mid-range phone does not.
//
// Nothing here downloads a model behind your back, and nothing here is on by
// default: an on-device model is a gigabyte of someone else's weights and a
// deliberate choice.
//
// Why there is no catalogue of download URLs: the models worth running are
// Gemma's, and Gemma is behind a licence you have to accept in a browser. Vex IS
// a browser. So the flow is: open the model's page, accept, download the
// .litertlm, and import the file — or paste a direct URL if you have one, which
// is resumed properly if the connection drops.

const VexLocalAI = (() => {
  // The system prompt for on-device chat. A 1B model does not need telling what
  // it is twice, and every token here is a token of page text it cannot have.
  const SYSTEM = 'You are Vex, a browser assistant running on this phone. '
    + 'Answer briefly and directly in plain text. Use the page text when it is given.';

  // A small model's whole context is often 1280 tokens. Sending it the 6000
  // characters the worker gets would push the question out of the window.
  const PAGE_LIMIT = 2400;

  const MODELS = [
    {
      id: 'gemma3-1b', name: 'Gemma3-1B-IT.litertlm', label: 'Gemma 3 1B',
      size: '~0.6 GB', note: 'Quick on any phone. Good for short questions.',
      page: 'https://huggingface.co/litert-community/Gemma3-1B-IT'
    },
    {
      id: 'gemma3-4b', name: 'Gemma3-4B-IT.litertlm', label: 'Gemma 3 4B',
      size: '~2.6 GB', note: 'The best answers a phone can give. Wants a recent flagship.',
      page: 'https://huggingface.co/litert-community/Gemma3-4B-IT'
    },
    {
      id: 'gemma3n-e2b', name: 'Gemma3n-E2B-it.litertlm', label: 'Gemma 3n E2B',
      size: '~3.0 GB', note: 'Reads images as well as text.',
      page: 'https://huggingface.co/google/gemma-3n-E2B-it-litert-lm'
    },
    {
      id: 'qwen2.5-1.5b', name: 'Qwen2.5-1.5B-Instruct.litertlm', label: 'Qwen 2.5 1.5B',
      size: '~1.1 GB', note: 'A middle option, and not gated behind a licence.',
      page: 'https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct'
    }
  ];

  const BACKENDS = [
    { id: 'gpu', label: 'GPU', note: 'Fastest where it works. Falls back on its own if it does not.' },
    { id: 'cpu', label: 'CPU', note: 'Always works. Slower, and warmer.' },
    { id: 'npu', label: 'NPU', note: 'Qualcomm only, and only with NPU libraries present.' }
  ];

  // What the plugin last told us, so a panel can draw without waiting.
  const state = {
    supported: false, loaded: false, busy: false,
    model: '', backend: '', models: {}, nano: 'unknown',
    downloading: null,        // { name, received, total }
    lastError: ''
  };

  const listeners = new Set();
  function changed() { for (const fn of listeners) { try { fn(state); } catch { /* a panel that has gone */ } } }

  // Which jobs on-device can take. The agent is deliberately absent: it needs
  // valid JSON and a tool loop, and a 1B model produces neither reliably — the
  // desktop makes the same cut.
  const CHAT_ACTIONS = ['chat', 'summarize', 'explain', 'translate'];

  function mode() {
    const value = VexStore.get('vex.localAI', 'off');
    return ['off', 'prefer', 'only'].includes(value) ? value : 'off';
  }

  function nanoMode() {
    return VexStore.get('vex.nanoAI', 'off') === 'on';
  }

  function chosenModel() {
    return String(VexStore.get('vex.localModel', '') || '');
  }

  function chosenBackend() {
    const value = VexStore.get('vex.localBackend', 'gpu');
    return BACKENDS.some(backend => backend.id === value) ? value : 'gpu';
  }

  function model(name) {
    return MODELS.find(entry => entry.name === name || entry.id === name) || null;
  }

  function page(text) {
    return String(text || '').slice(0, PAGE_LIMIT);
  }

  // The worker shapes its own prompts server-side; on-device there is nobody to
  // do that, so the prompt is built here — the same four jobs, spelled out.
  function promptFor(action, message, context, extra = {}) {
    const text = page(context && context.text);
    const about = text ? '\n\nThe page says:\n' + text : '';
    if (action === 'summarize') {
      return 'Summarise the page below in three short bullet points.' + about;
    }
    if (action === 'explain') {
      return 'Explain this, plainly and briefly:\n\n' + String(extra.selectedText || message || '');
    }
    if (action === 'translate') {
      return 'Translate the text below into ' + (extra.targetLanguage || 'English')
        + '. Give only the translation.' + about;
    }
    return message + about;
  }

  async function refresh() {
    // Asking is not an operation that can fail usefully: no answer is "nothing".
    const status = await VexBridge.localAI('status', {}).catch(() => ({}));
    state.supported = !!(status && status.supported);
    state.loaded = !!(status && status.loaded);
    state.busy = !!(status && status.busy);
    state.model = (status && status.model) || '';
    state.backend = (status && status.backend) || '';
    state.models = (status && status.models) || {};
    changed();
    return state;
  }

  async function refreshNano() {
    const result = await VexBridge.localAI('nanoStatus', {}).catch(() => ({}));
    state.nano = (result && result.status) || 'unavailable';
    changed();
    return state.nano;
  }

  // ── Generation ───────────────────────────────────────────────────────────

  let nextId = 1;

  async function ensureLoaded() {
    if (state.loaded) return true;
    const name = chosenModel();
    if (!name) return false;
    if (!state.models || state.models[name] === undefined) {
      await refresh();
      if (!state.models || state.models[name] === undefined) return false;
    }
    try {
      const result = await VexBridge.localAI('load', {
        name, backend: chosenBackend(), system: SYSTEM
      });
      state.loaded = !!(result && result.loaded);
      state.model = (result && result.model) || name;
      state.backend = (result && result.backend) || chosenBackend();
      state.lastError = '';
      changed();
      return state.loaded;
    } catch (error) {
      state.lastError = error.message || String(error);
      // A GPU that cannot take this model is the common failure, and the answer
      // is the CPU — try it once rather than reporting defeat.
      if (chosenBackend() !== 'cpu') {
        try {
          const result = await VexBridge.localAI('load', { name, backend: 'cpu', system: SYSTEM });
          state.loaded = !!(result && result.loaded);
          state.model = name;
          state.backend = 'cpu';
          await VexStore.set('vex.localBackend', 'cpu');
          changed();
          return state.loaded;
        } catch (second) {
          state.lastError = second.message || String(second);
        }
      }
      changed();
      return false;
    }
  }

  return {
    SYSTEM, MODELS, BACKENDS, CHAT_ACTIONS, state,
    mode, nanoMode, chosenModel, chosenBackend, model, promptFor, refresh, refreshNano,

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    installed() {
      return Object.keys(state.models || {});
    },

    ready() {
      return !!(state.supported && chosenModel() && (state.models || {})[chosenModel()] !== undefined);
    },

    /** Should the on-device model take this one, instead of the worker? */
    handles(action) {
      if (mode() === 'off') return false;
      if (!CHAT_ACTIONS.includes(action || 'chat')) return false;
      return this.ready();
    },

    /** Nano takes a summary only when it is there and you asked it to. */
    nanoHandles(action) {
      return nanoMode() && state.nano === 'available' && action === 'summarize';
    },

    insists() { return mode() === 'only'; },

    async setMode(value) { await VexStore.set('vex.localAI', value); changed(); },
    async setNano(on) { await VexStore.set('vex.nanoAI', on ? 'on' : 'off'); changed(); },
    async setModel(name) {
      if (state.loaded && state.model !== name) await this.unload();
      await VexStore.set('vex.localModel', name);
      changed();
    },
    async setBackend(id) {
      if (state.loaded) await this.unload();
      await VexStore.set('vex.localBackend', id);
      changed();
    },

    async load() { return ensureLoaded(); },

    async unload() {
      await VexBridge.localAI('unload', {}).catch(() => {});
      state.loaded = false;
      state.model = '';
      state.backend = '';
      changed();
    },

    /**
     * Ask the model. `onToken` is called with each piece as it arrives, because
     * twenty seconds of nothing reads as a hang.
     */
    async generate(prompt, options = {}) {
      if (!await ensureLoaded()) {
        throw new Error(state.lastError || 'No on-device model is loaded.');
      }
      const id = 'gen-' + (nextId++);
      let stop = null;
      if (options.onToken) {
        stop = VexBridge.onLocalAI('token', data => {
          if (data && data.id === id && data.text) options.onToken(data.text);
        });
      }
      try {
        const result = await VexBridge.localAI('generate', { id, prompt });
        return String((result && result.text) || '').trim();
      } finally {
        if (stop) stop();
      }
    },

    stop() { return VexBridge.localAI('stop', {}).catch(() => ({})); },

    // ── Getting a model onto the phone ─────────────────────────────────────

    /** Resume-capable download of a direct URL. Progress arrives as events. */
    async download(name, url, token = '') {
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      // Gigabytes take a while; the notification is how you watch it from
      // outside Vex, and Android 13+ wants that asked for.
      try { await VexBridge.requestPermission('notifications'); } catch { /* the download does not need it */ }
      state.downloading = { name, received: 0, total: -1 };
      changed();
      return VexBridge.localAI('download', { name, url, headers });
    },

    cancelDownload() {
      state.downloading = null;
      changed();
      return VexBridge.localAI('cancelDownload', {}).catch(() => ({}));
    },

    /**
     * A .litertlm already on the device — the file Vex itself downloaded. The
     * picker and the copy both happen natively: three gigabytes cannot come
     * through the bridge, and the chrome has no business holding it.
     */
    async importFile(name) {
      const result = await VexBridge.localAI('pickModel', { name });
      return !!(result && result.picked);
    },

    async remove(name) {
      await VexBridge.localAI('deleteModel', { name });
      if (chosenModel() === name) await VexStore.set('vex.localModel', '');
      await refresh();
    },

    // ── Nano ───────────────────────────────────────────────────────────────

    nanoDownload() { return VexBridge.localAI('nanoDownload', {}); },

    async nanoSummarize(text, bullets = 3) {
      const result = await VexBridge.localAI('nanoSummarize', { text, bullets });
      return String((result && result.text) || '').trim();
    },

    async nanoProofread(text) {
      const result = await VexBridge.localAI('nanoProofread', { text });
      return String((result && result.text) || '').trim();
    },

    async nanoRewrite(text, style = 'rephrase') {
      const result = await VexBridge.localAI('nanoRewrite', { text, style });
      return String((result && result.text) || '').trim();
    },

    /** Wired once at boot: the download's progress and outcome. */
    bind() {
      VexBridge.onLocalAI('modelProgress', data => {
        if (!data || !data.name) return;
        state.downloading = { name: data.name, received: Number(data.received) || 0, total: Number(data.total) || -1 };
        changed();
      });
      VexBridge.onLocalAI('modelReady', async data => {
        state.downloading = null;
        state.lastError = '';
        await refresh();
        if (!chosenModel() && data && data.name) await VexStore.set('vex.localModel', data.name);
        VexUI.toast('The model is on your phone');
        changed();
      });
      VexBridge.onLocalAI('modelFailed', data => {
        state.downloading = null;
        state.lastError = (data && data.message) || 'The download failed';
        if (state.lastError !== 'cancelled') VexUI.toast(state.lastError);
        changed();
      });
    }
  };
})();

if (typeof window !== 'undefined') window.VexLocalAI = VexLocalAI;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLocalAI };
