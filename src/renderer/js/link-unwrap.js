// === Skip tracking redirect links (the window's side) =========================
//
// A click on google.com/url?q=..., facebook.com/l.php?u=... and the other wrappers in js/link-safety.js goes straight to the page
// the link names. Main does it (src/main/nav-unwrap.js, src/main.js _unwrapTarget): only a link you just clicked, only a GET, only a
// known wrapper, never a Tor tab, never a site you turned it off for. This file is what the person sees:
//
//   - the global setting (Settings, Ctrl+K). New profile: on. A profile that already had data: off until it is turned on. Decided
//     once, from the same "is this a new profile" the quiet defaults use (js/quiet-defaults.js), and never over a saved choice;
//   - a quiet toast the first three times ("Skipped the redirect via google.com") with Undo, which opens the link as it was, once;
//   - the per-site off switch is in the site panel (js/site-panel.js).
const VexLinkUnwrap = {
  TOASTS_KEY: 'vex.unwrapToasts',
  TOASTS_MAX: 3,
  _bound: false,
  _on: null,

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },
  _note(msg, err) { if (window.VexProblems) window.VexProblems.note('Skip redirects', msg, err); else console.error('[LinkUnwrap] ' + msg, err); },

  on() { return this._on === true; },

  // What a profile that has not decided yet gets: on for a new profile, off for one that already had data. Pure given the state.
  defaultFor(quietState) { return !!quietState && quietState.mode === 'quiet'; },

  _quietState() {
    if (typeof VexQuietDefaults === 'undefined') throw new Error('Quiet defaults are not loaded, so a new profile cannot be told from an old one');
    return VexQuietDefaults.state();
  },

  toastsShown() {
    let n = 0;
    try { n = parseInt(localStorage.getItem(this.TOASTS_KEY) || '0', 10) || 0; } catch (err) { this._note('Could not read how many times the redirect note was shown', err); }
    return n;
  },
  _countToast() { try { localStorage.setItem(this.TOASTS_KEY, String(this.toastsShown() + 1)); } catch (err) { this._note('Could not remember that the redirect note was shown', err); } },

  _tabOfPage(pageId) {
    for (const tab of TabManager.tabs) {
      const wv = WebviewManager.webviews.get(tab.id);
      let id = null;
      try { id = wv && wv.getWebContentsId ? wv.getWebContentsId() : null; } catch { id = null; }
      if (id === pageId) return { tab, wv };
    }
    return null;
  },

  // Main skipped a redirect: msg = { pageId, from, to, via, newTab }.
  onSkipped(msg) {
    if (!msg || typeof msg.from !== 'string') return;
    if (this.toastsShown() >= this.TOASTS_MAX) return;
    this._countToast();
    const via = (msg.via && msg.via[0]) || (() => { try { return new URL(msg.from).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    const actions = msg.newTab ? undefined : { actions: [{ label: this._t('Undo'), run: () => { this.undo(msg).catch(err => { this._note('Undo did not work', err); window.showToast?.(err.message, 'error'); }); } }] };
    window.showToast?.(this._t('Skipped the redirect via {1}').replace('{1}', via), 'info', 7000, actions);
  },

  // Open the link as it was, once, in the tab it was clicked in.
  async undo(msg) {
    const found = this._tabOfPage(msg.pageId);
    if (!found) throw new Error('That tab is not open any more');
    const res = await window.vex.linkUnwrapAllowOnce({ pageId: msg.pageId, url: msg.from });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not open the link as it was');
    found.wv.loadURL(msg.from);
  },

  async set(on) {
    if (SiteRulesUI._isPrivate()) throw new Error('Change this in a normal window: it applies to every window');
    const res = await window.vex.navPrivacySet({ unwrap: !!on });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not change this setting');
    this._on = res.unwrap === true;
    return this._on;
  },

  registerSettings() {
    const G = window.VexSettingsGroups;
    if (!G || this._registered) return;
    this._registered = true;
    G.register({
      id: 'link-unwrap', title: 'Skip tracking redirect links', keywords: 'redirect tracking links google url facebook unwrap clean link wrapper',
      render: (body) => {
        const label = document.createElement('label');
        label.style.cssText = 'display:block;margin:4px 0';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = this.on();
        cb.addEventListener('change', () => { this.set(cb.checked).then((now) => { cb.checked = now; }, (err) => { cb.checked = this.on(); window.showToast?.(err.message, 'error'); }); });
        label.append(cb, document.createTextNode(' ' + this._t('Go straight to the page behind a tracking redirect link')));
        body.append(label, G.note(this._t('A link you click that goes through google.com/url, facebook.com/l.php and similar goes straight to the real page, so those companies do not hear of the click. Only links you click, only known redirect pages, and never from https to http. A site where it breaks a sign-in can be left out in its site panel.')));
      },
    });
  },

  async init() {
    if (this._bound) return this;
    this._bound = true;
    try { this.registerSettings(); } catch (err) { this._note('The Settings section could not be added', err); }
    if (window.vex && typeof window.vex.onLinkUnwrapped === 'function') window.vex.onLinkUnwrapped((msg) => this.onSkipped(msg));
    if (window.vex && typeof window.vex.onNavPrivacyChanged === 'function') window.vex.onNavPrivacyChanged((state) => { if (state && typeof state.unwrap === 'boolean') this._on = state.unwrap; });
    const res = await window.vex.navPrivacyGet();
    if (!res || !res.ok) throw new Error((res && res.error) || 'Could not read the redirect setting');
    this._on = res.unwrap === true;
    // Not decided yet on this profile: Vex's default, written once (never over a choice: main only has null here).
    if (res.unwrap === null && !SiteRulesUI._isPrivate()) {
      const want = this.defaultFor(this._quietState());
      const done = await window.vex.navPrivacySet({ unwrap: want });
      if (!done || !done.ok) throw new Error((done && done.error) || 'Could not save the redirect default');
      this._on = done.unwrap === true;
    }
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.VexLinkUnwrap = VexLinkUnwrap;
  if (typeof document !== 'undefined' && window.vex && typeof window.vex.navPrivacyGet === 'function') {
    VexLinkUnwrap.init().catch(err => VexLinkUnwrap._note('Skipping redirects could not start', err));
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLinkUnwrap };
