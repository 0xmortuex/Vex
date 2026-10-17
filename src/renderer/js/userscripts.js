// === Userscripts — a small, safe ==UserScript== manager ======================
//
// The scripts, their saved values and every rule about where they may run live
// in the main process (src/main/userscripts.js); this is the window's side:
// Settings → Userscripts (add from a pasted script, an address or a file, with a
// preview and a confirmation before anything is switched on), the toolbar
// marker that says how many are running on the page you are looking at, and the
// kill switch.
//
// Honest limits, said in the preview: scripts never run in private, Tor,
// burner or routed tabs, on Vex's own pages, or on a banking / mail / sign-in
// site unless that site is added to the script by name; nothing updates by
// itself; GM_xmlhttpRequest reaches only the hosts the script declares.
const VexUserscripts = {
  _state: { enabled: true, scripts: [] },
  _active: new Map(),   // tab id -> { count, names }
  _menu: null,

  _api() {
    const api = window.vex && window.vex.userscripts;
    if (!api) throw new Error('Userscripts are not available in this window');
    return api;
  },
  _isPrivate() { return !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },

  async refresh() {
    this._state = await this._api().list();
    return this._state;
  },

  // ---- install flow ------------------------------------------------------
  // Preview -> confirm -> (a second, plain warning when it asks for every
  // site) -> install. Returns true when something was installed.
  async reviewAndInstall(source, { sourceUrl = '', replaceId = '' } = {}) {
    const api = this._api();
    const p = await api.preview(source, replaceId);
    if (!p.ok) {
      await vexAlert({ title: 'This is not a userscript Vex can use', message: p.errors.join('\n') });
      return false;
    }
    if (p.replaces && p.sameVersion) { window.showToast?.('You already have exactly this script'); return false; }
    const update = !!p.replaces;
    const lines = p.lines.slice();
    if (p.older) lines.push('NOTE: this is OLDER than the version you have (' + p.replaces.version + ').');
    lines.push('', 'It runs only on the pages above, never in private, Tor or burner tabs, and never on banking, mail or sign-in sites unless you add that site to it. It can contact only the sites listed under "Can contact".');
    const ok = await vexConfirm({
      title: update ? 'Update ' + p.replaces.name + '?' : 'Install this userscript?',
      message: lines.join('\n'),
      okLabel: update ? 'Update' : 'Install and turn on',
      cancelLabel: 'Cancel',
      danger: p.wantsAnyHost,
      wide: true,
    });
    if (!ok) return false;
    let anyHost = false;
    if (p.wantsAnyHost) {
      anyHost = await vexConfirm({
        title: 'Let it contact any site?',
        message: 'This script asks to send requests to ANY web site (@connect *). A script that can do that can send what it sees on the pages it runs on to anywhere.\n\nChoose "Only the sites it names" to install it without that permission.',
        okLabel: 'Allow any site',
        cancelLabel: 'Only the sites it names',
        danger: true,
      });
    }
    // The confirm above listed what each permission lets the script do, so this install counts as reviewed.
    const r = await api.install({ source, anyHost, sourceUrl, replaceId: p.replaces ? p.replaces.id : '', reviewed: true });
    await this.refresh();
    window.showToast?.((r.replaced ? 'Updated ' : 'Installed ') + r.name + '. Reload a page to run it there.');
    return true;
  },

  async fromPaste() {
    const text = await vexPrompt({
      title: 'Paste a userscript', label: 'The whole script, including the // ==UserScript== block',
      multiline: true, wide: true, okLabel: 'Review it',
    });
    if (text == null || !String(text).trim()) return false;
    return this.reviewAndInstall(String(text));
  },

  async fromUrl() {
    const url = await vexPrompt({ title: 'Install from an address', label: 'Address of a .user.js file (http or https)', placeholder: 'https://example.com/script.user.js', okLabel: 'Fetch and review' });
    if (url == null || !String(url).trim()) return false;
    const r = await this._api().fetch(String(url).trim());
    return this.reviewAndInstall(r.source, { sourceUrl: r.finalUrl || String(url).trim() });
  },

  fromFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.js,text/javascript,text/plain';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) { resolve(false); return; }
        if (file.size > 450000) { reject(new Error('That file is larger than a userscript can be (400 KB)')); return; }
        try { resolve(await this.reviewAndInstall(await file.text())); } catch (err) { reject(err); }
      });
      input.click();
    });
  },

  // Manual only: fetched on this click, never in the background. A newer
  // version goes through the same preview, with what it adds called out.
  async checkUpdate(id) {
    const s = this._state.scripts.find(x => x.id === id);
    if (!s) throw new Error('That userscript is gone');
    if (!s.updateUrl) { window.showToast?.(s.name + ' has no address to update from'); return false; }
    const r = await this._api().fetch(s.updateUrl);
    const p = await this._api().preview(r.source, id);
    if (!p.ok) throw new Error('The copy at ' + s.updateUrl + ' is not a usable userscript: ' + p.errors[0]);
    if (p.sameVersion || (p.older === false && p.meta.version && p.meta.version === s.version)) {
      window.showToast?.(s.name + ' is up to date (' + (s.version || 'no version') + ')');
      return false;
    }
    return this.reviewAndInstall(r.source, { sourceUrl: r.finalUrl || s.updateUrl, replaceId: id });
  },

  // ---- kill switch and the page marker -------------------------------------
  async setAll(on) {
    await this._api().setGlobal(on);
    await this.refresh();
    this._paint();
    window.showToast?.(on ? 'Userscripts are on. Reload a page to run them.' : 'All userscripts are off. Pages already open keep what ran; reload them to undo it.');
  },

  noteActive(tabId, info) {
    if (!tabId) return;
    if (info && info.count > 0) this._active.set(tabId, { count: info.count, names: Array.isArray(info.names) ? info.names.slice(0, 20) : [] });
    else this._active.delete(tabId);
    this._paint();
  },

  _paint() {
    const btn = document.getElementById('btn-userscripts');
    if (!btn) return;
    const id = typeof TabManager !== 'undefined' ? TabManager.activeTabId : null;
    const a = id ? this._active.get(id) : null;
    btn.hidden = !a;
    if (!a) { this._closeMenu(); return; }
    const badge = btn.querySelector('.us-count');
    if (badge) badge.textContent = String(a.count);
    btn.title = a.count + ' userscript' + VexPlural.s(a.count) + ' running on this page — click for the list and the off switch';
    btn.setAttribute('aria-label', btn.title);
  },

  _closeMenu() {
    if (this._menu) { this._menu.remove(); this._menu = null; }
  },

  _openMenu() {
    if (this._menu) { this._closeMenu(); return; }
    const btn = document.getElementById('btn-userscripts');
    const id = typeof TabManager !== 'undefined' ? TabManager.activeTabId : null;
    const a = id ? this._active.get(id) : null;
    if (!btn || !a) return;
    const m = document.createElement('div');
    m.className = 'us-menu';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', 'Userscripts on this page');
    const head = document.createElement('div');
    head.className = 'us-menu-head';
    head.textContent = 'Running on this page';
    m.appendChild(head);
    for (const n of a.names) {
      const row = document.createElement('div');
      row.className = 'us-menu-row';
      row.textContent = n;
      m.appendChild(row);
    }
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'btn-danger us-menu-off';
    off.textContent = 'Disable all userscripts';
    off.addEventListener('click', () => {
      this._closeMenu();
      this.setAll(false).catch(err => window.showToast?.(err.message, 'error'));
    });
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'btn-secondary';
    manage.textContent = 'Manage…';
    manage.addEventListener('click', () => {
      this._closeMenu();
      if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('userscripts-panel');
    });
    m.append(off, manage);
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + 6) + 'px';
    m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    this._menu = m;
    off.focus({ preventScroll: true });
  },

  // ---- Settings ------------------------------------------------------------
  async renderPanel(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(s);
    if (this._isPrivate()) {
      container.innerHTML = '<p class="setting-info muted">Userscripts are not available in a private window. They never run in private, Tor or burner tabs.</p>';
      return;
    }
    try { await this.refresh(); }
    catch (err) { container.textContent = 'Userscripts could not be read: ' + err.message; return; }
    const st = this._state;
    container.innerHTML = '';
    const intro = document.createElement('p');
    intro.className = 'setting-info muted';
    intro.textContent = 'Install a ==UserScript== from a pasted script, an address or a file. You see its name, version, the pages it runs on, what it may do and which sites it may contact before anything is switched on. Scripts never run in private, Tor or burner tabs, on Vex\'s own pages, or on banking, mail and sign-in sites unless you add that site to the script. Nothing updates by itself.';
    container.appendChild(intro);

    const bar = document.createElement('div');
    bar.className = 'us-bar';
    const mkBtn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', () => { Promise.resolve().then(fn).then(() => this.renderPanel(container)).catch(err => window.showToast?.(err.message, 'error')); });
      return b;
    };
    bar.append(
      mkBtn('Paste a script…', 'btn-primary', () => this.fromPaste()),
      mkBtn('From an address…', 'btn-secondary', () => this.fromUrl()),
      mkBtn('From a file…', 'btn-secondary', () => this.fromFile()),
      mkBtn(st.enabled ? 'Disable all userscripts' : 'Enable userscripts', st.enabled ? 'btn-danger' : 'btn-secondary', () => this.setAll(!st.enabled)),
    );
    container.appendChild(bar);
    if (!st.enabled) {
      const off = document.createElement('p');
      off.className = 'setting-info';
      off.textContent = 'Userscripts are switched off: no script runs anywhere.';
      container.appendChild(off);
    }
    if (!st.scripts.length) {
      container.insertAdjacentHTML('beforeend', '<div style="font-size:12.5px;color:var(--text-muted);margin-top:10px">No userscripts installed.</div>');
      return;
    }
    for (const s of st.scripts) {
      const row = document.createElement('div');
      row.className = 'us-row';
      const bits = [];
      bits.push(s.enabled ? 'on' : 'off');
      bits.push(s.runAt);
      if (s.grants.length) bits.push(s.grants.join(', '));
      bits.push(s.connects.length ? 'contacts ' + (s.connects.includes('*') && !s.anyHost ? s.connects.filter(c => c !== '*').join(', ') || 'no site' : s.connects.join(', ')) : 'contacts no site');
      if (s.valueCount) bits.push(s.valueCount + ' saved value' + VexPlural.s(s.valueCount) + ' (' + Math.max(1, Math.round(s.valueBytes / 1024)) + ' KB)');
      const sites = s.matches.slice(0, 4).join(', ') + (s.matches.length > 4 ? ' +' + (s.matches.length - 4) : '');
      row.innerHTML = '<div class="us-row-main"><div class="us-row-name">' + esc(s.name) + (s.version ? ' <span class="us-ver">v' + esc(s.version) + '</span>' : '') + '</div>'
        + '<div class="us-row-meta">' + esc(s.description || '') + '</div>'
        + '<div class="us-row-meta">Runs on: ' + esc(sites || 'no site yet') + (s.userHosts.length ? ' · added by you: ' + esc(s.userHosts.join(', ')) : '') + '</div>'
        + '<div class="us-row-meta">' + esc(bits.join(' · ')) + '</div>'
        + (s.connects.includes('*') ? '<div class="us-row-meta us-warn">' + (s.anyHost ? 'Can contact ANY site (you allowed it).' : 'Asked to contact any site; not allowed.') + '</div>' : '')
        + '</div><div class="us-row-actions"></div>';
      const actions = row.querySelector('.us-row-actions');
      const act = (label, fn, cls) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls || 'btn-secondary';
        b.textContent = label;
        b.setAttribute('aria-label', label + ': ' + s.name);
        b.addEventListener('click', () => { Promise.resolve().then(fn).then(() => this.renderPanel(container)).catch(err => window.showToast?.(err.message, 'error')); });
        actions.appendChild(b);
      };
      act(s.enabled ? 'Turn off' : 'Turn on', async () => {
        if (!s.enabled) {
          const ok = await vexConfirm({ title: 'Turn on ' + s.name + '?', message: 'It will run on: ' + (s.matches.join(', ') || 'only the sites you added') + (s.grants.length ? '\nPermissions: ' + s.grants.join(', ') : '') + ((s.review || []).length ? '\n\nWhat each permission lets it do:\n' + s.review.map(r => '  ' + (r.risk === 'high' ? '[high] ' : '') + r.id + ': ' + r.says).join('\n') : ''), okLabel: 'Turn on', danger: (s.review || []).some(r => r.risk === 'high') });
          if (!ok) return;
        }
        await this._api().setEnabled(s.id, !s.enabled);
      });
      act('Sites…', async () => {
        const v = await vexPrompt({
          title: 'Also run ' + s.name + ' on…', label: 'Site names separated by commas (example.com). A site you add here runs the script even where it is normally held back, such as a bank or a mail site.',
          value: s.userHosts.join(', '), okLabel: 'Save',
        });
        if (v == null) return;
        const hosts = String(v).split(/[\s,]+/).filter(Boolean);
        const sensitive = hosts.filter(h => !s.userHosts.includes(h));
        if (sensitive.length) {
          const ok = await vexConfirm({ title: 'Run this script on ' + sensitive.join(', ') + '?', message: 'The script will be able to read and change those pages, including anything you type there.', okLabel: 'Add', danger: true });
          if (!ok) return;
        }
        await this._api().setHosts(s.id, hosts);
      });
      if (s.updateUrl) act('Check for update', () => this.checkUpdate(s.id));
      if (s.valueCount) {
        act('Clear saved values', async () => {
          const ok = await vexConfirm({ title: 'Clear saved values?', message: s.name + ' loses the ' + s.valueCount + ' value' + VexPlural.s(s.valueCount) + ' it saved.', okLabel: 'Clear', danger: true });
          if (ok) await this._api().clearValues(s.id);
        });
      }
      act('Delete', async () => {
        const ok = await vexConfirm({ title: 'Delete ' + s.name + '?', message: 'The script and its saved values are removed. Pages already open keep what it did until you reload them.', okLabel: 'Delete', danger: true });
        if (ok) await this._api().remove(s.id);
      }, 'btn-danger');
      container.appendChild(row);
    }
  },

  init() {
    document.getElementById('btn-userscripts')?.addEventListener('click', (e) => { e.stopPropagation(); this._openMenu(); });
    document.addEventListener('click', (e) => {
      if (this._menu && !this._menu.contains(e.target) && e.target.closest && !e.target.closest('#btn-userscripts')) this._closeMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._menu) this._closeMenu(); });
    window.addEventListener('vex-tabs-changed', () => this._paint());
    return this;
  },
};
window.VexUserscripts = VexUserscripts;
