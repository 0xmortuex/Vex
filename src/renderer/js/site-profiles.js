// === Vex Site Settings (per-site profiles) ===
// Everything Vex remembers per website — zoom, forced dark mode, never
// sleeping, always translating, custom CSS/JS boosts and the site switches.
// The site in front is changed in the site panel (js/site-panel.js — click the
// icon at the left of the address field, or Ctrl+K → "Site Settings"); every
// site that has anything set is listed in Settings › Site settings, drawn
// here from the very same stores, so the two always agree.
const SiteProfiles = {
  _zooms() { try { return JSON.parse(localStorage.getItem('vex.zooms') || '{}') || {}; } catch { return {}; } },
  _saveZooms(z) { try { localStorage.setItem('vex.zooms', JSON.stringify(z)); } catch { return false; } return true; },
  _darkHosts() { try { const a = JSON.parse(localStorage.getItem('vex.forceDarkHosts') || '[]'); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); } },
  _boosts() { try { return JSON.parse(localStorage.getItem('vex.boosts') || '{}') || {}; } catch { return {}; } },
  _neverSleepHosts() { try { const a = JSON.parse(localStorage.getItem('vex.neverSleepHosts') || '[]'); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); } },
  _saveNeverSleep(set) { try { localStorage.setItem('vex.neverSleepHosts', JSON.stringify([...set])); } catch { return false; } return true; },

  _hostFromUrl(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } },
  _bare(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); },

  // The site panel replaced the dialog this used to open.
  open() {
    if (typeof SitePanel === 'undefined') throw new Error('The site panel is not loaded');
    return SitePanel.open();
  },

  // "Never let this site sleep" — the list every sleep path reads
  // (TabManager._isKeptAwake). Turning it on wakes the site's tabs now.
  setNeverSleep(host, on) {
    const h = this._bare(host);
    if (!h) throw new Error('That is not a web page');
    const set = this._neverSleepHosts();
    if (on) set.add(h); else set.delete(h);
    if (!this._saveNeverSleep(set)) throw new Error('The choice could not be saved');
    if (on && typeof TabManager !== 'undefined') {
      for (const t of (TabManager.tabs || [])) {
        if (this._hostFromUrl(t.url) !== h) continue;
        if (t.sleeping) TabManager.wakeTab(t.id); else if (t._lazy) TabManager._materializeTab(t);
      }
    }
    return !!on;
  },

  // Every site with anything set, by host without "www." (a zoom is saved
  // under the page's own host name, www. or not — both are one site here).
  customizedSites() {
    const sites = new Map();
    const at = (host) => {
      const h = this._bare(host);
      if (!h) return null;
      if (!sites.has(h)) sites.set(h, { host: h });
      return sites.get(h);
    };
    for (const [h, z] of Object.entries(this._zooms())) { const s = at(h); if (s && Number(z) && Number(z) !== 1) s.zoom = Number(z); }
    for (const h of this._darkHosts()) { const s = at(h); if (s) s.dark = true; }
    for (const h of Object.keys(this._boosts())) { const s = at(h); if (s) s.boost = true; }
    for (const h of this._neverSleepHosts()) { const s = at(h); if (s) s.neverSleep = true; }
    if (typeof TranslateSide !== 'undefined') for (const h of TranslateSide.alwaysHosts()) { const s = at(h); if (s) s.translate = true; }
    if (typeof SiteRulesUI !== 'undefined') {
      for (const [h, rule] of Object.entries(SiteRulesUI.rules())) {
        const s = at(h);
        if (!s || !rule) continue;
        if (rule.ads === 'off') s.adsAllowed = true;
        const off = SiteRulesUI.WHAT.filter(w => rule[w.id] === 'off').map(w => w.name);
        if (off.length) s.switchesOff = off;
      }
    }
    if (typeof SiteRoutes !== 'undefined') {
      for (const r of SiteRoutes.rules()) { const s = at(r.host); if (s) s.route = SiteRoutes.whereOf(r); }
    }
    return [...sites.values()].sort((a, b) => a.host.localeCompare(b.host));
  },

  // What a row says about a site, in words.
  describeSite(s) {
    const bits = [];
    if (s.zoom) bits.push('zoom ' + Math.round(s.zoom * 100) + '%');
    if (s.dark) bits.push('dark mode');
    if (s.neverSleep) bits.push('never sleeps');
    if (s.translate) bits.push('always translated');
    if (s.adsAllowed) bits.push('ads and trackers not blocked');
    if (s.switchesOff) bits.push(s.switchesOff.join(', ').toLowerCase() + ' off');
    if (s.boost) bits.push('custom CSS/JS');
    if (s.route) bits.push('opens ' + s.route);
    return bits.join(' · ');
  },

  // Settings › Site settings. Redrawn each time Settings opens.
  renderSettings(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const sites = this.customizedSites();
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">Everything set for one site at a time. Change the site in front from the icon at the left of the address field; its permissions are under Site Permissions, and where it opens under Private routing › Site rules.</p>
      ${sites.length ? `<div class="site-settings-list">${sites.map(s => `
        <div class="site-settings-row" data-host="${esc(s.host)}">
          <div class="site-settings-info">
            <div class="site-settings-host">${esc(s.host)}</div>
            <div class="site-settings-what">${esc(this.describeSite(s))}</div>
          </div>
          <button type="button" class="btn-secondary-sm" data-act="go">Open</button>
          <button type="button" class="btn-secondary-sm" data-act="reset" ${s.route && !s.zoom && !s.dark && !s.neverSleep && !s.translate && !s.adsAllowed && !s.switchesOff && !s.boost ? 'disabled title="Remove its rule under Private routing › Site rules"' : ''}>Reset</button>
        </div>`).join('')}</div>`
        : '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No site has anything set yet.</div>'}`;
    container.querySelectorAll('[data-host]').forEach(row => {
      const h = row.dataset.host;
      row.querySelector('[data-act="go"]').addEventListener('click', () => {
        TabManager.createTab('https://' + h, true);
      });
      // Done at once — zoom, dark mode, sleep, translation, ad blocking, the
      // site switches and custom CSS/JS; its permissions and where it opens
      // stay. Undo on the toast puts every one of them back.
      row.querySelector('[data-act="reset"]').addEventListener('click', async () => {
        const redraw = () => { if (container.isConnected) this.renderSettings(container); };
        let res;
        try { res = await this.forgetSite(h); }
        catch (err) { window.showToast?.('Could not reset ' + h + ': ' + err.message, 'error'); redraw(); return; }
        redraw();
        window.VexUndo.offer({
          message: this._resetWords(h, res.failed),
          undo: async () => { await this.restoreSite(res.snapshot); redraw(); },
        });
      });
    });
  },

  _resetWords(h, failed) {
    const bare = this._bare(h);
    return failed && failed.length
      ? `Reset ${bare}, but these could not be saved and will come back: ${failed.join(', ')}`
      : 'Reset ' + bare;
  },

  // _resetSite, and the site switches main keeps (an async round trip).
  // -> { snapshot, failed }: snapshot is everything that was taken away, for
  // restoreSite. Nothing is touched when the switches cannot be changed here.
  async forgetSite(h) {
    const bare = this._bare(h);
    const names = [bare, 'www.' + bare];
    const rulesChange = typeof SiteRulesUI !== 'undefined' && names.some(n => Object.hasOwn(SiteRulesUI.rules(), n));
    if (rulesChange && SiteRulesUI._isPrivate()) throw new Error('Change this in a normal window — it applies to every window');
    const snapshot = this.snapshotSite(h);
    const failed = this._resetSite(h, { toast: false });
    if (rulesChange) {
      const rules = SiteRulesUI.rules();
      for (const key of names) delete rules[key];
      SiteRulesUI.save(rules);
      await SiteRulesUI.push();
    }
    return { snapshot, failed };
  },

  // Everything Reset takes from `h`, exactly as it is now: the saved zoom
  // under each spelling of the host, dark mode, never-sleep, always-translate,
  // its custom CSS/JS, its site switches, and the zoom and dark mode of each
  // open tab of it.
  snapshotSite(h) {
    const bare = this._bare(h);
    const names = [bare, 'www.' + bare];
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const zooms = this._zooms();
    const dark = this._darkHosts();
    const never = this._neverSleepHosts();
    const snap = {
      host: h, bare, zoom: {}, dark: names.filter(n => dark.has(n)), neverSleep: names.filter(n => never.has(n)),
      translate: typeof TranslateSide !== 'undefined' && TranslateSide.alwaysHosts().includes(bare),
      boost: null, rules: {}, tabs: [],
    };
    for (const n of names) if (Object.hasOwn(zooms, n)) snap.zoom[n] = zooms[n];
    const boosts = typeof VexBoosts !== 'undefined' && VexBoosts.boosts ? VexBoosts.boosts : this._boosts();
    if (Object.hasOwn(boosts, h)) snap.boost = clone(boosts[h]);
    if (typeof SiteRulesUI !== 'undefined') {
      const rules = SiteRulesUI.rules();
      for (const n of names) if (Object.hasOwn(rules, n)) snap.rules[n] = clone(rules[n]);
    }
    if (typeof TabManager !== 'undefined' && typeof WebviewManager !== 'undefined') {
      for (const t of (TabManager.tabs || [])) {
        if (this._hostFromUrl(t.url) !== bare) continue;
        const wv = WebviewManager.webviews?.get(t.id);
        if (!wv) continue;
        let zoom = null;
        try { zoom = typeof wv.getZoomFactor === 'function' ? wv.getZoomFactor() : null; } catch { zoom = null; }
        snap.tabs.push({ id: t.id, zoom, dark: !!wv._forceDarkKey });
      }
    }
    return snap;
  },

  // Reset's Undo: each piece back in its store, and on the tabs still open.
  // Something set for the site since the reset wins over what it replaced.
  async restoreSite(snap) {
    if (!snap || !snap.bare) throw new Error('Nothing to put back');
    const { host: h, bare } = snap;
    const ruleNames = Object.keys(snap.rules);
    if (ruleNames.length && typeof SiteRulesUI !== 'undefined' && SiteRulesUI._isPrivate()) throw new Error('Change this in a normal window — it applies to every window');
    const failed = [];
    const zooms = this._zooms();
    let zoomChanged = false;
    for (const [n, z] of Object.entries(snap.zoom)) if (!Object.hasOwn(zooms, n)) { zooms[n] = z; zoomChanged = true; }
    if (zoomChanged && !this._saveZooms(zooms)) failed.push('zoom');
    if (snap.dark.length) {
      const dark = this._darkHosts();
      snap.dark.forEach(n => dark.add(n));
      try { localStorage.setItem('vex.forceDarkHosts', JSON.stringify([...dark])); } catch { failed.push('dark mode'); }
    }
    if (snap.neverSleep.length) {
      const never = this._neverSleepHosts();
      snap.neverSleep.forEach(n => never.add(n));
      if (!this._saveNeverSleep(never)) failed.push('sleep');
    }
    if (snap.translate && typeof TranslateSide !== 'undefined' && !TranslateSide.alwaysHosts().includes(bare)) {
      TranslateSide.setAlways('https://' + bare + '/', true);
    }
    if (snap.boost) {
      if (typeof VexBoosts !== 'undefined' && VexBoosts.boosts) {
        if (!Object.hasOwn(VexBoosts.boosts, h)) {
          // Its JS never left the open pages; only the zaps and CSS go back on
          // them — running the JS again would not be undoing.
          VexBoosts.boosts[h] = { ...snap.boost, js: '' };
          VexBoosts.refreshHost(h);
          VexBoosts.boosts[h] = snap.boost;
          if (!VexBoosts.save()) failed.push('custom CSS/JS');
        }
      } else {
        const b = this._boosts();
        if (!Object.hasOwn(b, h)) { b[h] = snap.boost; localStorage.setItem('vex.boosts', JSON.stringify(b)); }
      }
    }
    if (ruleNames.length && typeof SiteRulesUI !== 'undefined') {
      const rules = SiteRulesUI.rules();
      let changed = false;
      for (const n of ruleNames) if (!Object.hasOwn(rules, n)) { rules[n] = snap.rules[n]; changed = true; }
      if (changed) { SiteRulesUI.save(rules); await SiteRulesUI.push(); }
    }
    // The tabs still open: their zoom, and dark mode where the site has it.
    if (typeof TabManager !== 'undefined' && typeof WebviewManager !== 'undefined') {
      for (const t of snap.tabs) {
        if (!(TabManager.tabs || []).some(x => x.id === t.id)) continue;
        const wv = WebviewManager.webviews?.get(t.id);
        if (!wv) continue;
        if (t.zoom != null && typeof wv.setZoomFactor === 'function') wv.setZoomFactor(t.zoom);
        if (t.dark && WebviewManager._applyForceDark) WebviewManager._applyForceDark(wv);
      }
    }
    if (failed.length) throw new Error(`${failed.join(', ')} could not be saved`);
    return true;
  },

  // Undo every per-site preference for `h` kept in this window's storage.
  //
  // Boosts must go through VexBoosts, not straight to localStorage: VexBoosts
  // keeps the whole map in memory and rewrites it on its next save, so deleting
  // the key underneath it looked like it worked and then silently resurrected
  // the boost the next time any boost was edited. Going through VexBoosts also
  // lets us pull the injected CSS out of the pages that are open right now.
  // -> the names of what could not be saved ([] when all of it was). With
  // toast (the default) it says so itself; true is returned when nothing failed.
  _resetSite(h, { toast = true } = {}) {
    const failed = [];
    const bare = this._bare(h);
    const names = [bare, 'www.' + bare];
    try { const z = this._zooms(); names.forEach(n => delete z[n]); if (!this._saveZooms(z)) failed.push('zoom'); } catch { failed.push('zoom'); }
    try {
      const a = [...this._darkHosts()].filter(x => !names.includes(x));
      localStorage.setItem('vex.forceDarkHosts', JSON.stringify(a));
    } catch { failed.push('dark mode'); }
    try {
      const set = this._neverSleepHosts();
      if (names.map(n => set.delete(n)).some(Boolean) && !this._saveNeverSleep(set)) failed.push('sleep');
    } catch { failed.push('sleep'); }
    try {
      if (typeof TranslateSide !== 'undefined' && TranslateSide.alwaysHosts().includes(bare)) TranslateSide.setAlways('https://' + bare + '/', false);
    } catch { failed.push('translation'); }
    try {
      if (typeof VexBoosts !== 'undefined' && VexBoosts.boosts) {
        if (Object.hasOwn(VexBoosts.boosts, h)) {
          delete VexBoosts.boosts[h];
          if (!VexBoosts.save()) failed.push('custom CSS/JS');
          VexBoosts.refreshHost(h);
        }
      } else {
        const b = this._boosts(); delete b[h]; localStorage.setItem('vex.boosts', JSON.stringify(b));
      }
    } catch { failed.push('custom CSS/JS'); }
    // Zoom is applied per webview; take it back on the tabs showing this host.
    try {
      (TabManager.tabs || []).forEach(t => {
        if (this._hostFromUrl(t.url) !== bare) return;
        const wv = WebviewManager.webviews?.get(t.id);
        if (wv) { wv.setZoomFactor(1); if (WebviewManager._removeForceDark) WebviewManager._removeForceDark(wv); }
      });
    } catch {}
    if (!toast) return failed;
    try { window.showToast?.(this._resetWords(h, failed), failed.length ? 'error' : undefined); } catch {}
    return !failed.length;
  },
};

if (typeof window !== 'undefined') window.SiteProfiles = SiteProfiles;
