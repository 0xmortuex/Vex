// === Notifications from panels: what a panel said while its toast was held =====
//
// Discord and WhatsApp in a panel (or a tab) tell you things through the page's
// own Notification API, and Windows shows them as toasts. While a game, a call
// or Focus mode has the screen, Windows holds those toasts back, and when you
// look up the panel's icon only says "11". This keeps a short local list of what
// each one said, so the answer to "what did that panel say?" is one click away.
//
// It is the person's OWN session in the person's OWN window, nothing more:
//   - OFF until the person turns it on in Settings and agrees to what it does
//     (VexConsent 'panel-capture'); then ON PER SITE, so Discord can be on
//     while WhatsApp stays off;
//   - what is kept is the notification's title and a short slice of its body
//     (200 and 300 characters), never the page, never a message that did not
//     raise a notification, and it never leaves this computer;
//   - never from a private window, a private or Tor tab or a routed container
//     (VexTabPolicy.canReadWebview), and never from a banking-looking address;
//   - at most 200 items, none older than 7 days; "Forget" empties the list;
//   - a conversation can be muted for a while inside Vex's own list: the page's
//     toast still shows (that is the page's, Vex does not touch it), but the
//     muted conversation does not count as waiting for you.
//
// The preload reports a notification to this window as 'vex-notification-seen'
// (preload-webview.js); js/sidebar.js and js/webview.js hand it to fromHost()
// and fromTab(). VIP rules (js/vip-rules.js) mark the ones that matter.
const PanelCapture = {
  CONSENT: 'panel-capture',
  KEYS: { on: 'vex.panelCapture.on', sites: 'vex.panelCapture.sites', items: 'vex.panelCapture.items', mutes: 'vex.panelCapture.mutes' },
  SOURCES: { discord: 'Discord', whatsapp: 'WhatsApp' },
  MAX_ITEMS: 200,
  MAX_AGE_MS: 7 * 24 * 3600 * 1000,
  MAX_MUTES: 50,
  DUP_MS: 5000,
  MUTE_CHOICES: { '15 minutes': 15 * 60000, '1 hour': 3600000, '8 hours': 8 * 3600000, '1 day': 24 * 3600000 },
  // A bank, a payment service or a government page is never read, whatever the panel is called.
  NEVER: /(^|[.-])(bank|banking|paypal|wise|revolut|monzo|n26|stripe|gov)([.-]|$)/i,

  _now() { return Date.now(); },

  // ---- storage ------------------------------------------------------------------
  _read(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try { const v = JSON.parse(raw); return v == null ? fallback : v; }
    catch (err) { throw new Error('The saved panel notifications "' + key + '" are not readable', { cause: err }); }
  },
  _write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  _emit(kind, item) {
    try { document.dispatchEvent(new CustomEvent('vex:panel-notification', { detail: { kind, item: item || null } })); }
    catch { /* vex-allow-empty-catch: no document: a test */ }
  },

  // ---- on / off, and which sites ----------------------------------------------------
  _flag() { return localStorage.getItem(this.KEYS.on) === '1'; },
  _consented() { return typeof VexConsent !== 'undefined' && VexConsent.granted(this.CONSENT); },
  enabled() { return this._flag() && this._consented(); },
  // Switching it on needs the consent; Settings asks for it and calls grant().
  setEnabled(on) {
    if (on && !this._consented()) throw new Error('Notifications from panels need your permission first: Settings, Panels and messages');
    localStorage.setItem(this.KEYS.on, on ? '1' : '0');
    this._emit('switched');
  },
  grant() {
    if (typeof VexConsent === 'undefined') throw new Error('Consents are not loaded (js/vex-defaults.js)');
    VexConsent.record(this.CONSENT, 'granted');
    localStorage.setItem(this.KEYS.on, '1');
    this._emit('switched');
  },
  revoke() {
    if (typeof VexConsent !== 'undefined') VexConsent.revoke(this.CONSENT);
    localStorage.setItem(this.KEYS.on, '0');
    this._emit('switched');
  },
  sites() { const v = this._read(this.KEYS.sites, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; },
  siteOn(source) { return this.sites()[source] === true; },
  setSite(source, on) {
    this._source(source);
    const s = this.sites();
    if (on) s[source] = true; else delete s[source];
    this._write(this.KEYS.sites, s);
    this._emit('switched');
  },
  label(source) { return this.SOURCES[source] || (typeof SidebarManager !== 'undefined' && SidebarManager.panelLabel ? SidebarManager.panelLabel(source) : source); },

  _source(name) {
    const s = String(name == null ? '' : name).toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,40}$/.test(s)) throw new Error('"' + String(name).slice(0, 30) + '" is not a panel name');
    return s;
  },

  // ---- coming in -----------------------------------------------------------------------
  _readable(webview) {
    const policy = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    if (!policy || typeof policy.canReadWebview !== 'function' || !webview) return false;
    if (policy.isPrivateWindow || !policy.canReadWebview(webview)) return false;
    let host = '';
    try { host = new URL(webview.getURL()).hostname; } catch { return false; }
    return !this.NEVER.test(host);
  },

  // A panel's webview reported a notification (js/sidebar.js).
  fromHost(source, payload, webview) {
    try {
      if (!this.enabled()) return null;
      return this.ingest(source, payload, { readable: this._readable(webview) });
    } catch (err) {
      console.error('[PanelCapture] a panel notification could not be recorded:', err);
      if (window.VexProblems) window.VexProblems.note('Panels', 'A panel notification could not be recorded', err);
      return null;
    }
  },

  // A tab's webview reported one (js/webview.js): only Discord and WhatsApp send them.
  fromTab(webview, payload) {
    try {
      if (!this.enabled()) return null;
      let host = '';
      try { host = new URL(webview.getURL()).hostname.toLowerCase(); } catch { return null; }
      const source = /(^|\.)(discord\.com|discordapp\.com)$/.test(host) ? 'discord' : host === 'web.whatsapp.com' ? 'whatsapp' : '';
      if (!source) return null;
      return this.ingest(source, payload, { readable: this._readable(webview) });
    } catch (err) {
      console.error('[PanelCapture] a tab notification could not be recorded:', err);
      if (window.VexProblems) window.VexProblems.note('Panels', 'A tab notification could not be recorded', err);
      return null;
    }
  },

  // -> the item kept, or null when it was not (off, site not opted in, unreadable page, a repeat).
  ingest(source, payload, { readable = true } = {}) {
    if (!this.enabled()) return null;
    const src = this._source(source);
    if (!this.siteOn(src) || !readable) return null;
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return null;
    if (!payload || typeof payload !== 'object') throw new Error('A notification from a panel needs a title and a body');
    const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    const title = clean(payload.title, 200), body = clean(payload.body, 300);
    if (!title && !body) return null;
    const now = this._now();
    const items = this._items(now);
    const dup = items.find(i => i.source === src && i.title === title && i.body === body && now - i.ts < this.DUP_MS);
    if (dup) return null;
    const item = { id: 'n' + now.toString(36) + Math.random().toString(36).slice(2, 6), source: src, title, body, ts: now, read: false, vip: null };
    if (typeof VipRules !== 'undefined' && !this.isMuted(src, title)) item.vip = VipRules.hit(title + ' ' + body, src);
    items.unshift(item);
    while (items.length > this.MAX_ITEMS) items.pop();
    this._write(this.KEYS.items, items);
    this._emit('added', item);
    this._breakThrough(item);
    return item;
  },

  // A VIP hit while Vex is quiet (Focus, a game, quiet hours...) gets one in-window
  // toast through the Attention Budget, which lets a VIP through (reason "vip").
  // Outside a quiet moment the page's own toast already did the job.
  _breakThrough(item) {
    if (!item.vip || this.isMuted(item.source, item.title)) return;
    if (typeof AttentionState === 'undefined' || typeof VexAttention === 'undefined') return;
    if (!AttentionState.get().quiet) return;
    const text = this.label(item.source) + ': ' + item.title + (item.body ? ' - ' + item.body : '');
    VexAttention.notify({ feature: 'panel-capture', urgency: 'useful', id: item.id, dedupeKey: item.source + '::' + item.title, title: text.slice(0, 140), vipText: item.title + ' ' + item.body, vipSource: item.source },
      () => { if (window.showToast) window.showToast(text.slice(0, 160), 'info', 6000); });
  },

  // ---- reading -------------------------------------------------------------------------------
  _items(now = this._now()) {
    const v = this._read(this.KEYS.items, []);
    return (Array.isArray(v) ? v : []).filter(i => i && typeof i.id === 'string' && typeof i.source === 'string' && now - i.ts < this.MAX_AGE_MS);
  },
  // { source?, unreadOnly?, since?, includeMuted? } -> newest first
  list({ source, unreadOnly = false, since = 0, includeMuted = false } = {}) {
    return this._items().filter(i => (!source || i.source === source) && (!unreadOnly || !i.read) && i.ts > since
      && (includeMuted || !this.isMuted(i.source, i.title)));
  },
  unreadCount(source) { return this.list({ source, unreadOnly: true }).length; },
  markRead(id) {
    const items = this._items();
    let n = 0;
    for (const i of items) if (!i.read && (id == null || i.id === id)) { i.read = true; n++; }
    if (n) { this._write(this.KEYS.items, items); this._emit('read'); }
    return n;
  },
  remove(id) {
    const items = this._items();
    const next = items.filter(i => i.id !== id);
    if (next.length === items.length) return false;
    this._write(this.KEYS.items, next);
    this._emit('removed');
    return true;
  },
  // "Forget": the list is emptied (and the mutes, which only make sense with it).
  forget() {
    localStorage.removeItem(this.KEYS.items);
    localStorage.removeItem(this.KEYS.mutes);
    this._emit('forgotten');
  },

  // ---- conversation mutes (Vex's own list only) ---------------------------------------------------
  _key(source, title) { return source + '::' + String(title || '').toLowerCase().slice(0, 120); },
  _mutes(now = this._now()) {
    const m = this._read(this.KEYS.mutes, {});
    const out = {};
    if (m && typeof m === 'object' && !Array.isArray(m)) for (const [k, until] of Object.entries(m)) if (Number(until) > now) out[k] = Number(until);
    return out;
  },
  isMuted(source, title) { return this._mutes()[this._key(source, title)] != null; },
  mute(source, title, ms) {
    const src = this._source(source);
    if (!(ms > 0)) throw new Error('A mute needs a length of time');
    const m = this._mutes();
    m[this._key(src, title)] = this._now() + ms;
    const keys = Object.keys(m);
    if (keys.length > this.MAX_MUTES) { keys.sort((a, b) => m[a] - m[b]); for (const k of keys.slice(0, keys.length - this.MAX_MUTES)) delete m[k]; }
    this._write(this.KEYS.mutes, m);
    this._emit('muted');
    return m[this._key(src, title)];
  },
  unmute(source, title) {
    const m = this._mutes();
    const k = this._key(source, title);
    if (!(k in m)) return false;
    delete m[k];
    this._write(this.KEYS.mutes, m);
    this._emit('muted');
    return true;
  },
  mutedList() { return Object.entries(this._mutes()).map(([k, until]) => ({ source: k.split('::')[0], title: k.slice(k.indexOf('::') + 2), until })); },
};

if (typeof VexConsent !== 'undefined') VexConsent.register(PanelCapture.CONSENT, { version: 1, label: 'Notifications from panels' });
if (typeof window !== 'undefined') window.PanelCapture = PanelCapture;
if (typeof module !== 'undefined' && module.exports) module.exports = { PanelCapture };
