// === Vex Image Zoom — right-click an image → pan & zoom lightbox ===
//
// Opens the image in a full-window overlay: scroll to zoom (anchored at the
// cursor), drag to pan, double-click to fit, +/- keys, Esc / click-backdrop to
// close. Wired from the image context menu in webview.js (ImageZoom.open(url)).
// The image is loaded in the host renderer via a plain <img>, so cross-origin
// images display fine (no canvas reads, so no CORS needed).

const ImageZoom = {
  _el: null, _img: null, _pct: null,
  _s: 1, _tx: 0, _ty: 0, _natW: 0, _natH: 0,
  _drag: null, _onKey: null, _mm: null, _mu: null,

  open(url) {
    if (!url) return;
    this.close();
    this._injectStyles();

    const el = document.createElement('div');
    el.className = 'vex-imgzoom';
    el.innerHTML = `
      <div class="vex-imgzoom-bar">
        <span class="vex-imgzoom-pct">—</span>
        <button class="vex-imgzoom-reset" title="Fit (double-click image)">Fit</button>
        <button class="vex-imgzoom-close" title="Close (Esc)">✕</button>
      </div>
      <img class="vex-imgzoom-img" draggable="false" alt="">`;
    document.body.appendChild(el);
    this._el = el;
    this._img = el.querySelector('.vex-imgzoom-img');
    this._pct = el.querySelector('.vex-imgzoom-pct');

    this._img.onload = () => {
      this._natW = this._img.naturalWidth || this._img.width || 0;
      this._natH = this._img.naturalHeight || this._img.height || 0;
      this._fit();
    };
    this._img.onerror = () => { window.showToast?.('Could not load image'); this.close(); };
    this._img.src = url;

    el.addEventListener('wheel', (e) => { e.preventDefault(); this._zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    this._img.addEventListener('mousedown', (e) => { e.preventDefault(); this._drag = { x: e.clientX, y: e.clientY, tx: this._tx, ty: this._ty }; });
    this._mm = (e) => { if (!this._drag) return; this._tx = this._drag.tx + (e.clientX - this._drag.x); this._ty = this._drag.ty + (e.clientY - this._drag.y); this._render(); };
    this._mu = () => { this._drag = null; };
    window.addEventListener('mousemove', this._mm);
    window.addEventListener('mouseup', this._mu);
    this._img.addEventListener('dblclick', () => this._fit());

    el.querySelector('.vex-imgzoom-reset').addEventListener('click', (e) => { e.stopPropagation(); this._fit(); });
    el.querySelector('.vex-imgzoom-close').addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
    // Click on the empty backdrop (not the image or bar) closes.
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });

    this._onKey = (e) => {
      if (e.key === 'Escape') this.close();
      else if (e.key === '+' || e.key === '=') this._zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.2);
      else if (e.key === '-' || e.key === '_') this._zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.2);
      else if (e.key === '0') this._fit();
    };
    document.addEventListener('keydown', this._onKey, true);
  },

  _fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!this._natW || !this._natH) { this._s = 1; this._tx = 0; this._ty = 0; this._render(); return; }
    const s = Math.min(vw * 0.92 / this._natW, vh * 0.86 / this._natH, 1);
    this._s = s > 0 ? s : 1;
    this._tx = (vw - this._natW * this._s) / 2;
    this._ty = (vh - this._natH * this._s) / 2 + 6;
    this._render();
  },

  // Zoom keeping the point under the cursor fixed (transform-origin is 0 0).
  _zoomAt(cx, cy, factor) {
    const ns = Math.max(0.05, Math.min(40, this._s * factor));
    this._tx = cx - (cx - this._tx) * (ns / this._s);
    this._ty = cy - (cy - this._ty) * (ns / this._s);
    this._s = ns;
    this._render();
  },

  _render() {
    if (!this._img) return;
    this._img.style.transform = `translate(${this._tx}px, ${this._ty}px) scale(${this._s})`;
    if (this._pct) this._pct.textContent = Math.round(this._s * 100) + '%';
  },

  close() {
    if (this._onKey) document.removeEventListener('keydown', this._onKey, true);
    if (this._mm) window.removeEventListener('mousemove', this._mm);
    if (this._mu) window.removeEventListener('mouseup', this._mu);
    if (this._el) { this._el.remove(); this._el = null; }
    this._img = this._pct = this._drag = this._onKey = this._mm = this._mu = null;
  },

  _injectStyles() {
    if (document.getElementById('vex-imgzoom-styles')) return;
    const st = document.createElement('style');
    st.id = 'vex-imgzoom-styles';
    st.textContent = `
      .vex-imgzoom{position:fixed;inset:0;z-index:100100;background:rgba(0,0,0,0.92);overflow:hidden;cursor:grab;animation:vexImgZoomIn .12s ease;}
      .vex-imgzoom:active{cursor:grabbing;}
      @keyframes vexImgZoomIn{from{opacity:0}to{opacity:1}}
      .vex-imgzoom-img{position:absolute;top:0;left:0;transform-origin:0 0;user-select:none;-webkit-user-drag:none;max-width:none;max-height:none;image-rendering:auto;}
      .vex-imgzoom-bar{position:fixed;top:12px;right:14px;z-index:2;display:flex;gap:8px;align-items:center;}
      .vex-imgzoom-pct{color:#fff;font:600 12px/1 ui-monospace,monospace;background:rgba(0,0,0,0.45);padding:7px 9px;border-radius:7px;min-width:42px;text-align:center;}
      .vex-imgzoom-bar button{background:rgba(255,255,255,0.13);color:#fff;border:none;border-radius:7px;padding:7px 11px;cursor:pointer;font:600 12px/1 'Segoe UI',sans-serif;}
      .vex-imgzoom-bar button:hover{background:rgba(255,255,255,0.26);}
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') window.ImageZoom = ImageZoom;
if (typeof module !== 'undefined' && module.exports) module.exports = { ImageZoom };
