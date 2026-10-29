// === Page chrome: the link bar, the load bar and slim scrollbars on websites ====
//
// Three small pieces of the frame around a page that Vex used to leave to Chromium (which draws none of
// them inside a <webview>) or did crudely. A late module (js/lazy-boot.js): nothing reads it while the
// window comes up, and every caller guards with `typeof … !== 'undefined'`.
//
//   VexLinkBar         the address a link goes to, in a slim bar at the bottom-left of the page area, while the
//                      pointer is over the link (the webview's `update-target-url` event, js/webview.js). The
//                      registrable domain is bold and the rest muted, a link to another site is marked, and a
//                      look-alike address (js/idn.js, VexIdn.suspicious) or one that hides its host behind a
//                      login name (https://bank.com@evil.test) is drawn as a warning. A long address is cut in
//                      the middle, never in the domain. The bar steps to the right side when the pointer enters
//                      it, so it does not sit on the page's own bottom-left controls.
//   VexLoadBar         a slim bar along the top of the page area while the tab in front is loading: it fills to
//                      about 70% at once, creeps on towards 95%, reaches the end and fades when `tab.loading`
//                      becomes false (tabs.js updateTab). It keeps one state per tab, so switching tabs shows
//                      that tab's own. It replaces the spinner in the middle of the page (css/page-chrome.css).
//   VexPageScrollbars  Settings > Appearance > "Slim scrollbars on websites" (off by default): a thin scrollbar
//                      in the theme's colours, inserted as `:where()` CSS (zero specificity, so a page that sets
//                      its own always wins) after a page loads; removed when switched off; not on Vex's own pages
//                      or on the sites in the off list.
//
// Keys: vex.pageScrollbars ('1' = on), vex.pageScrollbarsOff (JSON array of host names).

// ---- the shared pure helpers -----------------------------------------------------------------------
const VexPageChromeText = {
  // Second-level labels under a country code that belong to the registry, not to a site ("co.uk"). A small
  // list, not the Public Suffix List; the same one src/main/preconnect.js uses.
  REGISTRY_LABELS: new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gen', 'web', 'info', 'biz', 'k12', 'pvt', 'av', 'bel', 'tsk', 'kep', 'dr']),

  // "login.bank.co.uk" -> "bank.co.uk"; an address, a name with one label or a name with a colon is itself.
  registrable(host) {
    const h = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!h) return '';
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':') || !h.includes('.')) return h;
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    const tld = parts[parts.length - 1];
    const second = parts[parts.length - 2];
    if (tld.length === 2 && this.REGISTRY_LABELS.has(second)) return parts.slice(-3).join('.');
    return parts.slice(-2).join('.');
  },

  // `text` cut in the middle to at most `keep` characters (the ellipsis is one of them).
  middle(text, keep) {
    const s = String(text);
    if (keep >= s.length) return s;
    if (keep <= 1) return '…';
    const head = Math.ceil((keep - 1) * 0.6);
    const tail = keep - 1 - head;
    return s.slice(0, head) + '…' + (tail > 0 ? s.slice(s.length - tail) : '');
  },

  // What the link bar shows for `url`, seen from `pageUrl`:
  //   { web, scheme, auth, sub, domain, rest, host, otherSite, warn }
  // web: false for mailto:, javascript:, blob: ... (then `rest` is the whole text and the rest is empty).
  // warn: null, 'lookalike' or 'login-name'. otherSite: the link leaves the site of the page in front.
  parts(url, pageUrl, idn) {
    const text = String(url || '');
    let u;
    try { u = new URL(text); } catch { return { web: false, scheme: '', auth: '', sub: '', domain: '', rest: text, host: '', otherSite: false, warn: null }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { web: false, scheme: '', auth: '', sub: '', domain: '', rest: text, host: '', otherSite: false, warn: null };
    const host = u.hostname;
    const shown = idn ? idn.display(host) : host;
    const reg = this.registrable(shown);
    const sub = reg && shown.length > reg.length && shown.endsWith('.' + reg) ? shown.slice(0, shown.length - reg.length) : '';
    const domain = sub ? reg : shown;
    let warn = null;
    if (idn && idn.suspicious(host)) warn = 'lookalike';
    else if (u.username || u.password) warn = 'login-name';
    let otherSite = false;
    try {
      const page = new URL(String(pageUrl || ''));
      if (page.protocol === 'http:' || page.protocol === 'https:') otherSite = this.registrable(page.hostname) !== this.registrable(host);
    } catch { /* vex-allow-empty-catch: the page in front has no web address (a Vex page), so there is no site to compare with */ }
    const auth = u.username || u.password ? (u.username + (u.password ? ':' + u.password : '') + '@') : '';
    return { web: true, scheme: u.protocol + '//', auth, sub, domain, rest: (u.port ? ':' + u.port : '') + u.pathname + u.search + u.hash, host, otherSite, warn };
  },
};

// ---- the link bar -----------------------------------------------------------------------------------
const VexLinkBar = {
  // Off: the link's address is no longer shown at the bottom of the page (the person's switch, Settings > Feature switches).
  PREF: 'vex.linkBar.off',
  enabled() {
    try { return localStorage.getItem(this.PREF) !== '1'; }
    catch (err) { throw new Error('The link address bar setting could not be read: ' + err.message, { cause: err }); }
  },
  setEnabled(on) {
    try { if (on) localStorage.removeItem(this.PREF); else localStorage.setItem(this.PREF, '1'); }
    catch (err) { throw new Error('The link address bar setting could not be saved: ' + err.message, { cause: err }); }
    if (!on) this.hide();
    return !!on;
  },
  SHOW_MS: 90,    // a pointer sweeping over links does not flicker the bar
  HIDE_MS: 140,
  MIN_KEEP: 6,
  _el: null,
  _tabId: null,
  _shown: false,
  _showTimer: null,
  _hideTimer: null,
  _rest: '',
  _parts: null,

  place() {
    if (this._el) return true;
    const area = document.getElementById('content-area');
    if (!area) { console.warn('[link-bar] #content-area is missing, so the link bar cannot be placed'); return false; }
    const el = document.createElement('div');
    el.id = 'vex-linkbar';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'off');   // hovering is not an announcement
    el.innerHTML = '<span class="lb-mark"></span><span class="lb-url"><span class="lb-muted lb-scheme"></span><span class="lb-muted lb-auth"></span><span class="lb-muted lb-sub"></span><b class="lb-domain"></b><span class="lb-muted lb-rest"></span></span><span class="lb-tag"></span>';
    // The pointer came onto the bar: it goes to the other corner (and back if the pointer follows it there).
    el.addEventListener('pointerenter', () => { el.classList.toggle('end'); });
    area.appendChild(el);
    this._el = el;
    return true;
  },

  // The pointer is over `url` (empty: it left the link) in the page of tab `tabId`.
  update(url, tabId, pageUrl) {
    if (!this.enabled()) return;
    if (!url) { this._scheduleHide(); return; }
    if (!this.place()) return;
    this._tabId = tabId;
    clearTimeout(this._hideTimer); this._hideTimer = null;
    this._render(url, pageUrl);
    if (this._shown) return;
    if (this._showTimer) return;
    this._showTimer = setTimeout(() => {
      this._showTimer = null;
      this._shown = true;
      this._el.classList.add('show');
      this._fit();
    }, this.SHOW_MS);
  },

  _scheduleHide() {
    clearTimeout(this._showTimer); this._showTimer = null;
    if (!this._shown || this._hideTimer) return;
    this._hideTimer = setTimeout(() => this.hide(), this.HIDE_MS);
  },

  hide() {
    clearTimeout(this._showTimer); this._showTimer = null;
    clearTimeout(this._hideTimer); this._hideTimer = null;
    this._shown = false;
    if (!this._el) return;
    this._el.classList.remove('show', 'end');
  },

  // Another tab came to the front (tabs.js syncReloadButton): the bar belongs to the one it was drawn for.
  tabChanged(tabId) {
    if (this._tabId !== null && this._tabId !== tabId) this.hide();
  },

  _render(url, pageUrl) {
    const el = this._el;
    const p = VexPageChromeText.parts(url, pageUrl, window.VexIdn);
    this._parts = p;
    const set = (cls, text) => { el.querySelector(cls).textContent = text; };
    set('.lb-scheme', p.web ? p.scheme : '');
    set('.lb-auth', p.auth);
    set('.lb-sub', p.sub);
    set('.lb-domain', p.web ? p.domain : '');
    this._rest = p.rest;
    set('.lb-rest', p.rest);
    el.classList.toggle('plain', !p.web);
    el.classList.toggle('warn', !!p.warn);
    el.classList.toggle('other', !p.warn && p.otherSite);
    const mark = el.querySelector('.lb-mark');
    const icon = p.warn ? 'warning' : (p.otherSite ? 'external' : 'link');
    if (mark.dataset.icon !== icon) { mark.dataset.icon = icon; mark.innerHTML = window.VexIcons ? window.VexIcons.svg(icon, { size: 13 }) : ''; }
    const tag = p.warn === 'lookalike' ? 'Look-alike address' : (p.warn === 'login-name' ? 'Name before the address' : (p.otherSite ? 'Other site' : ''));
    set('.lb-tag', tag);
    this._fit();
  },

  // The path and query give way first, cut in the middle so the start and the end of the address both show.
  _fit() {
    const el = this._el;
    if (!el || !this._parts) return;
    const restEl = el.querySelector('.lb-rest');
    const box = el.querySelector('.lb-url');   // it is the part that gives way (flex-shrink), so it is the one that overflows
    const over = () => box.scrollWidth > box.clientWidth + 0.5;
    restEl.textContent = this._rest;
    if (!over() || !this._rest) return;
    let lo = this.MIN_KEEP, hi = this._rest.length - 1;
    restEl.textContent = VexPageChromeText.middle(this._rest, lo);
    if (over()) return;   // the domain alone fills the bar: its own ellipsis (css) is the last resort
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      restEl.textContent = VexPageChromeText.middle(this._rest, mid);
      if (over()) hi = mid - 1; else lo = mid;
    }
    restEl.textContent = VexPageChromeText.middle(this._rest, lo);
  },
};

// ---- the load bar -----------------------------------------------------------------------------------
const VexLoadBar = {
  // Off: the thin bar along the top of a loading page is not drawn (the person's switch, Settings > Feature switches).
  PREF: 'vex.loadBar.off',
  enabled() {
    try { return localStorage.getItem(this.PREF) !== '1'; }
    catch (err) { throw new Error('The page load bar setting could not be read: ' + err.message, { cause: err }); }
  },
  setEnabled(on) {
    try { if (on) localStorage.removeItem(this.PREF); else localStorage.setItem(this.PREF, '1'); }
    catch (err) { throw new Error('The page load bar setting could not be saved: ' + err.message, { cause: err }); }
    if (!on && this._mode !== 'idle') this._snap();
    return !!on;
  },
  QUICK_MS: 450,        // to QUICK_TO
  QUICK_TO: 0.7,
  CREEP_TO: 0.95,
  CREEP_MS: 30000,
  DOM_READY_AT: 0.85,
  CAP_MS: 200000,       // the load watchdog (webview.js) lets a page that really loads keep the state for about 3 minutes; this ends the bar just after
  _st: new Map(),       // tab id -> { t0, floor } while that tab loads
  _el: null,
  _fill: null,
  _mode: 'idle',        // 'idle' | 'loading' | 'done'
  _shownId: null,
  _timer: null,
  _doneTimer: null,
  _capTimer: null,

  // How far along a load is `ms` after it began, as a fraction: quick to QUICK_TO, then a slow creep towards CREEP_TO.
  progressAt(ms) {
    if (!(ms > 0)) return 0;
    if (ms < this.QUICK_MS) return this.QUICK_TO * (1 - Math.pow(1 - ms / this.QUICK_MS, 3));
    return this.QUICK_TO + (this.CREEP_TO - this.QUICK_TO) * (1 - Math.exp(-(ms - this.QUICK_MS) / 9000));
  },

  place() {
    if (this._fill) return true;
    const area = document.getElementById('content-area');
    if (!area) { console.warn('[load-bar] #content-area is missing, so the load bar cannot be placed; the plain line on the page is used'); return false; }
    const el = document.createElement('div');
    el.id = 'vex-loadbar';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<i></i>';
    area.insertBefore(el, area.firstChild);
    this._el = el;
    this._fill = el.firstChild;
    document.documentElement.setAttribute('data-loadbar', '');   // css/page-chrome.css drops its plain-line fallback
    return true;
  },

  // A tab's loading flag changed (tabs.js updateTab): keep its state, whatever tab is in front.
  note(tab) {
    if (!tab) return;
    if (tab.loading) {
      if (!this._st.has(tab.id)) {
        if (this._st.size > 20 && typeof TabManager !== 'undefined') {
          for (const id of [...this._st.keys()]) if (!TabManager.tabs.some(t => t.id === id)) this._st.delete(id);
        }
        this._st.set(tab.id, { t0: performance.now(), floor: 0 });
      }
    } else this._st.delete(tab.id);
  },

  // The tab in front (tabs.js syncReloadButton, on every change and every switch).
  show(tab) {
    if (!tab || !this.enabled() || !this.place()) return;
    if (tab.loading && !this._st.has(tab.id)) this.note(tab);
    const st = tab.loading ? this._st.get(tab.id) : null;
    if (this._mode !== 'idle' && this._shownId !== tab.id) this._snap();
    this._shownId = tab.id;
    if (st) {
      if (this._mode === 'loading') return;
      this._begin(st);
    } else if (this._mode === 'loading') this._finish();
  },

  // The page's DOM is ready (webview.js): most of the way there.
  milestone(tabId) {
    const st = this._st.get(tabId);
    if (!st) return;
    st.floor = Math.max(st.floor, this.DOM_READY_AT);
    if (this._mode !== 'loading' || this._shownId !== tabId) return;
    clearTimeout(this._timer);
    this._to(this.DOM_READY_AT, 350, 'ease-out');
    this._timer = setTimeout(() => this._creep(), 360);
  },

  _t(ms, ease) { return 'transform ' + ms + 'ms ' + ease + ', opacity 300ms ease'; },

  _to(scale, ms, ease) {
    this._fill.style.transition = this._t(ms, ease);
    this._fill.style.transform = 'scaleX(' + scale + ')';
  },

  _creep() {
    this._to(this.CREEP_TO, this.CREEP_MS, 'cubic-bezier(0.1, 0.4, 0.2, 1)');
  },

  _begin(st) {
    clearTimeout(this._timer); clearTimeout(this._doneTimer); clearTimeout(this._capTimer);
    const elapsed = performance.now() - st.t0;
    const from = Math.max(this.progressAt(elapsed), st.floor);
    this._mode = 'loading';
    this._el.classList.remove('done');
    this._el.classList.add('on');
    this._fill.style.transition = 'none';
    this._fill.style.transform = 'scaleX(' + from + ')';
    void this._fill.offsetWidth;   // the starting point is taken before the move to the next one
    if (elapsed < this.QUICK_MS && from < this.QUICK_TO) {
      const left = this.QUICK_MS - elapsed;
      this._to(this.QUICK_TO, left, 'cubic-bezier(0.2, 0.7, 0.3, 1)');
      this._timer = setTimeout(() => this._creep(), left);
    } else this._creep();
    this._capTimer = setTimeout(() => { if (this._mode === 'loading') this._finish(); }, this.CAP_MS);
  },

  // The load ended: run to the end, then fade.
  _finish() {
    clearTimeout(this._timer); clearTimeout(this._capTimer);
    this._mode = 'done';
    this._to(1, 180, 'ease-out');
    this._doneTimer = setTimeout(() => {
      this._el.classList.add('done');
      this._doneTimer = setTimeout(() => this._snap(), 360);
    }, 200);
  },

  // Gone at once (another tab came to the front, or the fade is over).
  _snap() {
    clearTimeout(this._timer); clearTimeout(this._doneTimer); clearTimeout(this._capTimer);
    this._mode = 'idle';
    if (!this._el) return;
    this._el.classList.remove('on', 'done');
    this._fill.style.transition = 'none';
    this._fill.style.transform = 'scaleX(0)';
  },
};

// ---- slim scrollbars on websites -----------------------------------------------------------------------
const VexPageScrollbars = {
  KEY: 'vex.pageScrollbars',
  SITES_KEY: 'vex.pageScrollbarsOff',
  // A page that already styles its scrollbars is left alone: Chromium ignores a page's ::-webkit-scrollbar rules
  // wherever scrollbar-color or scrollbar-width is set, so inserting ours over them would undo the page's own.
  // Only style sheets the page may read (its own) can be looked through.
  OWN_SCAN: `(() => {
    const re = /-webkit-scrollbar|scrollbar-(color|width)/i;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (err) { continue; }   // a style sheet from another site cannot be read: not known, so not counted
      for (const rule of rules) if (re.test(rule.cssText)) return true;
    }
    return false;
  })()`,

  on() {
    try { return localStorage.getItem(this.KEY) === '1'; }
    catch (err) { console.error('[page-scrollbars] reading the setting:', err.message); return false; }
  },

  setOn(on) {
    if (on) localStorage.setItem(this.KEY, '1'); else localStorage.removeItem(this.KEY);
    return this.refreshAll();
  },

  sites() {
    let raw = null;
    try { raw = localStorage.getItem(this.SITES_KEY); }
    catch (err) { throw new Error('The scrollbar site list could not be read: ' + err.message); }
    if (!raw) return [];
    let list;
    try { list = JSON.parse(raw); } catch (err) { throw new Error('The scrollbar site list is not readable: ' + err.message); }
    return Array.isArray(list) ? list.filter(h => typeof h === 'string' && h) : [];
  },

  hostOf(text) {
    const s = String(text || '').trim().toLowerCase();
    if (!s) return '';
    try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : 'https://' + s).hostname.replace(/^www\./, ''); } catch { return ''; }
  },

  addSite(text) {
    const host = this.hostOf(text);
    if (!host || !host.includes('.') && host !== 'localhost') throw new Error('Not a site address: ' + String(text).trim());
    const list = this.sites();
    if (!list.includes(host)) list.push(host);
    localStorage.setItem(this.SITES_KEY, JSON.stringify(list));
    return this.refreshAll();
  },

  removeSite(host) {
    localStorage.setItem(this.SITES_KEY, JSON.stringify(this.sites().filter(h => h !== host)));
    return this.refreshAll();
  },

  // Websites only: never Vex's own pages (the New Tab page, settings pages, error pages) and never a file.
  applies(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (typeof isStartPage === 'function' && isStartPage(String(url))) return false;
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return !this.sites().some(off => host === off || host.endsWith('.' + off));
  },

  // The theme's colours, resolved to plain colours: a page cannot read Vex's custom properties.
  colours() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    try {
      const read = (expr) => { probe.style.color = ''; probe.style.color = expr; return getComputedStyle(probe).color; };
      return {
        thumb: read('color-mix(in srgb, var(--primary) 30%, color-mix(in srgb, var(--text) 40%, var(--bg)))'),
        track: read('color-mix(in srgb, var(--text) 6%, var(--bg))'),
      };
    } finally { probe.remove(); }
  },

  css(c) {
    const col = c || this.colours();
    return ':where(html){scrollbar-color:' + col.thumb + ' ' + col.track + '}:where(html,html *){scrollbar-width:thin}';
  },

  async remove(wv) {
    const key = wv._slimScrollKey;
    wv._slimScrollKey = null;
    wv._slimScrollGen = (wv._slimScrollGen || 0) + 1;   // an apply still on its way must not insert after this
    if (key && typeof wv.removeInsertedCSS === 'function') await wv.removeInsertedCSS(key);
  },

  // Called after a page loads (webview.js did-finish-load) and when the setting, the site list or the theme changes.
  async apply(wv) {
    wv._slimScrollKey = null;   // a new document starts without what was inserted into the last
    const gen = wv._slimScrollGen = (wv._slimScrollGen || 0) + 1;
    if (!this.on() || typeof wv.insertCSS !== 'function') return false;
    let url = '';
    try { url = wv.getURL(); } catch { return false; }   // not attached yet: it is asked again when the page has loaded
    if (!this.applies(url)) return false;
    if (!wv._noScripts) {
      const own = await wv.executeJavaScript(this.OWN_SCAN);
      if (gen !== wv._slimScrollGen) return false;
      if (own) return false;
    }
    const key = await wv.insertCSS(this.css());
    if (gen !== wv._slimScrollGen) { await wv.removeInsertedCSS(key); return false; }
    wv._slimScrollKey = key;
    return true;
  },

  async refreshAll() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    for (const wv of WebviewManager.webviews.values()) {
      try {
        await this.remove(wv);
        if (this.on()) await this.apply(wv);
      } catch (err) { console.warn('[page-scrollbars] could not update a page:', err && err.message); }
    }
  },

  // ---- Settings > Appearance
  wire() {
    const box = document.getElementById('setting-page-scrollbars');
    if (!box || box.dataset.wired) return;
    box.dataset.wired = '1';
    box.checked = this.on();
    box.addEventListener('change', () => {
      this.setOn(box.checked).catch(err => window.showToast?.('Could not change the scrollbars on websites: ' + err.message, 'error'));
    });
    const input = document.getElementById('page-scrollbars-site');
    const add = (text) => {
      let done;
      try { done = this.addSite(text); } catch (err) { window.showToast?.(err.message, 'error'); return; }
      if (input) input.value = '';
      this.drawSites();
      done.catch(err => window.showToast?.('Could not change the scrollbars on websites: ' + err.message, 'error'));
    };
    document.getElementById('page-scrollbars-add')?.addEventListener('click', () => { if (input && input.value.trim()) add(input.value); });
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); add(input.value); } });
    document.getElementById('page-scrollbars-this')?.addEventListener('click', () => {
      const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === TabManager.activeTabId) : null;
      if (!tab || !/^https?:/i.test(tab.url || '')) { window.showToast?.('Open a website first'); return; }
      add(tab.url);
    });
    this.drawSites();
  },

  drawSites() {
    const list = document.getElementById('page-scrollbars-list');
    if (!list) return;
    let sites;
    try { sites = this.sites(); } catch (err) { list.textContent = err.message; return; }
    list.textContent = '';
    for (const host of sites) {
      const chip = document.createElement('span');
      chip.className = 'psb-chip';
      const name = document.createElement('span');
      name.textContent = host;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'psb-remove';
      rm.title = 'Remove';
      rm.setAttribute('aria-label', 'Remove');
      rm.innerHTML = window.VexIcons ? window.VexIcons.svg('x', { size: 12 }) : '';
      rm.addEventListener('click', () => {
        this.removeSite(host).catch(err => window.showToast?.('Could not change the scrollbars on websites: ' + err.message, 'error'));
        this.drawSites();
      });
      chip.append(name, rm);
      list.appendChild(chip);
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexLinkBar = VexLinkBar;
  window.VexLoadBar = VexLoadBar;
  window.VexPageScrollbars = VexPageScrollbars;
  window.VexPageChromeText = VexPageChromeText;
  if (typeof document !== 'undefined') {
    const start = () => {
      VexPageScrollbars.wire();
      // The theme or the look changed: the scrollbars take its colours.
      let again = null;
      const recolour = () => { if (!VexPageScrollbars.on()) return; clearTimeout(again); again = setTimeout(() => VexPageScrollbars.refreshAll(), 300); };
      document.addEventListener('theme-changed', recolour);
      window.addEventListener('vex:gui-style', recolour);
      window.addEventListener('vex:gui-colors', recolour);
      // This module arrives after the first pages have loaded.
      if (VexPageScrollbars.on()) VexPageScrollbars.refreshAll();
      if (typeof TabManager !== 'undefined') {
        const front = TabManager.tabs.find(t => t.id === TabManager.activeTabId);
        for (const t of TabManager.tabs) VexLoadBar.note(t);
        if (front) VexLoadBar.show(front);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPageChromeText, VexLinkBar, VexLoadBar, VexPageScrollbars };
