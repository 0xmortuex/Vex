// === Which sites used your microphone and camera, and when =================
//
// Settings › Site Permissions already shows what is using the microphone or
// camera right now, with Stop. What it could not say is what happened while
// you were not looking: "discord.com used your microphone 3 times today".
// Every start and stop the tabs and panels already announce
// (vex:media-capture) is written down here — the site, which device, when —
// for thirty days. Private and Tor tabs leave nothing, as everywhere else.

const CaptureHistory = {
  KEY: 'vex.captureLog',
  MAX: 300,
  KEEP_MS: 30 * 24 * 60 * 60 * 1000,

  list() {
    let a;
    try { a = JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch (err) { throw new Error('The microphone and camera history could not be read', { cause: err }); }
    return Array.isArray(a) ? a.filter(e => e && typeof e.site === 'string' && (e.kind === 'mic' || e.kind === 'camera') && Number.isFinite(e.start)) : [];
  },
  _save(list) { localStorage.setItem(this.KEY, JSON.stringify(list)); },

  // Where a start or stop came from, as a site: the tab's host, or the
  // panel's page's host. null when it must not be kept (private, Tor).
  siteOf(detail) {
    if (detail.where === 'tab') {
      const tab = (typeof TabManager !== 'undefined' ? TabManager.tabs : []).find(t => t.id === detail.id);
      if (!tab) return null;
      if (window.VexTabPolicy && !window.VexTabPolicy.canPersist(tab)) return null;
      try { return new URL(tab.url).hostname.replace(/^www\./, ''); } catch { return null; }
    }
    if (detail.where === 'panel') {
      const wv = document.querySelector('#panel-' + detail.id + ' webview');
      try { if (wv && wv.getURL) return new URL(wv.getURL()).hostname.replace(/^www\./, ''); } catch { /* not loaded yet */ }
      return String(detail.id);
    }
    return null;
  },

  record(detail, now = Date.now()) {
    const site = this.siteOf(detail);
    if (!site || (detail.kind !== 'mic' && detail.kind !== 'camera')) return null;
    let list = this.list().filter(e => now - e.start < this.KEEP_MS);
    const open = list.find(e => e.site === site && e.kind === detail.kind && e.end == null);
    if (detail.active) {
      if (open) return open;                                   // already recorded as started
      const e = { site, kind: detail.kind, start: now, end: null };
      list.push(e);
      list = list.slice(-this.MAX);
      this._save(list);
      return e;
    }
    if (open) { open.end = now; this._save(list); }
    return open || null;
  },

  // Per site and device: times today, times this week, and when last.
  summary(now = Date.now()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const out = new Map();
    for (const e of this.list()) {
      const k = e.site + '|' + e.kind;
      const s = out.get(k) || { site: e.site, kind: e.kind, today: 0, week: 0, last: 0, now: false };
      if (e.start >= today.getTime()) s.today++;
      if (now - e.start < 7 * 86400000) s.week++;
      s.last = Math.max(s.last, e.start);
      if (e.end == null) s.now = true;
      out.set(k, s);
    }
    return [...out.values()].sort((a, b) => b.last - a.last);
  },

  clear() { localStorage.removeItem(this.KEY); },

  start() {
    document.addEventListener('vex:media-capture', (e) => {
      try { this.record(e.detail || {}); }
      catch (err) { console.warn('[CaptureHistory] could not record', err); window.VexProblems?.note('Permissions', 'Could not record microphone or camera use', err); }
    });
  },
};

if (typeof window !== 'undefined') { window.CaptureHistory = CaptureHistory; CaptureHistory.start(); }
if (typeof module !== 'undefined') module.exports = { CaptureHistory };
