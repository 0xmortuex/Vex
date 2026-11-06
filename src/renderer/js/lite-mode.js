// === Lite mode: for slow Wi-Fi and a phone hotspot ======================================
//
// One switch (the toolbar badge, Settings, Ctrl+K) that, on every web tab:
//
//   - refuses the page's pictures and web fonts: the same per-request hook the per-site "Pictures" switch uses, with one global
//     flag (src/main/ad-verdict.js 'lite', src/main/nav-privacy.js);
//   - stops sound and video from starting by themselves: a tab built with autoplayPolicy=user-gesture-required, so the tabs open
//     are built again when the switch is thrown (js/webview.js autoplayDiffers, js/site-rules-ui.js autoplayOff).
//
// A page looks broken on purpose, so a "Lite mode on" badge stays on the toolbar while it is on; its menu turns it off, or leaves
// the site in front out of it. The same exemption is in the site panel. A Tor tab and Vex's own pages are never changed. Nothing
// here starts by itself and nothing leaves the computer.
const VexLiteMode = {
  _bound: false,

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },
  _note(msg, err) { if (window.VexProblems) window.VexProblems.note('Lite mode', msg, err); else console.error('[LiteMode] ' + msg, err); },

  on() { return SiteRulesUI.liteOn(); },

  // The open tabs whose guest was built for the other autoplay setting: they are built again when the switch is thrown.
  tabsToRebuild() {
    if (typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return [];
    return TabManager.tabs.filter((tab) => {
      const wv = WebviewManager.webviews.get(tab.id);
      if (!wv) return false;                       // asleep or not built yet: it is built with the right policy when it wakes
      let url = tab.url;
      try { url = (wv.getURL && wv.getURL()) || tab.url; } catch { url = tab.url; }
      return WebviewManager.autoplayDiffers(url, wv._noAutoplay, tab.partition);
    });
  },

  // Throw the switch. ask: say first how many tabs will reload (a press in this window); a change made in another window just follows.
  async set(on, { ask = true } = {}) {
    on = !!on;
    if (on === this.on()) return on;
    if (SiteRulesUI._isPrivate()) throw new Error('Change Lite mode in a normal window: it applies to every window');
    if (typeof window.vex.navPrivacySet !== 'function') throw new Error('Lite mode is not available in this build');
    const wasOn = this.on();
    SiteRulesUI.setLiteOn(on);                     // tabs are judged against the new setting from here
    const rebuild = this.tabsToRebuild();
    SiteRulesUI.setLiteOn(wasOn);
    if (ask && rebuild.length) {
      const ok = await window.vexConfirm({
        title: this._t(on ? 'Turn Lite mode on' : 'Turn Lite mode off'),
        message: this._t('{1} open tabs reload so video and sound can stop starting by themselves. Anything typed into them and not sent is lost.').replace('{1}', String(rebuild.length)),
        okLabel: this._t(on ? 'Turn on and reload' : 'Turn off and reload'),
      });
      if (!ok) return wasOn;
    }
    const res = await window.vex.navPrivacySet({ lite: on });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Lite mode could not be changed');
    this.follow(on, rebuild);
    window.showToast?.(this._t(on ? 'Lite mode is on: pictures and fonts are not loaded, and video waits for a click.' : 'Lite mode is off.'));
    return on;
  },

  // This window's side of a change (made here or in another window).
  follow(on, rebuild) {
    SiteRulesUI.setLiteOn(on);
    const list = rebuild || this.tabsToRebuild();
    for (const tab of list) TabManager.rebuildTab(tab.id);
    // A page that is not built again still shows what it loaded before; the one in front reloads so the change is visible.
    const active = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    if (active && !list.some(t => t.id === active.id)) {
      const wv = WebviewManager.webviews.get(active.id);
      let url = '';
      try { url = wv && wv.getURL ? wv.getURL() : ''; } catch { url = ''; }
      if (wv && /^https?:/i.test(url)) { try { wv.reload(); } catch (err) { this._note('The page in front could not reload', err); } }
    }
    this.paint();
  },

  toggle() { return this.set(!this.on()); },

  // ---- the badge -----------------------------------------------------------------------------
  paint() {
    const btn = document.getElementById('btn-lite-mode');
    if (!btn) return;
    btn.hidden = !this.on();
    const label = this._t('Lite mode on');
    btn.title = this._t('Lite mode is on: pictures and fonts are not loaded and video waits for a click. Click for options.');
    btn.setAttribute('aria-label', label);
    const span = btn.querySelector('.lite-label');
    if (span) span.textContent = label;
  },

  _activeUrl() {
    const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const wv = tab && typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || (tab && tab.url) || ''; } catch { url = (tab && tab.url) || ''; }
    return { tab, url: /^https?:/i.test(url) ? url : '' };
  },

  openMenu(btn) {
    document.getElementById('lite-mode-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'lite-mode-menu';
    menu.className = 'ext-menu';
    const { tab, url } = this._activeUrl();
    const items = [{ label: this._t('Turn Lite mode off'), sub: this._t('Pictures and fonts load again; the open tabs reload'), run: () => this.set(false) }];
    if (url && !SiteRulesUI._isPrivate()) {
      const host = SiteRulesUI.host(url);
      const exempt = SiteRulesUI.isOff(url, 'lite');
      items.push({
        label: this._t(exempt ? 'Lite mode follows {1} again' : 'Leave Lite mode off for {1}').replace('{1}', host),
        sub: this._t('Only this site; the tab reloads'),
        run: async () => { await SiteRulesUI.set(url, 'lite', !exempt); TabManager.rebuildTab(tab.id); },
      });
    }
    for (const it of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ext-menu-item';
      row.innerHTML = '<span class="ext-menu-text"><span class="ext-menu-label"></span><span class="ext-menu-sub"></span></span>';
      row.querySelector('.ext-menu-label').textContent = it.label;
      row.querySelector('.ext-menu-sub').textContent = it.sub;
      row.addEventListener('click', () => { menu.remove(); Promise.resolve(it.run()).catch(err => window.showToast?.(err.message, 'error')); });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    if (typeof VexLayer !== 'undefined') VexLayer.popover(menu, 'lite-mode-menu');
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth || 260;
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
  },

  // ---- Settings ----------------------------------------------------------------------------
  registerSettings() {
    const G = window.VexSettingsGroups;
    if (!G || this._registered) return;
    this._registered = true;
    G.register({
      id: 'lite-mode', title: 'Lite mode (slow Wi-Fi)', keywords: 'lite mode slow wifi hotspot data saver images fonts autoplay metered',
      render: (body) => {
        const label = document.createElement('label');
        label.style.cssText = 'display:block;margin:4px 0';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = this.on();
        cb.addEventListener('change', () => {
          this.set(cb.checked).then((now) => { cb.checked = now; }, (err) => { cb.checked = this.on(); window.showToast?.(err.message, 'error'); });
        });
        label.append(cb, document.createTextNode(' ' + this._t('Lite mode')));
        body.append(label, G.note(this._t('For a slow connection or a phone hotspot: no pictures, no web fonts, and video and sound start only when you click. Pages can look plain or broken; a badge on the toolbar says Lite mode is on, and a site can be left out of it from the site panel.')));
      },
    });
  },

  async init() {
    if (this._bound) return this;
    this._bound = true;
    document.getElementById('btn-lite-mode')?.addEventListener('click', (e) => this.openMenu(e.currentTarget));
    try { this.registerSettings(); } catch (err) { this._note('The Settings section could not be added', err); }
    this.paint();
    // Main's flag is the truth (the window's copy is only a hint for the first tabs): read it, and follow another window's change.
    if (window.vex && typeof window.vex.onNavPrivacyChanged === 'function') {
      window.vex.onNavPrivacyChanged((state) => { if (state && typeof state.lite === 'boolean' && state.lite !== this.on()) this.follow(state.lite); });
    }
    if (window.vex && typeof window.vex.navPrivacyGet === 'function') {
      const res = await window.vex.navPrivacyGet();
      if (!res || !res.ok) throw new Error((res && res.error) || 'Could not read Lite mode');
      if (res.lite !== this.on()) this.follow(res.lite);
    }
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.VexLiteMode = VexLiteMode;
  if (typeof document !== 'undefined' && window.vex) {
    VexLiteMode.init().catch(err => VexLiteMode._note('Lite mode could not start', err));
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLiteMode };
