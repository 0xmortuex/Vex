// === Eyedropper — what colour is that? ======================================
//
// You are looking at a colour and you want its hex. Today that means a
// screenshot, a paint program, and a guess — or an extension you have to trust
// with every page you visit.
//
// Chromium has had the EyeDropper API since Chrome 95 and almost nothing uses
// it. It samples any pixel on the SCREEN, not just the page, so it works over a
// video, a PDF, another window, anything you can see. The magnifier is drawn by
// Chromium itself, so no page is injected into and no page is told.
//
// The colour is copied as hex, because that is what anyone asking this question
// is about to paste. The last few are kept so "what was that blue" has an
// answer.

const ColorPicker = {
  KEY: 'vex.recentColors',
  MAX: 12,
  recent: [],

  init() {
    try {
      const a = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      this.recent = Array.isArray(a) ? a.filter(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, this.MAX) : [];
    } catch { this.recent = []; }
    return this;
  },

  available() { return typeof window !== 'undefined' && typeof window.EyeDropper === 'function'; },

  _save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.recent)); } catch {}
  },

  _remember(hex) {
    this.recent = [hex, ...this.recent.filter(c => c.toLowerCase() !== hex.toLowerCase())].slice(0, this.MAX);
    this._save();
  },

  forget() { this.recent = []; try { localStorage.removeItem(this.KEY); } catch {} },

  // --- the numbers people actually want ---------------------------------
  rgb(hex) {
    const h = String(hex).replace('#', '');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  },

  hsl(hex) {
    let { r, g, b } = this.rgb(hex);
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) {
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  },

  // Perceived brightness (ITU-R BT.601), which is what decides whether text on
  // this colour should be black or white.
  isDark(hex) {
    const { r, g, b } = this.rgb(hex);
    return (r * 299 + g * 587 + b * 114) / 1000 < 140;
  },

  formats(hex) {
    const { r, g, b } = this.rgb(hex);
    const { h, s, l } = this.hsl(hex);
    return {
      hex: hex.toLowerCase(),
      rgb: `rgb(${r}, ${g}, ${b})`,
      hsl: `hsl(${h}, ${s}%, ${l}%)`,
    };
  },

  // --- picking -----------------------------------------------------------
  // Resolves to the hex, or null when the user pressed Escape. Anything else
  // is a real failure and is thrown.
  async pick() {
    if (!this.available()) throw new Error('This build of Chromium has no eyedropper');
    let result;
    try {
      result = await new window.EyeDropper().open();
    } catch (err) {
      // Escape and click-outside both land here as AbortError. Cancelling is
      // not an error and must not be reported as one.
      if (err && (err.name === 'AbortError' || /abort/i.test(err.message || ''))) return null;
      // Chromium only opens the magnifier in response to a real click or key
      // press of yours. Anything else — a scheduled task, the agent — is
      // refused, and "EyeDropper::open() requires user gesture" is not an
      // answer anybody wants.
      if (err && err.name === 'NotAllowedError') throw new Error('Start the eyedropper yourself — Chromium only opens it when you ask for it directly');
      throw err;
    }
    const hex = String((result && result.sRGBHex) || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error('The eyedropper returned something unreadable');
    this._remember(hex);
    try { await navigator.clipboard.writeText(hex); } catch { /* the toast still shows it */ }
    window.showToast?.(hex + ' copied — ' + this.formats(hex).rgb);
    return hex;
  },

  // --- the colours you picked earlier ------------------------------------
  openRecent() {
    document.querySelector('.vex-color-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-color-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:12vh';
    overlay.innerHTML = `
      <div class="vex-color-box" role="dialog" aria-modal="true" aria-label="Colours"
           style="width:min(520px,92vw);background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Colours</div>
          <button data-pick type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">Pick one</button>
          <button data-forget type="button" style="font-size:11.5px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer">Clear</button>
        </div>
        <div data-list style="padding:6px;max-height:56vh;overflow-y:auto"></div>
      </div>`;

    const listEl = overlay.querySelector('[data-list]');
    const draw = () => {
      if (!this.recent.length) {
        listEl.innerHTML = window.VexUI
          ? VexUI.emptyState('palette', 'No colours yet', 'Pick one from anywhere on the screen')
          : '<div style="padding:26px;text-align:center;font-size:12.5px;color:var(--text-muted)">No colours yet.</div>';
        return;
      }
      listEl.innerHTML = '';
      for (const hex of this.recent) {
        const f = this.formats(hex);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:8px;cursor:pointer';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.innerHTML = `
          <span style="flex:0 0 auto;width:30px;height:30px;border-radius:7px;border:1px solid var(--border);background:${esc(hex)}"></span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;color:var(--text);font-variant-numeric:tabular-nums">${esc(f.hex)}</div>
            <div style="font-size:10.5px;color:var(--text-muted)">${esc(f.rgb)} · ${esc(f.hsl)}</div>
          </div>
          <span data-copy style="font-size:11px;color:var(--text-muted)">Copy</span>`;
        row.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(hex); window.showToast?.(hex + ' copied'); }
          catch (err) { window.showToast?.('Could not copy that', 'error'); }
        });
        listEl.appendChild(row);
      }
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => {
      if (!overlay.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-pick]').addEventListener('click', async () => {
      // The magnifier is Chromium's own window; ours would sit on top of it.
      close();
      try { await this.pick(); } catch (err) { window.showToast?.(err.message, 'error'); }
      this.openRecent();
    });
    overlay.querySelector('[data-forget]').addEventListener('click', () => { this.forget(); draw(); });
    document.addEventListener('keydown', onKey, true);
    draw();
    document.body.appendChild(overlay);
    return overlay;
  },
};

if (typeof window !== 'undefined') window.ColorPicker = ColorPicker;
if (typeof module !== 'undefined' && module.exports) module.exports = { ColorPicker };
