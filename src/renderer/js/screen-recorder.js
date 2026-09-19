// === Record the screen =======================================================
//
// Showing someone how to do something, or what went wrong, is a video, and
// making one meant installing a recorder. Chromium has one built in
// (MediaRecorder), and Vex already has the picker for choosing a screen or a
// window (the one Discord screen share uses). This joins them.
//
//   choose      the same picker as screen share, with its "share audio" box
//   record      MP4 where this build can make it (plays everywhere, embeds in
//               chats); WebM where it cannot
//   keep        written to disk a second at a time by main
//               (src/main/recordings.js) — a long recording never sits in
//               memory — and saved where you choose when you stop
//
// A small pill shows the time and has Stop and Discard. Ending the share from
// Windows' own controls stops the recording the same way.

const ScreenRecorder = {
  TIMESLICE_MS: 1000,
  _rec: null,             // { recorder, stream, id, ext, started, pill, timer, sending, failed }

  // Best format this build can produce, as { mime, ext }.
  //
  // WebM first, deliberately. This build CAN record MP4, but measured live its
  // MP4 muxer hands over nothing until Stop — a 36-byte header, then silence,
  // even when asked every second — so the whole recording would sit in memory
  // however long it ran. WebM arrives a chunk a second (~270 KB here) and goes
  // straight to disk. VP9 + Opus plays in Windows' Media Player, Chrome, VLC
  // and Discord. MP4 stays as the fallback for a build with no WebM.
  format(isSupported = (t) => (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t))) {
    for (const [mime, ext] of [
      ['video/webm;codecs=vp9,opus', 'webm'],
      ['video/webm;codecs=vp8,opus', 'webm'],
      ['video/webm', 'webm'],
      ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
      ['video/mp4', 'mp4'],
    ]) if (isSupported(mime)) return { mime, ext };
    return null;
  },

  recording() { return !!this._rec; },

  elapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0');
  },

  async start() {
    if (this._rec) throw new Error('Already recording — stop that one first');
    if (!window.vex || typeof window.vex.recStart !== 'function') throw new Error('Recording is not available in this build');
    const fmt = this.format();
    if (!fmt) throw new Error('This build of Chromium cannot record video');

    // Cancelling the picker and being refused before it ever opens both come
    // back as NotAllowedError. Only the first is "you chose nothing"; the
    // second is a failure and must say so — it once failed in silence, with
    // no picker and no word.
    let pickerSeen = false;
    const watch = setInterval(() => { if (document.querySelector('.scrpick-ov')) pickerSeen = true; }, 50);
    let stream;
    try {
      // Vex's own picker answers this (the same one Discord screen share uses).
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    } catch (err) {
      if (document.querySelector('.scrpick-ov')) pickerSeen = true;
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError') && pickerSeen) return null;   // chose nothing
      throw new Error('Screen capture was refused before anything could be chosen: ' + ((err && err.message) || err));
    } finally { clearInterval(watch); }
    return this._record(stream);
  },

  // Record any stream to a file: the chosen screen above, or a cropped part of
  // Vex's own window (js/area-recorder.js). `cleanup` runs when it ends.
  async _record(stream, { cleanup = null } = {}) {
    const fmt = this.format();
    if (!fmt) { stream.getTracks().forEach(t => t.stop()); throw new Error('This build of Chromium cannot record video'); }
    const opened = await window.vex.recStart(fmt.ext);
    if (!opened || !opened.ok) { stream.getTracks().forEach(t => t.stop()); throw new Error((opened && opened.error) || 'Could not start the recording file'); }

    let recorder;
    try { recorder = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 6_000_000 }); }
    catch (err) {
      stream.getTracks().forEach(t => t.stop());
      await window.vex.recCancel(opened.id);
      throw new Error('Could not start recording: ' + err.message);
    }

    const rec = { recorder, stream, id: opened.id, ext: fmt.ext, started: Date.now(), sending: Promise.resolve(), failed: null, cleanup };
    this._rec = rec;
    // Recording the screen is sharing it, as far as streamer mode is concerned.
    document.dispatchEvent(new CustomEvent('vex:media-capture', { detail: { where: 'vex', kind: 'screen', active: true } }));

    // Chunks go to main one after another, never in parallel: order matters.
    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      rec.sending = rec.sending.then(async () => {
        if (rec.failed) return;
        // A chunk refused by an IPC guard THROWS rather than answering; left
        // uncaught it broke this chain, and Stop/Discard then never reached
        // the step that removes the temporary file (seen live).
        try {
          const bytes = new Uint8Array(await e.data.arrayBuffer());
          const r = await window.vex.recChunk(rec.id, bytes);
          if (!r || !r.ok) throw new Error((r && r.error) || 'Could not write the recording');
        } catch (err) {
          rec.failed = (err && err.message) || 'Could not write the recording';
          if (this._rec === rec) this.stop();
        }
      });
    };
    // "Stop sharing" from Windows' own bar ends the video track: treat it as Stop.
    stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (this._rec === rec) this.stop(); }));

    recorder.start(this.TIMESLICE_MS);
    this._showPill(rec);
    window.showToast?.('Recording — ' + (stream.getAudioTracks().length ? 'with sound' : 'no sound') + '. Stop it from the red pill at the top.');
    return rec;
  },

  // Stop and save (or, with discard, throw the recording away).
  async stop(discard = false) {
    const rec = this._rec;
    if (!rec) return null;
    this._rec = null;
    document.dispatchEvent(new CustomEvent('vex:media-capture', { detail: { where: 'vex', kind: 'screen', active: false } }));
    clearInterval(rec.timer);
    rec.pill?.remove();
    await new Promise((resolve) => {
      if (rec.recorder.state === 'inactive') return resolve();
      rec.recorder.addEventListener('stop', resolve, { once: true });
      try { rec.recorder.stop(); } catch { resolve(); }
    });
    rec.stream.getTracks().forEach(t => { try { t.stop(); } catch { /* ended */ } });
    if (rec.cleanup) { try { rec.cleanup(); } catch (err) { window.VexProblems?.note('Recording', 'Could not release the capture', err); } }
    await rec.sending;                                   // the last chunk is on disk
    if (discard) { await window.vex.recCancel(rec.id); window.showToast?.('Recording discarded'); return { discarded: true }; }
    if (rec.failed) window.showToast?.(rec.failed + ' — saving what was recorded', 'error');
    const r = await window.vex.recFinish(rec.id);
    if (r && r.ok) {
      const mb = r.bytes / (1024 * 1024);
      window.showToast?.('Recording saved — ' + String(r.path).split(/[\\/]/).pop() + ' (' + (mb >= 10 ? Math.round(mb) : mb.toFixed(1)) + ' MB, ' + this.elapsed(Date.now() - rec.started) + ')');
    } else if (r && r.cancelled) window.showToast?.('Recording not saved');
    else window.showToast?.((r && r.error) || 'Could not save the recording', 'error');
    return r;
  },

  _showPill(rec, stop = (discard) => this.stop(discard)) {
    const pill = document.createElement('div');
    pill.className = 'vex-rec-pill';
    pill.setAttribute('role', 'status');
    pill.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:100000;display:flex;align-items:center;gap:10px;padding:6px 8px 6px 12px;border-radius:20px;background:#b3261e;color:#fff;font-size:12.5px;box-shadow:0 6px 20px rgba(0,0,0,0.35)';
    pill.innerHTML = `
      <span style="width:9px;height:9px;border-radius:50%;background:#fff;animation:vex-think-pulse 1.4s ease-in-out infinite"></span>
      <span data-time style="font-variant-numeric:tabular-nums">0:00</span>
      <button data-stop type="button" style="font:inherit;font-size:12px;padding:3px 10px;border-radius:14px;border:none;background:#fff;color:#b3261e;cursor:pointer;font-weight:600">Stop</button>
      <button data-discard type="button" title="Throw this recording away" style="font:inherit;font-size:12px;padding:3px 8px;border-radius:14px;border:1px solid rgba(255,255,255,0.6);background:none;color:#fff;cursor:pointer">Discard</button>`;
    const time = pill.querySelector('[data-time]');
    rec.timer = setInterval(() => { time.textContent = this.elapsed(Date.now() - rec.started); }, 1000);
    pill.querySelector('[data-stop]').addEventListener('click', () => stop(false));
    pill.querySelector('[data-discard]').addEventListener('click', async () => {
      if (await vexConfirm({ title: 'Discard this recording?', message: 'It is deleted, not saved.', okLabel: 'Discard', danger: true })) stop(true);
    });
    document.body.appendChild(pill);
    rec.pill = pill;
  },

  toggle() { return this._rec ? this.stop() : this.start(); },
};

if (typeof window !== 'undefined') window.ScreenRecorder = ScreenRecorder;
if (typeof module !== 'undefined' && module.exports) module.exports = { ScreenRecorder };
