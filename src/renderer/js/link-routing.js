// === Links open in the panel that already has the site (T2-015) ================
//
// Vex has panels for claude.ai, Discord, Spotify, WhatsApp and any site the
// person pinned, and still the same sites kept opening as loose tabs: a link to
// claude.ai from another page made a second claude.ai next to the panel that was
// already signed in. With this on, a link that opens a new tab (target=_blank,
// or a link from another program when Vex is the default browser) goes to the
// matching panel instead.
//
// What is routed, and what is not:
//   - a plain "open in a new tab" link, and a link from outside Vex. NOT a pop-up
//     window (sign-in windows), NOT Ctrl+click / middle-click (that asks for a
//     background tab, and is the way to say "as a tab" for one link);
//   - only from an ordinary tab. A private, Tor or container tab keeps its own
//     session, so its links are never moved into a panel's session;
//   - not when the page you are on is already that site (a link inside github.com
//     stays a tab), and not for a site you told Vex to keep as a tab.
//
// Rules are the person's own: "github.com goes to the GitHub panel" or "keep
// example.com as a tab". Without a rule a link goes to the panel whose own address
// has exactly that host (www. ignored). The first 10 routes say why and offer
// "Open as a tab instead" and "Always open this site as a tab"; each route is
// written to the "Why did that happen?" list with an undo.
const LinkRouting = {
  KEYS: { on: 'vex.linkRouting.enabled', rules: 'vex.linkRouting.rules', told: 'vex.linkRouting.told' },
  MAX_RULES: 50,
  TELL_FIRST: 10,
  WAIT_PANEL_MS: 4000,

  _note(what, err) { window.VexProblems?.note('Link routing', what, err); },

  enabled() { return localStorage.getItem(this.KEYS.on) === 'on'; },
  setEnabled(on) { localStorage.setItem(this.KEYS.on, on ? 'on' : 'off'); },

  hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },
  cleanHost(input) {
    let h = String(input || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split('?')[0].replace(/^www\./, '').replace(/:\d+$/, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : '';
  },

  // ---- the person's rules: [{ host, mode: 'panel' | 'tab', panel? }] ---------------------
  rules() {
    const raw = localStorage.getItem(this.KEYS.rules);
    if (raw === null) return [];
    let list;
    try { list = JSON.parse(raw); } catch (err) { throw new Error('The link routing rules could not be read', { cause: err }); }
    if (!Array.isArray(list)) return [];
    return list.filter(r => r && typeof r.host === 'string' && (r.mode === 'tab' || (r.mode === 'panel' && typeof r.panel === 'string' && r.panel)))
      .map(r => ({ host: r.host, mode: r.mode, ...(r.mode === 'panel' ? { panel: r.panel } : {}) }));
  },
  setRule(host, { mode, panel } = {}) {
    const h = this.cleanHost(host);
    if (!h) throw new Error('Give a site such as github.com');
    if (mode !== 'tab' && mode !== 'panel') throw new Error('A rule opens a site in a panel or as a tab');
    if (mode === 'panel' && !this.panels().some(p => p.name === panel)) throw new Error('That panel is not there: ' + panel);
    const list = this.rules().filter(r => r.host !== h);
    if (list.length >= this.MAX_RULES) throw new Error('At most ' + this.MAX_RULES + ' rules');
    list.push(mode === 'tab' ? { host: h, mode } : { host: h, mode, panel });
    localStorage.setItem(this.KEYS.rules, JSON.stringify(list));
    return h;
  },
  removeRule(host) {
    const list = this.rules();
    const next = list.filter(r => r.host !== host);
    if (next.length === list.length) return false;
    localStorage.setItem(this.KEYS.rules, JSON.stringify(next));
    return true;
  },

  // ---- the panels that could take a link --------------------------------------------------
  // Web panels only (a panel with an address of its own): [{ name, host, label }].
  panels() {
    if (typeof SidebarManager === 'undefined' || !SidebarManager.panelConfigs) return [];
    const out = [];
    for (const [name, cfg] of Object.entries(SidebarManager.panelConfigs)) {
      if (!cfg || !cfg.url) continue;
      if (typeof SidebarManager.isWebPanel === 'function' && !SidebarManager.isWebPanel(name)) continue;
      const host = this.hostOf(cfg.url);
      if (!host) continue;
      let label = name;
      try { label = (typeof SidebarManager.panelLabel === 'function' && SidebarManager.panelLabel(name)) || name; } catch { label = name; }
      out.push({ name, host, label });
    }
    return out;
  },

  // -> { mode: 'panel', panel, label, why } | null
  decide(url) {
    const host = this.hostOf(url);
    if (!host || !/^https?:/i.test(String(url))) return null;
    const panels = this.panels();
    // The most specific rule wins: a rule for a.example.com over one for example.com.
    const rule = this.rules().filter(r => host === r.host || host.endsWith('.' + r.host)).sort((a, b) => b.host.length - a.host.length)[0];
    if (rule) {
      if (rule.mode === 'tab') return null;
      const p = panels.find(x => x.name === rule.panel);
      if (!p) return null;      // the panel was removed: the link opens as a tab, as before
      return { mode: 'panel', panel: p.name, label: p.label, why: 'your rule for ' + rule.host };
    }
    const p = panels.find(x => x.host === host);
    return p ? { mode: 'panel', panel: p.name, label: p.label, why: 'the ' + p.label + ' panel is already on ' + host } : null;
  },

  // ---- the hook ---------------------------------------------------------------------------
  // Called where a link is about to become a tab. -> true when it took the link (the
  // caller must NOT make the tab); false: carry on as before.
  //   tab: the tab the link came from (null for a link from another program)
  intercept(url, tab, { disposition } = {}) {
    if (!this.enabled()) return false;
    if (disposition && disposition !== 'foreground-tab' && disposition !== 'default') return false;
    if (tab && tab.partition && tab.partition !== 'persist:main') return false;
    const dest = this.decide(url);
    if (!dest) return false;
    if (tab && tab.url && this.hostOf(tab.url) === this.hostOf(url)) return false;
    this._open(url, dest).catch((err) => this._failed(url, dest, err));
    return true;
  },

  _failed(url, dest, err) {
    this._note('Could not open ' + url + ' in the ' + dest.label + ' panel', err);
    window.showToast?.('Could not open that link in the ' + dest.label + ' panel (' + ((err && err.message) || 'unknown') + '), so it opened as a tab', 'error');
    this._asTab(url);
  },
  _asTab(url) {
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    return TabManager.createTab(url, true);
  },

  async _open(url, dest) {
    if (typeof SidebarManager === 'undefined') throw new Error('Panels are not available');
    SidebarManager.showPanel(dest.panel);
    const deadline = Date.now() + this.WAIT_PANEL_MS;
    let wv = SidebarManager.panelWebviews && SidebarManager.panelWebviews[dest.panel];
    while (!wv && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
      wv = SidebarManager.panelWebviews && SidebarManager.panelWebviews[dest.panel];
    }
    if (!wv) throw new Error('the panel did not open');
    const before = (() => { try { return wv.getURL(); } catch { return ''; } })();
    try { await Promise.resolve(wv.loadURL(url)); }
    catch (err) { if (!/ERR_ABORTED|\(-3\)/.test(String((err && err.message) || err))) throw err; }
    this._said(url, dest, before);
  },

  // ---- saying why, and undoing -------------------------------------------------------------
  _told() { return Number(localStorage.getItem(this.KEYS.told)) || 0; },
  _said(url, dest, before) {
    const host = this.hostOf(url);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.record({
        feature: 'link-routing', what: 'Opened a link to ' + host + ' in the ' + dest.label + ' panel', why: 'It would have been another tab of ' + host + '; ' + dest.why,
        undo: { kind: 'link-routing-tab', url, panel: dest.panel, before },
      });
    }
    const n = this._told();
    if (n >= this.TELL_FIRST) return;
    localStorage.setItem(this.KEYS.told, String(n + 1));
    const show = () => window.showToast?.('Opened in the ' + dest.label + ' panel because ' + dest.why + '.', 'info', 9000, { actions: [
      { label: 'Open as a tab instead', title: 'Put this link in a tab', run: () => { try { this._asTab(url); } catch (err) { this._note('Could not open the link as a tab', err); window.showToast?.(err.message, 'error'); } } },
      { label: 'Always a tab for ' + host, title: 'Add a rule for this site', run: () => { try { this.setRule(host, { mode: 'tab' }); this._asTab(url); window.showToast?.(host + ' will open as a tab'); } catch (err) { this._note('Could not save the rule', err); window.showToast?.(err.message, 'error'); } } },
    ] });
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: 'link-routing', urgency: 'asked', id: host }, show);
    else show();
  },

  // ---- Settings ------------------------------------------------------------------------------
  group(section) {
    const el = document.createElement('div');
    section.appendChild(el);
    const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    const draw = () => {
      el.textContent = '';
      const intro = mk('p', 'setting-info muted', 'A link that would open as a new tab goes to the panel that already has the site, when there is one. Ctrl+click always makes a tab, and so does a link from inside the same site.');
      el.appendChild(intro);
      const row = mk('div', 'setting-toggle-row');
      row.appendChild(mk('span', null, 'Open links in the matching panel'));
      const sw = document.createElement('label');
      sw.className = 'toggle';
      sw.innerHTML = '<input type="checkbox" aria-label="Open links in the matching panel"><span class="toggle-slider"></span>';
      const box = sw.querySelector('input');
      box.checked = this.enabled();
      box.addEventListener('change', () => { try { this.setEnabled(box.checked); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
      row.appendChild(sw);
      el.appendChild(row);
      const panels = this.panels();
      el.appendChild(mk('p', 'setting-info muted', panels.length
        ? 'Panels that can take links: ' + panels.map(p => p.label + ' (' + p.host + ')').join(', ') + '.'
        : 'No panel has a web address yet.'));
      let rules = [];
      try { rules = this.rules(); } catch (err) { el.appendChild(mk('p', 'setting-info muted', err.message)); }
      for (const r of rules) {
        const line = mk('div', 'setting-toggle-row');
        const p = panels.find(x => x.name === r.panel);
        line.appendChild(mk('span', null, r.host + ' → ' + (r.mode === 'tab' ? 'always a tab' : (p ? p.label + ' panel' : r.panel + ' (panel missing)'))));
        const rm = mk('button', 'btn-secondary', 'Remove');
        rm.type = 'button';
        rm.addEventListener('click', () => { try { this.removeRule(r.host); } catch (err) { window.showToast?.(err.message, 'error'); } draw(); });
        line.appendChild(rm);
        el.appendChild(line);
      }
      const add = mk('div', 'setting-toggle-row');
      const host = mk('input'); host.type = 'text'; host.placeholder = 'github.com'; host.setAttribute('aria-label', 'Site for a new rule'); host.className = 'setting-input';
      const dest = mk('select'); dest.setAttribute('aria-label', 'Where its links open');
      for (const [value, label] of [['tab', 'Always a tab'], ...panels.map(p => [p.name, p.label + ' panel'])]) { const o = mk('option', null, label); o.value = value; dest.appendChild(o); }
      const go = mk('button', 'btn-secondary', 'Add rule'); go.type = 'button';
      go.addEventListener('click', () => {
        try { this.setRule(host.value, dest.value === 'tab' ? { mode: 'tab' } : { mode: 'panel', panel: dest.value }); draw(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      });
      add.append(host, dest, go);
      el.appendChild(add);
    };
    draw();
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      // Undo: close nothing, just open the same link as a tab (what it would have been).
      VexLedger.registerUndo('link-routing-tab', async (token) => { this._asTab(token.url); });
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.LinkRouting = LinkRouting;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'link-routing', title: 'Links and panels',
      keywords: 'link routing open panel tab github claude discord rule new tab target blank',
      before: 'about',
      build: (el) => LinkRouting.group(el),
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'link-routing', label: 'Links and panels', hint: 'Open links in the panel that already has the site, and the rules for it', icon: 'link', action: () => { if (typeof SettingsUI !== 'undefined') SettingsUI.openSection('vex-sg-link-routing'); } });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => LinkRouting.init());
    else LinkRouting.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { LinkRouting };
