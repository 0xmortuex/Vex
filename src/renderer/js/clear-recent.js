// === Clear the last 15 minutes / hour / day, and clear when Vex closes ============
//
// Two things next to "Clear Browsing Data" (Settings > Privacy & Security, and Ctrl+K "Clear Recent Browsing Data"):
//
//   1. A time range. It removes the visits made in the last 15 minutes, hour or day from Vex's own history list and from Recall's
//      page index (a page that is also listed on an earlier day stays in Recall, as when you delete one day), and the tabs closed
//      in that time from "Reopen closed tab". It does NOT touch cookies, the cache or a site's stored data: Electron's session
//      clear functions take no time range (checked in electron.d.ts for Electron 42: clearData, clearStorageData and clearCache have
//      no start time, and a cookie has no creation date), so a ranged clear of those would really be a clear of everything. The
//      dialog says so. Nothing here removes a sign-in, so the "many logins look gone" notice has nothing to learn from it.
//   2. "Clear history, cookies and cache when Vex closes" (off until you turn it on). The window only keeps the switch and the
//      list of sites to keep signed in (vex.autoClear = { on, keep: [host] }); main does the clearing at a deliberate quit
//      (src/main/quit-clear.js), never after a crash, and tells the sign-in check it was on purpose.
//
//   VexClearRecent.cutoff(id, now)          pure: the start of a range (ms)
//   VexClearRecent.splitClosed(list, cut)   pure: closed tabs { kept, removed }
//   VexClearRecent.normalizeHost(text)      pure: "https://www.Example.com/x" -> "example.com", or throws
const VexClearRecent = {
  KEY: 'vex.autoClear',
  CLOSED_KEY: 'vex.recentlyClosed',
  MAX_KEEP: 200,
  RANGES: [
    { id: '15m', ms: 15 * 60000, label: 'Last 15 minutes' },
    { id: '1h', ms: 60 * 60000, label: 'Last hour' },
    { id: '1d', ms: 24 * 60 * 60000, label: 'Last day' },
  ],

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  // ---- pure ----------------------------------------------------------------------------
  cutoff(id, now = Date.now()) {
    const r = this.RANGES.find(x => x.id === id);
    if (!r) throw new Error('Choose 15 minutes, an hour or a day');
    return now - r.ms;
  },
  splitClosed(list, cut) {
    const kept = [], removed = [];
    for (const e of Array.isArray(list) ? list : []) {
      const at = e && e.closedAt ? Date.parse(e.closedAt) : NaN;
      if (Number.isFinite(at) && at >= cut) removed.push(e); else kept.push(e);
    }
    return { kept, removed };
  },
  normalizeHost(input) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw) throw new Error('Type a site, like example.com');
    let host = '';
    try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw).hostname; }
    catch { throw new Error('That is not a site address'); }
    host = host.replace(/^www\./, '').toLowerCase();
    if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(host) || !host.includes('.') && host !== 'localhost') throw new Error('That is not a site address');
    return host;
  },

  // ---- the saved switch and keep list -----------------------------------------------------
  config() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (err) { throw new Error('The clear-on-close setting could not be read: ' + err.message); }
    if (!raw) return { on: false, keep: [] };
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The saved clear-on-close setting is damaged: ' + err.message); }
    return { on: !!(o && o.on === true), keep: Array.isArray(o && o.keep) ? o.keep.filter(h => typeof h === 'string') : [] };
  },
  _save(cfg) { localStorage.setItem(this.KEY, JSON.stringify({ on: cfg.on === true, keep: cfg.keep })); },
  enabled() { return this.config().on; },
  setEnabled(on) { const c = this.config(); c.on = !!on; this._save(c); },
  addKeep(text) {
    const h = this.normalizeHost(text);
    const c = this.config();
    if (c.keep.includes(h)) return h;
    if (c.keep.length >= this.MAX_KEEP) throw new Error('At most ' + this.MAX_KEEP + ' sites');
    c.keep.push(h);
    this._save(c);
    return h;
  },
  removeKeep(host) { const c = this.config(); c.keep = c.keep.filter(h => h !== host); this._save(c); },

  // ---- the range clear ----------------------------------------------------------------------
  // -> { visits, closed }
  async clear(rangeId, now = Date.now()) {
    const cut = this.cutoff(rangeId, now);
    if (typeof HistoryPanel === 'undefined' || typeof HistoryPanel.deleteSince !== 'function') throw new Error('History is not available');
    let closed = 0;
    const raw = localStorage.getItem(this.CLOSED_KEY);
    if (raw) {
      let list;
      try { list = JSON.parse(raw); } catch (err) { throw new Error('The closed-tab list is damaged: ' + err.message); }
      const s = this.splitClosed(list, cut);
      closed = s.removed.length;
      if (closed) localStorage.setItem(this.CLOSED_KEY, JSON.stringify(s.kept));
    }
    const visits = await HistoryPanel.deleteSince(cut);
    return { visits, closed };
  },

  // ---- the screen ------------------------------------------------------------------------------
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('clear-recent');
    const G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-clear-recent', title: 'Clear recent browsing data', sub: 'Remove what you did a moment ago, or clear when Vex closes.' });
    const fail = (e) => window.showToast?.(e.message, 'error');
    const draw = () => {
      body.textContent = '';
      body.appendChild(G.note('Removes the visits and the closed tabs of that time from your history and from Recall. Cookies, the cache and site data are not touched: they cannot be cleared for a time range, so use Clear Browsing Data for those.'));
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0';
      for (const r of this.RANGES) {
        row.appendChild(G.button(r.label, async () => {
          try {
            if (!await window.vexConfirm({ title: r.label, message: 'Remove the history and closed tabs of this time? This cannot be undone.', okLabel: 'Clear', danger: true })) return;
            const res = await this.clear(r.id);
            window.showToast?.(this._t('Cleared. Visits removed: {1}. Closed tabs removed: {2}.').replace('{1}', res.visits).replace('{2}', res.closed));
          } catch (e) { fail(e); }
        }, { danger: true }));
      }
      body.appendChild(row);
      body.appendChild(G.note('If you use Vex Sync, visits from your other devices can come back after the next sync.'));
      let cfg;
      try { cfg = this.config(); } catch (e) { fail(e); return; }
      body.appendChild(VexSettingsGroup.toggle('Clear history, cookies and cache when Vex closes', cfg.on, async (on) => {
        try {
          if (on && !await window.vexConfirm({ title: 'Clear when Vex closes?', message: 'Every time you close Vex, your history, cookies, cache and site data are cleared, which signs you out of sites (except the ones you keep below and the video, music and chat sites Vex needs). It does not run after a crash.', okLabel: 'Turn on', danger: true })) { draw(); return; }
          this.setEnabled(on);
        } catch (e) { fail(e); }
        draw();
      }));
      body.appendChild(G.note('Sites you keep signed in are left alone when Vex closes:'));
      for (const h of cfg.keep) {
        const line = document.createElement('div');
        line.style.cssText = 'display:flex;gap:8px;align-items:center;margin:2px 0';
        const t = document.createElement('span'); t.style.flex = '1'; t.textContent = h;
        line.append(t, G.button('Remove', () => { try { this.removeKeep(h); draw(); } catch (e) { fail(e); } }));
        body.appendChild(line);
      }
      body.appendChild(G.button('Keep a site signed in...', async () => {
        try {
          const v = await window.vexPrompt({ title: 'Keep a site signed in', label: 'Site', placeholder: 'example.com', okLabel: 'Keep' });
          if (v == null) return;
          this.addKeep(v); draw();
        } catch (e) { fail(e); }
      }));
    };
    draw();
  },
};

if (typeof window !== 'undefined') window.VexClearRecent = VexClearRecent;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexClearRecent };
