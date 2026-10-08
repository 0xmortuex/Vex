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
      row.querySelector('[data-act="reset"]').addEventListener('click', async () => {
        if (!await window.vexConfirm({
          title: 'Reset ' + h,
          message: `Forget what Vex keeps for ${h} — zoom, dark mode, sleep, translation, ad blocking and the site switches, and any custom CSS/JS? Its permissions and where it opens stay. This cannot be undone.`,
          okLabel: 'Reset', danger: true,
        })) return;
        try { await this.forgetSite(h); }
        catch (err) { window.showToast?.('Could not reset ' + h + ': ' + err.message, 'error'); }
        this.renderSettings(container);
      });
    });
  },

  // _resetSite, and the site switches main keeps (an async round trip).
  async forgetSite(h) {
    const ok = this._resetSite(h);
    if (typeof SiteRulesUI !== 'undefined') {
      const rules = SiteRulesUI.rules();
      const bare = this._bare(h);
      let changed = false;
      for (const key of [bare, 'www.' + bare]) if (Object.hasOwn(rules, key)) { delete rules[key]; changed = true; }
      if (changed) {
        if (SiteRulesUI._isPrivate()) throw new Error('Change this in a normal window — it applies to every window');
        SiteRulesUI.save(rules);
        await SiteRulesUI.push();
      }
    }
    return ok;
  },

  // Undo every per-site preference for `h` kept in this window's storage.
  //
  // Boosts must go through VexBoosts, not straight to localStorage: VexBoosts
  // keeps the whole map in memory and rewrites it on its next save, so deleting
  // the key underneath it looked like it worked and then silently resurrected
  // the boost the next time any boost was edited. Going through VexBoosts also
  // lets us pull the injected CSS out of the pages that are open right now.
  _resetSite(h) {
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
    try {
      window.showToast?.(failed.length
        ? `Reset ${bare}, but these could not be saved and will come back: ${failed.join(', ')}`
        : 'Reset ' + bare, failed.length ? 'error' : undefined);
    } catch {}
    return !failed.length;
  },
};

if (typeof window !== 'undefined') window.SiteProfiles = SiteProfiles;
