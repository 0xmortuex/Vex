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
    this._timer?.stop();
    this._timer = VexJobs.every('Today refresh', 60 * 1000, () => this.refresh());
    const b = window.vex && window.vex.reminders;
    if (b && typeof b.onFired === 'function') b.onFired(() => this.refresh());
    return true;
  },

  // Build the snapshot. Each source is optional and isolated: one failing
  // does not blank the others, and the failure is written into the snapshot
  // rather than hidden, so the page can say "reminders could not be read".
  async build() {
    const now = Date.now();
    // From `now`, not a second clock: the two drifted apart across midnight.
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = startOfDay.getTime() + 24 * 3600 * 1000;
    let job = null;
    try { job = (typeof JobProfiles !== 'undefined' && JobProfiles.current) ? JobProfiles.current() : null; } catch { job = null; }
    const snap = { at: now, job, reminders: [], tasks: [], changed: [], saved: [], recent: [], errors: [] };

    try {
      const b = window.vex && window.vex.reminders;
      if (b && typeof b.list === 'function') {
        const all = await b.list();
        snap.reminders = all
          .filter(r => !r.firedAt && r.kind !== 'review' && ((r.at != null && r.at < endOfDay) || r.site))
          .sort((a, c) => (a.at == null ? Infinity : a.at) - (c.at == null ? Infinity : c.at))
          .slice(0, this.MAX_PER_KIND)
          .map(r => ({ id: r.id, text: r.message, at: r.at, site: r.site || null, url: r.url || null, overdue: r.at != null && r.at < now, repeat: r.repeat || null, kind: r.kind || 'reminder', job: r.job || null, forWork: !!(job && r.job === job) }));
      }
    } catch (err) { snap.errors.push('reminders: ' + ((err && err.message) || 'unavailable')); }

    // Pages visited most recently — the new tab page's Recent list, which was
    // a placeholder nothing ever filled.
    try {
      if (typeof HistoryPanel !== 'undefined' && typeof HistoryPanel.list === 'function') {
        const seen = new Set();
        snap.recent = HistoryPanel.list()
          .filter(e => e && e.url && /^https?:/i.test(e.url) && !seen.has(e.url) && seen.add(e.url))
          .slice(0, 8)
          .map(e => ({ url: e.url, text: e.title || e.url, at: e.timestamp || e.at || e.visitedAt || null, favicon: e.favicon || null }));
      }
    } catch (err) { snap.errors.push('recent pages: ' + ((err && err.message) || 'unavailable')); }

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
      // Page watches (page-watch.js) that changed in the last day. This read
      // a WebMonitor that never existed, so the section was always empty.
      if (window.PageWatch) {
        snap.changed = window.PageWatch.list()
          .filter(w => w.lastChangedAt && now - w.lastChangedAt < 24 * 3600 * 1000)
          .sort((a, c) => c.lastChangedAt - a.lastChangedAt)
          .slice(0, this.MAX_PER_KIND)
          .map(w => ({ id: w.id, text: w.title || w.url, url: w.url, at: w.lastChangedAt }));
      }
    } catch (err) { snap.errors.push('watched pages: ' + ((err && err.message) || 'unavailable')); }

    // The world clock's cities, as they read right now.
    try {
      if (typeof VexClock !== 'undefined' && VexClock.cities) {
        snap.clock = VexClock.cities().slice(0, 6).map(c => {
          const p = VexClock.partsIn(c.zone, now);
          return { name: c.name, zone: c.zone, hhmm: String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0'), offset: VexClock.offsetLabel(c.zone, now), day: p.hour >= 7 && p.hour < 19 };
        });
      }
    } catch (err) { snap.errors.push('world clock: ' + ((err && err.message) || 'unavailable')); }

    try {
      if (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) {
        snap.saved = ReadLater.items
          .filter(i => !i.read && i.at && now - i.at < 48 * 3600 * 1000)
          .sort((a, c) => c.at - a.at)
          .slice(0, this.MAX_PER_KIND)
          .map(i => ({ id: i.id, text: i.title || i.url, url: i.url, at: i.at }));
      }
    } catch (err) { snap.errors.push('read later: ' + ((err && err.message) || 'unavailable')); }

    // The morning brief, if one was written today.
    const brief = this.brief(now);
    if (brief) snap.brief = brief;

    return snap;
  },

  // ---- The morning brief -----------------------------------------------------
  // A paragraph at the top of Today on the new tab page: the day in plain
  // words. Written by the AI only when asked (Ctrl+K › Write my morning brief)
  // — never on its own, so opening a new tab never loads a model.
  BRIEF_KEY: 'vex.morningBrief',
  _day(ms) { const d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); },
  brief(now = Date.now()) {
    try {
      const b = JSON.parse(localStorage.getItem(this.BRIEF_KEY) || 'null');
      return b && b.day === this._day(now) && b.text ? { text: b.text, at: b.at } : null;
    } catch { return null; }
  },

  // What the brief is written from — only what Vex has, so nothing is made up.
  briefFacts(snap, headlines = []) {
    const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const lines = [];
    for (const r of snap.reminders) lines.push('Reminder' + (r.site ? ' (when on ' + r.site + ')' : ' at ' + hhmm(r.at)) + (r.overdue ? ', overdue' : '') + ': ' + r.text);
    for (const t of snap.tasks) lines.push('Scheduled at ' + hhmm(t.at) + ': ' + t.text);
    for (const c of snap.changed) lines.push('A watched page changed: ' + c.text);
    for (const s of snap.saved) lines.push('Saved to read: ' + s.text);
    for (const h of headlines.slice(0, 8)) lines.push('New in your feeds: ' + h);
    return lines;
  },

  async writeBrief(now = Date.now()) {
    const snap = await this.build();
    let headlines = [];
    if (typeof VexFeeds !== 'undefined' && VexFeeds.feeds && VexFeeds.feeds.length) {
      const got = await VexFeeds.fetchAll();
      headlines = got.items.filter(i => now - i.at < 24 * 3600 * 1000).map(i => i.title);
    }
    const facts = this.briefFacts(snap, headlines);
    if (!facts.length) throw new Error('Nothing on today: no reminders, tasks, changed pages, saved links or new feed items to write about');
    const prompt = 'Write my morning brief: one short paragraph, 2 to 4 sentences, in plain words, no list and no greeting. Say what matters first. Use only these facts and invent nothing:\n\n' + facts.join('\n');
    const res = await AIRouter.callAI('chat', { message: prompt });
    const text = String((res && (res.result || res.text || res.message)) || '').trim();
    if (!text) throw new Error('The AI returned nothing');
    localStorage.setItem(this.BRIEF_KEY, JSON.stringify({ day: this._day(now), text, at: now }));
    await this.refresh();
    return text;
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
