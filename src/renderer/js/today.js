// === Today ==================================================================
//
// One place that shows what is going to happen and what happened: reminders
// due today, scheduled tasks about to run, watched pages that changed, pages
// saved for later recently. Every one of those is already stored somewhere in
// Vex; nothing showed them together.
//
// The new tab page is a separate document (start.html in a webview) with no
// bridge to the main process, but it shares this renderer's localStorage. So
// this module builds a small snapshot here, where everything is reachable,
// and writes it to localStorage under 'vex.today'; the start page reads that
// and re-renders on the storage event. The snapshot is display data only —
// nothing acts on it.
const VexToday = {
  KEY: 'vex.today',
  MAX_PER_KIND: 6,
  _timer: null,

  init() {
    this.refresh();
    clearInterval(this._timer);
    this._timer = setInterval(() => this.refresh(), 60 * 1000);
    const b = window.vex && window.vex.reminders;
    if (b && typeof b.onFired === 'function') b.onFired(() => this.refresh());
    return true;
  },

  // Build the snapshot. Each source is optional and isolated: one failing
  // does not blank the others, and the failure is written into the snapshot
  // rather than hidden, so the page can say "reminders could not be read".
  async build() {
    const now = Date.now();
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = startOfDay.getTime() + 24 * 3600 * 1000;
    const snap = { at: now, reminders: [], tasks: [], changed: [], saved: [], errors: [] };

    try {
      const b = window.vex && window.vex.reminders;
      if (b && typeof b.list === 'function') {
        const all = await b.list();
        snap.reminders = all
          .filter(r => !r.firedAt && ((r.at != null && r.at < endOfDay) || r.site))
          .sort((a, c) => (a.at == null ? Infinity : a.at) - (c.at == null ? Infinity : c.at))
          .slice(0, this.MAX_PER_KIND)
          .map(r => ({ id: r.id, text: r.message, at: r.at, site: r.site || null, url: r.url || null, overdue: r.at != null && r.at < now, repeat: r.repeat || null }));
      }
    } catch (err) { snap.errors.push('reminders: ' + ((err && err.message) || 'unavailable')); }

    try {
      if (typeof Scheduler !== 'undefined' && Scheduler.getAllTasks) {
        snap.tasks = Scheduler.getAllTasks()
          .filter(t => t.enabled)
          .map(t => { let next = null; try { next = Scheduler.nextOccurrence(t, now); } catch { next = null; } return { id: t.id, text: t.name, at: next, action: (() => { try { return Scheduler.describeAction(t); } catch { return ''; } })() }; })
          .filter(t => t.at != null && t.at < endOfDay)
          .sort((a, c) => a.at - c.at)
          .slice(0, this.MAX_PER_KIND);
      }
    } catch (err) { snap.errors.push('scheduled tasks: ' + ((err && err.message) || 'unavailable')); }

    try {
      if (typeof WebMonitor !== 'undefined' && Array.isArray(WebMonitor.watches)) {
        snap.changed = WebMonitor.watches
          .filter(w => w.changed)
          .sort((a, c) => (c.changedAt || 0) - (a.changedAt || 0))
          .slice(0, this.MAX_PER_KIND)
          .map(w => ({ id: w.id, text: w.title || w.url, url: w.url, at: w.changedAt || null }));
      }
    } catch (err) { snap.errors.push('watched pages: ' + ((err && err.message) || 'unavailable')); }

    try {
      if (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) {
        snap.saved = ReadLater.items
          .filter(i => !i.read && i.at && now - i.at < 48 * 3600 * 1000)
          .sort((a, c) => c.at - a.at)
          .slice(0, this.MAX_PER_KIND)
          .map(i => ({ id: i.id, text: i.title || i.url, url: i.url, at: i.at }));
      }
    } catch (err) { snap.errors.push('read later: ' + ((err && err.message) || 'unavailable')); }

    return snap;
  },

  async refresh() {
    const snap = await this.build();
    this._last = snap;
    try { localStorage.setItem(this.KEY, JSON.stringify(snap)); }
    catch (err) { console.error('[Today] could not write the snapshot:', err.message); return null; }
    this.pushAll();
    return snap;
  },

  // The start page runs in its own session partition, so this renderer's
  // localStorage is not visible there. The snapshot is handed to each open
  // start page directly, on its dom-ready and on every refresh — the same
  // route the theme attribute takes.
  _last: null,
  isStartPage(url) { return /\/renderer\/start\.html(?:[?#]|$)/i.test(String(url || '')); },

  push(webview) {
    if (!webview || typeof webview.executeJavaScript !== 'function') return false;
    let url = '';
    try { url = webview.getURL(); } catch { return false; }
    if (!this.isStartPage(url)) return false;
    const snap = this._last;
    if (!snap) return false;
    const code = `(() => { window.__vexToday = ${JSON.stringify(snap)}; window.dispatchEvent(new Event('vex-today')); return true; })()`;
    webview.executeJavaScript(code).catch(err => console.error('[Today] could not hand the snapshot to the start page:', err && err.message));
    return true;
  },

  pushAll() {
    // WebviewManager is a top-level const, not a window property.
    const wm = (typeof WebviewManager !== 'undefined') ? WebviewManager : (window.WebviewManager || null);
    if (!wm || !wm.webviews || typeof wm.webviews.values !== 'function') return 0;
    let n = 0;
    for (const wv of wm.webviews.values()) { try { if (this.push(wv)) n++; } catch { /* a detached webview */ } }
    return n;
  },
};

if (typeof window !== 'undefined') window.VexToday = VexToday;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexToday };
