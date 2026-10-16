// === Instant tab switch: the last picture of a page while it wakes (T3-069) =====
//
// A tab put to sleep (or not made yet) has no page. Going to it makes the page
// again, and for a second or two the window shows an empty white area. This keeps
// the last picture of each tab you leave and, when you go to one that is asleep,
// shows that picture over the empty area until the page has loaded. It is a
// picture and nothing more: the page behind it is the real one, and the picture
// takes no clicks, so scrolling and clicking go through to it as soon as it exists.
//
// What is kept: the pictures of the last 12 tabs you left, in memory only (never
// written to disk, never synced, gone when Vex closes). Not for a private, Tor or
// other session-only tab, not for a page of Vex's own, and a picture is dropped when
// its tab closes or its page has moved on (a different address).
const VexTabThumbs = {
  KEY: 'vex.tabThumbs',
  DEFAULTS: { on: true },
  MAX: 12,
  WIDTH: 420,
  MIN_GAP_MS: 15000,
  MAX_SHOWN_MS: 4000,

  _shots: new Map(),    // tabId -> { url, data, at }  (insertion order = oldest first)
  _overlay: null,

  enabled() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return this.DEFAULTS.on;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[TabThumbs] the saved choice is damaged and starts again:', err); return this.DEFAULTS.on; }
    return !!(v && typeof v === 'object' && typeof v.on === 'boolean' ? v.on : this.DEFAULTS.on);
  },
  setEnabled(on) {
    localStorage.setItem(this.KEY, JSON.stringify({ on: !!on }));
    if (!on) { this._shots.clear(); this.hide(); }
  },

  // May a picture of this tab be kept? A web page in a session that outlives the window.
  allowed(tab) {
    if (!tab || !/^https?:/i.test(tab.url || '')) return false;
    return !tab.partition || String(tab.partition).startsWith('persist:');
  },

  remember(tab, data) {
    if (!data || !this.allowed(tab)) return;
    this._shots.delete(tab.id);
    this._shots.set(tab.id, { url: tab.url, data, at: Date.now() });
    while (this._shots.size > this.MAX) this._shots.delete(this._shots.keys().next().value);
  },
  forget(tabId) { this._shots.delete(tabId); },
  get(tab) {
    const s = tab && this._shots.get(tab.id);
    if (!s) return null;
    // The page it was a picture of, not another one the tab went on to.
    if (s.url !== (tab.originalUrl || tab.url)) { this._shots.delete(tab.id); return null; }
    return s;
  },
  size() { return this._shots.size; },

  // Called by switchTab just before the tab in front changes: the picture is taken from the page while it
  // is still showing. Not more than once in 15 seconds for the same address.
  leaving(tabId) {
    if (!this.enabled() || typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return;
    const tab = TabManager.tabs.find(t => t.id === tabId);
    const wv = WebviewManager.webviews.get(tabId);
    if (!tab || !wv || !wv._attached || typeof wv.capturePage !== 'function' || !this.allowed(tab)) return;
    const last = this._shots.get(tabId);
    if (last && last.url === tab.url && Date.now() - last.at < this.MIN_GAP_MS) return;
    let pending;
    try { pending = Promise.resolve(wv.capturePage()); }
    catch (err) { this._note('The picture of a tab could not be asked for', err); return; }
    pending.then(img => {
      if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) return;
      const small = typeof img.resize === 'function' ? img.resize({ width: this.WIDTH }) : img;
      this.remember(tab, small.toDataURL());
    }).catch(err => this._note('The picture of a tab could not be taken', err));
  },

  _note(what, err) {
    if (typeof VexProblems !== 'undefined') VexProblems.note('Tabs', what, err);
    else console.warn('[TabThumbs] ' + what + ':', err && err.message);
  },

  // Called by wakeTab for the tab that was asleep, once its page is being made.
  showWhileWaking(tab, wv) {
    this.hide();
    if (!this.enabled() || !tab || tab.id !== TabManager.activeTabId) return false;
    if (typeof SplitScreen !== 'undefined' && SplitScreen.active) return false;
    const shot = this.get(tab);
    const host = document.getElementById('webviews-container');
    if (!shot || !host) return false;
    const img = document.createElement('img');
    img.className = 'tw-shot';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.src = shot.data;
    host.appendChild(img);
    const done = () => this.hide();
    const timer = setTimeout(done, this.MAX_SHOWN_MS);
    const stopOnTab = (e) => { if (!e.detail || e.detail.tabId !== tab.id) done(); };
    window.addEventListener('vex:tab-activated', stopOnTab);
    const events = ['did-finish-load', 'did-fail-load', 'crashed', 'destroyed'];
    for (const ev of events) wv.addEventListener(ev, done, { once: true });
    this._overlay = { img, timer, cleanup: () => { clearTimeout(timer); window.removeEventListener('vex:tab-activated', stopOnTab); for (const ev of events) wv.removeEventListener(ev, done); } };
    this._shots.delete(tab.id);
    return true;
  },

  hide() {
    const o = this._overlay;
    if (!o) return;
    this._overlay = null;
    o.cleanup();
    // One frame later, so the page underneath has been painted before the picture goes.
    requestAnimationFrame(() => o.img.remove());
  },
  shown() { return !!this._overlay; },

  init() {
    document.addEventListener('vex:tab-closed', (e) => { if (e.detail && e.detail.tabId) this.forget(e.detail.tabId); });
  },
};

if (typeof window !== 'undefined') window.VexTabThumbs = VexTabThumbs;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTabThumbs };
