// === Dictation — speak, and it is typed ======================================
//
// Electron has no speech recognition of its own (Chrome's sends your voice to
// Google with a key Electron does not have). So Vex runs Whisper itself, on
// this PC: the model is downloaded once, from Hugging Face, after you say so;
// from then on it works offline and nothing you say leaves the computer.
//
// Ctrl+Alt+D (or Ctrl+K "Dictate") starts listening; the same again, or Stop,
// ends it and the words are typed where the cursor was — a box in a web page
// or in Vex itself. Esc throws the recording away.
//
// It runs on the graphics card when there is one to spare, and on the
// processor while a game is running (Vex's game detection), so dictating
// never costs a game frames. The model is let go two minutes after the last
// use, so it does not sit in memory.

const Dictation = {
  MODELS: {
    base:  { id: 'onnx-community/whisper-base', label: 'Base', mb: 73, note: 'fast; good for English' },
    small: { id: 'onnx-community/whisper-small', label: 'Small', mb: 238, note: 'slower; clearly better, especially for other languages' },
  },
  LANGUAGES: [['', 'Detect it'], ['english', 'English'], ['arabic', 'Arabic'], ['french', 'French'], ['spanish', 'Spanish'], ['german', 'German'], ['turkish', 'Turkish'], ['italian', 'Italian'], ['portuguese', 'Portuguese'], ['dutch', 'Dutch'], ['russian', 'Russian'], ['hindi', 'Hindi'], ['urdu', 'Urdu'], ['chinese', 'Chinese'], ['japanese', 'Japanese']],
  MODEL_KEY: 'vex.dictation.model',
  LANG_KEY: 'vex.dictation.language',
  READY_KEY: 'vex.dictation.ready.',          // + model: downloaded once, and allowed
  MAX_SECONDS: 300,
  IDLE_UNLOAD_MS: 2 * 60 * 1000,
  RATE: 16000,

  _asr: null, _asrKey: '', _unloadTimer: null, _session: null,

  model() { const m = localStorage.getItem(this.MODEL_KEY); return this.MODELS[m] ? m : 'base'; },
  language() { const l = localStorage.getItem(this.LANG_KEY) || ''; return this.LANGUAGES.some(([v]) => v === l) ? l : ''; },
  isReady(model = this.model()) { return localStorage.getItem(this.READY_KEY + model) === '1'; },

  // Graphics card unless a game has it (or there is none).
  device() {
    const gaming = !!(window.GameMode && window.GameMode.gaming);
    return !gaming && navigator.gpu ? 'webgpu' : 'wasm';
  },

  // --- the recording's audio -------------------------------------------------------
  // Chunks of 16 kHz mono → one Float32Array.
  join(chunks) {
    const n = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Float32Array(n);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  },

  // Whisper's text: trimmed, and nothing when it heard nothing. Whisper
  // answers silence with stock phrases; those are not dictation.
  clean(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || /^[\s.,!?…-]*$/.test(t) || /^\[?\(?\s*(blank_audio|silence|music|inaudible)\s*\)?\]?$/i.test(t)) return '';
    return t;
  },

  // Where the words go: the box that had the cursor when you started.
  _target() {
    const el = document.activeElement;
    if (el && el.tagName !== 'WEBVIEW' && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url|email|)$/i.test(el.type || '')) || el.isContentEditable)) return { kind: 'ui', el };
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    if (wv) return { kind: 'page', wv };
    return null;
  },

  // Insert into a Vex box, with a space before it when the text runs on.
  insertInto(el, text) {
    if (el.isContentEditable) { el.focus(); document.execCommand('insertText', false, text); return; }
    const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const words = (before && !/\s$/.test(before) ? ' ' : '') + text;
    el.focus();
    el.setRangeText(words, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },

  // --- the model ---------------------------------------------------------------------
  async _load(onProgress) {
    const model = this.model(), device = this.device();
    const key = model + '@' + device;
    if (this._asr && this._asrKey === key) return this._asr;
    await this._unload();
    const T = await import(new URL('vendor/runtime/transformers.mjs', window.location.href).href);
    T.env.allowLocalModels = false;
    T.env.backends.onnx.wasm.wasmPaths = new URL('vendor/runtime/', window.location.href).href;
    const files = new Map();
    this._asr = await T.pipeline('automatic-speech-recognition', this.MODELS[model].id, {
      device, dtype: 'q8',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) { files.set(p.file, [p.loaded, p.total]); const [l, t] = [...files.values()].reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]); onProgress && onProgress(l / t); }
      },
    });
    this._asrKey = key;
    localStorage.setItem(this.READY_KEY + model, '1');
    return this._asr;
  },

  async _unload() {
    clearTimeout(this._unloadTimer);
    const asr = this._asr;
    this._asr = null; this._asrKey = '';
    if (asr && typeof asr.dispose === 'function') await asr.dispose();
  },

  _idle() {
    clearTimeout(this._unloadTimer);
    this._unloadTimer = setTimeout(() => { this._unload().catch(err => console.warn('[Dictation] could not let the model go', err)); }, this.IDLE_UNLOAD_MS);
  },

  // Ask before the first download of a model.
  async _allowed() {
    const model = this.model();
    if (this.isReady(model)) return true;
    const m = this.MODELS[model];
    return window.vexConfirm({
      title: 'Download the speech model?',
      message: `Dictation runs Whisper ${m.label} on this PC. It is ${m.mb} MB, downloaded once from Hugging Face; after that it works offline and nothing you say leaves this computer.`,
      okLabel: 'Download and dictate',
    });
  },

  // --- listening ---------------------------------------------------------------------
  toggle() { return this._session ? this.stop() : this.start(); },

  async start() {
    if (this._session) return;
    const target = this._target();
    if (!target) throw new Error('Click into a text box first, then dictate');
    if (!(await this._allowed())) return;
    const pill = this._pill();
    const session = { target, chunks: [], pill, started: Date.now(), stream: null, ctx: null, cancelled: false };
    this._session = session;
    try {
      // Load (and download, the first time) while the microphone opens.
      // It records while the model downloads; the pill says both.
      session.loading = this._load((f) => { if (!session.stopping) pill.say('Listening — the speech model is downloading, ' + Math.round(f * 100) + '%'); });
      session.loading.then(
        () => { if (this._session === session && !session.stopping) pill.listening(); },
        // A failed download is said at once, in the pill; Stop reports it too.
        (err) => pill.say('The speech model could not load: ' + ((err && err.message) || 'unknown error')));
      session.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      session.ctx = new AudioContext({ sampleRate: this.RATE });
      const src = session.ctx.createMediaStreamSource(session.stream);
      const proc = session.ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        session.chunks.push(new Float32Array(data));
        let sum = 0; for (let i = 0; i < data.length; i += 16) sum += data[i] * data[i];
        pill.level(Math.min(1, Math.sqrt(sum / (data.length / 16)) * 6));
        if ((Date.now() - session.started) / 1000 > this.MAX_SECONDS) this.stop();
      };
      src.connect(proc); proc.connect(session.ctx.destination);
      session.proc = proc;
      pill.listening();
    } catch (err) {
      this._end(session);
      throw new Error(err && err.name === 'NotAllowedError' ? 'Vex could not use the microphone — check Windows Settings › Privacy › Microphone' : ((err && err.message) || 'Could not start dictation'), { cause: err });
    }
  },

  cancel() {
    const s = this._session;
    if (!s) return;
    s.cancelled = true;
    this._end(s);
    window.showToast?.('Dictation thrown away');
  },

  async stop() {
    const s = this._session;
    if (!s || s.stopping) return;
    s.stopping = true;
    const audio = this.join(s.chunks);
    this._release(s);
    if (audio.length < this.RATE * 0.4) { this._end(s); window.showToast?.('Nothing was recorded'); return; }
    s.pill.say('Writing it down…');
    try {
      const asr = await s.loading;
      const lang = this.language();
      const out = await asr(audio, { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, ...(lang ? { language: lang } : {}) });
      if (s.cancelled) return;
      const text = this.clean(out && out.text);
      this._end(s);
      if (!text) { window.showToast?.('No words were heard'); return; }
      this._deliver(s.target, text);
    } catch (err) {
      this._end(s);
      window.showToast?.('Dictation failed: ' + ((err && err.message) || 'unknown error'), 'error');
    } finally {
      this._idle();
    }
  },

  _deliver(target, text) {
    if (target.kind === 'ui' && target.el.isConnected) { this.insertInto(target.el, text); return; }
    if (target.kind === 'page') {
      // Typed into whatever has the cursor in that page, as if from the keyboard.
      target.wv.focus();
      target.wv.insertText(text);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => window.showToast?.('The box you were typing in is gone — the words are on the clipboard'),
      (err) => window.showToast?.('Could not place the words: ' + err.message, 'error'));
  },

  _release(s) {
    if (s.proc) { s.proc.onaudioprocess = null; s.proc.disconnect(); }
    if (s.stream) s.stream.getTracks().forEach(t => t.stop());
    if (s.ctx) s.ctx.close().catch(err => console.warn('[Dictation] audio context did not close', err));
    s.proc = null; s.stream = null; s.ctx = null;
  },

  _end(s) {
    this._release(s);
    s.pill.remove();
    if (this._session === s) this._session = null;
  },

  // The small floating control while listening.
  _pill() {
    document.getElementById('vex-dictation')?.remove();
    const el = document.createElement('div');
    el.id = 'vex-dictation';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:99500;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-radius:999px;background:var(--surface);border:1px solid var(--border);box-shadow:0 10px 30px var(--vex-shadow-color,rgba(0,0,0,0.35));font-size:12.5px;color:var(--text)';
    el.innerHTML = `
      <span style="display:inline-flex;color:var(--danger,#e5534b)">${VexIcons.svg('mic', { size: 15 })}</span>
      <span data-bar style="width:46px;height:6px;border-radius:3px;background:var(--border);overflow:hidden"><span style="display:block;height:100%;width:0;background:var(--primary)"></span></span>
      <span data-text>Opening the microphone…</span>
      <button data-stop type="button" style="font:inherit;font-size:12px;padding:4px 11px;border-radius:999px;border:none;background:var(--primary);color:#fff;cursor:pointer">Stop</button>
      <button data-cancel type="button" aria-label="Throw it away" title="Throw it away (Esc)" style="display:inline-flex;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:3px">${VexIcons.svg('x', { size: 13 })}</button>`;
    // Keep the cursor where it was: clicking the pill must not take focus.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.querySelector('[data-stop]').addEventListener('click', () => this.stop());
    el.querySelector('[data-cancel]').addEventListener('click', () => this.cancel());
    const onKey = (e) => { if (e.key === 'Escape' && this._session) { e.preventDefault(); this.cancel(); } };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(el);
    const bar = el.querySelector('[data-bar] span');
    return {
      say: (t) => { el.querySelector('[data-text]').textContent = t; },
      level: (v) => { bar.style.width = Math.round(v * 100) + '%'; },
      listening: () => { el.querySelector('[data-text]').textContent = 'Listening — Stop or Ctrl+Alt+D when done'; },
      remove: () => { document.removeEventListener('keydown', onKey, true); el.remove(); },
    };
  },

  // --- settings --------------------------------------------------------------------------
  openSettings() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { body } = window.PageExport._sheet('Dictation', 'vex-dictation-overlay');
    const field = 'font:inherit;font-size:12.5px;padding:6px 8px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text)';
    const draw = () => {
      body.innerHTML = `
        <div style="padding:12px 14px;display:grid;gap:12px;font-size:12.5px;color:var(--text)">
          <div>Press <b>Ctrl+Alt+D</b> (or Ctrl+K › Dictate) with the cursor in a text box, speak, and press it again. The words are typed where the cursor was. Esc throws the recording away.</div>
          <label style="display:grid;gap:4px">Model
            <select data-model style="${field}">${Object.entries(this.MODELS).map(([k, m]) => `<option value="${k}" ${k === this.model() ? 'selected' : ''}>${esc(m.label)} — ${m.mb} MB, ${esc(m.note)}${this.isReady(k) ? ' (downloaded)' : ''}</option>`).join('')}</select></label>
          <label style="display:grid;gap:4px">Language you speak
            <select data-lang style="${field}">${this.LANGUAGES.map(([v, l]) => `<option value="${v}" ${v === this.language() ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <div style="font-size:11.5px;color:var(--text-muted)">Runs on this PC — on the graphics card, or on the processor while a game is running. The model is downloaded once from Hugging Face and then works offline; nothing you say is sent anywhere.</div>
          <div><button data-forget type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer">Remove downloaded models</button></div>
        </div>`;
      body.querySelector('[data-model]').addEventListener('change', (e) => { localStorage.setItem(this.MODEL_KEY, e.target.value); this._unload(); });
      body.querySelector('[data-lang]').addEventListener('change', (e) => localStorage.setItem(this.LANG_KEY, e.target.value));
      body.querySelector('[data-forget]').addEventListener('click', async () => {
        const ok = await window.vexConfirm({ title: 'Remove the speech models?', message: 'They are deleted from this PC. Dictating again downloads one again, after asking.', okLabel: 'Remove', danger: true });
        if (!ok) return;
        await this._unload();
        await caches.delete('transformers-cache');
        for (const k of Object.keys(this.MODELS)) localStorage.removeItem(this.READY_KEY + k);
        window.showToast?.('Speech models removed');
        draw();
      });
    };
    draw();
    return body;
  },
};

if (typeof window !== 'undefined') window.Dictation = Dictation;
if (typeof module !== 'undefined') module.exports = { Dictation };
