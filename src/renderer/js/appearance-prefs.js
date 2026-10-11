// === Website appearance and Reduce motion (Settings > Appearance) ==========
//
// Website appearance: websites ignored Vex's theme. A dark Vex still showed
// every site's light design, with white scrollbars, because pages are told
// Windows' light/dark, not Vex's (cat-themes gaps). Electron has one switch for
// what pages are told, nativeTheme.themeSource (src/main/website-appearance.js);
// this decides its value:
//   vex      (the default) the light or dark Vex itself wears now: the theme's,
//            or dark under Glass
//   windows  whatever Windows' app mode says
//   light / dark  always that
//
// Reduce motion: Vex followed only Windows' "Animation effects". This switch
// stills Vex's own animations whatever Windows says; off, Windows decides
// (css/a11y.css carries both rules).
const WebsiteAppearance = {
  KEY: 'vex.websiteAppearance',
  MODES: ['vex', 'windows', 'light', 'dark'],
  _last: null,

  mode() {
    let v = null;
    try { v = localStorage.getItem(this.KEY); } catch (err) { console.error('[website-appearance] reading the setting:', err.message); }
    return this.MODES.includes(v) ? v : 'vex';
  },

  // What pages are told: nativeTheme.themeSource's value.
  source(mode) {
    mode = mode || this.mode();
    if (mode === 'windows') return 'system';
    if (mode === 'light' || mode === 'dark') return mode;
    // Vex's own: the color-scheme the window wears (css/theme-tokens.css sets
    // it from the theme, and dark under Glass).
    return /dark/.test(getComputedStyle(document.documentElement).colorScheme) ? 'dark' : 'light';
  },

  // Tells main when the answer changes. A private window leaves it to the main
  // window (main refuses theme:set* from one).
  apply() {
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return Promise.resolve(null);
    if (!window.vex || typeof window.vex.setWebsiteAppearance !== 'function') return Promise.reject(new Error('Website appearance cannot be set from here'));
    const s = this.source();
    if (s === this._last) return Promise.resolve(s);
    this._last = s;
    return window.vex.setWebsiteAppearance(s).then(() => s, (err) => { this._last = null; throw err; });
  },

  set(mode) {
    if (!this.MODES.includes(mode)) throw new Error('There is no website appearance called "' + mode + '"');
    localStorage.setItem(this.KEY, mode);
    return this.apply();
  },

  // Follows the theme and the GUI style as they change.
  listen() {
    const report = (err) => console.error('[website-appearance]', err && err.message);
    document.addEventListener('theme-changed', () => { this.apply().catch(report); });
    window.addEventListener('vex:gui-style', () => { this.apply().catch(report); });
  },

  wire() {
    const sel = document.getElementById('setting-website-appearance');
    if (sel && !sel.dataset.wired) {
      sel.dataset.wired = '1';
      sel.value = this.mode();
      sel.addEventListener('change', () => {
        this.set(sel.value).catch(err => window.showToast?.('Could not change how websites look: ' + err.message, 'error'));
      });
    }
  },
};

const ReduceMotion = {
  KEY: 'vex.reduceMotion',

  on() {
    try { return localStorage.getItem(this.KEY) === '1'; }
    catch (err) { console.error('[reduce-motion] reading the setting:', err.message); return false; }
  },

  apply() {
    if (this.on()) document.documentElement.setAttribute('data-reduce-motion', '');
    else document.documentElement.removeAttribute('data-reduce-motion');
  },

  set(on) {
    if (on) localStorage.setItem(this.KEY, '1'); else localStorage.removeItem(this.KEY);
    this.apply();
  },

  wire() {
    const box = document.getElementById('setting-reduce-motion');
    if (!box || box.dataset.wired) return;
    box.dataset.wired = '1';
    box.checked = this.on();
    box.addEventListener('change', () => this.set(box.checked));
  },
};

if (typeof window !== 'undefined') {
  window.WebsiteAppearance = WebsiteAppearance;
  window.ReduceMotion = ReduceMotion;
  // Before first paint, so nothing slides in that should not.
  ReduceMotion.apply();
  // Listening before ThemeManager.init's first applyTheme, which this follows.
  WebsiteAppearance.listen();
  const start = () => { WebsiteAppearance.wire(); ReduceMotion.wire(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

if (typeof module !== 'undefined' && module.exports) module.exports = { WebsiteAppearance, ReduceMotion };
