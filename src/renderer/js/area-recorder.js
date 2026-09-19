// === Record a tab, or part of the window — as a video or a GIF =============
//
// The screen recorder (js/screen-recorder.js) records a whole screen or a
// whole window, through the picker. Showing one page, or one bug in one
// corner of it, wants less: this records Vex's own window with no picker,
// cropped to the tab or to a box you drag, and as a GIF when it is a short
// clip for a chat or an issue.
//
// How: main hands over this window's capture id; the window is captured
// (getUserMedia, desktop source), drawn cropped onto a canvas, and either the
// canvas is recorded as video (the screen recorder's file pipeline and pill)
// or frames are taken from it ten times a second, reduced to the GIF palette
// as they come (js/gif-encoder.js), and written when you stop. A GIF stops by
// itself after 30 seconds: past that it is a video's job.
const AreaRecorder = {
  GIF_FPS: 10,
  GIF_MAX_S: 30,
  GIF_MAX_WIDTH: 640,
  _gif: null,

  async _windowStream() {
    const id = await window.vex.recOwnWindow();
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxFrameRate: 30 } } });
  },

  tabRect() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) throw new Error('No tab is open');
    const r = wv.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) throw new Error('The tab is not on screen');
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  },

  // Drag a box over the window. → { x, y, w, h } in CSS pixels, or null (Esc).
  pickArea() {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'vex-area-pick';
      ov.style.cssText = 'position:fixed;inset:0;z-index:100001;cursor:crosshair;background:rgba(0,0,0,0.25)';
      ov.innerHTML = '<div data-hint style="position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:8px;background:rgba(0,0,0,0.75);color:#fff;font-size:12.5px">Drag over what to record · Esc to cancel</div><div data-box style="position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,0.35);display:none"></div>';
      const box = ov.querySelector('[data-box]');
      let start = null;
      const done = (rect) => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(rect); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
      ov.addEventListener('mousedown', (e) => { start = { x: e.clientX, y: e.clientY }; box.style.display = 'block'; });
      ov.addEventListener('mousemove', (e) => {
        if (!start) return;
        const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
        Object.assign(box.style, { left: x + 'px', top: y + 'px', width: Math.abs(e.clientX - start.x) + 'px', height: Math.abs(e.clientY - start.y) + 'px' });
      });
      ov.addEventListener('mouseup', (e) => {
        if (!start) return;
        const rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
        done(rect.w >= 20 && rect.h >= 20 ? rect : null);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(ov);
    });
  },

  // The window, cropped to `rect`, on a canvas redrawn every frame.
  // `scaleTo` limits the canvas width (a GIF does not need 4K).
  async _cropped(rect, scaleTo = Infinity) {
    const stream = await this._windowStream();
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // Capture pixels per CSS pixel, measured, so display scaling is right.
    const k = video.videoWidth / window.innerWidth;
    const sw = Math.round(rect.w * k), sh = Math.round(rect.h * k);
    const fit = Math.min(1, scaleTo / sw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(sw * fit) & ~1);
    canvas.height = Math.max(2, Math.round(sh * fit) & ~1);
    const ctx = canvas.getContext('2d', { willReadFrequently: scaleTo !== Infinity });
    let alive = true;
    const draw = () => { if (!alive) return; ctx.drawImage(video, Math.round(rect.x * k), Math.round(rect.y * k), sw, sh, 0, 0, canvas.width, canvas.height); requestAnimationFrame(draw); };
    draw();
    const stop = () => { alive = false; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
    return { canvas, ctx, stop };
  },

  // what: 'tab' | 'area'; gif: a GIF instead of a video.
  async record({ what = 'tab', gif = false } = {}) {
    if (ScreenRecorder._rec || this._gif) throw new Error('Already recording — stop that one first');
    const rect = what === 'tab' ? this.tabRect() : await this.pickArea();
    if (!rect) return null;
    const src = await this._cropped(rect, gif ? this.GIF_MAX_WIDTH : Infinity);
    if (!gif) return ScreenRecorder._record(src.canvas.captureStream(30), { cleanup: src.stop });

    const g = { src, frames: [], started: Date.now(), width: src.canvas.width, height: src.canvas.height };
    g.tick = setInterval(() => {
      g.frames.push(GifEncoder.quantize(src.ctx.getImageData(0, 0, g.width, g.height).data));
      if (Date.now() - g.started >= this.GIF_MAX_S * 1000) this.stopGif();
    }, 1000 / this.GIF_FPS);
    this._gif = g;
    ScreenRecorder._showPill(g, (discard) => this.stopGif(discard));
    window.showToast?.('Recording a GIF — up to ' + this.GIF_MAX_S + ' seconds. Stop it from the red pill.');
    return g;
  },

  async stopGif(discard = false) {
    const g = this._gif;
    if (!g) return null;
    this._gif = null;
    clearInterval(g.tick);
    clearInterval(g.timer);
    g.pill?.remove();
    g.src.stop();
    if (discard) { window.showToast?.('Recording discarded'); return { discarded: true }; }
    if (!g.frames.length) throw new Error('Nothing was recorded');
    const bytes = GifEncoder.encode({ width: g.width, height: g.height, frames: g.frames, delayMs: 1000 / this.GIF_FPS });
    const opened = await window.vex.recStart('gif');
    if (!opened || !opened.ok) throw new Error((opened && opened.error) || 'Could not start the file');
    for (let i = 0; i < bytes.length; i += 16 * 1024 * 1024) {
      const r = await window.vex.recChunk(opened.id, bytes.subarray(i, i + 16 * 1024 * 1024));
      if (!r || !r.ok) { await window.vex.recCancel(opened.id); throw new Error((r && r.error) || 'Could not write the GIF'); }
    }
    const r = await window.vex.recFinish(opened.id, 'vex-clip');
    if (r && r.ok) window.showToast?.('GIF saved — ' + String(r.path).split(/[\\/]/).pop() + ' (' + (r.bytes / (1024 * 1024)).toFixed(1) + ' MB, ' + g.frames.length + ' frames)');
    else if (r && r.cancelled) window.showToast?.('GIF not saved');
    else throw new Error((r && r.error) || 'Could not save the GIF');
    return r;
  },
};

if (typeof window !== 'undefined') window.AreaRecorder = AreaRecorder;
if (typeof module !== 'undefined' && module.exports) module.exports = { AreaRecorder };
