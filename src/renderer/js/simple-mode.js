// === Simple mode ===========================================================
//
// Vex has a great many tools, and a newcomer meets all of them at once: twenty
// sidebar panels, a dozen toolbar buttons, forty sections of Settings. Simple
// mode is the calm version of the same browser — tabs, the address bar, Back /
// Forward / Reload, bookmarks, history, downloads, notes, privacy and Settings —
// with everything else tucked out of sight behind one "All features" switch.
//
// It only HIDES. Nothing is removed or switched off: every panel still opens
// from Ctrl+K and its shortcut, every setting is still found by the Settings
// search, and the user's own panel overrides, sidebar order and toolbar layout
// are never written — Simple mode is a view laid over them, so turning it off
// gives back exactly the browser that was there before.
//
//   vex.uiMode   'simple' | 'full'. Unset only on a profile that has not been
//                through first-run setup yet; it counts as Full until then.
//
// Who gets which:
//   * A new profile gets what the setup wizard picks (js/onboarding.js — the
//     "Choose your starting point" step offers Simple, pre-selected, or Full).
//   * An existing profile is marked Full once, before anything reads the mode
//     (migrate(), from js/app.js), so an update never changes a browser that
//     someone already uses.
//
// The pieces hidden live in css/simple-mode.css (toolbar, tools rail, advanced
// Settings) and in SidebarManager.applyPanelOverrides (the panel rail, through
// hidesPanel below).

const VexSimpleMode = {
  KEY: 'vex.uiMode',
  // What the setup wizard pre-selects for a new profile (and what one gets by
  // leaving setup before that step — Onboarding.finish).
  DEFAULT_FOR_NEW: 'simple',

  // The rail's panels kept in Simple mode. A pinned site (site_*) is the
  // user's own button and always stays.
  PANELS: ['start', 'bookmarks', 'history', 'downloads', 'notes', 'privacy', 'settings'],

  // Toolbar controls tucked away (css/simple-mode.css hides them; the list is
  // here so tests and the report can name them). Back / Forward / Reload, the
  // address bar, Downloads, the command bar, the window controls and the
  // status pills (Tor running, a timer, a held-back site, private routing)
  // stay.
  TOOLBAR: [
    'btn-onboarding', 'btn-restart-app', 'btn-copy-url', 'btn-ai-summarize',
    'btn-tor', 'btn-notes-top', 'btn-extensions', 'btn-toggle-ai', 'btn-split',
    'btn-dev-dash', 'btn-profile', 'workspace-switcher', 'sync-indicator',
  ],

  stored() {
    const v = localStorage.getItem(this.KEY);
    return v === 'simple' || v === 'full' ? v : null;
  },
  mode() { return this.stored() === 'simple' ? 'simple' : 'full'; },
  isSimple() { return this.mode() === 'simple'; },

  // Does Simple mode keep this rail button out of sight right now?
  hidesPanel(panel) {
    if (!panel || !this.isSimple()) return false;
    if (String(panel).startsWith('site_')) return false;
    return !this.PANELS.includes(panel);
  },

  // One-time marker for profiles that existed before Simple mode: they stay
  // Full. Runs before anything reads the mode. Returns what it wrote, or null.
  migrate() {
    if (window.VexTabPolicy?.isPrivateWindow) return null;   // its own throwaway storage
    if (this.stored() != null) return null;
    if (typeof Onboarding === 'undefined') throw new Error('[SimpleMode] Onboarding is not loaded — cannot tell a new profile from an old one');
    if (!(Onboarding.done() || Onboarding._usedBefore())) return null;  // new: the wizard decides
    localStorage.setItem(this.KEY, 'full');
    return 'full';
  },

  // Switch modes. Instant: no reload, nothing of the user's own rewritten.
  set(mode) {
    if (mode !== 'simple' && mode !== 'full') throw new Error('[SimpleMode] unknown mode: ' + mode);
    localStorage.setItem(this.KEY, mode);
    this.apply();
    // Settings › Sidebar Buttons says which buttons Simple mode is keeping back.
    if (typeof SidebarManager !== 'undefined') SidebarManager.renderSidebarManager();
    window.dispatchEvent(new CustomEvent('vex-ui-mode-changed', { detail: { mode } }));
    return mode;
  },

  toggle() { return this.set(this.isSimple() ? 'full' : 'simple'); },

  // The "All features" button: everything back, and where to find the switch.
  showAll() {
    this.set('full');
    window.showToast?.('All features are on. Settings › General › Simple mode tucks them away again.', 'info', 6000);
  },

  apply() {
    const simple = this.isSimple();
    document.body.dataset.uiMode = simple ? 'simple' : 'full';
    const btn = document.getElementById('btn-all-features');
    if (btn) btn.hidden = !simple;
    const box = document.getElementById('setting-simple-mode');
    if (box) box.checked = simple;
    // (The toolbar overflow menu re-fits by itself: js/toolbar-overflow.js
    // watches body[data-ui-mode].)
    if (typeof SidebarManager !== 'undefined') {
      // A panel that is open when its button goes out of sight stays open —
      // closing what someone is looking at is not "tucking away".
      SidebarManager.applyPanelOverrides();
    }
    return simple;
  },

  init() {
    const btn = document.getElementById('btn-all-features');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.innerHTML = VexIcons.svg('grid', { size: 14 }) + '<span class="all-features-label">All features</span>';
      btn.addEventListener('click', () => this.showAll());
    }
    const box = document.getElementById('setting-simple-mode');
    if (box && !box.dataset.wired) {
      box.dataset.wired = '1';
      box.addEventListener('change', () => {
        this.set(box.checked ? 'simple' : 'full');
        window.showToast?.(box.checked
          ? 'Simple mode on — press All features in the toolbar to see everything'
          : 'All features are on');
      });
    }
    this.apply();
  },
};

if (typeof window !== 'undefined') window.VexSimpleMode = VexSimpleMode;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSimpleMode };
