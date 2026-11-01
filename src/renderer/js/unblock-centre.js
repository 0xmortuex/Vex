// === Unblock centre: open a site your network blocks, without admin rights ==================
//
// When a page fails to load in a way that looks like a block (the connection is reset, times out, the
// secure handshake is cut, or the name does not resolve) AND the network is up AND the site exists, a calm
// bar appears on that tab: "This site may be blocked on your network. Try to open it with a bypass?"
// Try / Not now / Never for this site. It is only ever asked once per site per hour, only after a failed
// load, and never in a private window or a Tor, container-route or proxied tab.
//
// Try asks the main process (src/main/unblock-main.js) to use the ways Vex has WITHOUT administrator
// rights, in order, for that one site only: encrypted DNS, then encrypted DNS with a split handshake, then
// the ByeDPI helper (downloaded only after you say yes). The first that opens the site is remembered for
// that site. A way that needs administrator rights (Zapret / WinDivert) is listed as such and never run.
//
// The list lives in vex.unblock.sites; the main process holds nothing across a restart and is told the list
// at start (a site is on again by itself only when you chose "Always"). The helper it may start stops when the
// last site that needs it is gone, and when Vex closes.
//
//   VexUnblock.renderCentre(body)   the Unblock centre (Settings section, Ctrl+K "Unblock centre")
//   VexUnblock.sites()        the saved list: [{ host, mode, method, preset, at }]
const VexUnblock = {
  KEYS: { on: 'vex.unblock.enabled', sites: 'vex.unblock.sites' },
  MODES: ['ask', 'always', 'never', 'once'],
  _bars: new Map(),      // tab id -> { host, url, state }
  _status: null,         // the last answer of unblock:status / unblock:sync
  _el: null,

  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },
  _note(what, err) { if (window.VexProblems) window.VexProblems.note('Unblock centre', what, err); else console.error('[Unblock]', what, err); },
  _api() {
    const api = window.vex && window.vex.unblock;
    if (!api) throw new Error('The Unblock centre is not available in this window');
    return api;
  },

  METHOD_LABELS: { doh: 'Encrypted DNS', light: 'Encrypted DNS and a split handshake', byedpi: 'ByeDPI helper' },
  methodLabel(id) { return id ? this._t(this.METHOD_LABELS[id] || id) : this._t('None yet'); },

  // ---- switch and list --------------------------------------------------------------------------
  enabled() { return localStorage.getItem(this.KEYS.on) !== 'off'; },
  setEnabled(on) {
    localStorage.setItem(this.KEYS.on, on ? 'on' : 'off');
    this.sync().catch(err => this._note('The change could not be sent to the app', err));
    if (!on) this._clearBars();
  },

  sites() {
    const raw = localStorage.getItem(this.KEYS.sites);
    if (!raw) return [];
    let list;
    try { list = JSON.parse(raw); }
    catch (err) { this._note('The saved list of sites could not be read', err); return []; }
    if (!Array.isArray(list)) { this._note('The saved list of sites is not a list', new Error('vex.unblock.sites is not an array')); return []; }
    return list.filter(s => s && typeof s.host === 'string' && this.MODES.includes(s.mode));
  },
  _save(list) {
    if (list.length > 200) throw new Error('The Unblock centre keeps up to 200 sites');
    localStorage.setItem(this.KEYS.sites, JSON.stringify(list));
  },
  site(host) { return this.sites().find(s => s.host === host) || null; },
  put(host, patch) {
    const list = this.sites();
    const i = list.findIndex(s => s.host === host);
    const next = { host, mode: 'ask', method: null, preset: null, at: Date.now(), ...(i >= 0 ? list[i] : {}), ...patch };
    if (i >= 0) list[i] = next; else list.push(next);
    this._save(list);
    return next;
  },
  forget(host) {
    this._save(this.sites().filter(s => s.host !== host));
    return this.sync();
  },
  hostOf(url) { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); },

  // Tells the main process the whole list (it switches sites on and off to match) and keeps its answer.
  async sync() {
    // A private window has no Unblock centre at all (the channels are closed there): nothing is sent.
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) return null;
    const list = this.sites().map(s => ({ host: s.host, mode: s.mode, method: s.method || null, preset: s.preset == null ? null : s.preset }));
    this._status = await this._api().sync({ enabled: this.enabled(), sites: list });
    return this._status;
  },

  // ---- the bar -----------------------------------------------------------------------------------
  _busy() { return (typeof GameMode !== 'undefined' && !!GameMode.gaming) || (typeof GameSession !== 'undefined' && !!GameSession.active); },

  async onLoadFailed(detail) {
    if (!this.enabled() || (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow)) return null;
    const { tabId, code, url } = detail || {};
    const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
    if (!tab || !/^https:\/\//i.test(String(url || ''))) return null;
    const r = await this._api().assess(String(url), Number(code), tab.partition || null);
    if (!r || !r.suggest) return r;
    // The tab is still on that failed page (a new navigation clears the failure).
    if (!tab._loadFailed || tab._loadFailed.url !== url) return r;
    this._bars.set(tabId, { host: r.host, url, state: 'offer', dns: !!r.dns });
    this.drawBar();
    return r;
  },

  _clearBars() { this._bars.clear(); this.drawBar(); },
  hide() { if (this._el) { this._el.remove(); this._el = null; } },

  drawBar() {
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const bar = tab && this._bars.get(tab.id);
    if (!this.enabled() || !bar) { this.hide(); return; }
    const host = document.getElementById('webviews-container');
    if (!host) return;
    this.hide();
    const el = document.createElement('div');
    el.id = 'vex-unblock-bar';
    el.className = 'unblock-bar';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', this._t('Unblock centre'));
    const icon = document.createElement('span');
    icon.className = 'unblock-bar-icon';
    icon.innerHTML = typeof VexIcons !== 'undefined' ? VexIcons.svg('unlock', { size: 16 }) : '';
    const text = document.createElement('span');
    text.className = 'unblock-bar-text';
    text.setAttribute('role', 'status');
    const row = document.createElement('span');
    row.className = 'unblock-bar-actions';
    const add = (label, run, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'unblock-btn' + (primary ? ' unblock-primary' : '');
      b.textContent = this._t(label);
      b.addEventListener('click', () => { Promise.resolve().then(run).catch(err => this._fail(tab.id, err)); });
      row.appendChild(b);
    };
    const close = () => { this._bars.delete(tab.id); this.hide(); };
    if (bar.state === 'offer') {
      text.textContent = bar.host + ': ' + this._t('This site may be blocked on your network. Try to open it with a bypass?');
      add('Try', () => this.attempt(tab.id), true);
      add('Not now', close);
      add('Never for this site', () => { this.put(bar.host, { mode: 'never', method: null }); close(); return this.sync(); });
    } else if (bar.state === 'trying') {
      text.textContent = this._t('Trying to open {1}…').replace('{1}', bar.host);
    } else if (bar.state === 'opened') {
      text.textContent = this._t('Opened {1} with: {2}. Use this for the site every time?').replace('{1}', bar.host).replace('{2}', this.methodLabel(bar.method));
      add('Always for this site', () => { this.put(bar.host, { mode: 'always' }); close(); return this.sync(); }, true);
      add('Just this time', close);
    } else if (bar.state === 'failed') {
      text.textContent = bar.message;
      add('Open the Unblock centre', () => { close(); return this.openCentre(); }, true);
      add('Close', close);
    }
    el.append(icon, text, row);
    host.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'chrome', id: 'unblock-bar', keep: true, close: () => this.hide() });
    this._el = el;
  },

  _fail(tabId, err) {
    this._note('Trying the site failed', err);
    this._bars.set(tabId, { ...(this._bars.get(tabId) || { host: '', url: '' }), state: 'failed', message: (err && err.message) || String(err) });
    this.drawBar();
  },

  // Words for what was tried, from the steps the main process reports.
  summarize(steps) {
    return (steps || []).map((s) => {
      const label = this._t(s.label || s.id);
      if (s.ok) return label + ': ' + this._t('opened the site');
      if (s.skipped === 'admin') return label + ': ' + this._t('needs administrator rights, so Vex does not run it');
      if (s.skipped === 'download') return label + ': ' + this._t('not tried, the helper is not downloaded');
      return label + ': ' + this._t(s.error || 'did not open the site');
    }).join('. ');
  },

  async _try(host, opts) {
    let r = await this._api().try(host, opts);
    if (!r.ok && r.needsDownload && !(opts && opts.allowDownload)) {
      const yes = typeof window.vexConfirm === 'function' && await window.vexConfirm({
        title: this._t('Download the ByeDPI helper?'),
        message: this._t('The first two ways did not open this site. The next one is ByeDPI, a small open-source helper that Vex downloads from GitHub once (github.com/hufrea/byedpi). It runs without administrator rights, only while a site needs it, and stops when you close Vex.'),
        okLabel: this._t('Download and try'),
        cancelLabel: this._t('Not now'),
      });
      if (yes) r = await this._api().try(host, { ...(opts || {}), allowDownload: true });
    }
    return r;
  },

  async attempt(tabId) {
    const bar = this._bars.get(tabId);
    if (!bar) return null;
    bar.state = 'trying';
    this.drawBar();
    const r = await this._try(bar.host, {});
    if (r.ok && r.direct) {
      // It opens now without help (the network changed): nothing to remember.
      this._bars.delete(tabId);
      this.drawBar();
      window.showToast?.(this._t('{1} opens now without any help').replace('{1}', bar.host));
      this._reload(tabId, bar.url);
      return r;
    }
    if (r.ok) {
      this.put(bar.host, { mode: 'once', method: r.method, preset: r.preset == null ? null : r.preset, at: Date.now() });
      await this.sync();
      this._bars.set(tabId, { ...bar, state: 'opened', method: r.method });
      this.drawBar();
      this._reload(tabId, bar.url);
      return r;
    }
    this._bars.set(tabId, { ...bar, state: 'failed', message: this._t('Vex could not open {1} with the ways that need no administrator rights.').replace('{1}', bar.host) + ' ' + this.summarize(r.steps) });
    this.drawBar();
    return r;
  },

  _reload(tabId, url) {
    if (typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') throw new Error('Tabs are not available');
    if (TabManager.activeTabId !== tabId) TabManager.switchTab(tabId);
    if (typeof VexLoadFailure !== 'undefined') VexLoadFailure.clear(tabId);
    WebviewManager.navigate(url);
  },

  // ---- the centre --------------------------------------------------------------------------------
  async testSite(host) {
    const s = this.site(host);
    if (!s) throw new Error('That site is not in the list');
    const r = await this._try(host, { prefer: s.method || undefined, keep: s.mode === 'always' });
    if (r.ok && !r.direct) this.put(host, { method: r.method, preset: r.preset == null ? null : r.preset, at: Date.now() });
    await this.sync();
    return r;
  },

  describeTest(r) {
    if (r.ok && r.direct) return this._t('Opens without any help now.');
    if (r.ok) return this._t('Works with: {1}.').replace('{1}', this.methodLabel(r.method));
    return this._t('Could not be opened. {1}').replace('{1}', this.summarize(r.steps));
  },

  _el2(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  },

  _switch(label, checked, onChange) {
    const row = this._el2('div', 'setting-toggle-row');
    const span = this._el2('span', '', label);
    const sw = this._el2('label', 'toggle');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => { Promise.resolve().then(() => onChange(input.checked)).catch((err) => { input.checked = !input.checked; this._note('The change failed', err); window.showToast?.(err.message, 'error'); }); });
    sw.append(input, this._el2('span', 'toggle-slider'));
    row.append(span, sw);
    return row;
  },

  async renderCentre(body) {
    const L = (s) => this._t(s);
    body.textContent = '';
    body.appendChild(this._el2('div', 'vex-platform-note', L('When a site will not load because your network blocks it, Vex can try to open just that site without administrator rights. Nothing is sent anywhere new: the site name is only looked up over encrypted DNS and requested from the site itself, and your list stays on this computer.')));
    body.appendChild(this._switch(L('Offer help when a site looks blocked'), this.enabled(), (on) => { this.setEnabled(on); }));

    let status = this._status;
    try { status = await this._api().status(); this._status = status; }
    catch (err) { this._note('The state of the helpers could not be read', err); body.appendChild(this._el2('div', 'vex-platform-note unblock-error', err.message)); }
    const errors = (status && status.errors) || {};
    const activeHosts = new Set(((status && status.active) || []).map(a => a.host));

    const ways = this._el2('div', 'unblock-ways');
    ways.appendChild(this._el2('div', 'unblock-h', L('The ways, in the order they are tried')));
    for (const m of ((status && status.methods) || [])) {
      const li = this._el2('div', 'unblock-way' + (m.adminOnly ? ' unblock-way-admin' : ''));
      li.appendChild(this._el2('span', 'unblock-way-name', L(m.label)));
      li.appendChild(this._el2('span', 'unblock-way-note', m.adminOnly
        ? L('Needs administrator rights, so Vex never starts it. The Game Control Center tool can run it for you.')
        : L(m.note)));
      ways.appendChild(li);
    }
    body.appendChild(ways);

    const listHead = this._el2('div', 'unblock-h', L('Sites'));
    body.appendChild(listHead);
    const sites = this.sites();
    if (!sites.length) body.appendChild(this._el2('div', 'vex-platform-note', L('No sites yet. When a blocked site fails to load, Vex offers help on the tab; you can also type a site here.')));
    for (const s of sites) {
      const row = this._el2('div', 'unblock-site');
      const head = this._el2('div', 'unblock-site-head');
      head.appendChild(this._el2('span', 'unblock-site-host', s.host));
      const stateText = s.mode === 'never' ? L('Never offered')
        : (s.mode === 'always' ? L('Always on') : (activeHosts.has(s.host) ? L('On until Vex closes') : L('Off')));
      head.appendChild(this._el2('span', 'unblock-site-state', stateText + (s.method ? ' · ' + this.methodLabel(s.method) : '')));
      row.appendChild(head);
      const out = this._el2('div', 'unblock-site-out');
      out.setAttribute('role', 'status');
      if (errors[s.host]) out.textContent = errors[s.host];
      const actions = this._el2('div', 'unblock-site-actions');
      if (s.mode !== 'never') {
        const sw = this._switch(L('On every time'), s.mode === 'always', async (on) => {
          if (on && !s.method) throw new Error(L('Press Test now first, so Vex knows which way opens this site'));
          this.put(s.host, { mode: on ? 'always' : 'ask' });
          await this.sync();
          this.renderCentre(body);
        });
        actions.appendChild(sw);
        const test = VexSettingsGroups.button(L('Test now'), () => {
          out.textContent = L('Testing…');
          this.testSite(s.host).then((r) => { out.textContent = this.describeTest(r); this._refreshLater(body); }).catch((err) => { out.textContent = err.message; this._note('Test failed', err); });
        });
        actions.appendChild(test);
      }
      actions.appendChild(VexSettingsGroups.button(L('Forget'), () => { this.forget(s.host).then(() => this.renderCentre(body)).catch(err => { this._note('Forget failed', err); window.showToast?.(err.message, 'error'); }); }, { danger: true }));
      row.append(actions, out);
      body.appendChild(row);
    }

    const add = this._el2('div', 'unblock-add');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vexsr-input';
    input.placeholder = L('Add a site, for example example.com');
    input.setAttribute('aria-label', L('Add a site'));
    input.spellcheck = false;
    const result = this._el2('div', 'vex-platform-note');
    result.setAttribute('role', 'status');
    add.append(input, VexSettingsGroups.button(L('Try to open it'), () => {
      const raw = input.value.trim();
      if (!raw) return;
      result.textContent = L('Testing…');
      let host;
      try { host = this.hostOf(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (err) { result.textContent = L('That is not a site name'); return; }
      this._try(host, {}).then(async (r) => {
        if (r.ok && !r.direct) { this.put(host, { mode: 'once', method: r.method, preset: r.preset == null ? null : r.preset, at: Date.now() }); await this.sync(); }
        result.textContent = this.describeTest(r);
        if (r.ok && !r.direct) this._refreshLater(body);
      }).catch((err) => { result.textContent = err.message; this._note('Trying a typed site failed', err); });
    }, { primary: true }));
    body.append(add, result);
  },

  _refreshLater(body) { setTimeout(() => { if (body.isConnected) this.renderCentre(body); }, 1800); },

  async openCentre() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Settings sections are not loaded, so the Unblock centre cannot open');
    const dlg = VexSettingsGroups.dialog({ id: 'vex-unblock-centre', title: this._t('Unblock centre'), sub: this._t('Sites your network blocks, and the way that opens each one') });
    await this.renderCentre(dlg.body);
    return dlg;
  },

  init() {
    if (this._inited) return false;
    this._inited = true;
    document.addEventListener('vex:page-load-failed', (e) => {
      this.onLoadFailed(e.detail).catch(err => this._note('Could not check a page that did not load', err));
    });
    window.addEventListener('vex:tab-activated', () => this.drawBar());
    document.addEventListener('vex:tab-closed', (e) => { if (e.detail) this._bars.delete(e.detail.tabId); this.drawBar(); });
    // The page loaded after all (or went elsewhere): an offer for a failure that is over goes. The bars that
    // report an outcome stay until the person answers them.
    document.addEventListener('vex:tab-navigated', (e) => {
      const d = e.detail || {};
      const bar = this._bars.get(d.tabId);
      if (bar && bar.state === 'offer' && !d.failed) { this._bars.delete(d.tabId); this.drawBar(); }
    });
    // The main process forgets everything at a restart: hand it the list again. A site is on again by itself only when
    // it was "Always".
    this.sync().catch(err => this._note('The list could not be sent to the app at start', err));
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexUnblock = VexUnblock;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'unblock-centre', title: 'Unblock centre', keywords: 'unblock blocked site bypass dpi dns doh byedpi zapret censorship turkey open blocked website', render: (body) => { VexUnblock.renderCentre(body).catch(err => { VexUnblock._note('The Unblock centre could not be drawn', err); body.textContent = err.message; }); } });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'unblock-centre', label: 'Unblock centre', hint: 'Sites your network blocks, the way that opens each one, and a test for each', keywords: 'unblock blocked site bypass dns byedpi censorship', icon: 'unlock', action: () => VexUnblock.openCentre().catch((err) => { VexUnblock._note('The Unblock centre could not open', err); window.showToast?.(err.message, 'error'); }) });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexUnblock.init());
    else VexUnblock.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexUnblock };
