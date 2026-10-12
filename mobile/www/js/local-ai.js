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
// The catalogue is the Google AI Edge Gallery's own (model_allowlists, 1.0.19):
// the same files, pinned to the same commits, so a download is byte-for-byte
// what the Gallery would fetch. Hugging Face serves them directly. Gemma 3 and
// FunctionGemma are behind a licence you accept once on the model's page; for
// those Vex asks for a Hugging Face read token (kept on this phone, sent only
// to huggingface.co). The rest download with no account at all.

const VexLocalAI = (() => {
  // The system prompt for on-device chat. A 1B model does not need telling what
  // it is twice, and every token here is a token of page text it cannot have.
  const SYSTEM = 'You are Vex, a browser assistant running on this phone. '
    + 'Answer briefly and directly in plain text. Use the page text when it is given.';

  // A small model's whole context is often 1280 tokens. Sending it the 6000
  // characters the worker gets would push the question out of the window.
  const PAGE_LIMIT = 2400;

  const HF = 'https://huggingface.co/';
  const hf = (repo, commit, file) => HF + repo + '/resolve/' + commit + '/' + file + '?download=true';

  // tasks: which of the AI Lab's features a model can do — the Gallery's
  // taskTypes, renamed. config: the Gallery's defaults for it.
  const MODELS = [
    {
      id: 'gemma4-e2b', name: 'gemma-4-E2B-it.litertlm', label: 'Gemma 4 E2B',
      repo: 'litert-community/gemma-4-E2B-it-litert-lm', commit: '6e5c4f1e395deb959c494953478fa5cec4b8008f',
      bytes: 2588147712, ram: 8, family: 'Gemma 4', image: true, audio: true,
      tasks: ['chat', 'prompt', 'agent', 'image', 'audio'],
      config: { topK: 64, topP: 0.95, temperature: 1.0, maxTokens: 4000 },
      note: 'Sees, hears and uses tools. The one to start with on a flagship.'
    },
    {
      id: 'gemma4-e4b', name: 'gemma-4-E4B-it.litertlm', label: 'Gemma 4 E4B',
      repo: 'litert-community/gemma-4-E4B-it-litert-lm', commit: '28299f30ee4d43294517a4ac93abd6163412f07f',
      bytes: 3659530240, ram: 12, family: 'Gemma 4', image: true, audio: true,
      tasks: ['chat', 'prompt', 'agent', 'image', 'audio'],
      config: { topK: 64, topP: 0.95, temperature: 1.0, maxTokens: 4000 },
      note: 'The strongest Gemma a phone runs. Wants 12 GB of memory.'
    },
    {
      id: 'gemma3n-e2b', name: 'gemma-3n-E2B-it-int4.litertlm', label: 'Gemma 3n E2B',
      aliases: ['Gemma3n-E2B-it.litertlm'],
      repo: 'google/gemma-3n-E2B-it-litert-lm', commit: 'ba9ca88da013b537b6ed38108be609b8db1c3a16',
      bytes: 3655827456, ram: 8, family: 'Gemma 3n', image: true, audio: true, gated: true,
      tasks: ['chat', 'prompt', 'image', 'audio'],
      config: { topK: 64, topP: 0.95, temperature: 1.0, maxTokens: 4096 },
      note: 'Reads pictures and listens to audio.'
    },
    {
      id: 'gemma3n-e4b', name: 'gemma-3n-E4B-it-int4.litertlm', label: 'Gemma 3n E4B',
      repo: 'google/gemma-3n-E4B-it-litert-lm', commit: '297ed75955702dec3503e00c2c2ecbbf475300bc',
      bytes: 4919541760, ram: 12, family: 'Gemma 3n', image: true, audio: true, gated: true,
      tasks: ['chat', 'prompt', 'image', 'audio'],
      config: { topK: 64, topP: 0.95, temperature: 1.0, maxTokens: 4096 },
      note: 'Gemma 3n at its larger size: better answers, slower.'
    },
    {
      id: 'gemma3-1b', name: 'gemma3-1b-it-int4.litertlm', label: 'Gemma 3 1B',
      aliases: ['Gemma3-1B-IT.litertlm'],
      repo: 'litert-community/Gemma3-1B-IT', commit: '42d538a932e8d5b12e6b3b455f5572560bd60b2c',
      bytes: 584417280, ram: 6, family: 'Gemma 3', gated: true,
      tasks: ['chat', 'prompt'],
      config: { topK: 64, topP: 0.95, temperature: 1.0, maxTokens: 1024 },
      note: 'Small and quick on any phone. Text only.'
    },
    {
      id: 'tiny-garden', name: 'tiny_garden_q8_ekv1024.litertlm', label: 'FunctionGemma 270M · Tiny Garden',
      repo: 'litert-community/functiongemma-270m-ft-tiny-garden', commit: 'c205853ff82da86141a1105faa2344a8b176dfe7',
      bytes: 288964608, ram: 6, family: 'FunctionGemma', gated: true, cpuOnly: true,
      tasks: ['garden'],
      config: { topK: 64, topP: 0.95, temperature: 0, maxTokens: 1024 },
      note: 'Trained for one thing: turning what you say into garden moves.'
    },
    {
      id: 'mobile-actions', name: 'mobile_actions_q8_ekv1024.litertlm', label: 'FunctionGemma 270M · Mobile Actions',
      repo: 'litert-community/functiongemma-270m-ft-mobile-actions', commit: '38942192c9b723af836d489074823ff33d4a3e7a',
      bytes: 288964608, ram: 6, family: 'FunctionGemma', gated: true, cpuOnly: true,
      tasks: ['actions'],
      config: { topK: 64, topP: 0.95, temperature: 0, maxTokens: 1024 },
      note: 'Trained to turn a request into a phone action: torch, contact, email, map, Wi-Fi, calendar.'
    },
    {
      id: 'qwen2.5-1.5b', name: 'Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm', label: 'Qwen 2.5 1.5B',
      aliases: ['Qwen2.5-1.5B-Instruct.litertlm'],
      repo: 'litert-community/Qwen2.5-1.5B-Instruct', commit: '19edb84c69a0212f29a6ef17ba0d6f278b6a1614',
      bytes: 1597931520, ram: 6, family: 'Other',
      tasks: ['chat', 'prompt'],
      config: { topK: 20, topP: 0.8, temperature: 0.7, maxTokens: 4096 },
      note: 'A capable middle option. No licence to accept.'
    },
    {
      id: 'deepseek-r1-1.5b', name: 'DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm', label: 'DeepSeek R1 Distill 1.5B',
      repo: 'litert-community/DeepSeek-R1-Distill-Qwen-1.5B', commit: 'e34bb88632342d1f9640bad579a45134eb1cf988',
      bytes: 1833451520, ram: 6, family: 'Other',
      tasks: ['chat', 'prompt'],
      config: { topK: 64, topP: 0.95, temperature: 1.0, maxTokens: 4096 },
      note: 'Thinks out loud before it answers. No licence to accept.'
    },
    {
      id: 'phi4-mini', name: 'Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.litertlm', label: 'Phi-4 mini',
      repo: 'litert-community/Phi-4-mini-instruct', commit: '054f4e2694a86f81a129a40596e08b8d74770a9d',
      bytes: 3910090752, ram: 6, family: 'Other',
      tasks: ['chat', 'prompt'],
      config: { topK: 64, topP: 0.95, temperature: 1.0, maxTokens: 4096 },
      note: 'Microsoft\u2019s small model, from an older Gallery list. No licence to accept.'
    },
    {
      id: 'magic-touch', name: 'interactive_segmentation.task', label: 'Magic Touch (cut-outs)',
      url: 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task',
      bytes: 30525312, family: 'Tools', kind: 'segmenter',
      tasks: ['scrapbook'],
      note: 'Not a language model: MediaPipe\u2019s segmenter, which Scrapbook cuts photos with.'
    }
  ].map(entry => Object.assign({
    size: '~' + (entry.bytes >= 1e9 ? (entry.bytes / 1073741824).toFixed(1) + ' GB' : Math.round(entry.bytes / 1048576) + ' MB'),
    page: entry.repo ? HF + entry.repo : '',
    url: entry.repo ? hf(entry.repo, entry.commit, entry.name) : '',
    kind: 'llm'
  }, entry));

  const BACKENDS = [
    { id: 'gpu', label: 'GPU', note: 'Fastest where it works. Falls back on its own if it does not.' },
    { id: 'cpu', label: 'CPU', note: 'Always works. Slower, and warmer.' },
    { id: 'npu', label: 'NPU', note: 'Qualcomm only, and only with NPU libraries present.' }
  ];

  // What the plugin last told us, so a panel can draw without waiting.
  const state = {
    supported: false, loaded: false, busy: false,
    model: '', backend: '', models: {}, nano: 'unknown',
    vision: false, audio: false, recording: false, clipMillis: 0,
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
    return MODELS.find(entry => entry.name === name || entry.id === name
      || (entry.aliases || []).includes(name)) || null;
  }

  /** The file on the phone for a catalogue entry — its own name, or an older one. */
  function fileOf(entry) {
    if (!entry) return '';
    const here = state.models || {};
    if (here[entry.name] !== undefined) return entry.name;
    return (entry.aliases || []).find(name => here[name] !== undefined) || '';
  }

  function modelsFor(task) {
    return MODELS.filter(entry => entry.tasks.includes(task));
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

  // Asking is not a change. The On-device AI page redraws when this module
  // says something changed, and drawing it asks for the status — so saying
  // "changed" after every ask made the page redraw itself twice a second for
  // as long as it was open (seen on a Galaxy S25: the page jumping and the
  // Gemini Nano section blinking out). Only a real difference is announced.
  async function refresh() {
    // Asking is not an operation that can fail usefully: no answer is "nothing".
    const status = await VexBridge.localAI('status', {}).catch(() => ({}));
    const seen = () => JSON.stringify([state.supported, state.loaded, state.busy, state.model, state.backend,
      state.models, state.vision, state.audio, state.recording, state.clipMillis]);
    const before = seen();
    state.supported = !!(status && status.supported);
    state.loaded = !!(status && status.loaded);
    state.busy = !!(status && status.busy);
    state.model = (status && status.model) || '';
    state.backend = (status && status.backend) || '';
    state.models = (status && status.models) || {};
    state.vision = !!(status && status.vision);
    state.audio = !!(status && status.audio);
    state.recording = !!(status && status.recording);
    state.clipMillis = Number(status && status.clipMillis) || 0;
    if (!state.loaded) purpose = '';
    if (seen() !== before) changed();
    return state;
  }

  async function refreshNano() {
    const result = await VexBridge.localAI('nanoStatus', {}).catch(() => ({}));
    const before = state.nano;
    state.nano = (result && result.status) || 'unavailable';
    if (state.nano !== before) changed();
    return state.nano;
  }

  // ── Generation ───────────────────────────────────────────────────────────
  //
  // One engine, many uses. The engine holds the weights and is slow to build;
  // a conversation on it is cheap. Every feature — the assistant, Ask Image,
  // Tiny Garden — says what it wants with use(): which model, whether it needs
  // the image or audio reader, its system prompt, sampling and tools. Asking
  // for the same again is free; a different purpose on the same engine is a
  // new conversation; a different model, backend or reader is a reload.

  let nextId = 1;
  let purpose = '';            // what the conversation on the engine is for
  let toolHandler = null;      // who runs the tools that conversation declared
  let loading = null;          // one use() at a time

  function samplerOf(entry, override) {
    const config = Object.assign({}, (entry && entry.config) || {}, override || {});
    return config.topK
      ? { topK: Math.max(1, Math.round(config.topK)), topP: Number(config.topP), temperature: Number(config.temperature) }
      : {};
  }

  function backendFor(entry) {
    // The Gallery runs FunctionGemma on the CPU only; it is 270M parameters,
    // and the GPU path costs more to set up than it saves.
    return entry && entry.cpuOnly ? 'cpu' : chosenBackend();
  }

  async function use(key, options = {}) {
    while (loading) await loading.catch(() => {});
    const job = useNow(key, options);
    loading = job;
    try { return await job; } finally { if (loading === job) loading = null; }
  }

  async function useNow(key, options) {
    const name = options.model || chosenModel();
    if (!name) throw new Error('Choose a model first — AI Lab → Models.');
    if (!state.models || state.models[name] === undefined) {
      await refresh();
      if (!state.models || state.models[name] === undefined) {
        throw new Error((model(name) ? model(name).label : name) + ' is not on this phone yet.');
      }
    }
    const entry = model(name);
    const backend = options.backend || backendFor(entry);
    const vision = !!options.vision;
    const audio = !!options.audio;
    const chat = Object.assign({ system: options.system || '' }, samplerOf(entry, options.sampler),
      { tools: options.tools && options.tools.length ? JSON.stringify(options.tools) : '' });
    // An engine with readers this use does not need still serves it: the
    // assistant can talk to a model Ask Image loaded with its eyes open.
    const engineFits = state.loaded && state.model === name
      && (options.backend ? state.backend === backend : true)
      && (!vision || state.vision) && (!audio || state.audio);
    const fresh = options.fresh || purpose !== key || !engineFits;
    toolHandler = options.onTool || null;
    if (!fresh) return state;
    try {
      const result = engineFits
        ? await VexBridge.localAI('reset', chat)
        : await VexBridge.localAI('load', Object.assign({
          name, backend, vision, audio,
          maxTokens: (entry && entry.config && entry.config.maxTokens) || 0
        }, chat));
      adopt(result, name, backend);
      purpose = key;
      return state;
    } catch (error) {
      state.lastError = error.message || String(error);
      // A GPU that cannot take this model is the common failure, and the
      // answer is the CPU — try it once rather than reporting defeat.
      if (!engineFits && backend !== 'cpu') {
        try {
          const result = await VexBridge.localAI('load', Object.assign({
            name, backend: 'cpu', vision, audio,
            maxTokens: (entry && entry.config && entry.config.maxTokens) || 0
          }, chat));
          adopt(result, name, 'cpu');
          purpose = key;
          // Remembered, so the next load does not fail on the GPU first.
          if (!options.backend && backend === chosenBackend()) await VexStore.set('vex.localBackend', 'cpu');
          return state;
        } catch (second) {
          state.lastError = second.message || String(second);
        }
      }
      purpose = '';
      changed();
      throw new Error(state.lastError);
    }
  }

  function adopt(result, name, backend) {
    state.loaded = !!(result && result.loaded);
    state.model = (result && result.model) || name;
    state.backend = (result && result.backend) || backend;
    state.vision = !!(result && result.vision);
    state.audio = !!(result && result.audio);
    state.lastError = '';
    changed();
  }

  // The assistant's own conversation: its prompt, the model's own sampling.
  async function ensureLoaded() {
    const name = chosenModel();
    if (!name) return false;
    try {
      await use('assistant', { model: name, system: SYSTEM });
      return state.loaded;
    } catch {
      return false;
    }
  }

  async function runTool(data) {
    let result;
    try {
      let args = {};
      try { args = JSON.parse((data && data.args) || '{}') || {}; } catch { args = {}; }
      result = toolHandler
        ? await toolHandler(String(data.name || ''), args)
        : { error: 'Nothing is listening for ' + data.name };
    } catch (error) {
      result = { error: error.message || String(error) };
    }
    await VexBridge.localAI('toolResult', {
      callId: data.callId,
      result: JSON.stringify(result === undefined ? { result: 'success' } : result)
    }).catch(() => {});
  }

  return {
    SYSTEM, MODELS, BACKENDS, CHAT_ACTIONS, state,
    mode, nanoMode, chosenModel, chosenBackend, model, fileOf, modelsFor, promptFor, refresh, refreshNano,
    use,
    purpose() { return purpose; },

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
      state.vision = false;
      state.audio = false;
      purpose = '';
      changed();
    },

    /**
     * Ask the model. `onToken` is called with each piece as it arrives, because
     * twenty seconds of nothing reads as a hang.
     */
    async generate(prompt, options = {}) {
      const key = options.purpose || 'assistant';
      if (key === 'assistant') {
        if (!await ensureLoaded()) {
          throw new Error(state.lastError || 'No on-device model is loaded.');
        }
      } else if (purpose !== key || !state.loaded) {
        throw new Error('Another feature took the model in the meantime — try again.');
      }
      const id = 'gen-' + (nextId++);
      let stop = null;
      if (options.onToken) {
        stop = VexBridge.onLocalAI('token', data => {
          if (data && data.id === id && data.text) options.onToken(data.text);
        });
      }
      try {
        const result = await VexBridge.localAI('generate', {
          id, prompt: String(prompt || ''),
          images: options.images || [],
          withClip: !!options.withClip
        });
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

    /** Download a catalogue entry from where the Gallery gets it. */
    async downloadModel(entry) {
      const token = entry.gated ? String(VexStore.get('vex.hfToken', '') || '') : '';
      return this.download(entry.name, entry.url, token);
    },

    hfToken() { return String(VexStore.get('vex.hfToken', '') || ''); },
    async setHfToken(value) { await VexStore.set('vex.hfToken', String(value || '').trim()); },

    // ── Pictures and sound ─────────────────────────────────────────────────

    async pickImage(capture = false) {
      const result = await VexBridge.localAI('pickImage', { capture, maxSide: 1024 });
      return result && result.picked ? result : null;
    },

    async recordAudio(onLevel) {
      if (!await VexBridge.requestPermission('microphone')) {
        throw new Error('Vex needs the microphone for this — allow it in Android settings.');
      }
      const stop = onLevel ? VexBridge.onLocalAI('audioLevel', data => onLevel(data || {})) : null;
      state.recording = true;
      changed();
      try {
        const result = await VexBridge.localAI('recordAudio', {});
        state.clipMillis = Number(result && result.millis) || 0;
        return state.clipMillis;
      } finally {
        if (stop) stop();
        state.recording = false;
        changed();
      }
    },

    stopAudio() { return VexBridge.localAI('stopAudio', {}).catch(() => ({})); },

    async importAudio() {
      const result = await VexBridge.localAI('importAudio', {});
      if (!result || !result.picked) return 0;
      state.clipMillis = Number(result.millis) || 0;
      changed();
      return state.clipMillis;
    },

    async clearAudio() {
      await VexBridge.localAI('clearAudio', {}).catch(() => ({}));
      state.clipMillis = 0;
      changed();
    },

    deviceAction(name, args) {
      return VexBridge.localAI('deviceAction', { name, args: JSON.stringify(args || {}) });
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

    /** Wired once at boot: the download's progress and outcome, and tool calls. */
    bind() {
      VexBridge.onLocalAI('toolCall', data => { if (data && data.callId) runTool(data); });
      VexBridge.onLocalAI('modelProgress', data => {
        if (!data || !data.name) return;
        state.downloading = { name: data.name, received: Number(data.received) || 0, total: Number(data.total) || -1 };
        changed();
      });
      VexBridge.onLocalAI('modelReady', async data => {
        state.downloading = null;
        state.lastError = '';
        await refresh();
        // The first chat model to arrive becomes the assistant's; the cut-out
        // model and the two FunctionGemmas cannot chat.
        const arrived = data && data.name ? model(data.name) : null;
        if (!chosenModel() && arrived && arrived.tasks.includes('chat')) await VexStore.set('vex.localModel', data.name);
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
