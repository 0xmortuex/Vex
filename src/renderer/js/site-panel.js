// === The site panel — everything about the site in front, in one place =====
//
// Click (or Enter/Space on) the icon at the left of the address field. What a
// site may do and how Vex treats it used to be spread over five screens — Site
// Settings, What This Site Is Allowed, Site Data, Site Rules, Settings › Site
// permissions — and the padlock itself did nothing. This panel shows all of it
// for the page in front and changes it in the SAME stores those screens read:
//
//   connection, certificate   the page's own connection (main, site:certificate)
//   permissions               main/permissions.js, the store the page is held to
//                             (persist:main, its container's, or a private
//                             window's in memory) — Settings › Site Permissions
//   zoom                      vex.zooms (WebviewManager, Ctrl+= / Ctrl+-)
//   never sleep               vex.neverSleepHosts (TabManager._isKeptAwake)
//   always translate          vex.translateAlwaysHosts (js/translate-side.js)
//   dark mode, custom CSS/JS  vex.forceDarkHosts, VexBoosts
//   ad & tracker blocking     the site switches, 'ads' (main/site-rules.js)
//   JavaScript, cookies,      the site switches (js/site-rules-ui.js)
//   content from other sites
//   where it opens            vex.siteRoutes (js/site-routes.js): a container,
//                             Tor or a proxy, every time
//   cookies and site data     the tab's own session (js/site-data.js)
//
// Settings › Site settings lists every site with anything set
// (SiteProfiles.renderSettings), from those same stores.
//
// A private window, an off-the-record tab and a Tor tab keep nothing: the
// panel shows what applies there and says, in so many words, that nothing set
// in it is saved; it never writes a site's name into the profile from them.
const SitePanel = {
  _el: null,
  _ctx: null,
  _returnFocus: null,
  _after: null,        // 'rebuild' | 'reload' once a switch changed: done on close
  _showAllPerms: false,
  _certOpen: false,
  _proxyOpen: false,

  // The permissions a site most often asks for are always listed; the rest
  // only once the site has an answer, or with "Show all".
  PERMS: [
    { id: 'geolocation', name: 'Location', icon: 'pin', common: true },
    { id: 'camera', name: 'Camera', icon: 'camera', common: true },
    { id: 'microphone', name: 'Microphone', icon: 'mic', common: true },
    { id: 'notifications', name: 'Notifications', icon: 'bell', common: true },
    { id: 'popups', name: 'Pop-ups', icon: 'window', common: true, noAsk: true,
      note: 'Windows the page opens by itself. A link you click always opens.' },
    { id: 'clipboard-read', name: 'Read your clipboard', icon: 'clipboard' },
    { id: 'display-capture', name: 'Share your screen', icon: 'monitor' },
    { id: 'midi', name: 'MIDI devices', icon: 'music' },
  ],
  CONTAINERS: ['work', 'personal', 'shopping'],

  // ---- what the page in front is --------------------------------------------
  // The tab in front, or the one given (a page's own context menu).
  context(forTab = null) {
    const tab = forTab || (typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null);
    if (!tab) throw new Error('There is no tab open');
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
    let url = '';
    try { url = (wv && wv.getURL && wv.getURL()) || tab.url || ''; } catch { url = tab.url || ''; }
    const policy = window.VexTabPolicy || {};
    const partition = tab.partition || policy.defaultPartition || 'persist:main';
    let u = null;
    try { u = new URL(url); } catch { u = null; }
    const web = !!u && /^https?:$/.test(u.protocol);
    const start = !web && this._isStart(url);
    const kind = web ? 'web' : start ? 'start' : (u && u.protocol === 'file:') ? 'file' : 'internal';
    const privateWindow = !!policy.isPrivateWindow;
    const tor = /^tor-/.test(partition);
    const torRoute = partition === 'persist:route-tor';
    const ephemeral = !partition.startsWith('persist:');
    let pageId = null;
    try { pageId = wv && typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null; } catch { pageId = null; }
    return {
      tab, wv, url, kind, web, partition, privateWindow, tor, torRoute, ephemeral, pageId,
      host: web ? u.hostname.replace(/^www\./, '').toLowerCase() : '',
      fullHost: web ? u.hostname.toLowerCase() : '',
      origin: web ? u.origin : '',
      secure: !!u && u.protocol === 'https:',
      container: /^persist:container-/.test(partition) ? partition.slice('persist:container-'.length) : null,
      proxyRoute: /^persist:route-proxy-/.test(partition),
      // Whether a choice made here may be kept for the site.
      canSave: web && !privateWindow && !ephemeral,
    };
  },

  _isStart(url) {
    try {
      const p = new URL(url);
      return (p.protocol === 'vex:' && p.hostname === 'start') || (p.protocol === 'file:' && /\/renderer\/start\.html$/i.test(p.pathname));
    } catch { return false; }
  },

  // Why nothing here is kept, when it is not.
  _notKept(c) {
    if (c.privateWindow) return 'This is a private window: nothing you set here is kept, and the site’s own settings are changed from a normal window.';
    if (c.tor) return 'This is a Tor tab: nothing you set here is kept, and sites are given no permissions at all.';
    if (c.ephemeral) return 'This tab keeps nothing: nothing you set here is saved. Change the site’s settings from an ordinary tab.';
    return '';
  },

  // ---- the icon in the address field ---------------------------------------
  _iconFor(c) {
    if (!c || c.kind === 'start' || c.kind === 'internal') return { icon: 'globe', state: 'internal', label: 'Vex page — site information' };
    if (c.kind === 'file') return { icon: 'file', state: 'file', label: 'Local file — site information' };
    if (c.secure) return { icon: 'lock', state: 'secure', label: 'Connection is secure — site information and settings for ' + c.host };
    return { icon: 'unlock', state: 'insecure', label: 'Not secure — site information and settings for ' + c.host };
  },

  refreshIcon() {
    const btn = document.getElementById('url-site-btn');
    if (!btn) return null;
    let c = null;
    try { c = this.context(); } catch { c = null; }
    const look = this._iconFor(c);
    if (btn.dataset.state !== look.state || btn.dataset.icon !== look.icon) {
      btn.dataset.state = look.state;
      btn.dataset.icon = look.icon;
      btn.innerHTML = VexIcons.svg(look.icon, { size: 14 });
      const svg = btn.querySelector('svg');
      if (svg) { svg.id = 'url-icon'; svg.setAttribute('aria-hidden', 'true'); }
    }
    btn.title = look.label;
    btn.setAttribute('aria-label', look.label);
    return look.state;
  },

  // ---- open / close ---------------------------------------------------------
  toggle(opts) { if (this._el) this.close(); else this.open(opts); },

  open(opts = {}) {
    if (!this._onKey) this._bind();
    this.close({ keepFocus: true });
    const c = this.context();
    this._ctx = c;
    this._after = null;
    this._certOpen = false;
    this._proxyOpen = false;
    this._showAllPerms = false;
    const btn = document.getElementById('url-site-btn');
    this._returnFocus = btn || document.activeElement;
    const el = document.createElement('div');
    el.id = 'vex-site-panel';
    el.className = 'sp-panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'sp-title');
    el.setAttribute('aria-describedby', 'sp-sub');
    el.tabIndex = -1;
    this._el = el;
    this._paint();
    document.body.appendChild(el);
    this._place();
    if (btn) btn.setAttribute('aria-expanded', 'true');
    el.addEventListener('click', this._onClick);
    el.addEventListener('change', this._onChange);
    document.addEventListener('keydown', this._onKey, true);
    document.addEventListener('mousedown', this._onDocDown, true);
    document.addEventListener('focusin', this._onFocusIn, true);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('vex-tabs-changed', this._onTabs);
    this._load();
    const target = opts.section ? el.querySelector(`[data-sec="${opts.section}"]`) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    // Opened with the keyboard: focus on the first control (the close button,
    // or the section asked for). Opened with the mouse: on the panel itself,
    // so no focus ring is drawn — Tab still goes straight to its first control.
    const first = opts.pointer ? null : ((target && target.querySelector('input, select, button')) || el.querySelector('.sp-x'));
    if (first) first.focus({ preventScroll: !!target });
    else el.focus({ preventScroll: true });
    return el;
  },

  close({ keepFocus = false } = {}) {
    const el = this._el;
    if (!el) return;
    this._el = null;
    el.remove();
    document.removeEventListener('keydown', this._onKey, true);
    document.removeEventListener('mousedown', this._onDocDown, true);
    document.removeEventListener('focusin', this._onFocusIn, true);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('vex-tabs-changed', this._onTabs);
    const btn = document.getElementById('url-site-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    // JavaScript is decided when the tab is built, so the tab is built again;
    // the other switches take effect on the next request, so a reload.
    const c = this._ctx;
    if (this._after && c && c.tab) {
      try {
        if (this._after === 'rebuild') TabManager.rebuildTab(c.tab.id);
        else if (c.wv) c.wv.reload();
      } catch (err) { window.showToast?.('Reload the page to see the change: ' + err.message, 'error'); }
    }
    this._after = null;
    if (!keepFocus && this._returnFocus && this._returnFocus.isConnected) this._returnFocus.focus();
    this._returnFocus = null;
  },

  // Under the icon, inside the window: 8px from each edge, as tall as fits.
  _place() {
    const el = this._el;
    if (!el) return;
    const btn = document.getElementById('url-site-btn');
    const bar = document.getElementById('url-bar');
    const anchor = (btn && btn.getClientRects().length) ? btn.getBoundingClientRect() : { left: 8, bottom: 48 };
    const under = (bar && bar.getClientRects().length) ? bar.getBoundingClientRect().bottom : anchor.bottom;
    const width = Math.min(392, window.innerWidth - 16);
    el.style.width = width + 'px';
    el.style.left = Math.max(8, Math.min(anchor.left - 10, window.innerWidth - width - 8)) + 'px';
    el.style.top = (under + 6) + 'px';
    el.style.maxHeight = Math.max(200, window.innerHeight - under - 18) + 'px';
  },

  // ---- events (bound once, so they can be removed) --------------------------
  _onKey: null, _onDocDown: null, _onFocusIn: null, _onResize: null, _onBlur: null, _onTabs: null, _onClick: null, _onChange: null,

  _bind() {
    this._onKey = (e) => {
      if (!this._el) return;
      // A confirmation on top of the panel has the keys.
      if (document.querySelector('.vex-dialog-overlay')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
      if (e.key === 'Tab') {
        const items = this._focusables();
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === items.length - 1)) { e.preventDefault(); items[0].focus(); }
      }
    };
    this._onDocDown = (e) => {
      if (!this._el || this._el.contains(e.target)) return;
      if (e.target.closest && (e.target.closest('#url-site-btn') || e.target.closest('.vex-dialog-overlay'))) return;
      this.close({ keepFocus: true });
    };
    // A click in the page never reaches this document — the page's webview
    // taking focus is how it shows. Other focus moves (Vex putting the caret
    // in the address field as a window opens) leave the panel be; a click
    // anywhere else in Vex is the mousedown above.
    this._onFocusIn = (e) => {
      if (!this._el || !e.target || e.target.tagName !== 'WEBVIEW') return;
      this.close({ keepFocus: true });
    };
    this._onResize = () => this._place();
    // A click in the page takes focus out of Vex's own document (as with the
    // toolbar's More menu); so does switching to another program.
    this._onBlur = () => { if (this._el && !document.querySelector('.vex-dialog-overlay')) this.close({ keepFocus: true }); };
    this._onTabs = () => {
      if (!this._el || !this._ctx) return;
      const tab = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
      if (!tab || tab.id !== this._ctx.tab.id) this.close({ keepFocus: true });
    };
    this._onClick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type === 'checkbox')) return;
      this._act(b.dataset.act, b).catch(err => this._fail(err));
    };
    this._onChange = (e) => {
      const t = e.target;
      if (t.dataset.perm) { this._setPerm(t.dataset.perm, t.value).catch(err => this._fail(err)); return; }
      if (t.dataset.act) this._act(t.dataset.act, t).catch(err => this._fail(err));
    };
  },

  _focusables() {
    if (!this._el) return [];
    return [...this._el.querySelectorAll('button, select, input, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(x => !x.disabled && x.getClientRects().length);
  },

  // An error from main arrives as "Error invoking remote method 'x': Error: …": only the words.
  _said(err) { return String((err && err.message) || '').replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ''); },

  _fail(err) {
    console.error('[SitePanel]', err);
    window.showToast?.(this._said(err) || 'That did not work', 'error');
    if (this._el) this._paint();
  },

  // ---- drawing ---------------------------------------------------------------
  _esc(s) { return window.escapeHtml(String(s == null ? '' : s)); },
  _ico(name, size = 14) { return VexIcons.svg(name, { size }); },

  _switch(act, label, { checked = false, disabled = false, note = '' } = {}) {
    const id = 'sp-' + act;
    return `<div class="sp-row">
      <label class="sp-row-text" for="${id}"><span class="sp-row-label">${this._esc(label)}</span>${note ? `<span class="sp-row-note">${this._esc(note)}</span>` : ''}</label>
      <input type="checkbox" role="switch" class="sp-switch" id="${id}" data-act="${act}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
    </div>`;
  },

  _section(sec, title, inner) {
    return `<section class="sp-sec" data-sec="${sec}" aria-labelledby="sp-h-${sec}"><h3 class="sp-h" id="sp-h-${sec}">${this._esc(title)}</h3>${inner}</section>`;
  },

  // Everything is drawn from the stores each time, so a change shows what
  // was actually kept — not what the click hoped for.
  _paint() {
    const el = this._el, c = this._ctx;
    if (!el || !c) return;
    const scroll = el.querySelector('.sp-body')?.scrollTop || 0;
    // Focus stays on the same control through a redraw.
    const a = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
    const focusSel = !a ? '' : a.id ? '#' + CSS.escape(a.id) : a.dataset.act ? `[data-act="${CSS.escape(a.dataset.act)}"]` : '';
    const look = this._iconFor(c);
    const title = c.web ? c.host : c.kind === 'start' ? 'New Tab' : c.kind === 'file' ? 'Local file' : 'Vex page';
    const sub = c.kind === 'start' || c.kind === 'internal' ? 'Vex’s own page'
      : c.kind === 'file' ? 'A file on this computer'
      : c.secure ? 'Connection is secure' : 'Connection is not secure';
    let body = '';
    if (!c.web) {
      body = `<p class="sp-empty">${c.kind === 'file'
        ? 'This page is a file on your computer. Nothing on it comes from a website, so there are no site permissions, cookies or site settings for it.'
        : 'Nothing on this page comes from a website, so there are no site permissions, cookies or site settings for it. Open a website and click this icon again.'}</p>`;
    } else {
      const notKept = this._notKept(c);
      if (notKept) body += `<div class="sp-notice" role="note">${this._ico('incognito', 14)}<span>${this._esc(notKept)}</span></div>`;
      body += this._connectionHtml(c);
      body += this._permissionsHtml(c);
      body += this._zoomHtml(c);
      body += this._behaviourHtml(c);
      body += this._blockingHtml(c);
      body += this._switchesHtml(c);
      body += this._opensHtml(c);
      body += this._dataHtml(c);
    }
    el.innerHTML = `
      <div class="sp-head">
        <span class="sp-head-ico" data-state="${look.state}" aria-hidden="true">${this._ico(look.icon, 16)}</span>
        <div class="sp-head-text">
          <div class="sp-title" id="sp-title">${this._esc(title)}</div>
          <div class="sp-sub" id="sp-sub">${this._esc(sub)}</div>
        </div>
        <button type="button" class="sp-x" data-act="close" aria-label="Close site panel" title="Close (Esc)">${this._ico('x', 13)}</button>
      </div>
      <div class="sp-body">${body}</div>
      <div class="sp-foot">
        ${c.web ? `<button type="button" class="sp-link sp-danger" data-act="reset-site">${this._ico('trash', 13)}<span>Reset this site</span></button>` : '<span></span>'}
        <button type="button" class="sp-link" data-act="settings">${this._ico('settings', 13)}<span>Site settings</span></button>
      </div>`;
    const b = el.querySelector('.sp-body');
    if (b) b.scrollTop = scroll;
    if (focusSel) { const f = el.querySelector(focusSel); if (f) f.focus({ preventScroll: true }); }
  },

  _connectionHtml(c) {
    const cert = this._cert;
    let details = '';
    if (this._certOpen) {
      if (!c.secure) details = '<p class="sp-note">This page came over plain HTTP: anyone on the network can read and change it. Don’t type a password here.</p>';
      else if (!cert) details = '<p class="sp-note">Reading the certificate…</p>';
      else if (cert.error) details = `<p class="sp-note">${this._esc(cert.error)}</p>`;
      else {
        const day = (ms) => Number.isFinite(ms) ? new Date(ms).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '?';
        details = `<dl class="sp-cert">
          <dt>Issued to</dt><dd>${this._esc(cert.subject)}${cert.organization ? ' · ' + this._esc(cert.organization) : ''}</dd>
          <dt>Issued by</dt><dd>${this._esc(cert.issuer)}${cert.selfSigned ? ' <b>(self-signed)</b>' : ''}</dd>
          <dt>Valid</dt><dd>${this._esc(day(cert.validFrom))} to ${this._esc(day(cert.validTo))}</dd>
          ${cert.protocol ? `<dt>Connection</dt><dd>${this._esc(cert.protocol + (cert.cipher ? ', ' + cert.cipher : ''))}</dd>` : ''}
          ${cert.networkError ? `<dt>Problem</dt><dd class="sp-danger">${this._esc(cert.networkError)}</dd>` : ''}
          ${cert.fingerprint256 ? `<dt>SHA-256</dt><dd class="sp-mono">${this._esc(cert.fingerprint256)}</dd>` : ''}
        </dl>`;
      }
    }
    const words = c.secure
      ? 'Vex checked this site’s certificate; what you send and see is encrypted on the way.'
      : 'This page is not encrypted. Anyone on the network can see and change what you send and receive.';
    const where = c.tor || c.torRoute ? ' It is going through Tor.' : c.proxyRoute ? ' It is going through your proxy.' : c.container ? ` It is in the “${c.container}” container.` : '';
    return this._section('connection', 'Connection', `
      <p class="sp-note">${this._esc(words + where)}</p>
      <button type="button" class="sp-link" data-act="cert" aria-expanded="${this._certOpen}" aria-controls="sp-cert-box">${this._ico(this._certOpen ? 'chevron-up' : 'chevron-down', 12)}<span>${c.secure ? 'Certificate' : 'Why this matters'}</span></button>
      <div id="sp-cert-box">${details}</div>`);
  },

  _permValue(decisions, origin, p) {
    const v = decisions[origin + '::' + p] || ((p === 'camera' || p === 'microphone') ? decisions[origin + '::media'] : undefined);
    if (p === 'popups') return v === 'deny' ? 'deny' : 'allow';
    return v === 'allow' || v === 'deny' ? v : 'ask';
  },

  _permissionsHtml(c) {
    if (c.tor || c.torRoute) {
      return this._section('permissions', 'Permissions', '<p class="sp-note">A Tor tab gives sites no permissions: the camera, microphone, location, notifications and the rest are always refused.</p>');
    }
    const decisions = this._decisions;
    if (!decisions) return this._section('permissions', 'Permissions', '<p class="sp-note">Reading this site’s permissions…</p>');
    if (decisions.error) return this._section('permissions', 'Permissions', `<p class="sp-note">${this._esc(decisions.error)}</p>`);
    const o = c.origin;
    const has = (p) => Object.hasOwn(decisions, o + '::' + p) || ((p === 'camera' || p === 'microphone') && Object.hasOwn(decisions, o + '::media'));
    const shown = this.PERMS.filter(p => p.common || has(p.id) || this._showAllPerms);
    const external = Object.keys(decisions).filter(k => k.startsWith(o + '::external:')).map(k => k.slice(o.length + 2));
    const row = (id, name, icon, value, noAsk, note) => {
      const sel = 'sp-perm-' + id.replace(/[^a-z0-9-]/gi, '-');
      return `<div class="sp-row">
        <label class="sp-row-text" for="${sel}"><span class="sp-row-label">${this._ico(icon, 13)}${this._esc(name)}</span>${note ? `<span class="sp-row-note">${this._esc(note)}</span>` : ''}</label>
        <select class="sp-select" id="${sel}" data-perm="${this._esc(id)}">
          <option value="allow" ${value === 'allow' ? 'selected' : ''}>Allow</option>
          ${noAsk ? '' : `<option value="ask" ${value === 'ask' ? 'selected' : ''}>Ask</option>`}
          <option value="deny" ${value === 'deny' ? 'selected' : ''}>Block</option>
        </select>
      </div>`;
    };
    let html = shown.map(p => row(p.id, p.name, p.icon, this._permValue(decisions, o, p.id), p.noAsk, p.note)).join('');
    html += external.map(p => row(p, 'Open ' + p.slice('external:'.length) + ': links in another program', 'link', this._permValue(decisions, o, p), false, '')).join('');
    const store = c.privateWindow ? 'Answers here last until this private window closes.'
      : c.ephemeral ? 'Answers here last until this tab closes.'
      : c.container ? `In the “${c.container}” container — its permissions are its own.`
      : c.proxyRoute ? 'Through your proxy — this site’s permissions there are its own.' : '';
    if (store) html += `<p class="sp-note">${this._esc(store)}</p>`;
    html += `<div class="sp-actions">
      ${this._showAllPerms ? '' : '<button type="button" class="sp-link" data-act="perms-all">Show all permissions</button>'}
      <button type="button" class="sp-link" data-act="perms-reset">Reset permissions</button>
    </div>`;
    return this._section('permissions', 'Permissions', html);
  },

  _zoomHtml(c) {
    let z = 1;
    try { z = c.wv && c.wv.getZoomFactor ? c.wv.getZoomFactor() : 1; } catch { z = 1; }
    const pct = Math.round(z * 100);
    const note = c.canSave ? 'Kept for every page of this site.' : 'For this tab only — not kept.';
    return this._section('zoom', 'Zoom', `
      <div class="sp-row">
        <span class="sp-row-text"><span class="sp-row-label" id="sp-zoom-label">Page zoom</span><span class="sp-row-note">${this._esc(note)}</span></span>
        <div class="sp-zoom" role="group" aria-labelledby="sp-zoom-label">
          <button type="button" class="sp-btn" id="sp-zoom-out" data-act="zoom-out" aria-label="Zoom out">${this._ico('minus', 13)}</button>
          <output class="sp-zoom-val" id="sp-zoom-val" aria-live="polite">${pct}%</output>
          <button type="button" class="sp-btn" id="sp-zoom-in" data-act="zoom-in" aria-label="Zoom in">${this._ico('plus', 13)}</button>
          <button type="button" class="sp-btn sp-btn-text" id="sp-zoom-reset" data-act="zoom-reset" ${pct === 100 ? 'disabled' : ''}>Reset</button>
        </div>
      </div>`);
  },

  _behaviourHtml(c) {
    const off = !c.canSave;
    const never = typeof SiteProfiles !== 'undefined' && SiteProfiles._neverSleepHosts().has(c.host);
    const route = typeof SiteRoutes !== 'undefined' ? SiteRoutes.match(c.url) : null;
    const translate = typeof TranslateSide !== 'undefined' && TranslateSide.isAlways(c.url);
    const lang = typeof TranslateSide !== 'undefined' ? TranslateSide.lang() : 'en';
    const langName = (typeof Translator !== 'undefined' && (Translator.languages.find(l => l.code === lang) || {}).name) || lang;
    const darkGlobal = (() => { try { return localStorage.getItem('vex.forceDarkSites') === 'true'; } catch { return false; } })();
    const dark = typeof WebviewManager !== 'undefined' && WebviewManager._shouldForceDark && WebviewManager._shouldForceDark(c.url);
    const boost = typeof VexBoosts !== 'undefined' && VexBoosts.boosts && Object.hasOwn(VexBoosts.boosts, c.host);
    return this._section('behaviour', 'This site', `
      ${this._switch('never-sleep', 'Never let this site sleep', {
        checked: never || !!(route && route.awake), disabled: off || !!(route && route.awake),
        note: route && route.awake ? 'Its site rule keeps it awake (Private routing › Site rules).' : 'Its tabs stay loaded in the background — no memory saver, no auto-sleep.' })}
      ${this._switch('translate', 'Always translate this site', {
        checked: translate, disabled: off,
        note: 'Into ' + langName + ', side by side with the original, every time a page of it loads.' + (c.proxyRoute || c.torRoute ? ' Not on its own while it goes through a route.' : '') })}
      ${this._switch('dark', 'Force dark mode', { checked: !!dark, disabled: off || darkGlobal, note: darkGlobal ? 'On for every site (older setting).' : '' })}
      <div class="sp-row">
        <span class="sp-row-text"><span class="sp-row-label">Custom CSS and JavaScript</span><span class="sp-row-note">${boost ? 'Active on this site.' : 'None yet.'}</span></span>
        <button type="button" class="sp-btn sp-btn-text" data-act="boost" ${off ? 'disabled' : ''}>Edit…</button>
      </div>`);
  },

  _blockedHere(c) {
    const stats = this._stats;
    if (!stats || !stats.bySite) return null;
    let n = 0;
    for (const [site, count] of Object.entries(stats.bySite)) if (site === c.host || site.endsWith('.' + c.host)) n += count;
    return n;
  },

  _blockingHtml(c) {
    const globalOn = this._blocking !== false;
    const allowed = typeof SiteRulesUI !== 'undefined' && SiteRulesUI.adsAllowed(c.url);
    const n = this._blockedHere(c);
    let note;
    if (c.tor || c.torRoute) note = 'A Tor tab always blocks them.';
    else if (!globalOn) note = 'Blocking is off for every site.';
    else if (allowed) note = 'Off here — this site’s ads and trackers load.';
    else note = n == null ? 'Counting…' : (c.ephemeral || c.privateWindow) ? 'Not counted in a tab that keeps nothing.' : `${n.toLocaleString()} blocked on this site since Vex started.`;
    let html = this._switch('ads', 'Block ads and trackers here', {
      checked: (c.tor || c.torRoute) ? true : (globalOn && !allowed), disabled: !c.canSave || c.tor || c.torRoute || !globalOn, note });
    if (!globalOn) html += '<div class="sp-actions"><button type="button" class="sp-link" data-act="adblock-settings">Turn blocking on in Settings</button></div>';
    return this._section('blocking', 'Ads and trackers', html);
  },

  _switchesHtml(c) {
    if (typeof SiteRulesUI === 'undefined') return '';
    const off = !c.canSave;
    const rows = SiteRulesUI.WHAT.map(w => this._switch('rule-' + w.id, w.name, { checked: !SiteRulesUI.isOff(c.url, w.id), disabled: off, note: w.note })).join('');
    return this._section('switches', 'What this site is allowed', rows
      + `<p class="sp-note">${this._after ? 'The page reloads when you close this panel.' : 'Every page of this site, in every window.'}</p>`);
  },

  _containerNames() {
    const names = new Set(this.CONTAINERS);
    if (typeof SiteRoutes !== 'undefined') for (const r of SiteRoutes.rules()) if (r.mode === 'container' && r.container) names.add(r.container);
    if (this._ctx && this._ctx.container) names.add(this._ctx.container);
    return [...names];
  },

  _cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); },

  _opensHtml(c) {
    if (typeof SiteRoutes === 'undefined') return '';
    // A rule names a web address (example.com): not localhost or an IP.
    const named = !!SiteRoutes.normalizeHost(c.host);
    const off = !c.canSave || !named;
    const rule = SiteRoutes.match(c.url);
    const value = !rule ? '' : rule.mode === 'container' ? 'container:' + rule.container : rule.mode;
    const names = this._containerNames();
    const opt = (v, label) => `<option value="${this._esc(v)}" ${value === v ? 'selected' : ''}>${this._esc(label)}</option>`;
    let html = `<div class="sp-row">
      <label class="sp-row-text" for="sp-route"><span class="sp-row-label">Always open this site</span><span class="sp-row-note">${!named ? 'A rule needs a web address such as example.com.' : rule && rule.host !== c.host ? 'Set for ' + this._esc(rule.host) + ' and its subdomains.' : 'Every time, in its own session.'}</span></label>
      <select class="sp-select" id="sp-route" data-act="route" ${off ? 'disabled' : ''}>
        ${opt('', 'The ordinary way')}
        ${names.map(n => opt('container:' + n, 'In the “' + this._cap(n) + '” container')).join('')}
        ${opt('tor', 'Through Tor')}
        ${opt('proxy', rule && rule.mode === 'proxy' ? 'Through ' + rule.custom : 'Through a proxy…')}
      </select>
    </div>`;
    if (this._proxyOpen) {
      html += `<div class="sp-row sp-proxy">
        <input class="sp-input" id="sp-proxy-addr" placeholder="socks5://127.0.0.1:1080" aria-label="Proxy address" value="${this._esc(rule && rule.mode === 'proxy' ? rule.custom : '')}">
        <button type="button" class="sp-btn sp-btn-text" data-act="proxy-save">Save</button>
      </div>`;
    }
    const here = c.container ? `In the “${this._cap(c.container)}” container` : c.torRoute || c.tor ? 'Through Tor' : c.proxyRoute ? 'Through your proxy' : c.privateWindow ? 'In this private window' : c.ephemeral ? 'In a tab that keeps nothing' : 'In the ordinary session';
    const reopenOff = c.privateWindow || c.ephemeral;
    html += `<div class="sp-row">
      <label class="sp-row-text" for="sp-reopen"><span class="sp-row-label">This tab</span><span class="sp-row-note">${this._esc(here)}.</span></label>
      <div class="sp-inline">
        <select class="sp-select" id="sp-reopen" aria-label="Reopen this page in" ${reopenOff ? 'disabled' : ''}>
          <option value="persist:main">Ordinary session</option>
          ${names.map(n => `<option value="persist:container-${this._esc(n)}" ${c.container === n ? 'selected' : ''}>${this._esc(this._cap(n))} container</option>`).join('')}
        </select>
        <button type="button" class="sp-btn sp-btn-text" data-act="reopen" ${reopenOff ? 'disabled' : ''}>Reopen</button>
      </div>
    </div>
    <p class="sp-note">Each container and route is a separate cookie jar: a site opened there is signed out of.</p>`;
    return this._section('opens', 'Where it opens', html);
  },

  _dataHtml(c) {
    const n = this._cookies;
    const words = n == null ? 'Counting…' : n.error ? n.error : `${n.count} cookie${n.count === 1 ? '' : 's'} in this tab’s session`;
    return this._section('data', 'Cookies and site data', `
      <div class="sp-row">
        <span class="sp-row-text"><span class="sp-row-label">${this._esc(words)}</span><span class="sp-row-note">Plus what the site keeps in its own storage.</span></span>
        <div class="sp-inline">
          <button type="button" class="sp-btn sp-btn-text" data-act="data-manage">Manage…</button>
          <button type="button" class="sp-btn sp-btn-text sp-danger" data-act="data-clear">Clear…</button>
        </div>
      </div>`);
  },

  // ---- what the panel reads from main ---------------------------------------
  _cert: null, _decisions: null, _stats: null, _blocking: true, _cookies: null,

  async _load() {
    const c = this._ctx;
    this._cert = null; this._decisions = null; this._stats = null; this._blocking = true; this._cookies = null;
    if (!c || !c.web) return;
    const jobs = [];
    if (!c.tor && !c.torRoute) {
      jobs.push((async () => {
        if (c.pageId == null) throw new Error('This page is not loaded yet');
        this._decisions = (await window.vex.permissionsListForPage(c.pageId)) || {};
      })().catch(err => { this._decisions = { error: 'Could not read this site’s permissions: ' + this._said(err) }; }));
    }
    jobs.push((async () => {
      const [stats, on] = await Promise.all([window.vex.privacyTrackerStats(), window.vex.getAdBlockerState()]);
      this._stats = stats || {};
      this._blocking = on !== false;
    })().catch(err => { console.error('[SitePanel] blocking stats:', err); this._stats = {}; }));
    jobs.push((async () => {
      const res = await window.vex.cookiesList({ url: c.url, partition: c.partition });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Could not count the cookies');
      this._cookies = { count: res.cookies.length };
    })().catch(err => { this._cookies = { error: this._said(err) }; }));
    await Promise.all(jobs);
    if (this._el && this._ctx === c) this._paint();
  },

  async _loadCert() {
    const c = this._ctx;
    if (!c || !c.secure) return;
    try {
      if (c.pageId == null) throw new Error('This page is not loaded yet');
      const cert = await window.vex.siteCertificate(c.pageId);
      this._cert = cert && cert.ok ? cert : { error: (cert && cert.error) || 'The certificate could not be read' };
    } catch (err) { this._cert = { error: this._said(err) }; }
    if (this._el && this._ctx === c) this._paint();
  },

  // ---- changes ---------------------------------------------------------------
  async _setPerm(permission, value) {
    const c = this._ctx;
    const def = this.PERMS.find(p => p.id === permission);
    // Pop-ups are allowed unless blocked: "Allow" forgets the answer.
    const decision = def && def.noAsk && value === 'allow' ? 'ask' : value;
    this._decisions = (await window.vex.permissionsSetForPage(c.pageId, permission, decision)) || {};
    this._paint();
  },

  _mustSave(c) {
    if (!c.canSave) throw new Error(this._notKept(c) || 'Not on this page');
  },

  async _act(act, el) {
    const c = this._ctx;
    switch (act) {
      case 'close': this.close(); return;
      case 'settings':
        this.close({ keepFocus: true });
        if (typeof SettingsUI === 'undefined') throw new Error('Settings are not loaded');
        SettingsUI.openSection('setting-site-settings');
        return;
      case 'cert':
        this._certOpen = !this._certOpen;
        this._paint();
        if (this._certOpen && !this._cert) await this._loadCert();
        return;
      case 'perms-all': this._showAllPerms = true; this._paint(); return;
      case 'perms-reset': {
        const token = await this._resetPerms(c);
        this._paint();
        window.VexUndo.offer({
          message: 'Permissions reset for ' + c.host + (c.container ? ' in the ' + c.container + ' container' : ''),
          undo: async () => { await this._putPermsBack(token); this._refreshIfOn(c); },
        });
        return;
      }
      case 'zoom-in': WebviewManager.zoomIn(); this._paint(); return;
      case 'zoom-out': WebviewManager.zoomOut(); this._paint(); return;
      case 'zoom-reset': WebviewManager.zoomReset(); this._paint(); return;
      case 'never-sleep':
        this._mustSave(c);
        SiteProfiles.setNeverSleep(c.host, el.checked);
        window.showToast?.(el.checked ? c.host + ' will stay awake' : c.host + ' can sleep again');
        this._paint();
        return;
      case 'translate': {
        this._mustSave(c);
        TranslateSide.setAlways(c.url, el.checked);
        this._paint();
        if (el.checked) {
          if (!TranslateSide.mayTranslateOnItsOwn(c.partition)) return;
          if (await window.vexGuestEval(c.wv, '!!document.querySelector("[data-vex-tr-out]")', false, 6000)) return;
          await TranslateSide.runOn(c.wv, TranslateSide.lang());
        } else {
          await window.vexGuestEval(c.wv, TranslateSide.clearScript(), false, 6000);
        }
        return;
      }
      case 'dark':
        this._mustSave(c);
        WebviewManager.toggleForceDarkForSite(c.wv);
        this._paint();
        return;
      case 'boost': this._mustSave(c); this.close({ keepFocus: true }); VexBoosts.openEditor(); return;
      case 'ads':
        this._mustSave(c);
        await SiteRulesUI.set(c.url, 'ads', !el.checked);
        this._after = this._after || 'reload';
        window.showToast?.(el.checked ? 'Blocking ads and trackers on ' + c.host + ' again' : 'Ads and trackers are no longer blocked on ' + c.host);
        this._paint();
        return;
      case 'route': return this._setRoute(el.value);
      case 'proxy-save': {
        const addr = this._el.querySelector('#sp-proxy-addr').value;
        const prev = SiteRoutes.match(c.url);
        this._mustSave(c);
        SiteRoutes.add(prev ? prev.host : c.host, 'proxy', addr, { muted: !!(prev && prev.muted), awake: !!(prev && prev.awake) });
        this._proxyOpen = false;
        this._routeChanged();
        return;
      }
      case 'reopen': {
        const partition = this._el.querySelector('#sp-reopen').value;
        this._reopenIn(partition);
        return;
      }
      case 'data-manage': this.close({ keepFocus: true }); await SiteData.open(); return;
      case 'data-clear': {
        if (!await window.vexConfirm({ title: 'Clear site data', message: `Remove the cookies and stored data ${c.host} keeps${c.container ? ' in the ' + c.container + ' container' : ''}, and reload it? You will probably be signed out of it.`, okLabel: 'Clear and reload', danger: true })) return;
        const res = await window.vex.clearSiteData({ partition: c.partition, url: c.url });
        if (!res || !res.ok) throw new Error((res && res.error) || 'The site data could not be cleared');
        try { if (typeof c.wv.reloadIgnoringCache === 'function') c.wv.reloadIgnoringCache(); else c.wv.reload(); }
        catch (err) { throw new Error('Cleared, but the page could not reload: ' + err.message); }
        window.showToast?.('Cleared ' + c.host + ' — reloading', 'success');
        this._cookies = null;
        this._paint();
        setTimeout(() => { if (this._el && this._ctx === c) this._load(); }, 1500);
        return;
      }
      case 'adblock-settings':
        this.close({ keepFocus: true });
        SettingsUI.openSection('setting-adblocker');
        return;
      case 'reset-site': return this._resetSite(c);
      default:
        if (act.startsWith('rule-')) {
          this._mustSave(c);
          const what = act.slice(5);
          await SiteRulesUI.set(c.url, what, !el.checked);
          this._after = what === 'js' ? 'rebuild' : (this._after || 'reload');
          this._paint();
          return;
        }
        throw new Error('Unknown action: ' + act);
    }
  },

  _setRoute(value) {
    const c = this._ctx;
    this._mustSave(c);
    const prev = SiteRoutes.match(c.url);
    const opts = { muted: !!(prev && prev.muted), awake: !!(prev && prev.awake) };
    // A rule set for a parent domain is that rule: it is the one changed.
    const host = prev ? prev.host : c.host;
    if (value === 'proxy') { this._proxyOpen = true; this._paint(); this._el.querySelector('#sp-proxy-addr')?.focus(); return; }
    this._proxyOpen = false;
    if (!value) { if (prev) SiteRoutes.remove(prev.host); }
    else if (value === 'tor') SiteRoutes.add(host, 'tor', null, opts);
    else if (value.startsWith('container:')) SiteRoutes.add(host, 'container', value.slice('container:'.length), opts);
    else throw new Error('Unknown place: ' + value);
    this._routeChanged();
  },

  // A rule decides where a NEW tab of the site goes; the tab in front stays
  // where it is until it is opened again.
  _routeChanged() {
    const c = this._ctx;
    const rule = SiteRoutes.match(c.url);
    window.showToast?.(rule ? c.host + ' will open ' + SiteRoutes.whereOf(rule) + ' — Reopen this tab to move it now' : c.host + ' opens the ordinary way again');
    this._paint();
  },

  // The page again, in another session; the tab it was in goes. A rule for
  // the site still applies to an ordinary tab (SiteRoutes.reroute).
  _reopenIn(partition) {
    const c = this._ctx;
    if (c.privateWindow || c.ephemeral) throw new Error('A page in a tab that keeps nothing cannot be moved to another session');
    if (partition !== 'persist:main' && !/^persist:container-[a-z0-9-]+$/.test(partition)) throw new Error('Unknown session: ' + partition);
    const oldId = c.tab.id;
    this.close({ keepFocus: true });
    TabManager.createTab(c.url, true, null, { partition, allowDuplicate: true });
    TabManager.closeTab(oldId);
  },

  // Every permission answer of the page's site, in the store the page is held
  // to; -> the token that puts them back (main keeps what was taken).
  async _resetPerms(c) {
    const res = await window.vex.permissionsResetForPage(c.pageId);
    if (!res || !res.undo) throw new Error('The permissions could not be reset');
    if (this._ctx === c) this._decisions = res.decisions || {};
    return res.undo;
  },
  async _putPermsBack(token) {
    const res = await window.vex.permissionsResetForPageUndo(token);
    if (!res || !res.ok) throw new Error((res && res.error) || 'The permissions could not be put back');
  },
  // The panel, if it is still showing the same tab, read again from the stores.
  _refreshIfOn(c) {
    if (this._el && this._ctx && this._ctx.tab.id === c.tab.id) this._load();
  },

  // A page's context menu: Reset this site's settings, for that page's tab.
  resetSite(tab) {
    return this._resetSite(this.context(tab));
  },

  // Done at once, with Undo on the toast (js/vex-undo.js): its permissions,
  // the page's zoom, and where the site's settings may be kept, its saved
  // zoom, dark mode, sleep, translation, ad blocking, site switches and custom
  // CSS/JS. Where it opens and its cookies stay. Undo puts every one back.
  // A tab that keeps nothing has only its in-memory permissions and its zoom
  // to reset, and Undo writes nothing to disk for it either.
  async _resetSite(c) {
    if (!c || !c.web) throw new Error('Only a website has settings to reset');
    const perms = !c.tor && !c.torRoute ? await this._resetPerms(c) : null;
    let zoomWas = null;
    try { zoomWas = c.wv.getZoomFactor(); c.wv.setZoomFactor(1); }
    catch (err) { console.warn('[SitePanel] zoom of the page could not be reset:', err.message); }
    let site = null, hadRules = false;
    if (c.canSave) {
      hadRules = !!SiteRulesUI.forUrl(c.url);
      site = await SiteProfiles.forgetSite(c.host);
      if (hadRules) {
        if (this._el && this._ctx === c) this._after = 'rebuild';
        else TabManager.rebuildTab(c.tab.id);
      }
    }
    this._paint();
    window.VexUndo.offer({
      message: site ? SiteProfiles._resetWords(c.host, site.failed) : 'Reset ' + c.host + ' for this tab',
      undo: async () => {
        if (perms) await this._putPermsBack(perms);
        if (site) await SiteProfiles.restoreSite(site.snapshot);
        // Last: the site's snapshot was taken after this page's zoom went to 100%.
        const open = (TabManager.tabs || []).some(t => t.id === c.tab.id);
        if (open && zoomWas != null && c.wv.isConnected !== false) c.wv.setZoomFactor(zoomWas);
        // The site switches are back: the tab built without them is built again.
        if (open && hadRules) {
          if (this._el && this._ctx && this._ctx.tab.id === c.tab.id) this._after = 'rebuild';
          else TabManager.rebuildTab(c.tab.id);
        }
        this._refreshIfOn(c);
      },
    });
  },

  // ---- start ------------------------------------------------------------------
  init() {
    this._bind();
    const btn = document.getElementById('url-site-btn');
    if (!btn) throw new Error('[SitePanel] #url-site-btn missing');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      // detail is 0 for a click made with Enter or Space.
      try { this.toggle({ pointer: e.detail > 0 }); } catch (err) { this._fail(err); }
    });
    // The icon follows the tab in front, whichever way you got there.
    const follow = () => this.refreshIcon();
    document.addEventListener('vex:tab-navigated', follow);
    window.addEventListener('vex-tabs-changed', follow);
    window.addEventListener('vex:tab-url-changed', follow);
    // A navigation that announces nothing (a redirect, a tab put to sleep).
    if (typeof VexJobs !== 'undefined') VexJobs.every('Site icon', 1500, follow);
    follow();
    // Always-translated sites, as each of their pages finishes loading.
    document.addEventListener('vex:tab-navigated', (e) => {
      const { tabId, url } = e.detail || {};
      if (typeof TranslateSide === 'undefined' || !url) return;
      TranslateSide.autoTranslate(tabId, url)
        .catch(err => console.warn('[SitePanel] could not translate ' + url + ' on its own:', err.message));
    });
    // Settings › Site settings, drawn each time Settings opens.
    document.addEventListener('vex:panel-changed', (e) => {
      if (!e.detail || e.detail.panel !== 'settings' || typeof SiteProfiles === 'undefined') return;
      SiteProfiles.renderSettings(document.getElementById('site-settings-panel-content'));
    });
    return this;
  },
};

if (typeof window !== 'undefined') window.SitePanel = SitePanel;
if (typeof module !== 'undefined' && module.exports) module.exports = { SitePanel };
if (typeof document !== 'undefined' && typeof VexIcons !== 'undefined') {
  const start = () => { if (document.getElementById('url-site-btn')) SitePanel.init(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
