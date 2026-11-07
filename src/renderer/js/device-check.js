// === "Check my devices" before a call ============================================
//
// One card, opened by a press (Ctrl+K "Check My Devices", or offered when Meeting mode starts): the camera with a live picture,
// the microphone with a level meter ("speak now"), the speakers or headphones with a soft test tone you can send to the device
// you pick, and the connection (the time to a neutral host, the same measurement as "Is it me or the server?"). Each part ends
// as "Looks good" or "Needs a look" with a plain reason, and the top line sums them up.
//
// Nothing is recorded, stored or sent: the camera picture goes to a <video> in this card, the microphone only to a level meter,
// the tone only to the speaker. Every stream is stopped when the card is closed, on Escape, when the tab changes (or the window
// is hidden), and if the card closes while a device is still opening, that stream is stopped the moment it arrives.
//
// The camera: Vex's own window is otherwise never given a camera. Opening this card asks main to allow it for this window for a
// short lease (two minutes, main/permissions.js UI_CAMERA_MS). The open card renews it every 30 s, but only while the window is
// visible and has focus; closing gives it back at once, and so does the window staying out of focus for 30 s or the tab
// changing or navigating. A card that crashed or was never closed therefore cannot keep the camera open past the lease.
const VexDeviceCheck = {
  FEATURE: 'device-check',
  HEARD_RMS: 0.01,          // a microphone is "hearing you" above this level
  SILENT_AFTER_MS: 6000,    // no sound this long after the meter started: tell the person
  TONE_HZ: 440,
  TONE_GAIN: 0.12,
  TONE_MS: 1500,
  PICTURE_MS: 4000,
  HEARTBEAT_MS: 30000,      // the card renews the camera lease this often while it is visible and the window has focus
  BLUR_CLOSE_MS: 30000,     // the window out of focus this long closes the card (and so ends the lease)

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  // ---- pure --------------------------------------------------------------------------------
  // Why a device did not open, in words for a person. what: 'camera' | 'microphone'.
  explain(err, what) {
    const name = err && err.name ? String(err.name) : '';
    const cam = what === 'camera';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return this._t(cam
        ? 'Vex was not allowed to use the camera. Windows may be blocking it: open Windows Settings > Privacy & security > Camera and turn on "Let desktop apps access your camera".'
        : 'Vex was not allowed to use the microphone. Windows may be blocking it: open Windows Settings > Privacy & security > Microphone and turn on "Let desktop apps access your microphone".');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
      return this._t(cam ? 'No camera was found. Plug one in, or pick another from the list.' : 'No microphone was found. Plug one in, or pick another from the list.');
    }
    if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') {
      return this._t(cam
        ? 'The camera is busy or not answering. Another app (a call, a browser tab, a recorder) may be using it: close that, then press Check again.'
        : 'The microphone is busy or not answering. Another app (a call, a browser tab, a recorder) may be using it: close that, then press Check again.');
    }
    return this._t(cam ? 'The camera could not be opened: {1}' : 'The microphone could not be opened: {1}').replace('{1}', (err && err.message) || name || this._t('unknown error'));
  },

  // Root-mean-square level of a block of samples (-1..1): 0 silence, ~0.7 a full-scale sine.
  levelOf(samples) {
    if (!samples || !samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  },
  // The meter's width, 0..1; speech sits around 0.02-0.15 rms, so it is scaled up.
  meterFill(rms) { return Math.max(0, Math.min(1, rms * 8)); },

  // The state of the microphone from what it has heard. heardAt: whether any block was above HEARD_RMS; elapsedMs since the meter began.
  micState(heard, elapsedMs) {
    if (heard) return { state: 'ok', text: this._t('The microphone hears you.') };
    if (elapsedMs >= this.SILENT_AFTER_MS) return { state: 'problem', text: this._t('Nothing was heard. Check that the microphone is not muted (a switch on a headset, or in Windows), or pick another one.') };
    return { state: 'pending', text: this._t('Speak now: say a few words and watch the bar.') };
  },

  // The connection from the lowest time to a neutral host in the "Is it me or the server?" measurement (null: no answer).
  pingState(ms) {
    if (!Number.isFinite(ms)) return { state: 'problem', text: this._t('No answer from the test server. Check your internet connection.') };
    const r = Math.round(ms);
    if (r < 150) return { state: 'ok', text: this._t('Connection is fast ({1} ms).').replace('{1}', String(r)) };
    if (r < 300) return { state: 'ok', text: this._t('Connection is fine for a call ({1} ms), a little slow.').replace('{1}', String(r)) };
    return { state: 'problem', text: this._t('Connection is slow ({1} ms). Video may stutter.').replace('{1}', String(r)) };
  },

  // The top line from the four parts: { camera, microphone, speaker, connection } each { state: ok|problem|pending|off }.
  summary(parts) {
    const list = Object.entries(parts).filter(([, p]) => p && p.state !== 'off');
    const problems = list.filter(([, p]) => p.state === 'problem').map(([k]) => k);
    if (problems.length) return { state: 'problem', text: this._t('{1} needs a look: {2}.').replace('{1}', String(problems.length)).replace('{2}', problems.map((k) => this._t(k)).join(', ')) };
    const pending = list.filter(([, p]) => p.state === 'pending').map(([k]) => k);
    if (pending.length) return { state: 'pending', text: this._t('Still checking: {1}.').replace('{1}', pending.map((k) => this._t(k)).join(', ')) };
    return { state: 'ok', text: this._t('All good. Your camera, microphone, speakers and connection look fine.') };
  },

  // Everything that holds a device, so closing can stop every one of them.
  streamSet() {
    const streams = new Set();
    const contexts = new Set();
    let closed = false;
    return {
      get closed() { return closed; },
      // A stream that arrives after the card closed is stopped at once.
      addStream(stream) {
        if (closed) { stream.getTracks().forEach((t) => t.stop()); return false; }
        streams.add(stream);
        return true;
      },
      addContext(ctx) {
        if (closed) { ctx.close(); return false; }
        contexts.add(ctx);
        return true;
      },
      stopStream(stream) { stream.getTracks().forEach((t) => t.stop()); streams.delete(stream); },
      closeContext(ctx) { contexts.delete(ctx); return ctx.close(); },
      liveTracks() { let n = 0; for (const s of streams) for (const t of s.getTracks()) if (t.readyState === 'live') n++; return n; },
      // -> how many tracks were stopped
      closeAll() {
        closed = true;
        let n = 0;
        for (const s of streams) for (const t of s.getTracks()) { if (t.readyState === 'live') n++; t.stop(); }
        streams.clear();
        const closing = [];
        for (const c of contexts) closing.push(c.close());
        contexts.clear();
        return { tracks: n, contexts: Promise.allSettled(closing) };
      },
    };
  },

  // ---- the card -----------------------------------------------------------------------------
  _open: null,

  isOpen() { return !!this._open; },

  // Closes the card and lets go of every device. Safe to call twice.
  close() {
    const c = this._open;
    if (!c) return 0;
    this._open = null;
    cancelAnimationFrame(c.raf);
    clearTimeout(c.toneTimer);
    document.removeEventListener('keydown', c.onKey, true);
    window.removeEventListener('vex:tab-activated', c.onLeave);
    document.removeEventListener('visibilitychange', c.onHidden);
    window.removeEventListener('pagehide', c.onLeave);
    document.removeEventListener('vex:tab-navigated', c.onLeave);
    window.removeEventListener('blur', c.onBlur);
    window.removeEventListener('focus', c.onFocus);
    clearTimeout(c.beat);
    clearTimeout(c.blurTimer);
    if (c.video) c.video.srcObject = null;
    const { tracks, contexts } = c.set.closeAll();
    Promise.resolve(contexts).catch((err) => console.error('[DeviceCheck] an audio context did not close:', err));
    c.el.remove();
    Promise.resolve(window.vex?.deviceCheckCamera?.(false)).catch((err) => window.VexProblems?.note('Device check', 'Could not give the camera permission back', err));
    return tracks;
  },

  _api() {
    const v = typeof window !== 'undefined' ? window.vex : null;
    if (!v || typeof v.deviceCheckCamera !== 'function') throw new Error('This build cannot check the camera');
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') throw new Error('This window cannot use cameras or microphones');
    return v;
  },

  async open() {
    this._api();
    if (this._open) this.close();
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const el = document.createElement('div');
    el.className = 'vex-devcheck-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.42);display:grid;place-items:start center;padding-top:6vh;overflow:auto';
    el.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Check my devices" style="width:min(640px,94vw);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,0.45);overflow:hidden">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)"><div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Check my devices</div>' +
      '<button data-again type="button" class="btn-secondary" style="font-size:11.5px;padding:3px 8px">Check again</button><button data-close type="button" class="btn-secondary" aria-label="Close" title="Close" style="font-size:11.5px;padding:3px 8px">Close</button></div>' +
      '<div data-summary role="status" aria-live="polite" style="padding:10px 14px;font-size:12.5px;font-weight:600;border-bottom:1px solid var(--border)"></div>' +
      '<div data-parts style="display:grid;gap:10px;padding:12px 14px"></div>' +
      '<div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">Nothing is recorded or sent. The camera and microphone are turned off again when you close this.</div></div>';
    const parts = el.querySelector('[data-parts]');
    const sections = {};
    const make = (id, title) => {
      const box = document.createElement('div');
      box.dataset.part = id;
      box.style.cssText = 'border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:grid;gap:6px';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;gap:8px';
      const h = document.createElement('div');
      h.style.cssText = 'flex:1;font-size:12.5px;font-weight:650;color:var(--text)';
      h.textContent = this._t(title);
      const badge = document.createElement('span');
      badge.dataset.badge = '';
      badge.style.cssText = 'font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--border);color:var(--text-muted)';
      head.append(h, badge);
      const select = document.createElement('select');
      select.setAttribute('aria-label', this._t(title));
      select.style.cssText = 'max-width:100%;font-size:12px';
      const text = document.createElement('div');
      text.dataset.text = '';
      text.style.cssText = 'font-size:12px;color:var(--text-muted)';
      box.append(head, select, text);
      parts.appendChild(box);
      sections[id] = { box, badge, select, text, state: 'pending' };
      return sections[id];
    };
    const cam = make('camera', 'Camera');
    const video = document.createElement('video');
    video.muted = true; video.autoplay = true; video.playsInline = true;
    video.style.cssText = 'width:100%;max-width:320px;aspect-ratio:16/9;background:#000;border-radius:8px';
    cam.box.insertBefore(video, cam.text);
    const mic = make('microphone', 'Microphone');
    const meter = document.createElement('div');
    meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', this._t('Microphone level')); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100'); meter.setAttribute('aria-valuenow', '0');
    meter.style.cssText = 'height:10px;max-width:360px;border-radius:5px;background:var(--border);overflow:hidden';
    const fill = document.createElement('span');
    fill.style.cssText = 'display:block;height:100%;width:0;background:var(--primary)';
    meter.appendChild(fill);
    mic.box.insertBefore(meter, mic.text);
    const spk = make('speaker', 'Speakers or headphones');
    const toneRow = document.createElement('div');
    toneRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
    const playBtn = this._button('Play a test tone');
    const heardBtn = this._button('I heard it');
    const noBtn = this._button('I heard nothing');
    heardBtn.hidden = true; noBtn.hidden = true;
    toneRow.append(playBtn, heardBtn, noBtn);
    spk.box.insertBefore(toneRow, spk.text);
    const net = make('connection', 'Connection');
    net.select.remove();

    const c = { el, video, set: this.streamSet(), raf: 0, toneTimer: 0, sections, gen: { camera: 0, microphone: 0 }, started: 0, heard: false, micCtx: null, onKey: null, onLeave: null, onHidden: null, onBlur: null, onFocus: null, beat: 0, blurTimer: 0 };
    this._open = c;
    c.onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } };
    c.onLeave = () => this.close();
    c.onHidden = () => { if (document.hidden) this.close(); };
    c.onBlur = () => { clearTimeout(c.blurTimer); c.blurTimer = setTimeout(() => { if (this._open === c) this.close(); }, this.BLUR_CLOSE_MS); };
    c.onFocus = () => clearTimeout(c.blurTimer);
    document.addEventListener('keydown', c.onKey, true);
    window.addEventListener('vex:tab-activated', c.onLeave);
    document.addEventListener('vex:tab-navigated', c.onLeave);
    document.addEventListener('visibilitychange', c.onHidden);
    window.addEventListener('pagehide', c.onLeave);
    window.addEventListener('blur', c.onBlur);
    window.addEventListener('focus', c.onFocus);
    if (!document.hasFocus()) c.onBlur();
    // The heartbeat: renew the camera lease while the card is on screen and the window has focus. Nothing renews it otherwise,
    // so main lets it lapse by itself. A failed renewal is reported, not retried in a loop: the next beat is the retry.
    // One timeout that sets the next, not an interval: nothing is queued up behind a slow renewal.
    const beat = () => {
      c.beat = setTimeout(() => {
        if (this._open !== c) return;
        if (!document.hidden && document.hasFocus()) {
          Promise.resolve(window.vex.deviceCheckCamera(true)).catch((err) => window.VexProblems?.note('Device check', 'Could not renew the camera permission', err));
        }
        beat();
      }, this.HEARTBEAT_MS);
    };
    beat();
    el.querySelector('[data-close]').addEventListener('click', () => this.close());
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
    el.querySelector('[data-again]').addEventListener('click', () => { this._run(c).catch((err) => window.VexProblems?.note('Device check', 'The check could not run', err)); });
    cam.select.addEventListener('change', () => { this._camera(c, cam.select.value).catch((err) => this._fail(c, 'camera', err)); });
    mic.select.addEventListener('change', () => { this._mic(c, mic.select.value).catch((err) => this._fail(c, 'microphone', err)); });
    playBtn.addEventListener('click', () => { this._tone(c, spk.select.value, playBtn, heardBtn, noBtn).catch((err) => this._set(c, 'speaker', 'problem', this._t('The test tone could not play: {1}').replace('{1}', err.message))); });
    heardBtn.addEventListener('click', () => { heardBtn.hidden = true; noBtn.hidden = true; this._set(c, 'speaker', 'ok', this._t('You heard the tone, so the speakers work.')); });
    noBtn.addEventListener('click', () => { heardBtn.hidden = true; noBtn.hidden = true; this._set(c, 'speaker', 'problem', this._t('You heard nothing. Pick another output in the list and play the tone again, and check the volume and that the device is plugged in.')); });
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'dialog', id: 'device-check', close: () => this.close() });
    el.querySelector('[data-close]').focus({ preventScroll: true });
    await this._run(c);
    return c;
  },

  _button(text) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-secondary';
    b.textContent = this._t(text);
    b.style.cssText = 'font-size:11.5px;padding:3px 8px';
    return b;
  },

  _set(c, id, state, text) {
    if (this._open !== c) return;
    const s = c.sections[id];
    s.state = state;
    s.text.textContent = text;
    s.badge.textContent = this._t(state === 'ok' ? 'Looks good' : (state === 'problem' ? 'Needs a look' : 'Checking'));
    s.badge.style.color = state === 'ok' ? 'var(--success, #22c55e)' : (state === 'problem' ? '#ef4444' : 'var(--text-muted)');
    const sum = this.summary(Object.fromEntries(Object.entries(c.sections).map(([k, v]) => [k, { state: v.state }])));
    const top = c.el.querySelector('[data-summary]');
    top.textContent = sum.text;
    top.dataset.state = sum.state;
    top.style.color = sum.state === 'ok' ? 'var(--success, #22c55e)' : (sum.state === 'problem' ? '#ef4444' : 'var(--text)');
  },

  _fail(c, what, err) {
    this._set(c, what, 'problem', this.explain(err, what));
  },

  _fillSelect(select, devices, chosen, fallbackLabel) {
    const keep = chosen || select.value;
    select.textContent = '';
    devices.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || (fallbackLabel + ' ' + (i + 1));
      select.appendChild(o);
    });
    if (keep && [...select.options].some((o) => o.value === keep)) select.value = keep;
  },

  async _devices(kind) {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === kind && d.deviceId !== 'communications');
  },

  async _run(c) {
    // Start the four parts afresh. The camera and the microphone are asked for one after the other: each is its own permission.
    this._stopMedia(c);
    c.started = Date.now();
    c.heard = false;
    for (const id of ['camera', 'microphone', 'speaker', 'connection']) this._set(c, id, 'pending', this._t(id === 'speaker' ? 'Pick the output and press "Play a test tone".' : 'Checking…'));
    const results = await Promise.allSettled([
      this._camera(c, c.sections.camera.select.value).catch((err) => this._fail(c, 'camera', err)),
      this._mic(c, c.sections.microphone.select.value).catch((err) => this._fail(c, 'microphone', err)),
      this._connection(c),
    ]);
    await this._speakers(c);
    for (const r of results) if (r.status === 'rejected') window.VexProblems?.note('Device check', 'A part of the check failed', r.reason);
  },

  // Stops the camera and microphone streams, keeps the card.
  _stopMedia(c) {
    cancelAnimationFrame(c.raf);
    if (c.video) c.video.srcObject = null;
    c.gen.camera++; c.gen.microphone++;
    if (c.cameraStream) { c.set.stopStream(c.cameraStream); c.cameraStream = null; }
    if (c.micStream) { c.set.stopStream(c.micStream); c.micStream = null; }
    if (c.micCtx) { const ctx = c.micCtx; c.micCtx = null; Promise.resolve(c.set.closeContext(ctx)).catch((err) => console.error('[DeviceCheck] the meter context did not close:', err)); }
  },

  async _camera(c, deviceId) {
    const gen = ++c.gen.camera;
    if (c.cameraStream) { c.set.stopStream(c.cameraStream); c.cameraStream = null; c.video.srcObject = null; }
    const api = this._api();
    await api.deviceCheckCamera(true);
    if (this._open !== c || gen !== c.gen.camera) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true });
    if (!c.set.addStream(stream) || this._open !== c || gen !== c.gen.camera) { if (this._open === c) c.set.stopStream(stream); return; }
    c.cameraStream = stream;
    c.video.srcObject = stream;
    const sec = c.sections.camera;
    this._fillSelect(sec.select, await this._devices('videoinput'), (stream.getVideoTracks()[0].getSettings() || {}).deviceId, 'Camera');
    const track = stream.getVideoTracks()[0];
    const got = await new Promise((resolve) => {
      const done = (v) => { clearTimeout(timer); c.video.removeEventListener('loadeddata', onData); resolve(v); };
      const onData = () => done(true);
      const timer = setTimeout(() => done(c.video.videoWidth > 0), this.PICTURE_MS);
      if (c.video.readyState >= 2) done(true); else c.video.addEventListener('loadeddata', onData);
    });
    if (this._open !== c || gen !== c.gen.camera) return;
    if (got && track.readyState === 'live') this._set(c, 'camera', 'ok', this._t('You should see yourself above. If the picture is black, check the lens cover or pick another camera.'));
    else this._set(c, 'camera', 'problem', this._t('The camera opened but sent no picture. It may be covered, switched off with a privacy shutter, or used by another app.'));
  },

  async _mic(c, deviceId) {
    const gen = ++c.gen.microphone;
    cancelAnimationFrame(c.raf);
    if (c.micStream) { c.set.stopStream(c.micStream); c.micStream = null; }
    if (c.micCtx) { const old = c.micCtx; c.micCtx = null; await c.set.closeContext(old); }
    this._api();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (!c.set.addStream(stream) || this._open !== c || gen !== c.gen.microphone) { if (this._open === c) c.set.stopStream(stream); return; }
    c.micStream = stream;
    const sec = c.sections.microphone;
    this._fillSelect(sec.select, await this._devices('audioinput'), (stream.getAudioTracks()[0].getSettings() || {}).deviceId, 'Microphone');
    const ctx = new AudioContext();
    if (!c.set.addContext(ctx)) return;
    c.micCtx = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const meter = sec.box.querySelector('[role="meter"]');
    const fill = meter.firstElementChild;
    c.started = Date.now();
    c.heard = false;
    this._set(c, 'microphone', 'pending', this.micState(false, 0).text);
    const frame = () => {
      if (this._open !== c || gen !== c.gen.microphone) return;
      analyser.getFloatTimeDomainData(buf);
      const rms = this.levelOf(buf);
      const pct = Math.round(this.meterFill(rms) * 100);
      fill.style.width = pct + '%';
      meter.setAttribute('aria-valuenow', String(pct));
      if (rms >= this.HEARD_RMS) c.heard = true;
      const st = this.micState(c.heard, Date.now() - c.started);
      if (st.state !== sec.state) this._set(c, 'microphone', st.state, st.text);
      c.raf = requestAnimationFrame(frame);
    };
    c.raf = requestAnimationFrame(frame);
  },

  async _speakers(c) {
    let outs = [];
    try { outs = typeof AudioOutput !== 'undefined' ? await AudioOutput.devices() : (await this._devices('audiooutput')).map((d) => ({ id: d.deviceId, label: d.label })); }
    catch (err) { window.VexProblems?.note('Device check', 'Could not list the output devices', err); }
    if (this._open !== c) return;
    const sel = c.sections.speaker.select;
    sel.textContent = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = this._t('System default');
    sel.appendChild(first);
    for (const d of outs) {
      if (!d.id || d.id === 'default') continue;
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.label || this._t('Output');
      sel.appendChild(o);
    }
  },

  // A soft tone to the chosen output. The person says whether they heard it.
  async _tone(c, deviceId, playBtn, heardBtn, noBtn) {
    clearTimeout(c.toneTimer);
    if (c.toneCtx) { const old = c.toneCtx; c.toneCtx = null; await c.set.closeContext(old); }
    const ctx = new AudioContext();
    if (!c.set.addContext(ctx)) return;
    c.toneCtx = ctx;
    if (deviceId) {
      if (typeof ctx.setSinkId !== 'function') throw new Error(this._t('This window cannot choose an output device'));
      await ctx.setSinkId(deviceId);
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = this.TONE_HZ;
    const now = ctx.currentTime;
    const secs = this.TONE_MS / 1000;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.TONE_GAIN, now + 0.08);
    gain.gain.setValueAtTime(this.TONE_GAIN, now + secs - 0.12);
    gain.gain.linearRampToValueAtTime(0, now + secs);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + secs);
    playBtn.disabled = true;
    this._set(c, 'speaker', 'pending', this._t('Playing a soft tone for a second and a half…'));
    c.toneTimer = setTimeout(() => {
      playBtn.disabled = false;
      if (this._open !== c) return;
      heardBtn.hidden = false; noBtn.hidden = false;
      this._set(c, 'speaker', 'pending', this._t('Did you hear the tone?'));
      if (c.toneCtx === ctx) { c.toneCtx = null; Promise.resolve(c.set.closeContext(ctx)).catch((err) => console.error('[DeviceCheck] the tone context did not close:', err)); }
    }, this.TONE_MS + 100);
  },

  // The lowest time to a neutral host in one netLatency() answer (undefined: none answered). Shared with the speed test.
  lowestBaselineMs(res) {
    if (!res || !res.ok) throw new Error((res && res.error) || 'The check could not run');
    return (res.results || []).filter((r) => r.baseline && Number.isFinite(r.ms)).map((r) => r.ms).sort((a, b) => a - b)[0];
  },
  async _connection(c) {
    try {
      const res = await window.vex.netLatency();
      if (this._open !== c) return;
      const ms = this.lowestBaselineMs(res);
      const st = this.pingState(ms);
      this._set(c, 'connection', st.state, st.text);
    } catch (err) {
      this._set(c, 'connection', 'problem', this._t('The connection could not be measured: {1}').replace('{1}', err.message));
    }
  },
};

if (typeof window !== 'undefined') window.VexDeviceCheck = VexDeviceCheck;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDeviceCheck };
