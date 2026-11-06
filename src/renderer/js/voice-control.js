// === Voice control: say a command, or dictate ==============================================
//
// Hold the key (default Ctrl+Alt+Shift+V; Ctrl+Alt+V is taken by "Next project space") or press the microphone button,
// and speak. Two things can happen to what you said:
//   COMMAND   it is matched to a Ctrl+K command (js/voice-match.js). Clear match: shown with the words heard for one second,
//             with Cancel, then run. Not sure: "Did you mean ..." with up to three commands to click. Anything that deletes,
//             clears, sends, buys, signs out, closes everything or quits: ALWAYS asks first, never runs on one utterance.
//   DICTATE   the words are shown in a box you can correct, and typed into the focused field only when you press Insert.
//             Never into a password, one-time-code or card field, and never into a page that is not what you spoke to.
//
// Everything is local. The engine is whisper.cpp, downloaded on request and checked against a pinned SHA-256
// (src/main/voice-model.js); it runs as a short-lived child process of the main process (voice-engine.js) and the audio goes
// to it through a named pipe, never to a file. There is no Web Speech API here (Chromium would send the audio to Google).
//
// The microphone is opened ONLY while you hold the key or have started listening, and it is closed the moment the
// recording ends (silence, the hard maximum, Stop, Cancel or Esc). A red panel stays on screen the whole time (and Windows shows
// its own microphone indicator). The audio lives in this window's memory as numbers until it is handed to the engine, then
// it is dropped; it is never written anywhere and never logged. There is no wake word: nothing listens until you ask.
//
// The microphone permission here is Vex's own window only (main/permissions.js); a web page is never given this microphone
// by this feature.
//
// Pure parts (floatToPcm16, createEndpointer, isSecretField, pageProbe) are tested without a window; the whole flow is tested
// with a fake microphone; the real window is driven with a pre-recorded clip through a test seam that only exists in a source run.
const VexVoice = {
  FEATURE: 'voice-control',
  KEYS: {
    enabled: 'vex.voice.enabled', language: 'vex.voice.language', model: 'vex.voice.model',
    mic: 'vex.voice.mic', mode: 'vex.voice.mode', silence: 'vex.voice.silenceSec',
  },
  RATE: 16000,
  MAX_SECONDS: 30,                // the hard maximum of one recording
  NO_SPEECH_SECONDS: 6,           // nobody spoke: stop
  VOICE_LEVEL: 0.015,
  MIN_VOICE_MS: 120,
  GRACE_MS: 1000,                 // the recognised words and the chosen command are shown this long before it runs
  HOLD_MS: 350,                   // a key held longer than this is push-to-talk: releasing it ends the recording
  ANSWER_SECONDS: 6,
  HOTKEY_ID: 'voice-control',

  // ---- settings ---------------------------------------------------------------------------------
  _get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; }
    catch (err) { console.error('[Voice] a setting could not be read:', err); return fallback; }
  },
  enabled() { return this._get(this.KEYS.enabled, 'false') === 'true'; },
  setEnabled(on) {
    localStorage.setItem(this.KEYS.enabled, on ? 'true' : 'false');
    if (!on && this._run) this.cancel();
    this.registerCommands();
    this.syncButton();
  },
  language() { const v = this._get(this.KEYS.language, 'auto'); return ['auto', 'tr', 'en'].includes(v) ? v : 'auto'; },
  model() { const v = this._get(this.KEYS.model, 'base'); return ['base', 'small'].includes(v) ? v : 'base'; },
  mode() { const v = this._get(this.KEYS.mode, 'auto'); return ['auto', 'command', 'dictate'].includes(v) ? v : 'auto'; },
  micId() { return this._get(this.KEYS.mic, ''); },
  silenceSeconds() { const n = Number(this._get(this.KEYS.silence, '1.5')); return [1, 1.5, 2.5].includes(n) ? n : 1.5; },

  _t(en, ...args) {
    let text = en;
    try { if (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup) { const hit = VexI18nUI.lookup(en); if (hit != null) text = hit; } }
    catch (err) { console.warn('[Voice] a text could not be translated:', err && err.message); }
    return text.replace(/\{(\d)\}/g, (all, n) => (args[n - 1] != null ? args[n - 1] : all));
  },
  _api(name) {
    const f = typeof window !== 'undefined' && window.vex && window.vex[name];
    if (typeof f !== 'function') throw new Error('Voice control is not available in this window');
    return f;
  },

  // ---- pure parts -------------------------------------------------------------------------------
  // Float samples in -1..1 -> 16-bit little-endian PCM bytes.
  floatToPcm16(samples) {
    const out = new Uint8Array(samples.length * 2), v = new DataView(out.buffer);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return out;
  },
  level(samples) {
    if (!samples.length) return 0;
    let sum = 0, n = 0;
    for (let i = 0; i < samples.length; i += 4) { sum += samples[i] * samples[i]; n++; }
    return Math.sqrt(sum / n);
  },

  // Decides when a recording ends, from the audio alone and the number of samples (so it behaves the same on any machine).
  // push(block) -> { level, voiced, stop: null | 'silence' | 'no-speech' | 'max' }
  createEndpointer({ rate = this.RATE, silenceS = this.silenceSeconds(), maxS = this.MAX_SECONDS, noSpeechS = this.NO_SPEECH_SECONDS, voiceLevel = this.VOICE_LEVEL, minVoiceMs = this.MIN_VOICE_MS } = {}) {
    let samples = 0, voicedSamples = 0, quiet = 0, heard = false;
    const self = this;
    return {
      push(block) {
        const lv = self.level(block);
        samples += block.length;
        if (lv >= voiceLevel) { voicedSamples += block.length; quiet = 0; if (voicedSamples >= rate * minVoiceMs / 1000) heard = true; }
        else if (heard) quiet += block.length;
        let stop = null;
        if (samples >= rate * maxS) stop = 'max';
        else if (heard && quiet >= rate * silenceS) stop = 'silence';
        else if (!heard && samples >= rate * noSpeechS) stop = 'no-speech';
        return { level: lv, voiced: heard, stop };
      },
      seconds: () => samples / rate,
      heard: () => heard,
    };
  },

  // A field that holds a secret: Voice control never types into it.
  isSecretField(el) {
    if (!el || String(el.tagName).toUpperCase() !== 'INPUT') return false;
    const type = String(el.type || '').toLowerCase();
    const ac = String((el.getAttribute && el.getAttribute('autocomplete')) || '').toLowerCase();
    return type === 'password' || /current-password|new-password|one-time-code|\bcc-/.test(ac);
  },
  isEditable(el) {
    if (!el) return false;
    const tag = String(el.tagName).toUpperCase();
    if (tag === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (tag === 'INPUT') return !el.readOnly && !el.disabled && /^(text|search|url|email|tel|)$/i.test(el.type || '');
    return !!el.isContentEditable;
  },
  // Run inside a page (webview.executeJavaScript) to learn what has the cursor there.
  PAGE_PROBE: "(() => { const e = document.activeElement; if (!e) return 'none'; const t = String(e.tagName || '').toLowerCase(); const ty = String(e.type || '').toLowerCase(); const ac = String((e.getAttribute && e.getAttribute('autocomplete')) || '').toLowerCase(); if (t === 'input' && (ty === 'password' || /current-password|new-password|one-time-code|\\bcc-/.test(ac))) return 'secret'; if ((t === 'textarea' || t === 'input') && (e.readOnly || e.disabled)) return 'none'; if (t === 'textarea' || e.isContentEditable || (t === 'input' && /^(text|search|url|email|tel|)$/.test(ty))) return 'ok'; return 'none'; })()",

  // ---- the words that go to the matcher ----------------------------------------------------------
  // Commands the voice may pick: shown ones, without Voice control's own commands.
  _commands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return [];
    return CommandBar.commands.filter(c => c && c.id && !String(c.id).startsWith('voice-') && typeof c.action === 'function' && (typeof CommandBar._shown !== 'function' || CommandBar._shown(c)));
  },
  _aliases() {
    try {
      if (typeof VexAliases === 'undefined' || !VexAliases.prefs().enabled) return null;
      const store = VexAliases.load ? VexAliases.load() : null;
      if (!store || !store.aliases) return null;
      const out = {};
      for (const [w, a] of Object.entries(store.aliases)) if (a && a.id) out[w] = a.id;
      return out;
    } catch (err) { console.warn('[Voice] the shortcut words could not be read:', err && err.message); return null; }
  },
  decide(text) {
    if (typeof VexVoiceMatch === 'undefined') throw new Error('Voice control: the command matcher is missing');
    return VexVoiceMatch.decide(text, this._commands(), { aliases: this._aliases() });
  },

  // ---- the panel ---------------------------------------------------------------------------------
  _css() {
    if (document.getElementById('vex-voice-css')) return;
    const st = document.createElement('style');
    st.id = 'vex-voice-css';
    st.textContent = `
#vex-voice-panel{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99600;width:min(460px,calc(100vw - 32px));box-sizing:border-box;padding:12px 14px;border-radius:14px;background:var(--surface);color:var(--text);border:2px solid var(--danger,#d93025);box-shadow:0 12px 36px var(--vex-shadow-color,rgba(0,0,0,.4));font-size:13px;display:grid;gap:8px}
#vex-voice-panel[data-state="working"],#vex-voice-panel[data-state="result"]{border-color:var(--border)}
#vex-voice-panel .vv-head{display:flex;align-items:center;gap:8px;font-weight:600}
#vex-voice-panel .vv-dot{width:12px;height:12px;border-radius:50%;background:var(--danger,#d93025);flex:none}
#vex-voice-panel[data-state="listening"] .vv-dot{animation:vv-pulse 1.2s ease-in-out infinite}
#vex-voice-panel[data-state="working"] .vv-dot,#vex-voice-panel[data-state="result"] .vv-dot{background:var(--text-muted)}
@keyframes vv-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){#vex-voice-panel[data-state="listening"] .vv-dot{animation:none}}
#vex-voice-panel .vv-meter{height:8px;border-radius:4px;background:var(--border);overflow:hidden}
#vex-voice-panel .vv-meter>span{display:block;height:100%;width:0;background:var(--primary)}
#vex-voice-panel .vv-heard{font-size:14px}
#vex-voice-panel .vv-sub{color:var(--text-muted);font-size:12px}
#vex-voice-panel .vv-row{display:flex;gap:8px;flex-wrap:wrap}
#vex-voice-panel button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer}
#vex-voice-panel button.vv-primary{background:var(--primary);color:var(--on-primary,#fff);border-color:transparent}
#vex-voice-panel button.vv-danger{background:var(--danger,#d93025);color:#fff;border-color:transparent}
#vex-voice-panel button:focus-visible,#vex-voice-panel textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
#vex-voice-panel textarea{font:inherit;width:100%;box-sizing:border-box;min-height:64px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg,var(--surface));color:var(--text);resize:vertical}
#btn-voice[data-listening="true"]{color:var(--danger,#d93025)}`;
    // First in <head>, so a11y.css stays the last stylesheet.
    document.head.insertBefore(st, document.head.firstChild);
  },

  _panel(state) {
    this._css();
    let p = document.getElementById('vex-voice-panel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'vex-voice-panel';
      p.setAttribute('role', 'dialog');
      p.setAttribute('aria-label', this._t('Voice control'));
      p.addEventListener('mousedown', (e) => { if (!/^(TEXTAREA|INPUT)$/.test(e.target.tagName)) e.preventDefault(); });   // clicking the panel must not take the cursor out of the field you are speaking to
      document.body.appendChild(p);
      if (typeof VexLayer !== 'undefined' && VexLayer.track) VexLayer.track(p, { tier: 'panel', id: 'voice-control', keep: true });
    }
    p.dataset.state = state;
    p.textContent = '';
    return p;
  },
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  _head(p, title) {
    const h = this._el('div', 'vv-head');
    h.append(this._el('span', 'vv-dot'), this._el('span', '', title));
    h.firstChild.setAttribute('aria-hidden', 'true');
    p.appendChild(h);
    return h;
  },
  _button(label, onClick, kind) {
    const b = this._el('button', kind ? 'vv-' + kind : '', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  },
  _announce(text) {
    let live = document.getElementById('vex-voice-live');
    if (!live) {
      live = this._el('div');
      live.id = 'vex-voice-live';
      live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
      live.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden';
      document.body.appendChild(live);
    }
    live.textContent = text;
  },
  _close() {
    const p = document.getElementById('vex-voice-panel');
    if (p) p.remove();
    if (this._escHandler) { document.removeEventListener('keydown', this._escHandler, true); this._escHandler = null; }
    if (this._graceTimer) { clearTimeout(this._graceTimer); this._graceTimer = null; }
    this.syncButton();
  },
  _armEsc(fn) {
    if (this._escHandler) document.removeEventListener('keydown', this._escHandler, true);
    this._escHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fn(); }
    };
    document.addEventListener('keydown', this._escHandler, true);
  },

  // ---- where dictation goes ----------------------------------------------------------------------
  _target() {
    const el = document.activeElement;
    if (el && el.tagName !== 'WEBVIEW' && el.tagName !== 'BODY') {
      if (this.isSecretField(el)) return { kind: 'secret' };
      if (this.isEditable(el)) return { kind: 'ui', el };
      return null;
    }
    const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview) ? WebviewManager.getActiveWebview() : null;
    if (wv && el && el.tagName === 'WEBVIEW') return { kind: 'page', wv };
    return null;
  },
  async _probe(target) {
    if (target.kind === 'secret') return 'secret';
    if (target.kind === 'ui') return this.isSecretField(target.el) ? 'secret' : (target.el.isConnected && this.isEditable(target.el) ? 'ok' : 'none');
    if (target.kind === 'page') return String(await target.wv.executeJavaScript(this.PAGE_PROBE));
    return 'none';
  },
  async insert(target, text) {
    const state = await this._probe(target);
    if (state === 'secret') throw new Error(this._t('Voice control never types into a password or code field'));
    if (state !== 'ok') throw new Error(this._t('The field you were speaking to is gone. Click into a text box and try again'));
    if (target.kind === 'ui') {
      const el = target.el;
      if (el.isContentEditable) { el.focus(); document.execCommand('insertText', false, text); return; }
      const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
      const before = el.value.slice(0, start);
      el.focus();
      el.setRangeText((before && !/\s$/.test(before) ? ' ' : '') + text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    target.wv.focus();
    target.wv.insertText(text);
  },

  // ---- listening ---------------------------------------------------------------------------------
  _run: null,          // the recording / working / answering in progress

  isListening() { return !!this._run && this._run.phase === 'listening'; },
  isBusy() { return !!this._run; },

  async ready() {
    const st = await this._api('voiceStatus')();
    if (!st.platformOk) throw new Error(this._t('Voice control runs on Windows for now'));
    const m = st.models[this.model()];
    if (!st.engine.installed || !m || !m.installed) {
      const e = new Error(this._t('Voice control needs its speech engine and model first. Open Settings > Voice control to download them'));
      e.needsSetup = true;
      throw e;
    }
    return st;
  },

  // Starts a recording. Resolves when the whole thing (record, work out, show, run) is over.
  // How: 'key' (held), 'toggle' (button / Ctrl+K), 'clip' (the source-run test seam). kind: 'auto' | 'command' | 'dictate' | 'answer'.
  async listen({ kind = 'auto', how = 'toggle', clip = null, onAnswer = null } = {}) {
    if (!this.enabled()) throw new Error(this._t('Voice control is switched off in Settings'));
    if (this._run) { if (this._run.phase === 'listening') { this.finish(); return undefined; } throw new Error(this._t('Voice control is busy')); }
    let st;
    try { st = await this.ready(); }
    catch (err) {
      if (err.needsSetup && typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('setting-voice-control');
      throw err;
    }
    // The destination is decided before the panel exists, while the cursor is still where the person left it.
    let mode = kind === 'auto' ? this.mode() : kind;
    let target = null;
    if (mode === 'auto' || mode === 'dictate') {
      target = this._target();
      if (mode === 'auto') mode = target && target.kind !== 'secret' ? 'dictate' : 'command';
      if (mode === 'dictate' && (!target || target.kind === 'secret')) {
        throw new Error(target && target.kind === 'secret' ? this._t('Voice control never types into a password or code field') : this._t('Click into a text box first, then dictate'));
      }
    }
    if (kind === 'answer') mode = 'answer';
    const run = { phase: 'listening', mode, target, how, started: Date.now(), cancelled: false, onAnswer, stream: null, ctx: null, proc: null, chunks: [] };
    this._run = run;
    this.syncButton();
    try {
      if (clip) {
        if (!st.testSeam) throw new Error('The test clip seam is not available in this build');
        const pcm = await this._api('voiceTestClip')(clip);
        this._drawListening(run, this._t('Test clip: {1}', clip));
        run.chunks = [];
        run.pcm = pcm;
      } else {
        await this._openMic(run);
        this._drawListening(run);
        this._armEsc(() => this.cancel());
        await new Promise((resolve) => { run.done = resolve; });
      }
      if (run.cancelled) return undefined;
      return await this._work(run);
    } catch (err) {
      this._release(run);
      this._run = null;
      this._close();
      throw err;
    }
  },

  async _openMic(run) {
    const constraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } };
    if (this.micId()) constraints.audio.deviceId = { exact: this.micId() };
    try { run.stream = await navigator.mediaDevices.getUserMedia(constraints); }
    catch (err) { throw new Error(err && err.name === 'NotAllowedError' ? this._t('Vex could not use the microphone. Check Windows Settings > Privacy > Microphone') : ((err && err.message) || this._t('Could not open the microphone')), { cause: err }); }
    run.ctx = new AudioContext({ sampleRate: this.RATE });
    const src = run.ctx.createMediaStreamSource(run.stream);
    const proc = run.ctx.createScriptProcessor(4096, 1, 1);
    const silenceS = run.mode === 'answer' ? 1.2 : this.silenceSeconds();
    const maxS = run.mode === 'answer' ? this.ANSWER_SECONDS : this.MAX_SECONDS;
    run.endpointer = this.createEndpointer({ silenceS, maxS });
    proc.onaudioprocess = (e) => {
      if (run.phase !== 'listening') return;
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      run.chunks.push(data);
      const r = run.endpointer.push(data);
      this._meter(r.level);
      if (r.stop) { run.stopReason = r.stop; this.finish(); }
    };
    src.connect(proc); proc.connect(run.ctx.destination);
    run.proc = proc;
  },

  // The microphone is closed here, and nowhere later is it needed again.
  _release(run) {
    if (!run) return;
    if (run.proc) { run.proc.onaudioprocess = null; try { run.proc.disconnect(); } catch (err) { console.warn('[Voice] the audio node was already disconnected:', err && err.message); } }
    if (run.stream) run.stream.getTracks().forEach(t => t.stop());
    if (run.ctx) run.ctx.close().catch(err => console.warn('[Voice] the audio context did not close:', err && err.message));
    run.proc = null; run.stream = null; run.ctx = null;
  },

  finish() {
    const run = this._run;
    if (!run || run.phase !== 'listening') return false;
    if (run.chunks.length) {
      const n = run.chunks.reduce((s, c) => s + c.length, 0);
      const all = new Float32Array(n);
      let at = 0;
      for (const c of run.chunks) { all.set(c, at); at += c.length; }
      run.pcm = this.floatToPcm16(all);
      run.heard = run.endpointer ? run.endpointer.heard() : true;
    }
    run.chunks = [];                  // the float audio is dropped; only the 16-bit copy goes on to the engine
    run.phase = 'working';
    this._release(run);
    if (run.done) run.done();
    return true;
  },

  cancel() {
    const run = this._run;
    if (!run) return false;
    run.cancelled = true;
    run.phase = 'cancelled';
    run.chunks = []; run.pcm = null;
    this._release(run);
    try { this._api('voiceCancel')().catch(err => console.warn('[Voice] the engine could not be told to stop:', err && err.message)); }
    catch (err) { console.warn('[Voice] the engine could not be told to stop:', err && err.message); }
    if (run.done) run.done();
    this._run = null;
    this._close();
    return true;
  },

  _drawListening(run, note) {
    const p = this._panel('listening');
    this._head(p, this._t(run.mode === 'dictate' ? 'Listening: dictating' : run.mode === 'answer' ? 'Listening for your answer' : 'Listening: say a command'));
    const meter = this._el('div', 'vv-meter'); meter.setAttribute('aria-hidden', 'true'); meter.appendChild(this._el('span'));
    p.appendChild(meter);
    p.appendChild(this._el('div', 'vv-sub', note || this._t('The microphone is on. It stops by itself after a pause, or when you let go of the key. Nothing leaves this computer.')));
    const row = this._el('div', 'vv-row');
    row.append(this._button(this._t('Stop'), () => this.finish(), 'primary'), this._button(this._t('Cancel (Esc)'), () => this.cancel()));
    if (run.mode !== 'answer') {
      const other = run.mode === 'dictate' ? 'command' : 'dictate';
      row.appendChild(this._button(this._t(other === 'dictate' ? 'Dictate instead' : 'Command instead'), () => { if (other === 'dictate') { const t = this._target(); if (!t || t.kind === 'secret') { window.showToast?.(this._t('Click into a text box first, then dictate'), 'error'); return; } run.target = t; } run.mode = other; this._drawListening(run, note); }));
    }
    p.appendChild(row);
    run.meterEl = meter.firstChild;
    this._announce(this._t('Listening'));
    this.syncButton();
  },
  _meter(level) {
    const run = this._run;
    if (run && run.meterEl) run.meterEl.style.width = Math.round(Math.min(1, level * 8) * 100) + '%';
  },

  // ---- from audio to the result -------------------------------------------------------------------
  async _work(run) {
    run.phase = 'working';
    if (!run.pcm || run.pcm.length < 9600 || (run.heard === false)) {
      this._run = null;
      this._result(this._t('Nothing was heard.'), '', [this._button(this._t('Close'), () => this._close(), 'primary')]);
      return { action: 'none', text: '' };
    }
    const p = this._panel('working');
    this._head(p, this._t('Working it out on this computer'));
    p.appendChild(this._el('div', 'vv-sub', this._t('The speech is turned into text here; nothing is sent anywhere.')));
    this._armEsc(() => this.cancel());
    let out;
    try { out = await this._api('voiceTranscribe')(run.pcm, { model: this.model(), language: this.language() }); }
    finally { run.pcm = null; }              // the audio is dropped as soon as the engine has it
    if (run.cancelled) return undefined;
    const text = (out && out.text) || '';
    this._run = null;
    if (!text) { this._result(this._t('Nothing was heard.'), '', [this._button(this._t('Close'), () => this._close(), 'primary')]); return { action: 'none', text: '' }; }
    if (run.mode === 'answer') { this._close(); if (run.onAnswer) run.onAnswer(text); return { action: 'answer', text }; }
    if (run.mode === 'dictate') return this._reviewDictation(run, text);
    return this._handleCommand(text);
  },

  _result(heard, sub, buttons, state = 'result') {
    const p = this._panel(state);
    this._head(p, this._t('Voice control'));
    if (heard) p.appendChild(this._el('div', 'vv-heard', heard));
    if (sub) p.appendChild(this._el('div', 'vv-sub', sub));
    const row = this._el('div', 'vv-row');
    buttons.forEach(b => row.appendChild(b));
    p.appendChild(row);
    this._armEsc(() => this._close());
    this._announce([heard, sub].filter(Boolean).join('. '));
    const first = row.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    return p;
  },

  // COMMAND ---------------------------------------------------------------------------------------
  _handleCommand(text) {
    const d = this.decide(text);
    const quoted = '“' + text + '”';
    if (d.action === 'none') {
      this._result(this._t('Heard {1}', quoted), this._t('No command is close to that. Try again, or open Ctrl+K.'), [this._button(this._t('Try again'), () => { this._close(); this.listen({ kind: 'command' }).catch(e => window.showToast?.(e.message, 'error')); }, 'primary'), this._button(this._t('Close'), () => this._close())]);
      return { action: 'none', text, decision: d };
    }
    if (d.action === 'choose') {
      const buttons = d.candidates.map((c, i) => this._button(c.command.label, () => this._runCommand(c.command, text, true), i === 0 ? 'primary' : ''));
      buttons.push(this._button(this._t('None of these'), () => this._close()));
      this._result(this._t('Heard {1}', quoted), this._t('Did you mean:') + (d.risky ? ' ' + this._t('(what you said asks to delete, send or leave something, so nothing runs by itself)') : ''), buttons);
      return { action: 'choose', text, decision: d };
    }
    if (d.action === 'confirm') {
      const cmd = d.command;
      const yes = this._button(this._t('Yes, run {1}', cmd.label), () => this._runCommand(cmd, text, true), 'danger');
      const no = this._button(this._t('Cancel'), () => this._close());
      const say = this._button(this._t('Answer by voice'), () => {
        this._close();
        this.listen({ kind: 'answer', onAnswer: (a) => {
          const r = VexVoiceMatch.interpretAnswer(a);
          if (r === 'yes') this._runCommand(cmd, text, true);
          else if (r === 'no') this._result(this._t('Cancelled.'), '', [this._button(this._t('Close'), () => this._close(), 'primary')]);
          else this._result(this._t('Heard {1}', '“' + a + '”'), this._t('That was not a yes or a no. Nothing was run.'), [this._button(this._t('Close'), () => this._close(), 'primary')]);
        } }).catch(e => window.showToast?.(e.message, 'error'));
      });
      this._result(this._t('Heard {1}', quoted), this._t('This one asks first, every time: {1}. Run it?', cmd.label), [no, yes, say]);
      return { action: 'confirm', text, decision: d };
    }
    // run: shown for a second, with Cancel
    const cmd = d.command;
    const cancelBtn = this._button(this._t('Cancel (Esc)'), () => this._close(), 'primary');
    const nowBtn = this._button(this._t('Run now'), () => { clearTimeout(this._graceTimer); this._graceTimer = null; this._runCommand(cmd, text, false); });
    this._result(this._t('Heard {1}', quoted), this._t('Running: {1}', cmd.label) + ' (' + Math.round(d.confidence * 100) + '%)', [cancelBtn, nowBtn]);
    this._graceTimer = setTimeout(() => { this._graceTimer = null; this._runCommand(cmd, text, false); }, this.GRACE_MS);
    return { action: 'run', text, decision: d };
  },

  _runCommand(cmd, text, explicit) {
    this._close();
    if (typeof CommandBar === 'undefined' || typeof CommandBar._execute !== 'function') throw new Error('Voice control: the command bar is not available');
    this._last = { id: cmd.id, label: cmd.label, text, explicit, at: Date.now() };
    CommandBar._execute(cmd);
    this._announce(this._t('Ran {1}', cmd.label));
  },

  // DICTATION -------------------------------------------------------------------------------------
  _reviewDictation(run, text) {
    const p = this._panel('result');
    this._head(p, this._t('Dictation: check it, then insert'));
    const ta = this._el('textarea');
    ta.value = text;
    ta.setAttribute('aria-label', this._t('What you said. Correct it if needed'));
    p.appendChild(ta);
    p.appendChild(this._el('div', 'vv-sub', this._t('It is typed into the field only when you press Insert (Ctrl+Enter). Esc throws it away.')));
    const row = this._el('div', 'vv-row');
    const insert = this._button(this._t('Insert'), async () => {
      const value = ta.value.trim();
      if (!value) { this._close(); return; }
      try { await this.insert(run.target, value); this._close(); }
      catch (err) { this._close(); window.showToast?.(err.message, 'error'); }
    }, 'primary');
    row.append(insert, this._button(this._t('Cancel (Esc)'), () => this._close()));
    p.appendChild(row);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); insert.click(); } });
    this._armEsc(() => this._close());
    this._announce(this._t('Dictation ready to insert'));
    ta.focus({ preventScroll: true });
    return { action: 'dictate', text };
  },

  // ---- the key -----------------------------------------------------------------------------------
  // Push-to-talk. The shortcut registry runs the command on key DOWN; this watches for the key UP. A key held longer than HOLD_MS
  // ends the recording when it is released; a quick tap leaves it listening until a pause (or the key again).
  hotkeyDown(e) {
    if (e && e.repeat) return;                 // holding the key repeats keydown: only the first counts
    if (!this.enabled()) return;
    if (this._run && this._run.phase === 'listening') { this.finish(); return; }
    this._keyDownAt = Date.now();
    this.listen({ kind: 'auto', how: 'key' }).catch(err => window.showToast?.(err.message, 'error'));
  },
  _onKeyUp(e) {
    const run = this._run;
    if (!run || run.phase !== 'listening' || run.how !== 'key' || !this._keyDownAt) return;
    const combo = (typeof ShortcutsRegistry !== 'undefined' && ShortcutsRegistry.getShortcut) ? ShortcutsRegistry.getShortcut(this.HOTKEY_ID) : 'Ctrl+Alt+Shift+V';
    const parts = String(combo || '').split('+');
    const main = (parts[parts.length - 1] || '').toLowerCase();
    const released = String(e.key || '').toLowerCase();
    if (released === main || ['control', 'alt', 'shift'].includes(released)) {
      if (Date.now() - this._keyDownAt >= this.HOLD_MS) this.finish();
      this._keyDownAt = 0;
    }
  },

  // ---- the toolbar button and the commands -----------------------------------------------------------
  syncButton() {
    if (typeof document === 'undefined') return;
    let btn = document.getElementById('btn-voice');
    if (!this.enabled()) { if (btn) btn.remove(); return; }
    if (!btn) {
      const ai = document.getElementById('btn-toggle-ai');
      const bar = document.getElementById('top-bar-right');
      if (!bar) return;
      btn = document.createElement('button');
      btn.id = 'btn-voice';
      btn.type = 'button';
      btn.className = 'nav-btn';
      btn.innerHTML = (typeof VexIcons !== 'undefined' ? VexIcons.svg('mic', { size: 16 }) : '');
      btn.addEventListener('click', () => { this.listen({ kind: 'auto', how: 'toggle' }).catch(err => window.showToast?.(err.message, 'error')); });
      bar.insertBefore(btn, ai && ai.parentNode === bar ? ai : bar.firstChild);
    }
    const key = (typeof ShortcutsRegistry !== 'undefined' && ShortcutsRegistry.getShortcut) ? ShortcutsRegistry.getShortcut(this.HOTKEY_ID) : 'Ctrl+Alt+Shift+V';
    const label = this._t('Voice control') + (key ? ' (' + key + ')' : '');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', this.isListening() ? 'true' : 'false');
    btn.dataset.listening = this.isListening() ? 'true' : 'false';
  },

  registerCommands() {
    if (typeof VexExtras === 'undefined' || typeof VexExtras.registerCommand !== 'function') return false;
    const fail = (e) => window.showToast?.((e && e.message) || String(e), 'error');
    const cmd = (id, label, hint, action) => ({ id, label, hint, keywords: 'voice speak microphone dictate talk listen konus ses mikrofon', icon: 'mic', action });
    const on = () => { if (!this.enabled()) throw new Error(this._t('Voice control is switched off in Settings')); };
    // They stay registered (VexExtras has no remove); each refuses when the switch is off.
    VexExtras.registerCommand(cmd('voice-listen', 'Voice control', 'Hold Ctrl+Alt+Shift+V and speak: a command, or dictation into the field you are in. On this computer only', () => { on(); this.listen({ kind: 'auto', how: 'toggle' }).catch(fail); }));
    VexExtras.registerCommand(cmd('voice-command', 'Voice: say a command', 'Speak what you want ("open downloads", "yeni sekme")', () => { on(); this.listen({ kind: 'command', how: 'toggle' }).catch(fail); }));
    VexExtras.registerCommand(cmd('voice-dictate', 'Voice: dictate into this field', 'Speak, check the words, then insert them where the cursor is', () => { on(); this.listen({ kind: 'dictate', how: 'toggle' }).catch(fail); }));
    VexExtras.registerCommand(cmd('voice-settings', 'Voice control settings', 'Language, model, microphone, download or delete the speech model', () => { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('setting-voice-control'); }));
    return true;
  },

  // ---- Settings ---------------------------------------------------------------------------------------
  _mb(bytes) { return (bytes / 1048576).toFixed(bytes >= 100 * 1048576 ? 0 : 1) + ' MB'; },

  settingsRows(body) {
    const S = VexSettingsGroup;
    const fail = (e) => window.showToast?.((e && e.message) || String(e), 'error');
    body.appendChild(S.note(this._t('Talk to Vex: say a Ctrl+K command ("open downloads", "yeni sekme") or dictate into a text field. The speech is turned into text on this computer by whisper.cpp; nothing you say is sent anywhere. The engine and a model are downloaded only when you press Download below, and checked against a fixed checksum before use. The microphone is on only while you hold the key or have started listening, with a red panel on screen; the audio is never saved.')));
    body.appendChild(S.toggle(this._t('Voice control'), this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); window.VexSettingsGroups?.inject(); }, this._t('hold Ctrl+Alt+Shift+V or Ctrl+K > Voice control')));
    if (!this.enabled()) return;
    const box = document.createElement('div');
    body.appendChild(box);
    const select = (options, value, onChange) => {
      const s = document.createElement('select');
      for (const [v, l] of options) { const o = document.createElement('option'); o.value = v; o.textContent = l; s.appendChild(o); }
      s.value = value;
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    const draw = async () => {
      let st;
      try { st = await this._api('voiceStatus')(); } catch (err) { fail(err); return; }
      box.textContent = '';
      const sel = this.model();
      box.appendChild(S.field(this._t('Language you speak'), select([['auto', this._t('Detect it (Turkish or English)')], ['tr', 'Türkçe'], ['en', 'English']], this.language(), (v) => localStorage.setItem(this.KEYS.language, v)), 'voice-language'));
      box.appendChild(S.field(this._t('Default action'), select([['auto', this._t('Dictate when a text field has the cursor, otherwise a command')], ['command', this._t('Always a command')], ['dictate', this._t('Always dictate')]], this.mode(), (v) => localStorage.setItem(this.KEYS.mode, v)), 'voice-mode'));
      box.appendChild(S.field(this._t('Stop after a pause of'), select([['1', this._t('1 second')], ['1.5', this._t('1.5 seconds')], ['2.5', this._t('2.5 seconds')]], String(this.silenceSeconds()), (v) => localStorage.setItem(this.KEYS.silence, v)), 'voice-silence'));
      const models = Object.values(st.models);
      box.appendChild(S.field(this._t('Model'), select(models.map(m => [m.id, `${m.label}: ${this._mb(m.bytes)}${m.installed ? ' (' + this._t('downloaded') + ')' : ''}`]), sel, (v) => { localStorage.setItem(this.KEYS.model, v); draw(); }), 'voice-model'));
      box.appendChild(S.note(models.map(m => `${m.label} (${this._mb(m.bytes)}): ${this._t(m.note)}`).join(' ')));
      const mic = document.createElement('select');
      mic.id = 'voice-mic';
      mic.appendChild(new Option(this._t('Default microphone'), ''));
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').forEach((d, i) => mic.appendChild(new Option(d.label || this._t('Microphone {1}', i + 1), d.deviceId)));
      } catch (err) { box.appendChild(S.note(this._t('The list of microphones could not be read: {1}', err.message))); }
      mic.value = this.micId();
      if (mic.value !== this.micId()) mic.value = '';
      mic.addEventListener('change', () => localStorage.setItem(this.KEYS.mic, mic.value));
      box.appendChild(S.field(this._t('Microphone'), mic));

      // The files.
      const need = [];
      if (!st.engine.installed) need.push({ id: 'engine', label: this._t('speech engine'), bytes: st.engine.bytes, source: st.engine.source });
      const cur = st.models[sel];
      if (!cur.installed) need.push({ id: sel, label: this._t('model {1}', cur.label), bytes: cur.bytes, source: cur.source });
      const status = document.createElement('div');
      status.className = 'setting-info'; status.setAttribute('aria-live', 'polite');
      const bar = document.createElement('progress'); bar.max = 1; bar.value = 0; bar.hidden = true; bar.style.cssText = 'width:100%;max-width:360px'; bar.setAttribute('aria-label', this._t('Download progress'));
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0';
      if (need.length) {
        const total = need.reduce((s, n) => s + n.bytes, 0);
        status.textContent = this._t('Not ready: {1} to download ({2}).', need.map(n => n.label).join(' + '), this._mb(total));
        const dl = S.button(this._t('Download ({1})', this._mb(total)), async () => {
          const ok = await window.vexConfirm({ title: this._t('Download the voice files?'), message: this._t('Vex will download {1} ({2}) from {3}. Each file is checked against a fixed SHA-256 before it is used, and deleted if it does not match. You can delete them again here.', need.map(n => n.label).join(' + '), this._mb(total), [...new Set(need.map(n => n.source))].join(', ')), okLabel: this._t('Download') });
          if (!ok) return;
          dl.disabled = true; cancel.hidden = false; bar.hidden = false;
          const off = window.vex.onVoiceProgress ? window.vex.onVoiceProgress((p) => { bar.value = p.received / p.total; status.textContent = this._t('Downloading {1}: {2} of {3}', p.id === 'engine' ? this._t('the speech engine') : this._t('the model'), this._mb(p.received), this._mb(p.total)); }) : null;
          try {
            for (const n of need) {
              const r = await this._api('voiceDownload')(n.id);
              if (r && r.cancelled) { window.showToast?.(this._t('Download cancelled. Nothing was kept.')); break; }
            }
          } catch (err) { fail(err); }
          finally { if (off) off(); draw(); }
        }, 'primary');
        const cancel = S.button(this._t('Cancel download'), () => { this._api('voiceCancelDownload')().catch(fail); });
        cancel.hidden = true;
        row.append(dl, cancel);
      } else {
        status.textContent = this._t('Ready. Hold {1} and speak.', (typeof ShortcutsRegistry !== 'undefined' && ShortcutsRegistry.getShortcut ? ShortcutsRegistry.getShortcut(this.HOTKEY_ID) : 'Ctrl+Alt+Shift+V'));
      }
      if (st.engine.installed || models.some(m => m.installed)) {
        row.appendChild(S.button(this._t('Delete voice model'), async () => {
          const ok = await window.vexConfirm({ title: this._t('Delete the voice files?'), message: this._t('The speech engine and every downloaded model are deleted from this computer. You can download them again.'), okLabel: this._t('Delete'), danger: true });
          if (!ok) return;
          try { await this._api('voiceRemove')('all'); window.showToast?.(this._t('Voice files deleted')); } catch (err) { fail(err); }
          draw();
        }, 'danger'));
      }
      box.append(status, bar, row);

      // Test the microphone: a level meter, nothing is recorded or kept.
      const meter = document.createElement('div'); meter.style.cssText = 'height:8px;max-width:360px;border-radius:4px;background:var(--border);overflow:hidden;margin:6px 0'; meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', this._t('Microphone level')); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100');
      const fill = document.createElement('span'); fill.style.cssText = 'display:block;height:100%;width:0;background:var(--primary)'; meter.appendChild(fill);
      const testNote = document.createElement('div'); testNote.className = 'setting-info'; testNote.setAttribute('aria-live', 'polite');
      const test = S.button(this._t('Test microphone'), () => this.testMic(fill, meter, testNote, test).catch(fail));
      box.append(test, meter, testNote);
    };
    draw();
  },

  // Opens the microphone for at most 8 seconds and shows its level. Nothing is stored or sent.
  async testMic(fill, meter, note, button) {
    if (this._run || this._test) throw new Error(this._t('Voice control is busy'));
    const constraints = { audio: this.micId() ? { deviceId: { exact: this.micId() } } : true };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
    catch (err) { throw new Error(err && err.name === 'NotAllowedError' ? this._t('Vex could not use the microphone. Check Windows Settings > Privacy > Microphone') : ((err && err.message) || this._t('Could not open the microphone')), { cause: err }); }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    const t0 = Date.now();
    this._test = true;
    button.disabled = true;
    note.textContent = this._t('The microphone is on for 8 seconds. Say something.');
    this._announce(this._t('Testing the microphone'));
    await new Promise((resolve) => {
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        const lv = this.level(buf);
        peak = Math.max(peak, lv);
        fill.style.width = Math.round(Math.min(1, lv * 8) * 100) + '%';
        meter.setAttribute('aria-valuenow', String(Math.round(Math.min(1, lv * 8) * 100)));
        if (Date.now() - t0 >= 8000 || !this._test) resolve(); else setTimeout(tick, 60);
      };
      tick();
    });
    stream.getTracks().forEach(t => t.stop());
    ctx.close().catch(err => console.warn('[Voice] the test audio context did not close:', err && err.message));
    this._test = false;
    button.disabled = false;
    fill.style.width = '0';
    note.textContent = peak >= this.VOICE_LEVEL ? this._t('The microphone works (it heard you). The microphone is off again.') : this._t('Nothing was heard. Check the microphone, or Windows Settings > Privacy > Microphone. The microphone is off again.');
    return peak;
  },

  init() {
    this.registerCommands();
    // The key itself is wired in app.js (ShortcutsRegistry.register('voice-control')): the registry runs it on key down only and also passes the
    // repeats of a held key, which hotkeyDown ignores. Here only the key UP is watched, for push-to-talk.
    if (typeof document !== 'undefined') {
      document.addEventListener('keyup', (e) => this._onKeyUp(e), true);
      this.syncButton();
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexVoice = VexVoice;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'voice-control', title: 'Voice control', keywords: 'voice control speak microphone dictate dictation whisper speech command hands free konus ses mikrofon sesli komut', before: 'about', render: (body) => VexVoice.settingsRows(body) });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { VexVoice.init(); } catch (err) { console.error('[Voice] could not start:', err); } }, { once: true });
  else { try { VexVoice.init(); } catch (err) { console.error('[Voice] could not start:', err); } }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexVoice };
