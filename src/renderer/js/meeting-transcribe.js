// === Meeting transcript from the owner's own voice (meeting copilot, post-call notes) ==
//
// Opt-in, off until switched on in Settings. While a meeting copilot session is running, the
// person can press "Listen to my voice": the MICROPHONE is opened (never the screen, never the call's
// sound), the speech is cut into segments of at most 30 seconds, and each segment is turned into
// text by a LOCAL engine the person installed and chose (a whisper.cpp program and a model file;
// main/transcribe.js runs it). The text is added to the session as a transcript and ends up in the
// meeting note. Nothing is uploaded; the audio is deleted as soon as it has been read unless the
// person ticked "keep the audio".
//
// Consent, every session: a box in this window says what will happen, then the main process shows
// its own box with the exact command. A banner stays at the top of the window the whole time the
// microphone is open, with a Stop button. The engine itself is not shipped (BLOCKED-EXTERNAL): the
// person installs whisper.cpp and a model, then picks them in Settings.
//
// Speech timer hook (js/speech-timer.js): when the speech timer has a speaker up, each segment is
// labelled "during <name>'s turn", and a change of speaker ends the current segment. The label says
// whose turn it was, not who spoke: only the person's own microphone is heard.
//
// Pure parts (encodeWav, toBase64, level, createSegmenter, labelFor) are tested without a window.
const VexMeetingTranscribe = {
  ENABLED_KEY: 'vex.meetingTranscribe.enabled',
  FEATURE: 'meeting-transcribe',
  RATE: 16000,
  MIN_SEGMENT_S: 6,
  MAX_SEGMENT_S: 30,
  SILENCE_S: 0.8,
  VOICE_LEVEL: 0.012,
  MAX_SESSION_S: 3 * 3600,

  enabled() {
    try { return localStorage.getItem(this.ENABLED_KEY) === 'true'; }
    catch (err) { console.error('[MeetingTranscribe] the switch could not be read:', err); return false; }
  },
  setEnabled(on) {
    localStorage.setItem(this.ENABLED_KEY, on ? 'true' : 'false');
    if (!on && this._run) this.stop().catch((e) => window.showToast?.((e && e.message) || String(e), 'error'));
    this.registerCommands();
  },

  // ---- pure ------------------------------------------------------------------------------
  // 16-bit PCM WAV (mono) of float samples in -1..1.
  encodeWav(samples, rate = this.RATE) {
    const n = samples.length, out = new Uint8Array(44 + n * 2), v = new DataView(out.buffer);
    const tag = (at, s) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    tag(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return out;
  },
  toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  level(samples) {
    if (!samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 8) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.ceil(samples.length / 8));
  },

  // Cuts a stream of sample blocks into segments: at a pause after MIN_SEGMENT_S, or at MAX_SEGMENT_S.
  // push(block) -> a Float32Array when a segment is complete (and it had a voice in it), else null.
  // cut() / flush() end the segment now; silence-only segments are dropped, never sent.
  createSegmenter({ rate = this.RATE, minS = this.MIN_SEGMENT_S, maxS = this.MAX_SEGMENT_S, silenceS = this.SILENCE_S, voice = this.VOICE_LEVEL } = {}) {
    let blocks = [], samples = 0, voiced = false, quiet = 0;
    const take = () => {
      const had = voiced && samples >= rate * 0.5;
      const out = new Float32Array(samples);
      let at = 0;
      for (const b of blocks) { out.set(b, at); at += b.length; }
      blocks = []; samples = 0; voiced = false; quiet = 0;
      return had ? out : null;
    };
    return {
      push: (block) => {
        blocks.push(block); samples += block.length;
        if (this.level(block) >= voice) { voiced = true; quiet = 0; } else quiet += block.length;
        if (samples >= rate * maxS || (samples >= rate * minS && quiet >= rate * silenceS)) return take();
        return null;
      },
      cut: take,
      empty: () => samples === 0,
      seconds: () => samples / rate,
    };
  },

  labelFor(speaker) { return speaker ? 'during ' + speaker + '\'s turn' : ''; },

  // ---- the engine's settings ---------------------------------------------------------------
  _api(name) {
    if (!window.vex || typeof window.vex[name] !== 'function') throw new Error('Transcription is not available in this window');
    return window.vex[name].bind(window.vex);
  },
  config() { return this._api('transcribeConfig')(); },

  // ---- listening ------------------------------------------------------------------------------
  _run: null,

  isListening() { return !!this._run; },

  async start({ title = '' } = {}) {
    if (!this.enabled()) throw new Error('The meeting transcript is switched off in Settings');
    if (this._run) throw new Error('Already listening');
    if (typeof MeetingCopilot === 'undefined') throw new Error('Start the meeting notes first');
    const session = MeetingCopilot.current();
    if (!session || session.endedAt) throw new Error('Start the meeting notes first');
    if (window.GameMode && window.GameMode.gaming) throw new Error('A game is running, so Vex will not start the speech engine now');
    const cfg = await this.config();
    if (!cfg.ready) throw new Error('Choose the whisper.cpp program and a model file in Settings > Meeting transcript first');
    // The consent, every session: nothing is remembered from the last one.
    const ok = await window.vexConfirm({
      title: 'Listen to your voice for this meeting?',
      message: 'Vex will open YOUR microphone and turn what you say into text on this PC, using ' + cfg.engine.split(/[\\/]/).pop() + '. It does not record the call, the other people or the screen. '
        + (cfg.keepAudio ? 'The audio will be KEPT in your profile folder, because you ticked that. ' : 'The audio is deleted as soon as it has been read. ')
        + 'A bar at the top of Vex shows that the microphone is on until you press Stop. Tell the others that you are transcribing what you say.',
      okLabel: 'Start listening', cancelLabel: 'Cancel',
    });
    if (!ok) return false;
    const begun = await this._api('transcribeBegin')(title || session.title || '');
    if (!begun || !begun.started) return false;
    const run = { token: begun.token, session: session.id, segmenter: this.createSegmenter(), speaker: '', pending: 0, jobs: [], skipped: 0, failed: 0, segments: 0, started: Date.now(), banner: null, stream: null, ctx: null, proc: null, stopping: false };
    this._run = run;
    try {
      run.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      run.ctx = new AudioContext({ sampleRate: this.RATE });
      const src = run.ctx.createMediaStreamSource(run.stream);
      run.proc = run.ctx.createScriptProcessor(4096, 1, 1);
      run.proc.onaudioprocess = (e) => this._audio(run, new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(run.proc); run.proc.connect(run.ctx.destination);
      run.banner = this._banner(run);
      run.onSpeaker = (ev) => this._speakerChanged(run, ev && ev.detail && ev.detail.name || '');
      window.addEventListener('vex:speaker-change', run.onSpeaker);
      run.speaker = (typeof VexSpeechTimer !== 'undefined' && VexSpeechTimer.currentSpeaker) ? VexSpeechTimer.currentSpeaker() : '';
      if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
      return true;
    } catch (err) {
      await this._teardown(run);
      this._run = null;
      throw new Error(err && err.name === 'NotAllowedError' ? 'Vex could not use the microphone: check Windows Settings > Privacy > Microphone' : ((err && err.message) || 'Could not start listening'), { cause: err });
    }
  },

  _audio(run, block) {
    if (run.stopping) return;
    if ((Date.now() - run.started) / 1000 > this.MAX_SESSION_S) { this.stop().catch((e) => window.showToast?.(e.message, 'error')); return; }
    if (run.segmenter.empty()) run.segmentSpeaker = run.speaker;
    const seg = run.segmenter.push(block);
    if (run.banner) run.banner.level(this.level(block));
    if (seg) this._send(run, seg, run.segmentSpeaker);
  },

  // Whose turn it is changed: the segment so far belongs to the one before.
  _speakerChanged(run, name) {
    if (run.stopping) return;
    const seg = run.segmenter.cut();
    if (seg) this._send(run, seg, run.segmentSpeaker);
    run.speaker = name;
    run.segmentSpeaker = name;
  },

  MAX_WAITING: 8,

  _send(run, samples, speaker) {
    if (run.pending >= this.MAX_WAITING) {
      // Said, not silent: the part is lost and the bar and the summary say so.
      run.skipped += 1;
      this._status(run, 'the engine is not keeping up');
      return;
    }
    run.pending += 1;
    const at = Date.now() - Math.round(samples.length / this.RATE * 1000);
    const wav = this.toBase64(this.encodeWav(samples));
    run.segments += 1;
    const work = () => this._api('transcribeChunk')(run.token, wav);
    const job = (async () => {
      // Heavy work waits for a quiet moment and is refused while a game runs or memory is low (VexJobs).
      const r = typeof VexJobs !== 'undefined' && typeof VexJobs.heavy === 'function'
        ? await VexJobs.heavy('Meeting transcript', work, { kind: 'audio', feature: this.FEATURE })
        : { ran: true, value: await work() };
      return r;
    })().finally(() => { run.pending -= 1; }).then((r) => {
      if (r && r.ran === false) { run.skipped += 1; this._status(run, 'A part was not transcribed: ' + (r.reason || 'Vex is busy')); return; }
      const out = r && Object.hasOwn(r, 'value') ? r.value : r;
      const text = out && out.text ? out.text : '';
      if (text && typeof MeetingCopilot !== 'undefined') MeetingCopilot.transcript(text, { at, speaker: this.labelFor(speaker) });
      this._status(run);
    }, (err) => {
      run.failed += 1;
      window.showToast?.('Transcription failed: ' + ((err && err.message) || err), 'error');
      this._status(run, 'A part could not be transcribed');
    });
    run.jobs.push(job);
  },

  _status(run, extra) {
    if (!run.banner) return;
    const parts = [run.segments + ' part' + VexPlural.s(run.segments)];
    if (run.skipped) parts.push(run.skipped + ' skipped');
    if (run.failed) parts.push(run.failed + ' failed');
    run.banner.say('Listening to your microphone · ' + parts.join(' · ') + (extra ? ' · ' + extra : ''));
  },

  // The bar that is up the whole time the microphone is open.
  _banner(run) {
    document.getElementById('vex-transcribe-banner')?.remove();
    const el = document.createElement('div');
    el.id = 'vex-transcribe-banner';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99400;display:flex;align-items:center;gap:10px;justify-content:center;padding:6px 12px;background:var(--danger,#b3261e);color:#fff;font-size:12.5px';
    el.innerHTML = '<span data-icon style="display:inline-flex"></span><span data-text>Listening to your microphone</span><span data-bar style="width:46px;height:6px;border-radius:3px;background:rgba(255,255,255,.3);overflow:hidden"><span style="display:block;height:100%;width:0;background:#fff"></span></span><button data-stop type="button" style="font:inherit;font-size:12px;padding:3px 12px;border-radius:999px;border:1px solid #fff;background:transparent;color:#fff;cursor:pointer">Stop</button>';
    if (typeof VexIcons !== 'undefined') el.querySelector('[data-icon]').innerHTML = VexIcons.svg('mic', { size: 14 });
    el.querySelector('[data-stop]').addEventListener('click', () => { this.stop().catch((e) => window.showToast?.((e && e.message) || String(e), 'error')); });
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'chrome', id: 'transcribe-banner' });
    const bar = el.querySelector('[data-bar] span');
    return {
      el,
      say: (t) => { el.querySelector('[data-text]').textContent = t; },
      level: (v) => { bar.style.width = Math.round(Math.min(1, v * 6) * 100) + '%'; },
      remove: () => el.remove(),
    };
  },

  async _teardown(run) {
    if (run.onSpeaker) window.removeEventListener('vex:speaker-change', run.onSpeaker);
    if (run.proc) { run.proc.onaudioprocess = null; run.proc.disconnect(); }
    if (run.stream) run.stream.getTracks().forEach((t) => t.stop());
    if (run.ctx) { try { await run.ctx.close(); } catch (err) { console.warn('[MeetingTranscribe] the audio context did not close:', err.message); } }
    run.proc = null; run.stream = null; run.ctx = null;
    if (run.banner) { run.banner.remove(); run.banner = null; }
  },

  // Ends the microphone, hears out what was already cut, and tells main to close the session.
  async stop() {
    const run = this._run;
    if (!run) return null;
    run.stopping = true;
    const last = run.segmenter.cut();
    if (last) this._send(run, last, run.segmentSpeaker);
    await this._teardown(run);
    await Promise.all(run.jobs);
    this._run = null;
    const ended = await this._api('transcribeEnd')(run.token);
    const summary = { segments: run.segments, skipped: run.skipped, failed: run.failed, kept: ended && ended.kept ? ended.kept : null };
    window.showToast?.('Stopped listening · ' + summary.segments + ' part' + VexPlural.s(summary.segments) + (summary.skipped || summary.failed ? ' (' + (summary.skipped + summary.failed) + ' not transcribed)' : '') + (summary.kept ? ' · audio kept in ' + summary.kept : ''));
    return summary;
  },

  // A small area inside the meeting copilot's live view.
  mount(host) {
    if (!host || !this.enabled()) return false;
    host.textContent = '';
    const row = document.createElement('div');
    row.style.cssText = 'padding:0 14px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn-secondary';
    const info = document.createElement('span');
    info.style.color = 'var(--text-muted)';
    const draw = () => {
      btn.textContent = this.isListening() ? 'Stop listening' : 'Listen to my voice';
      info.textContent = this.isListening() ? 'The microphone is on.' : 'Turns what you say into text on this PC. Asks each time.';
    };
    btn.addEventListener('click', () => {
      const go = this.isListening() ? this.stop() : this.start();
      go.then(draw, (e) => { window.showToast?.((e && e.message) || String(e), 'error'); draw(); });
    });
    draw();
    row.append(btn, info);
    host.appendChild(row);
    return true;
  },

  async stopIfListening() { return this._run ? this.stop() : null; },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('meetingtranscribe:', this.enabled() ? [
      { id: 'meetingtranscribe:open', label: 'Meeting transcript settings', icon: 'mic', hint: 'Choose the local speech engine for meeting notes from your voice', action: () => { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('setting-meeting-transcribe'); } },
    ] : []);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Turns what YOU say into text for the meeting copilot, on this PC. You install a speech program (whisper.cpp, for example whisper-cli.exe) and a model file yourself and choose them here; Vex does not ship or download them. It uses only your microphone (not the call\'s sound, not the screen), asks every time you start, shows a bar at the top while the microphone is on, and deletes the audio right after it has been read unless you tick the box below. Nothing is uploaded.'));
    body.appendChild(S.toggle('Meeting transcript', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); window.VexSettingsGroups?.inject(); }, 'Ctrl+K > Meeting transcript settings'));
    if (!this.enabled()) return;
    const box = document.createElement('div');
    body.appendChild(box);
    const fail = (e) => window.showToast?.((e && e.message) || String(e), 'error');
    const draw = (cfg) => {
      box.textContent = '';
      const name = (p) => (p ? p.split(/[\\/]/).pop() : 'not chosen');
      const line = (kind, label) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0';
        const t = document.createElement('span'); t.style.cssText = 'min-width:120px;font-size:12px;color:var(--text-muted)'; t.textContent = label + ': ' + name(cfg[kind]);
        row.append(t, S.button('Choose...', () => { this._api('transcribePick')(kind).then(draw, fail); }));
        if (cfg[kind]) row.appendChild(S.button('Clear', () => { this._api('transcribeClear')(kind).then(draw, fail); }));
        box.appendChild(row);
      };
      line('engine', 'Speech program'); line('model', 'Model file'); line('script', 'Script it runs first (optional)');
      const lang = document.createElement('input');
      lang.type = 'text'; lang.value = cfg.language; lang.maxLength = 4; lang.style.width = '70px';
      lang.addEventListener('change', () => { this._api('transcribeSet')({ language: lang.value.trim().toLowerCase() }).then(draw, fail); });
      box.appendChild(S.field('Language', lang));
      box.appendChild(S.toggle('Keep the audio', cfg.keepAudio, (on) => { this._api('transcribeSet')({ keepAudio: on }).then(draw, fail); }, 'off: deleted as soon as it is read'));
      const ready = document.createElement('div');
      ready.className = 'setting-info'; ready.setAttribute('aria-live', 'polite');
      ready.textContent = cfg.ready ? 'Ready. Press "Listen to my voice" in the Meeting copilot.' : 'Not ready: choose the speech program and a model file.';
      box.appendChild(ready);
    };
    this.config().then(draw, fail);
  },

  init() { this.registerCommands(); },
};

if (typeof window !== 'undefined') {
  window.VexMeetingTranscribe = VexMeetingTranscribe;
  VexMeetingTranscribe.registerCommands();
  document.addEventListener('DOMContentLoaded', () => { try { VexMeetingTranscribe.init(); } catch (err) { console.error('[MeetingTranscribe] could not start:', err); } });
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'meeting-transcribe', title: 'Meeting transcript', keywords: 'meeting transcript microphone voice speech whisper dictate notes transcription', before: 'about', render: (body) => VexMeetingTranscribe.settingsRows(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMeetingTranscribe };
