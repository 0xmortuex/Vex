// === Vex Blackops Decorations ===
//
// Decorations that only render when the blackops theme is active:
//   1. Boot overlay (fullscreen 1.5s on fresh launch when theme=blackops)
//   2. Bottom status bar (CIA-aesthetic "CLASSIFIED // CLEARANCE: TOP SECRET // …")
//   3. Faint corner watermark — handled in CSS only (assets/cia-seal.png)
//
// Pure presentational layer — no app behavior changes. If the seal asset is
// missing the boot overlay still works (the <img> simply hides on error).

const BlackopsDecor = {
  _statusInterval: null,
  _bootShown: false,

  init() {
    this._wireStatusBar();

    document.addEventListener('theme-changed', (e) => {
      const theme = e?.detail?.theme;
      if (theme === 'blackops') {
        this._showBootOverlay({ skipIfShown: true });
        this._updateStatusBar();
      }
    });

    if (typeof ThemeManager !== 'undefined' && ThemeManager.getCurrentTheme() === 'blackops') {
      this._showBootOverlay({ skipIfShown: true });
      this._updateStatusBar();
    }
  },

  _wireStatusBar() {
    if (this._statusInterval) return;
    this._updateStatusBar();
    this._statusInterval = setInterval(() => this._updateStatusBar(), 1000);
  },

  _updateStatusBar() {
    const bar = document.getElementById('vex-status-bar');
    if (!bar) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const time = `${hh}:${mm}:${ss}`;
    bar.innerHTML = [
      '<span>VEX</span>',
      '<span class="sep">//</span>',
      '<span>CLASSIFIED</span>',
      '<span class="sep">//</span>',
      '<span>CLEARANCE: TOP SECRET</span>',
      '<span class="sep">//</span>',
      `<span class="status-time">${time}</span>`,
      '<span class="status-spacer"></span>',
      '<span>COMPARTMENT-7741-ALPHA</span>'
    ].join('');
  },

  _showBootOverlay(opts) {
    opts = opts || {};
    if (opts.skipIfShown && this._bootShown) return;
    this._bootShown = true;

    const overlay = document.createElement('div');
    overlay.id = 'vex-boot-overlay';
    overlay.innerHTML = `
      <img id="vex-boot-seal" src="../../assets/cia-seal.png" alt="" onerror="this.style.display='none'">
      <div id="vex-boot-text">
        <div>VEX INTELLIGENCE INTERFACE</div>
        <div>COMPARTMENT-7741-ALPHA</div>
        <div id="vex-boot-status">AUTHENTICATING.</div>
      </div>
    `;
    document.body.appendChild(overlay);

    const statusEl = overlay.querySelector('#vex-boot-status');
    let dots = 1;
    const cycle = setInterval(() => {
      dots = (dots % 3) + 1;
      if (statusEl) statusEl.textContent = 'AUTHENTICATING' + '.'.repeat(dots);
    }, 200);

    setTimeout(() => {
      clearInterval(cycle);
      overlay.classList.add('fading-out');
      setTimeout(() => overlay.remove(), 320);
    }, 1500);
  }
};

if (typeof window !== 'undefined') {
  window.BlackopsDecor = BlackopsDecor;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BlackopsDecor };
}
