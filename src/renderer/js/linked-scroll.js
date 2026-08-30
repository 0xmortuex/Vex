// === Vex Linked Split-Scroll ===
// In split screen, scroll one pane and the others follow (proportionally) — great
// for reading a doc next to a reference, or code next to its output. Poll-based so
// it needs no guest injection; toggle on/off. Ctrl+K → "Linked Scrolling".
const LinkedScroll = {
  _on: false, _timer: null, _last: [],

  _panes() {
    // In split mode multiple guest webviews are visible at once.
    return Array.from(document.querySelectorAll('#webviews-container webview'))
      .filter((w) => w.offsetWidth > 4 && w.offsetHeight > 4);
  },

  toggle() {
    if (this._on) { this.stop(); window.showToast?.('Linked scrolling off'); return; }
    if (this._panes().length < 2) { window.showToast?.('Enter split screen first (Ctrl+Shift+S), then link scrolling'); return; }
    this._on = true; this._last = [];
    this._timer = setInterval(() => this._sync(), 220);
    document.getElementById('linkedscroll-bar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'linkedscroll-bar';
    bar.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:100000;background:var(--surface,#222);color:var(--text,#eee);border:1px solid var(--border,#444);border-radius:20px;padding:6px 14px;box-shadow:0 6px 24px rgba(0,0,0,.4);font-size:12px;font-family:"Outfit",sans-serif;display:flex;align-items:center;gap:10px';
    bar.innerHTML = '🔗 Linked scrolling <button id="ls-off" style="background:var(--bg,#111);color:var(--text,#eee);border:1px solid var(--border,#444);border-radius:14px;padding:3px 10px;cursor:pointer;font-size:11px;font-family:inherit">Turn off</button>';
    document.body.appendChild(bar);
    bar.querySelector('#ls-off').addEventListener('click', () => { this.stop(); });
    window.showToast?.('🔗 Linked scrolling on — scroll a pane, the others follow');
  },

  stop() {
    this._on = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    document.getElementById('linkedscroll-bar')?.remove();
  },

  async _sync() {
    const panes = this._panes();
    if (panes.length < 2) { this.stop(); return; }
    let fracs;
    try {
      fracs = await Promise.all(panes.map(async (w) => {
        try { const r = await w.executeJavaScript('({y:window.scrollY,h:(document.documentElement.scrollHeight-window.innerHeight)})'); return (r && r.h > 0) ? Math.max(0, Math.min(1, r.y / r.h)) : null; } catch { return null; }
      }));
    } catch { return; }
    // Driver = the pane whose scroll fraction moved the most since last tick.
    let driver = -1, maxd = 0.004;
    for (let i = 0; i < panes.length; i++) {
      if (fracs[i] == null) continue;
      const prev = (this._last[i] == null) ? fracs[i] : this._last[i];
      const d = Math.abs(fracs[i] - prev);
      if (d > maxd) { maxd = d; driver = i; }
    }
    for (let i = 0; i < panes.length; i++) if (fracs[i] != null) this._last[i] = fracs[i];
    if (driver < 0) return;
    const f = fracs[driver];
    for (let j = 0; j < panes.length; j++) {
      if (j === driver || fracs[j] == null) continue;
      try { panes[j].executeJavaScript('window.scrollTo(0,(document.documentElement.scrollHeight-window.innerHeight)*' + f + ')'); this._last[j] = f; } catch {}
    }
  },
};

if (typeof window !== 'undefined') window.LinkedScroll = LinkedScroll;
