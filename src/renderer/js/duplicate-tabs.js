// === Opening something you already have open ===============================
//
// A bookmark, a shortcut, a link in a chat: you click it and get a second copy
// of a page that is already sitting three tabs to the left. Do that all day
// and half the tab bar is the same four pages.
//
// So when a tab is about to be opened for a page that is already open, Vex
// goes to the one you have instead, and says so. What counts as the same page
// is the same address in the same container — a Work-container Gmail and a
// personal one are two different things, and are left alone.
//
// Deliberate copies are not touched: Duplicate Tab, reopening a closed tab,
// and restoring a session all ask for a second copy on purpose.
const DuplicateTabs = {
  SETTING: 'vex.switchToOpen',

  enabled() { try { return localStorage.getItem(this.SETTING) !== 'off'; } catch { return true; } },
  setEnabled(on) { try { localStorage.setItem(this.SETTING, on ? 'on' : 'off'); } catch {} return !!on; },
  toggle() {
    const on = this.setEnabled(!this.enabled());
    window.showToast?.(on
      ? 'Opening a page you already have open goes to that tab'
      : 'A page you already have open opens again as a new tab');
    return on;
  },

  // The address, as a person means it: the fragment is a place on a page, and
  // one trailing slash is not a different page.
  norm(url) {
    try {
      const u = new URL(String(url));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      u.hash = '';
      let out = u.toString();
      if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '');
      return out.toLowerCase();
    } catch { return ''; }
  },

  // Two tabs are in the same jar when their partitions are the same, counting
  // "no partition" and the main one as the same thing.
  sameJar(a, b) {
    const jar = (p) => (!p || p === 'persist:main' ? '' : String(p));
    return jar(a) === jar(b);
  },

  // The tab already showing this page, or null. A sleeping tab counts — going
  // to it wakes it, which is what you wanted.
  match(tabs, url, partition) {
    if (!this.enabled()) return null;
    const want = this.norm(url);
    if (!want) return null;
    return (tabs || []).find(t => this.norm(t.url) === want && this.sameJar(t.partition, partition)) || null;
  },

  announce(tab) {
    window.showToast?.('Already open — switched to that tab');
    return tab;
  },
};

if (typeof window !== 'undefined') window.DuplicateTabs = DuplicateTabs;
if (typeof module !== 'undefined' && module.exports) module.exports = { DuplicateTabs };
