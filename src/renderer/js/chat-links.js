// === Links that came out of a chat: a "new domain" flag and a throwaway session ======
//
// Two small features on the same fact: main (src/main.js, setWindowOpenHandler) says a
// link was clicked inside a chat (Discord, WhatsApp Web, Roblox chat ...) by the
// ADDRESS of the page it was clicked in (src/main/chat-origin.js). Nothing on the
// page is read to know that.
//
//   T3-100  Newly-seen domain flag   VexChatFlag
//     A link from a chat to a site that is not in your history gets a small "new"
//     mark on its tab. If that page then shows a sign-in form (checked with one yes-or-no
//     question to the page: is there a password box?), a strip says so, with the
//     address the link really goes to, why it was flagged, and a "do not warn again
//     for this site". Quiet by default: a new site WITHOUT a sign-in form gets the
//     tab mark only, and a site you have visited gets nothing.
//
//   T3-102  Throwaway session for chat links   VexChatThrowaway   (off until you turn it on)
//     A chat link opens in its own in-memory session (an "otr-" partition, the one
//     off-the-record tabs and burner identities use): no cookies of the main
//     session go in, and everything it stores is dropped when the tab closes. By
//     default only for sites you have never visited, so the sites you are signed in to
//     still open the way they always did; "all chat links" is a setting. The strip says
//     what happened and has "Move to Daily", which opens the same address in the
//     normal session and closes the throwaway.
//
// Both go through the same web-safety layer as everything else: the lookalike verdict
// for the address comes from webSafety.check (src/main/web-safety.js), not from a
// second detector, and "do not warn again" is this feature's own short list.

const VexChatLinks = {
  // --- the two switches ---------------------------------------------------------------
  FLAG_KEY: 'vex.chatFlag',                 // 'off' turns the new-domain flag off
  QUIET_KEY: 'vex.chatFlag.quiet',          // hosts the person said not to warn about
  THROW_KEY: 'vex.chatThrowaway',           // 'on' turns the throwaway session on (off by default)
  THROW_MODE_KEY: 'vex.chatThrowaway.mode', // 'unknown' (default) | 'all'

  flagEnabled() { try { return localStorage.getItem(this.FLAG_KEY) !== 'off'; } catch { return true; } },
  setFlagEnabled(on) { localStorage.setItem(this.FLAG_KEY, on ? 'on' : 'off'); if (!on) this.hideStrip(); return !!on; },
  throwEnabled() { try { return localStorage.getItem(this.THROW_KEY) === 'on'; } catch { return false; } },
  setThrowEnabled(on) { localStorage.setItem(this.THROW_KEY, on ? 'on' : 'off'); return !!on; },
  throwMode() { try { return localStorage.getItem(this.THROW_MODE_KEY) === 'all' ? 'all' : 'unknown'; } catch { return 'unknown'; } },
  setThrowMode(mode) {
    if (mode !== 'all' && mode !== 'unknown') throw new Error('The throwaway session is for unknown sites or for all chat links');
    localStorage.setItem(this.THROW_MODE_KEY, mode);
    return mode;
  },

  // --- hosts and history --------------------------------------------------------------
  SUFFIX2: new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.kr', 'co.in', 'com.br', 'com.tr', 'org.tr', 'net.tr', 'gen.tr', 'com.mx', 'com.ar', 'co.za', 'com.cn', 'com.hk', 'com.sg', 'com.ua', 'com.pl', 'com.ru']),
  hostOf(url) { try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/\.$/, '') : ''; } catch { return ''; } },
  // The name that was registered: shop.example.co.uk -> example.co.uk. An address by number is itself.
  registrable(host) {
    const h = String(host || '').toLowerCase();
    if (!h || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || !h.includes('.')) return h;
    const p = h.split('.');
    return p.length >= 3 && this.SUFFIX2.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
  },
  // How many history entries are on this registrable name. A history that cannot be read is an error.
  visits(host) {
    if (typeof HistoryPanel === 'undefined' || typeof HistoryPanel.list !== 'function') throw new Error('The history is not available, so "new to you" cannot be told');
    const reg = this.registrable(host);
    if (!reg) return 0;
    let n = 0;
    for (const e of HistoryPanel.list()) {
      const h = this.hostOf(e && e.url);
      if (h && this.registrable(h) === reg) n++;
    }
    return n;
  },
  quietHosts() {
    let v;
    try { v = JSON.parse(localStorage.getItem(this.QUIET_KEY) || '[]'); } catch (err) { throw new Error('The list of sites not to warn about is damaged: ' + err.message, { cause: err }); }
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  },
  isQuiet(host) { const reg = this.registrable(host); return this.quietHosts().some(q => q === reg || q === host); },
  addQuiet(host) {
    const reg = this.registrable(host);
    if (!reg) throw new Error('That is not a site name');
    const list = this.quietHosts().filter(q => q !== reg);
    list.push(reg);
    localStorage.setItem(this.QUIET_KEY, JSON.stringify(list.slice(-300)));
    return reg;
  },
  removeQuiet(host) {
    const reg = this.registrable(host);
    localStorage.setItem(this.QUIET_KEY, JSON.stringify(this.quietHosts().filter(q => q !== reg && q !== host)));
  },

  // --- the decision, made before the tab exists -----------------------------------------
  // data: what main sent with tab:create-from-external ({ url, fromChat, partition, ... }).
  // → null for an ordinary link, else { chat, host, real, realHost, wrapped, known, newDomain, throwaway, partition }.
  plan(data) {
    if (!data || typeof data.fromChat !== 'string' || !data.fromChat || !/^https?:\/\//i.test(String(data.url || ''))) return null;
    const flag = this.flagEnabled();
    const throwOn = this.throwEnabled();
    if (!flag && !throwOn) return null;
    const real = typeof LinkSafety !== 'undefined' ? LinkSafety.unwrap(data.url) : String(data.url);
    const host = this.hostOf(data.url);
    const realHost = this.hostOf(real) || host;
    if (!realHost) return null;
    const known = this.visits(realHost) > 0;
    const plan = { chat: data.fromChat, host, real, realHost, wrapped: real !== data.url, known, newDomain: flag && !known && !this.isQuiet(realHost), throwaway: false, partition: undefined };
    // A link that already names its own session (a container) keeps it; only the main session is swapped for a disposable one.
    if (throwOn && !data.partition && (this.throwMode() === 'all' || !known)) {
      plan.throwaway = true;
      plan.partition = 'otr-chat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    return plan.newDomain || plan.throwaway ? plan : null;
  },

  // After the tab is made: mark it. `created` is the tab, or the id of one already open that was used instead.
  after(created, plan) {
    if (!plan || created == null || typeof TabManager === 'undefined') return null;
    const id = typeof created === 'string' ? created : created.id;
    const tab = TabManager.tabs.find(t => t.id === id);
    if (!tab) return null;
    // A tab that was already open (duplicate match) is not a new, flagged tab.
    if (plan.partition && tab.partition !== plan.partition) return null;
    Object.defineProperty(tab, 'chatLink', { value: { chat: plan.chat, realHost: plan.realHost, real: plan.real, wrapped: plan.wrapped, newDomain: plan.newDomain, throwaway: plan.throwaway }, writable: true, enumerable: false, configurable: true });
    this.refreshTabElement(tab);
    return tab;
  },

  // The tab's element was drawn before it was marked (or the mark changed): draw the mark again.
  refreshTabElement(tab) {
    if (typeof document === 'undefined') return;
    const el = document.querySelector('.tab-item[data-tab-id="' + String(tab.id).replace(/"/g, '') + '"]');
    if (!el) return;
    el.querySelector('.tab-chat-flag')?.remove();
    this.markTabElement(el, tab);
  },

  // Called by TabManager when it draws a tab (tabs.js, _createTabElement).
  markTabElement(el, tab) {
    const c = tab && tab.chatLink;
    if (!c || !(c.newDomain || c.throwaway)) return;
    this._style();
    const flag = document.createElement('span');
    flag.className = 'tab-chat-flag';
    flag.textContent = c.throwaway ? 'throwaway' : 'new';
    flag.title = (c.newDomain ? c.realHost + ' is new to you. ' : '') + 'It came from ' + c.chat + (c.throwaway ? '. It is in a throwaway session that is forgotten when the tab closes.' : '.');
    const info = el.querySelector('.tab-info');
    if (info) info.after(flag); else el.appendChild(flag);
  },

  // --- the strip ------------------------------------------------------------------------
  _strip: null,
  _stripTab: null,
  hideStrip() { if (this._strip) { this._strip.remove(); this._strip = null; this._stripTab = null; } },

  _style() {
    if (typeof document === 'undefined' || document.getElementById('chat-links-style')) return;
    const st = document.createElement('style');
    st.id = 'chat-links-style';
    st.textContent = `
      .tab-chat-flag { flex: none; font-size: 9.5px; line-height: 1; padding: 2px 5px; border-radius: 8px; margin-left: 4px; color: var(--text); background: color-mix(in srgb, var(--vex-warning, #d9a441) 28%, transparent); border: 1px solid color-mix(in srgb, var(--vex-warning, #d9a441) 55%, transparent); }
      #chat-link-strip { position: absolute; left: 10px; right: 10px; top: 8px; z-index: 40; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12.5px; color: var(--text); background: var(--surface, var(--bg)); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 26px var(--vex-shadow-color, rgba(0,0,0,.3)); }
      #chat-link-strip .cl-text { flex: 1 1 260px; min-width: 0; }
      #chat-link-strip .cl-why { flex: 1 1 100%; margin: 0; padding-left: 18px; font-size: 11.5px; color: var(--text-muted); }
      #chat-link-strip button { font-size: 12px; color: var(--text); background: none; border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; cursor: pointer; }
      #chat-link-strip button.cl-primary { background: var(--primary, #4f8cff); color: var(--on-primary, #fff); border-color: transparent; }`;
    document.head.appendChild(st);
  },

  showStrip(tab, { text, reasons = [], actions = [] }) {
    this.hideStrip();
    this._style();
    const area = document.getElementById('webviews-container') || document.getElementById('content-area');
    if (!area) throw new Error('There is no page area to show the notice in');
    const el = document.createElement('div');
    el.id = 'chat-link-strip';
    el.setAttribute('role', 'status');
    const t = document.createElement('div');
    t.className = 'cl-text';
    t.textContent = text;
    el.appendChild(t);
    const why = document.createElement('ul');
    why.className = 'cl-why';
    why.hidden = true;
    for (const r of reasons) { const li = document.createElement('li'); li.textContent = r; why.appendChild(li); }
    const btn = (label, fn, primary) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; if (primary) b.className = 'cl-primary';
      b.addEventListener('click', () => { Promise.resolve().then(fn).catch(err => window.showToast?.((err && err.message) || String(err), 'error')); });
      el.appendChild(b);
      return b;
    };
    if (reasons.length) btn('Why was this flagged?', () => { why.hidden = !why.hidden; });
    for (const a of actions) btn(a.label, a.run, a.primary);
    btn('Dismiss', () => this.hideStrip());
    el.appendChild(why);
    if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
    area.appendChild(el);
    this._strip = el;
    this._stripTab = tab.id;
    return el;
  },

  // Does the page in this tab ask for a password? One yes-or-no; the page's text is not read.
  async _hasLoginForm(tab) {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
    if (!wv || tab.sleeping || tab._lazy) return false;
    if (window.VexTabPolicy && !window.VexTabPolicy.canFillWebview(wv)) return false;
    return (await window.vexGuestEval(wv, '!!document.querySelector(\'input[type="password"]\')', false, 1500)) === true;
  },

  async _lookalikeLines(host) {
    if (!window.vex || !window.vex.webSafety || typeof window.vex.webSafety.check !== 'function') return [];
    const r = await window.vex.webSafety.check(host);
    return r && r.flagged ? [r.line, ...(r.reasons || [])] : [];
  },

  // A page in a flagged or throwaway tab has settled (webview.js fires vex:tab-settled).
  async onSettled(tabId) {
    if (typeof TabManager === 'undefined') return;
    const tab = TabManager.tabs.find(t => t.id === tabId);
    const c = tab && tab.chatLink;
    if (!c || c.shown) return;
    if (TabManager.activeTabId !== tab.id) return;           // shown when the person gets to it (onActivated)
    c.shown = true;
    const reasons = [];
    let login = false;
    if (c.newDomain && this.flagEnabled()) {
      try { login = await this._hasLoginForm(tab); }
      catch (err) { window.VexProblems?.note('Chat links', 'Could not ask the page whether it has a sign-in form', err); }
      reasons.push('You have never visited ' + c.realHost + ' (it is not in your history).');
      reasons.push('The link came out of ' + c.chat + ', where anybody can post a link.');
      if (c.wrapped) reasons.push('The link was a wrapper; it really goes to ' + c.real + '.');
      if (login) reasons.push('The page asks for a password.');
      try { reasons.push(...await this._lookalikeLines(c.realHost)); }
      catch (err) { window.VexProblems?.note('Chat links', 'Could not get the web safety verdict for ' + c.realHost, err); }
    }
    const flagged = c.newDomain && login;
    if (!flagged && !c.throwaway) return;
    const parts = [];
    if (flagged) parts.push(c.realHost + ' is new to you and came from ' + c.chat + '. It asks you to sign in, so check the address before you type anything.');
    if (c.throwaway) parts.push((flagged ? '' : c.realHost + ' came from ' + c.chat + '. ') + 'It is open in a throwaway session: it cannot see your other logins, and it is forgotten when you close this tab.');
    const actions = [];
    if (c.throwaway) actions.push({ label: 'Move to Daily', primary: true, run: () => this.moveToDaily(tab) });
    if (flagged) actions.push({ label: 'Do not warn again for this site', run: () => { this.addQuiet(c.realHost); c.newDomain = false; this.hideStrip(); this.refreshTabElement(tab); window.showToast?.('Vex will not flag ' + c.realHost + ' again'); } });
    this.showStrip(tab, { text: parts.join(' '), reasons: flagged ? reasons : [], actions });
  },

  onActivated(tabId) {
    if (this._stripTab && this._stripTab !== tabId) this.hideStrip();
    const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
    if (tab && tab.chatLink && !tab.chatLink.shown && !tab.loading) this.onSettled(tabId).catch(err => window.VexProblems?.note('Chat links', 'Could not show the notice', err));
  },

  // The same address in the normal session, and the throwaway closed.
  moveToDaily(tab) {
    const url = tab.url;
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('This tab has no web address to move');
    TabManager.createTab(url, true, tab.groupId || null, { partition: 'persist:main' });
    TabManager.closeTab(tab.id);
    this.hideStrip();
    return true;
  },

  init() {
    if (this._wired || typeof document === 'undefined') return false;
    this._wired = true;
    document.addEventListener('vex:tab-settled', (e) => {
      const id = e && e.detail && e.detail.tabId;
      if (id) this.onSettled(id).catch(err => window.VexProblems?.note('Chat links', 'Could not show the notice', err));
    });
    window.addEventListener('vex:tab-activated', (e) => { if (e && e.detail) this.onActivated(e.detail.tabId); });
    document.addEventListener('vex:tab-closed', (e) => { if (e && e.detail && e.detail.tabId === this._stripTab) this.hideStrip(); });
    return true;
  },
};

// Two switches over one module, so Minimal Vex can turn each off and put it back (vex-usage-registry.js).
const VexChatFlag = { enabled: () => VexChatLinks.flagEnabled(), setEnabled: (on) => VexChatLinks.setFlagEnabled(on) };
const VexChatThrowaway = { enabled: () => VexChatLinks.throwEnabled(), setEnabled: (on) => VexChatLinks.setThrowEnabled(on) };

if (typeof window !== 'undefined') {
  window.VexChatLinks = VexChatLinks; window.VexChatFlag = VexChatFlag; window.VexChatThrowaway = VexChatThrowaway;
  VexChatLinks.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexChatLinks, VexChatFlag, VexChatThrowaway };
