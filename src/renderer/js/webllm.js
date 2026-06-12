// === Vex On-Device AI (WebLLM / WebGPU) ===
//
// Runs a small LLM ENTIRELY on your machine via WebGPU — no server, no cloud,
// fully private and offline once the model is downloaded. Everything here is
// lazy and opt-in: the ~15 MB WebLLM runtime and the multi-GB model weights are
// fetched ONLY when you click "Download". WebGPU is feature-detected; if it's
// unavailable nothing loads and the rest of Vex is untouched. AIRouter routes
// chat-like features to this backend only when a model is loaded AND you've
// switched it on, and always falls back to cloud/Ollama on any failure.

const WebLLM = (() => {
  // Curated prebuilt MLC models — small enough to run on a typical laptop GPU.
  const MODELS = [
    { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', name: 'Llama 3.2 1B', size: '~0.9 GB', note: 'Fastest, lightest' },
    { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B', size: '~1.0 GB', note: 'Good all-rounder' },
    { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 3B', size: '~1.8 GB', note: 'Best quality (needs a real GPU)' },
    { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', name: 'Phi 3.5 mini', size: '~2.2 GB', note: 'Strong reasoning' },
  ];
  const LIB_URL = 'https://esm.run/@mlc-ai/web-llm';
  const MODEL_KEY = 'vex.webllmModel';
  const PREF_KEY = 'vex.preferOnDeviceAI';

  let _lib = null;          // the imported module
  let _engine = null;       // the loaded MLCEngine
  let _loadedId = null;     // which model is currently in the engine
  let _loading = false;
  let _onProgress = null;   // UI progress hook

  function isSupported() { try { return typeof navigator !== 'undefined' && !!navigator.gpu; } catch { return false; } }
  function isLoaded() { return !!_engine && !!_loadedId; }
  function isLoading() { return _loading; }
  function loadedModel() { return _loadedId; }
  function chosenModel() { try { return localStorage.getItem(MODEL_KEY) || MODELS[0].id; } catch { return MODELS[0].id; } }
  function setChosenModel(id) { try { localStorage.setItem(MODEL_KEY, id); } catch {} }
  function preferred() { try { return localStorage.getItem(PREF_KEY) === 'true'; } catch { return false; } }
  function setPreferred(v) { try { localStorage.setItem(PREF_KEY, v ? 'true' : 'false'); } catch {} }
  function models() { return MODELS; }
  function onProgress(fn) { _onProgress = fn; }

  async function ensureLib() {
    if (_lib) return _lib;
    // Dynamic import of the ESM build from CDN — only reached when the user
    // explicitly downloads a model.
    _lib = await import(/* @vite-ignore */ LIB_URL);
    return _lib;
  }

  // Download + initialize a model. Resolves when ready; reports progress via the
  // onProgress hook ({ progress: 0..1, text }).
  async function load(modelId) {
    if (!isSupported()) throw new Error('WebGPU is not available on this device/build.');
    modelId = modelId || chosenModel();
    if (_engine && _loadedId === modelId) return _loadedId;
    _loading = true;
    try {
      const lib = await ensureLib();
      // Reuse engine if present (reload weights); else create.
      const initProgressCallback = (p) => { try { _onProgress && _onProgress({ progress: p.progress || 0, text: p.text || '' }); } catch {} };
      if (_engine && typeof _engine.reload === 'function') {
        await _engine.reload(modelId);
      } else if (typeof lib.CreateMLCEngine === 'function') {
        _engine = await lib.CreateMLCEngine(modelId, { initProgressCallback });
      } else if (lib.MLCEngine) {
        _engine = new lib.MLCEngine({ initProgressCallback });
        await _engine.reload(modelId);
      } else {
        throw new Error('WebLLM runtime API not found.');
      }
      _loadedId = modelId;
      setChosenModel(modelId);
      return _loadedId;
    } finally {
      _loading = false;
    }
  }

  async function unload() {
    try { if (_engine && typeof _engine.unload === 'function') await _engine.unload(); } catch {}
    _engine = null; _loadedId = null;
  }

  // OpenAI-style chat. messages = [{role, content}]. Returns the assistant text.
  // Deliberately does NOT use response_format:json_object — grammar-constrained
  // generation hangs / badly slows the small models we ship in some WebLLM
  // builds. A timeout guards against any stall so the UI can never hang forever
  // (the router falls back to cloud/Ollama if this rejects).
  async function chat(messages, opts = {}) {
    if (!isLoaded()) throw new Error('No on-device model loaded.');
    const req = {
      messages,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.6,
      max_tokens: opts.maxTokens || 800,
    };
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('On-device generation timed out')), opts.timeoutMs || 120000); });
    try {
      const res = await Promise.race([_engine.chat.completions.create(req), timeout]);
      return res?.choices?.[0]?.message?.content || '';
    } finally { clearTimeout(timer); }
  }

  function init() { /* prefs are read lazily; nothing to download here */ }

  function renderSettings(container) {
    if (!container) return;
    if (!isSupported()) {
      container.innerHTML = `<p class="setting-info muted">On-device AI needs <strong>WebGPU</strong>, which isn't available on this device/build. The cloud and Ollama backends still work.</p>`;
      return;
    }
    const opts = MODELS.map(m => `<option value="${m.id}" ${chosenModel() === m.id ? 'selected' : ''}>${m.name} · ${m.size} — ${m.note}</option>`).join('');
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:8px">Run a small model <strong>entirely on your machine</strong> — private, offline, no server. The model downloads once (cached) and runs on your GPU. Nothing downloads until you press the button.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <select id="wl-model" style="min-width:230px">${opts}</select>
        <button id="wl-load" style="padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Download &amp; load</button>
        <button id="wl-unload" style="padding:8px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;display:${isLoaded() ? 'inline-block' : 'none'}">Unload</button>
      </div>
      <div id="wl-progress" style="display:none;margin:8px 0">
        <div style="height:8px;background:var(--bg);border-radius:5px;overflow:hidden;border:1px solid var(--border)"><div id="wl-bar" style="height:100%;width:0%;background:var(--primary);transition:width .2s"></div></div>
        <div id="wl-ptext" style="font-size:11px;color:var(--text-muted);margin-top:5px;font-family:'JetBrains Mono',monospace"></div>
      </div>
      <div id="wl-status" style="font-size:12.5px;color:${isLoaded() ? '#22c55e' : 'var(--text-muted)'};margin-bottom:8px">${isLoaded() ? '✓ ' + loadedModel() + ' loaded' : 'No model loaded.'}</div>
      <div class="setting-toggle-row"><span>Use on-device AI for chat</span><label class="toggle"><input type="checkbox" id="wl-prefer" ${preferred() ? 'checked' : ''} ${isLoaded() ? '' : 'disabled'}><span class="toggle-slider"></span></label></div>
      <p class="setting-info muted" style="margin-top:6px;font-size:11px">When on, AI chat runs locally on your GPU. Summaries, agent &amp; multi-tab still use cloud (small local models can't do those reliably). Falls back to cloud/Ollama automatically if anything fails or times out.</p>`;

    const bar = container.querySelector('#wl-bar');
    const ptext = container.querySelector('#wl-ptext');
    const prog = container.querySelector('#wl-progress');
    const status = container.querySelector('#wl-status');
    const preferToggle = container.querySelector('#wl-prefer');
    onProgress((p) => {
      prog.style.display = 'block';
      bar.style.width = Math.round((p.progress || 0) * 100) + '%';
      ptext.textContent = p.text || '';
    });
    container.querySelector('#wl-model').addEventListener('change', (e) => setChosenModel(e.target.value));
    container.querySelector('#wl-load').addEventListener('click', async () => {
      if (isLoading()) return;
      const id = container.querySelector('#wl-model').value;
      status.textContent = '⏳ Preparing… first run downloads the model (this can take a few minutes).';
      status.style.color = 'var(--text-muted)';
      try {
        await load(id);
        status.textContent = '✓ ' + loadedModel() + ' loaded — ready';
        status.style.color = '#22c55e';
        preferToggle.disabled = false;
        container.querySelector('#wl-unload').style.display = 'inline-block';
        window.showToast?.('🧠 On-device model ready');
      } catch (err) {
        status.textContent = '✕ ' + (err.message || 'Load failed');
        status.style.color = '#fca5a5';
        window.showToast?.('On-device load failed: ' + (err.message || 'error'));
      } finally { prog.style.display = 'none'; }
    });
    container.querySelector('#wl-unload').addEventListener('click', async () => {
      await unload(); setPreferred(false);
      window.showToast?.('On-device model unloaded');
      renderSettings(container);
    });
    preferToggle.addEventListener('change', (e) => { setPreferred(e.target.checked && isLoaded()); window.showToast?.(e.target.checked ? '🧠 Using on-device AI' : 'On-device AI off'); });
  }

  return { MODELS, models, isSupported, isLoaded, isLoading, loadedModel, chosenModel, setChosenModel, preferred, setPreferred, onProgress, load, unload, chat, init, renderSettings };
})();

if (typeof window !== 'undefined') window.WebLLM = WebLLM;
if (typeof module !== 'undefined' && module.exports) module.exports = { WebLLM };
