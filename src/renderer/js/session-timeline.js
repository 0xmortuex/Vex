// === Session timeline: what you did, by day and by week =====================
//
// One scrollable list of the things Vex already keeps on this PC, laid on a
// clock: pages you visited, notes you wrote, links you saved and finished,
// bookmarks, saved sessions, recordings, GitHub results Vex told you about,
// game sessions and (only if you switch it on) mail subjects.
//
// Nothing new is learned about you except three small things this file keeps
// in its own log ('vex.timeline.log', 60 days, 2000 entries): when a game
// started and ended, a GitHub result Vex announced, and every ten minutes (only
// when the set of open tabs changed) which pages were open. The last one is
// what lets a click reopen "that moment's tabs". Each is a switch in Settings.
//
// Private windows write nothing here and are never shown: a private or Tor tab
// is not in any of the sources, and every entry that carries a session of its
// own (a Tor or proxy route, a private partition, an .onion address) is
// dropped again when the list is built.
//
// The rules (what counts, how it is grouped, what a click reopens) are pure
// functions of plain data and are tested in tests/renderer/sessionTimeline.test.js.
const VexTimeline = {
  LOG_KEY: 'vex.timeline.log',
  PREFS_KEY: 'vex.timeline.prefs',
  MAX_LOG: 2000,
  KEEP_DAYS: 60,
  SNAP_EVERY_MS: 10 * 60 * 1000,
  MAX_SNAP_TABS: 30,
  // How far from a visit a tab snapshot still counts as "that moment".
  NEAR_MS: 30 * 60 * 1000,

  KINDS: {
    page: { label: 'Pages', icon: 'history' },
    note: { label: 'Notes', icon: 'note' },
    clip: { label: 'Recordings', icon: 'video' },
    saved: { label: 'Saved links', icon: 'book' },
    bookmark: { label: 'Bookmarks', icon: 'bookmark' },
    session: { label: 'Sessions', icon: 'folder' },
    mail: { label: 'Mail', icon: 'mail' },
    github: { label: 'GitHub', icon: 'activity' },
    game: { label: 'Games', icon: 'gamepad' },
    tabs: { label: 'Open tabs', icon: 'clock' },
  },

  // ---- prefs ----------------------------------------------------------------
  DEFAULTS: { tabs: true, games: true, github: true, mail: false },
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREFS_KEY) || 'null'); } catch { raw = null; }
    const out = {};
    for (const [k, d] of Object.entries(this.DEFAULTS)) out[k] = raw && typeof raw[k] === 'boolean' ? raw[k] : d;
    return out;
  },
  setPref(key, on) {
    if (!(key in this.DEFAULTS)) throw new Error('No such timeline setting: ' + key);
    localStorage.setItem(this.PREFS_KEY, JSON.stringify({ ...this.prefs(), [key]: !!on }));
  },

  // ---- what never appears ---------------------------------------------------
  // An entry of a private window, a Tor tab, a routed or temporary session.
  isExcluded(item) {
    if (!item || typeof item !== 'object') return true;
    if (item.private || item.incognito || item.tor || item.ownSession) return true;
    const part = item.partition;
    if (part && !/^persist:/.test(String(part))) return true;
    try { if (item.url && /\.onion$/i.test(new URL(item.url).hostname)) return true; } catch { /* not a URL */ }
    return false;
  },

  _ms(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const t = Date.parse(v || '');
    return Number.isFinite(t) ? t : 0;
  },

  // ---- the events -----------------------------------------------------------
  // `data` is { history, notes, readLater, bookmarks, sessions, clips, log }:
  // plain arrays, as the stores keep them. → events newest first.
  collect(data, { from = 0, to = Infinity, kinds = null } = {}) {
    const d = data || {};
    const out = [];
    const want = (k) => !kinds || kinds.includes(k);
    const add = (e) => {
      if (!e.t || e.t < from || e.t > to || !want(e.kind)) return;
      out.push(e);
    };
    for (const h of d.history || []) {
      if (this.isExcluded(h) || !h.url) continue;
      add({ t: this._ms(h.visitedAt || h.time), kind: 'page', title: h.title || h.url, url: h.url });
    }
    for (const n of d.notes || []) {
      if (!n || n.private) continue;
      add({ t: this._ms(n.updatedAt || n.createdAt), kind: 'note', title: n.title || 'Untitled note', noteId: n.id });
    }
    for (const r of d.readLater || []) {
      if (this.isExcluded(r)) continue;
      add({ t: this._ms(r.at), kind: 'saved', title: 'Saved: ' + (r.title || r.url), url: r.url });
      if (r.finishedAt) add({ t: this._ms(r.finishedAt), kind: 'saved', title: 'Finished: ' + (r.title || r.url), url: r.url });
    }
    for (const b of d.bookmarks || []) {
      if (this.isExcluded(b)) continue;
      add({ t: this._ms(b.at), kind: 'bookmark', title: 'Bookmarked: ' + (b.title || b.url), url: b.url });
    }
    for (const s of d.sessions || []) {
      if (!s || s.auto) continue;
      add({ t: this._ms(s.createdAt), kind: 'session', title: 'Session saved: ' + (s.name || 'Session'), sessionId: s.id, count: Array.isArray(s.tabs) ? s.tabs.length : 0 });
    }
    for (const c of d.clips || []) {
      add({ t: this._ms(c.at), kind: 'clip', title: 'Recording: ' + (c.name || 'clip'), path: c.path });
    }
    for (const l of d.log || []) {
      if (!l || !this.KINDS[l.kind]) continue;
      if (l.kind === 'tabs') {
        add({ t: l.t, kind: 'tabs', title: (l.tabs || []).length + ' tabs open', tabs: l.tabs || [] });
      } else {
        add({ t: l.t, kind: l.kind, title: l.title || '', url: l.url, ...(l.mailKey ? { mailKey: l.mailKey } : {}) });
      }
    }
    out.sort((a, b) => b.t - a.t);
    return out;
  },

  // ---- grouping -------------------------------------------------------------
  _dayStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); },
  _weekStart(t) {
    const d = new Date(this._dayStart(t));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));       // Monday
    return d.getTime();
  },

  dayLabel(start, now = Date.now()) {
    const today = this._dayStart(now);
    const days = Math.round((today - start) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return new Date(start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  },
  weekLabel(start, now = Date.now()) {
    const thisWeek = this._weekStart(now);
    if (start === thisWeek) return 'This week';
    if (start === thisWeek - 7 * 86400000) return 'Last week';
    const end = new Date(start + 6 * 86400000);
    return 'Week of ' + new Date(start).toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' – ' + end.toLocaleDateString([], { day: 'numeric', month: 'short' });
  },

  // by 'day' or 'week' → [{ key, start, label, events (newest first), counts }]
  group(events, by = 'day', now = Date.now()) {
    const startOf = by === 'week' ? (t) => this._weekStart(t) : (t) => this._dayStart(t);
    const map = new Map();
    for (const e of events) {
      const s = startOf(e.t);
      if (!map.has(s)) map.set(s, { key: String(s), start: s, label: by === 'week' ? this.weekLabel(s, now) : this.dayLabel(s, now), events: [], counts: {} });
      const g = map.get(s);
      g.events.push(e);
      g.counts[e.kind] = (g.counts[e.kind] || 0) + 1;
    }
    return [...map.values()].sort((a, b) => b.start - a.start);
  },

  // ---- what a click reopens -------------------------------------------------
  // The newest tab snapshot at or before `t`, if it is near enough.
  nearestSnapshot(log, t, within = this.NEAR_MS) {
    let best = null;
    for (const l of log || []) {
      if (!l || l.kind !== 'tabs' || !Array.isArray(l.tabs) || !l.tabs.length) continue;
      const gap = Math.abs(l.t - t);
      if (gap <= within && (!best || gap < Math.abs(best.t - t))) best = l;
    }
    return best;
  },

  // → { kind: 'session', id } | { kind: 'tabs', tabs, exact } | { kind: 'url', url } | null
  reopenPlan(event, log) {
    if (!event) return null;
    if (event.kind === 'session' && event.sessionId) return { kind: 'session', id: event.sessionId };
    if (event.kind === 'tabs' && event.tabs && event.tabs.length) return { kind: 'tabs', tabs: event.tabs, exact: true };
    const snap = event.kind === 'page' || event.kind === 'mail' || event.kind === 'game' ? this.nearestSnapshot(log, event.t) : null;
    if (snap) return { kind: 'tabs', tabs: snap.tabs, exact: false, at: snap.t };
    if (event.url && /^https?:/i.test(event.url)) return { kind: 'url', url: event.url };
    return null;
  },

  // ---- the log this file keeps ---------------------------------------------
  readLog() {
    try { const a = JSON.parse(localStorage.getItem(this.LOG_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
  },
  _trim(list, now = Date.now()) {
    const cutoff = now - this.KEEP_DAYS * 86400000;
    return list.filter(l => l && l.t >= cutoff).slice(-this.MAX_LOG);
  },
  record(entry) {
    if (typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return false;
    if (!entry || !this.KINDS[entry.kind]) throw new Error('Unknown timeline kind: ' + (entry && entry.kind));
    const p = this.prefs();
    const pref = { game: 'games', github: 'github', tabs: 'tabs', mail: 'mail' }[entry.kind];
    if (pref && !p[pref]) return false;
    const list = this.readLog();
    if (entry.mailKey && list.some(l => l.mailKey === entry.mailKey)) return false;
    list.push({ ...entry, t: entry.t || Date.now() });
    try { localStorage.setItem(this.LOG_KEY, JSON.stringify(this._trim(list))); }
    catch (err) { window.VexProblems?.note('Timeline', 'Could not save the timeline log', err); return false; }
    return true;
  },
  forgetLog() { localStorage.removeItem(this.LOG_KEY); this._lastTabsKey = ''; },

  // Which pages are open now, safe to keep: http(s) only, never a private or
  // Tor tab (VexTabPolicy.snapshot drops those).
  openTabs() {
    if (typeof TabManager === 'undefined' || !window.VexTabPolicy) return [];
    return window.VexTabPolicy.snapshot(TabManager.tabs)
      .filter(t => /^https?:/i.test(t.url || '') && !this.isExcluded({ url: t.url, partition: t.partition }))
      .slice(0, this.MAX_SNAP_TABS)
      .map(t => ({ url: t.url, title: String(t.title || '').slice(0, 120) }));
  },

  // Game mode is the one time nothing runs in the background.
  _gaming() {
    return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active);
  },

  snapshotTabs() {
    if (!this.prefs().tabs || this._gaming()) return false;
    const tabs = this.openTabs();
    if (!tabs.length) return false;
    const key = tabs.map(t => t.url).join('\n');
    if (key === this._lastTabsKey) return false;
    this._lastTabsKey = key;
    return this.record({ kind: 'tabs', t: Date.now(), tabs });
  },

  noteGame(detail) {
    if (!detail) return;
    const name = detail.app || 'A game';
    if (detail.active) { this._gameStart = Date.now(); this.record({ kind: 'game', title: name + ' started' }); return; }
    const mins = this._gameStart ? Math.max(1, Math.round((Date.now() - this._gameStart) / 60000)) : 0;
    this._gameStart = 0;
    this.record({ kind: 'game', title: name + ' ended' + (mins ? ' after ' + mins + ' min' : '') });
  },

  noteGitHub(detail) {
    if (!detail || !detail.text) return;
    this.record({ kind: 'github', title: String(detail.text).slice(0, 200), url: detail.url && /^https:/i.test(detail.url) ? detail.url : undefined });
  },

  // Mail subjects Vex was shown (only with the switch on): subject and the
  // time it came, nothing of the body and no addresses.
  noteMail(messages, account = '') {
    if (!this.prefs().mail || !Array.isArray(messages)) return 0;
    let n = 0;
    for (const m of messages.slice(0, 50)) {
      if (!m || !m.subject) continue;
      const t = this._ms(m.date) || Date.now();
      if (this.record({ kind: 'mail', t, title: String(m.subject).slice(0, 160), mailKey: account + ':' + (m.uid != null ? m.uid : m.subject + t) })) n++;
    }
    return n;
  },

  // ---- reading the stores ---------------------------------------------------
  _json(key) { try { const a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },

  async gather() {
    let history = [];
    if (typeof HistoryPanel !== 'undefined') {
      try { if (!HistoryPanel.entries.length && typeof HistoryPanel._hydrate === 'function') await HistoryPanel._hydrate(); } catch (err) { window.VexProblems?.note('Timeline', 'Could not read history', err); }
      history = Array.isArray(HistoryPanel.entries) ? HistoryPanel.entries : [];
    }
    if (!history.length) history = this._json('vex.history');
    let clips = [];
    if (typeof ClipsInbox !== 'undefined') {
      try {
        const dir = await ClipsInbox.folder(false);
        if (dir) clips = (await ClipsInbox.list(dir)).clips || [];
      } catch { /* no recordings folder chosen: nothing to show */ }
    }
    return {
      history,
      notes: this._json('vex.notes'),
      readLater: typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items) ? ReadLater.items : this._json('vex.readLater'),
      bookmarks: typeof Bookmarks !== 'undefined' && Array.isArray(Bookmarks.items) ? Bookmarks.items : this._json('vex.bookmarks'),
      sessions: this._json('vex.sessions'),
      clips,
      log: this.readLog(),
    };
  },

  // ---- reopening ------------------------------------------------------------
  async reopen(plan) {
    if (!plan) throw new Error('Nothing was recorded that could be reopened for this moment');
    if (plan.kind === 'session') {
      if (typeof SessionManager === 'undefined') throw new Error('Sessions are not available in this window');
      await SessionManager.restoreSession(plan.id, false);
      return 1;
    }
    if (plan.kind === 'url') { TabManager.createTab(plan.url, true); return 1; }
    const tabs = plan.tabs.filter(t => /^https?:/i.test(t.url || ''));
    if (!tabs.length) throw new Error('Those tabs had no addresses that can be reopened');
    if (tabs.length > 8 && typeof window.vexConfirm === 'function') {
      const ok = await window.vexConfirm({ title: 'Open ' + tabs.length + ' tabs?', message: 'These were open together ' + this.describeAt(plan.at || Date.now()) + '. They open beside the tabs you have now.', okLabel: 'Open them' });
      if (!ok) return 0;
    }
    tabs.forEach((t, i) => TabManager.createTab(t.url, i === 0));
    return tabs.length;
  },

  describeAt(t, now = Date.now()) {
    const d = new Date(t);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return this.dayLabel(this._dayStart(t), now).toLowerCase() + ' at ' + time;
  },

  // ---- the window -----------------------------------------------------------
  async open({ by = 'day' } = {}) {
    document.querySelector('.vex-timeline-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-timeline-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:7vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Timeline"
           style="width:min(680px,94vw);max-height:80vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0;font-size:13.5px;font-weight:650;color:var(--text)">Timeline</div>
          <div role="group" aria-label="Group by" data-by style="display:flex;gap:4px"></div>
          <button data-close type="button" aria-label="Close" title="Close" style="width:26px;height:26px;border:none;background:none;color:var(--text-muted);cursor:pointer;border-radius:6px">${VexIcons.svg('x', { size: 14 })}</button>
        </div>
        <div data-kinds style="display:flex;flex-wrap:wrap;gap:5px;padding:8px 14px;border-bottom:1px solid var(--border)"></div>
        <div data-list style="overflow-y:auto;padding:6px;flex:1"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          Built from what Vex already keeps on this PC. Private and Tor tabs are never in it. Click a moment to reopen it.
        </div>
      </div>`;
    const listEl = overlay.querySelector('[data-list]');
    const byEl = overlay.querySelector('[data-by]');
    const kindsEl = overlay.querySelector('[data-kinds]');
    const hidden = new Set();
    let data = null;
    let mode = by === 'week' ? 'week' : 'day';
    const chip = (label, on, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.style.cssText = 'font-size:11.5px;border:1px solid var(--border);border-radius:999px;padding:2px 10px;cursor:pointer;background:' + (on ? 'var(--vex-hover-fill,var(--surface))' : 'none') + ';color:' + (on ? 'var(--text)' : 'var(--text-muted)');
      b.addEventListener('click', fn);
      return b;
    };

    const draw = () => {
      byEl.textContent = '';
      for (const m of ['day', 'week']) byEl.appendChild(chip(m === 'day' ? 'Days' : 'Weeks', mode === m, () => { mode = m; draw(); }));
      kindsEl.textContent = '';
      for (const [k, v] of Object.entries(this.KINDS)) {
        if (k === 'tabs') continue;
        kindsEl.appendChild(chip(v.label, !hidden.has(k), () => { hidden.has(k) ? hidden.delete(k) : hidden.add(k); draw(); }));
      }
      listEl.textContent = '';
      if (!data) { listEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">Looking…</div>'; return; }
      const kinds = Object.keys(this.KINDS).filter(k => !hidden.has(k));
      const events = this.collect(data, { from: Date.now() - 60 * 86400000, to: Date.now() + 60000, kinds });
      if (!events.length) { listEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing recorded for the last 60 days with these filters.</div>'; return; }
      const MAX_ROWS = 400;
      let rows = 0;
      for (const g of this.group(events, mode)) {
        const h = document.createElement('div');
        const summary = Object.entries(g.counts).filter(([k]) => k !== 'tabs').map(([k, n]) => n + ' ' + (this.KINDS[k] ? this.KINDS[k].label.toLowerCase() : k)).join(' · ');
        h.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:700;padding:12px 8px 4px';
        h.innerHTML = esc(g.label) + (summary ? ' <span style="font-weight:400;text-transform:none;letter-spacing:0">· ' + esc(summary) + '</span>' : '');
        listEl.appendChild(h);
        for (const e of g.events) {
          if (rows++ >= MAX_ROWS) break;
          if (e.kind === 'tabs' && mode === 'week') continue;
          const plan = this.reopenPlan(e, data.log);
          const row = document.createElement(plan ? 'button' : 'div');
          if (plan) row.type = 'button';
          row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:8px;width:100%;text-align:left;border:none;background:none;color:inherit;font:inherit;' + (plan ? 'cursor:pointer' : 'opacity:0.85');
          if (plan) {
            row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
            row.addEventListener('mouseleave', () => { row.style.background = ''; });
          }
          const time = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const icon = this.KINDS[e.kind].icon;
          let sub = time;
          if (plan && plan.kind === 'tabs') sub += ' · reopens ' + plan.tabs.length + ' tab' + (plan.tabs.length === 1 ? '' : 's') + (plan.exact ? '' : ' open around then');
          else if (plan && plan.kind === 'session') sub += ' · reopens ' + (e.count || 'its') + ' tabs';
          else if (e.url) { try { sub += ' · ' + new URL(e.url).hostname.replace(/^www\./, ''); } catch { /* no host */ } }
          row.innerHTML = `<span style="color:var(--text-muted);display:grid;place-items:center">${VexIcons.svg(icon, { size: 14 })}</span>
            <span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.title)}</span>
            <span style="display:block;font-size:10.5px;color:var(--text-muted)">${esc(sub)}</span></span>`;
          if (plan) {
            row.addEventListener('click', async () => {
              try { const n = await this.reopen(plan); if (n) { overlay.remove(); document.removeEventListener('keydown', onKey, true); } }
              catch (err) { window.showToast?.((err && err.message) || 'Could not reopen that', 'error'); }
            });
          }
          listEl.appendChild(row);
        }
      }
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    draw();
    try { data = await this.gather(); }
    catch (err) { listEl.textContent = (err && err.message) || 'Could not read your history'; return overlay; }
    draw();
    return overlay;
  },

  // ---- start ----------------------------------------------------------------
  start() {
    if (this._started) return;
    this._started = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('vex:game-mode', (e) => { try { this.noteGame(e.detail); } catch (err) { window.VexProblems?.note('Timeline', 'Could not note a game', err); } });
      document.addEventListener('vex:github-watch', (e) => { try { this.noteGitHub(e.detail); } catch (err) { window.VexProblems?.note('Timeline', 'Could not note a GitHub result', err); } });
    }
    if (typeof VexJobs !== 'undefined') {
      this._job = VexJobs.every('Timeline tabs', this.SNAP_EVERY_MS, () => this.snapshotTabs(), { when: 'background', deferOnBattery: true });
    }
  },

  // A section the Morning Brief can take: today so far, in one line.
  section: {
    id: 'timeline-today',
    title: 'Today so far',
    isEnabled() { return true; },
    async build() {
      const data = await VexTimeline.gather();
      const start = VexTimeline._dayStart(Date.now());
      const ev = VexTimeline.collect(data, { from: start, kinds: ['page', 'note', 'saved', 'bookmark', 'game'] });
      if (!ev.length) return null;
      const g = VexTimeline.group(ev, 'day')[0];
      const parts = Object.entries(g.counts).map(([k, n]) => n + ' ' + VexTimeline.KINDS[k].label.toLowerCase());
      return { id: 'timeline-today', title: 'Today so far', text: parts.join(' · '), items: [{ text: 'Open the timeline', cmd: { type: 'command', id: 'timeline' } }] };
    },
  },
};

if (typeof window !== 'undefined') window.VexTimeline = VexTimeline;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTimeline };
