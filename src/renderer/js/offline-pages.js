// === Offline pages: mark a page as available without the internet ===========
//
// "Make available offline" keeps a copy of the page in front in the archive
// library (archive-library.js, main/archive-library.js): the same store, the
// same refusals (private, Tor, routed and container tabs, sites on Recall's
// "never remember" list, sign-in / bank / mail / health pages), the same size
// cap. This module adds only the list of what was marked and a section that
// can be built with no network at all.
//
// A page you had already archived yourself is marked without making a second
// copy, and un-marking it leaves your copy alone. A copy this module made is
// removed again when you un-mark it.
//
// State: localStorage 'vex.offline.pages' = [{ url, title, id, at, owned }]
// (this computer only). When a marked page will not load, the archive library
// already offers "Open your copy" (ArchiveLibrary.offerForDeadPage).
//
// Brief-ready section: { id, title, icon, build(), isEnabled() }. build() reads
// only local data and never touches the network, so it works offline.
const VexOfflinePages = {
  id: 'offline-ready',
  title: 'Available offline',
  icon: 'archive',
  KEY: 'vex.offline.pages',
  SETTING: 'offlinePages',
  MAX: 200,

  isEnabled() {
    return typeof VexExtras === 'undefined' ? true : VexExtras.get(this.SETTING, true) !== false;
  },

  list() {
    let raw;
    try { raw = localStorage.getItem(this.KEY); } catch { return []; }
    if (!raw) return [];
    let a;
    try { a = JSON.parse(raw); }
    catch (err) { throw new Error('The offline pages list could not be read', { cause: err }); }
    return Array.isArray(a) ? a.filter(p => p && typeof p.url === 'string' && typeof p.id === 'string') : [];
  },
  _save(list) {
    localStorage.setItem(this.KEY, JSON.stringify(list));
    try { document.dispatchEvent(new CustomEvent('vex:offline-pages-changed')); } catch { /* no document */ }
  },

  // The address without its fragment, so #section links count as the page.
  key(url) { return String(url || '').replace(/#.*$/, ''); },
  find(url) { const k = this.key(url); return this.list().find(p => this.key(p.url) === k) || null; },
  isOffline(url) { return !!this.find(url); },

  _api() { return (typeof window !== 'undefined' && window.vex) || null; },

  // Marks the page in front. Throws a plain reason when it must not be kept.
  async markActive() {
    if (typeof ArchiveLibrary === 'undefined') throw new Error('The archive library is not available here');
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    const url = wv && wv.getURL ? wv.getURL() : '';
    if (!/^https?:/i.test(url)) throw new Error('Only a web page can be made available offline');
    const list = this.list();
    if (list.some(p => this.key(p.url) === this.key(url))) throw new Error('This page is already available offline');
    if (list.length >= this.MAX) throw new Error('That is ' + this.MAX + ' offline pages already - un-mark some first');
    // Did the user already keep this page themselves?
    let owned = true, entry = null;
    const api = this._api();
    if (api && typeof api.pageArchiveFind === 'function') {
      const r = await api.pageArchiveFind(url);
      if (r && r.ok && r.entry) { entry = r.entry; owned = false; }
    }
    if (!entry) entry = await ArchiveLibrary.archiveActive();
    const rec = { url, title: String(entry.title || url).slice(0, 200), id: entry.id, at: Date.now(), owned, bytes: entry.bytes || 0 };
    list.push(rec);
    this._save(list);
    return rec;
  },

  async unmark(url) {
    const list = this.list();
    const i = list.findIndex(p => this.key(p.url) === this.key(url));
    if (i < 0) throw new Error('That page is not marked as available offline');
    const [rec] = list.splice(i, 1);
    if (rec.owned) {
      const api = this._api();
      if (!api || typeof api.pageArchiveRemove !== 'function') throw new Error('The archive library is not available here');
      const r = await api.pageArchiveRemove(rec.id);
      if (r && r.ok === false) throw new Error(r.error || 'The copy could not be removed');
    }
    this._save(list);
    return rec;
  },

  // Open the copy (works with no network: the viewer runs no script and
  // fetches nothing).
  async open(url) {
    const rec = this.find(url);
    if (!rec) throw new Error('That page is not marked as available offline');
    if (typeof ArchiveLibrary === 'undefined') throw new Error('The archive library is not available here');
    return ArchiveLibrary.openCopy(rec.id);
  },

  async toggleActive() {
    const wv = (typeof WebviewManager !== 'undefined') ? WebviewManager.getActiveWebview() : null;
    const url = wv && wv.getURL ? wv.getURL() : '';
    try {
      if (url && this.isOffline(url)) {
        await this.unmark(url);
        window.showToast?.('No longer marked as available offline');
        return false;
      }
      const rec = await this.markActive();
      window.showToast?.('Available offline: ' + rec.title.slice(0, 60), 'success');
      return true;
    } catch (err) {
      window.showToast?.(err.message, 'error', 6000);
      return null;
    }
  },

  // deps: { pages, online, readLater } for tests.
  build(now = Date.now(), deps = {}) {
    const pages = deps.pages || this.list();
    const online = deps.online !== undefined ? deps.online : (typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
    const lines = pages.slice().sort((a, b) => b.at - a.at).slice(0, 6).map(p => ({
      text: p.title || p.url,
      detail: 'Kept ' + new Date(p.at).toLocaleDateString() + (online ? '' : ' - open it from here'),
      url: p.url,
      offlineId: p.id,
    }));
    return {
      id: this.id, title: this.title, icon: this.icon,
      lines,
      online,
      count: pages.length,
      empty: lines.length === 0,
    };
  },

  openList() {
    const pages = this.list().sort((a, b) => b.at - a.at);
    return VexExtras.openReport({
      id: 'vex-offline-pages',
      title: 'Available offline',
      icon: this.icon,
      range: pages.length + (pages.length === 1 ? ' page' : ' pages'),
      sections: [{
        title: 'Pages with a copy on this computer',
        empty: 'Nothing is marked yet. Use "Make This Page Available Offline" in the command bar.',
        rows: pages.map(p => ({ text: p.title || p.url, sub: new Date(p.at).toLocaleDateString(), run: () => this.open(p.url) })),
      }],
      footer: 'Copies live in the archive library on this computer and are not synced.',
    });
  },
};

if (typeof window !== 'undefined') {
  window.VexOfflinePages = VexOfflinePages;
  if (typeof VexExtras !== 'undefined') {
    VexExtras.registerToggle({ key: 'offlinePages', label: 'Offline pages in the brief', hint: 'Shows the pages you marked as available offline. Marking a page keeps a copy in the archive library on this computer.', def: true });
    VexExtras.registerCommand({ id: 'offline-toggle', label: 'Make This Page Available Offline', hint: 'Keep a copy you can open without the internet (again to un-mark)', icon: 'archive', action: () => VexOfflinePages.toggleActive() });
    VexExtras.registerCommand({ id: 'offline-list', label: 'Pages Available Offline', hint: 'Open a page you marked', icon: 'archive', action: () => VexOfflinePages.openList() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexOfflinePages };
