// === Rename a tab, just for you (T3-118, the local rename) =====================
//
// "Rename tab..." in a tab's menu (or Ctrl+K, "Rename this tab") gives the page
// you are on a name of your own. The name belongs to the ADDRESS, not the tab: the
// same page opened again, in this tab or another, shows your name in the strip
// and the side list until you clear it. Nothing is sent to the site, and the
// page's real title is still what history, bookmarks and the window title use.
//
// The address is kept without its scheme, query and fragment ("docs.example.com/guide"),
// so a page that adds ?utm= or #section to itself keeps the name. Only ordinary web
// pages in the normal profile get one: a private, Tor or container tab is never
// written down, and neither is a page of Vex's own. At most 300 names are kept; the
// oldest go first.
const VexTabNames = {
  KEY: 'vex.tabNames',
  ON_KEY: 'vex.tabNamesOn',
  MAX: 300,
  MAX_LENGTH: 80,

  enabled() { return localStorage.getItem(this.ON_KEY) !== 'off'; },
  setEnabled(on) { localStorage.setItem(this.ON_KEY, on ? 'on' : 'off'); },

  // → 'host/path' for a page that may be named, else null.
  keyFor(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
    return (u.host + path).toLowerCase();
  },
  // A tab of the normal profile: a Tor, private or container session is never written down.
  allowed(tab) {
    if (!tab || !this.keyFor(tab.url)) return false;
    return !tab.partition || String(tab.partition) === 'persist:main';
  },

  all() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return {};
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[TabNames] the saved names are damaged and are not used:', err); return {}; }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  },
  nameFor(tab) {
    if (!this.enabled() || !this.allowed(tab)) return '';
    const n = this.all()[this.keyFor(tab.url)];
    return typeof n === 'string' ? n : '';
  },
  // What the strip and the list show for a tab.
  display(tab) {
    return this.nameFor(tab) || (tab ? tab.title : '');
  },

  set(tab, name) {
    if (!this.allowed(tab)) throw new Error('Only a web page in your normal profile can have a name of your own');
    const key = this.keyFor(tab.url);
    const clean = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, this.MAX_LENGTH);
    const names = this.all();
    delete names[key];                 // re-added last: the newest stays longest
    if (clean) names[key] = clean;
    const keys = Object.keys(names);
    for (const k of keys.slice(0, Math.max(0, keys.length - this.MAX))) delete names[k];
    if (Object.keys(names).length) localStorage.setItem(this.KEY, JSON.stringify(names)); else localStorage.removeItem(this.KEY);
    return clean;
  },

  async rename(tab) {
    if (!this.enabled()) throw new Error('Tab names are switched off in Settings');
    const target = tab || (typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null);
    if (!this.allowed(target)) throw new Error('Only a web page in your normal profile can have a name of your own');
    const value = await vexPrompt({ title: 'Rename this tab', label: 'Name for this page (blank = the page\'s own title)', value: this.nameFor(target) || target.title || '', okLabel: 'Rename' });
    if (value === null || value === undefined) return null;
    const clean = this.set(target, value);
    TabManager.rebuildAllTabs();
    window.showToast?.(clean ? 'Renamed to "' + clean + '"' : 'Back to the page\'s own title');
    return clean;
  },
};

if (typeof window !== 'undefined') window.VexTabNames = VexTabNames;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabNames };
