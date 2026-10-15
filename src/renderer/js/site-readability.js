// === Per-site readability tuner ===
//
// A font size, a text contrast and a content width that Vex remembers for each
// site and applies by itself every time that site loads. The site in front is
// tuned from Ctrl+K › "Readability for this site"; every tuned site is listed
// in Settings › Reading, where it can be reset.
//
// How it is applied (all through insertCSS, so nothing of the page's own
// JavaScript is needed or touched):
//   font size   html{font-size:N%} — scales everything written in rem/em — and
//               running text (paragraphs, list items, quotes) is set to 1rem so
//               a site that writes px sizes follows too. Menus, headers,
//               footers and sidebars keep the site's own sizes.
//   contrast    filter:contrast() on those same running-text elements only.
//               Never on <html>: the colour-vision filter and force-dark own
//               that, and a filter there would also move fixed elements.
//   width       max-width on <body>, centred.
//
// Stored under 'vex.siteReadability' as { "host": { font, contrast, width } }.
// Not part of Vex Sync (a screen-dependent choice, like the interface size).
// A private window or a Tor tab never writes a site into the list.

const SiteReadability = {
  KEY: 'vex.siteReadability',
  FONT: { min: 70, max: 250, def: 100, step: 5 },
  CONTRAST: { min: 100, max: 200, def: 100, step: 5 },
  WIDTH: { min: 400, max: 1600, def: 0, step: 20 },   // 0 = the site's own width

  // Running text: not in navigation, headers, footers or sidebars.
  TEXT: 'body :where(p,li,dd,blockquote,figcaption):not(:where(nav,header,footer,aside,[role=navigation],[role=banner],[role=complementary]) *)',

  _clamp(n, r) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return r.def;
    if (r.def === 0 && v === 0) return 0;
    return Math.min(r.max, Math.max(r.min, v));
  },

  // Whatever was stored or typed → { font, contrast, width }, or null when it
  // changes nothing (a site at its defaults is not a tuned site).
  normalize(cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    const out = {
      font: this._clamp(cfg.font == null ? this.FONT.def : cfg.font, this.FONT),
      contrast: this._clamp(cfg.contrast == null ? this.CONTRAST.def : cfg.contrast, this.CONTRAST),
      width: this._clamp(cfg.width == null ? this.WIDTH.def : cfg.width, this.WIDTH),
    };
    if (out.font === this.FONT.def && out.contrast === this.CONTRAST.def && out.width === this.WIDTH.def) return null;
    return out;
  },

  // The stylesheet for one site's settings ('' when there are none).
  buildCss(cfg) {
    const c = this.normalize(cfg);
    if (!c) return '';
    const parts = [];
    if (c.font !== this.FONT.def) {
      parts.push(`html{font-size:${c.font}% !important}`);
      parts.push(`${this.TEXT}{font-size:1rem !important;line-height:1.5 !important}`);
    }
    if (c.contrast !== this.CONTRAST.def) {
      parts.push(`${this.TEXT}{filter:contrast(${c.contrast}%) !important;text-shadow:none !important}`);
    }
    if (c.width !== this.WIDTH.def) {
      parts.push(`html body{max-width:${c.width}px !important;margin-left:auto !important;margin-right:auto !important}`);
    }
    return parts.join('\n');
  },

  // --- storage ----------------------------------------------------------
  _bare(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); },
  hostOf(url) { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? this._bare(u.hostname) : ''; } catch { return ''; } },

  all() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch { return {}; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [host, cfg] of Object.entries(raw)) {
      const n = this.normalize(cfg);
      if (n && /^[a-z0-9.-]{1,253}$/.test(host)) out[host] = n;
    }
    return out;
  },
  get(host) { return this.all()[this._bare(host)] || null; },

  // Presets that installed Vex Packs offer (js/packs-consumers.js): in memory
  // only, never in the person's own list, and the person's own choice wins.
  _pack: new Map(),
  setPackPresets(list) {
    const m = new Map();
    for (const p of Array.isArray(list) ? list : []) {
      const h = this._bare(p && p.host);
      const n = h ? this.normalize({ font: p.font, contrast: p.contrast, width: p.width }) : null;
      if (n && /^[a-z0-9.-]{1,253}$/.test(h) && !m.has(h)) m.set(h, n);
    }
    this._pack = m;
    return m.size;
  },

  _save(map) {
    try { localStorage.setItem(this.KEY, JSON.stringify(map)); }
    catch (err) { throw new Error('The readability choice could not be saved: ' + ((err && err.message) || err)); }
  },

  // Remember (or, when it is all defaults, forget) one site.
  set(host, cfg) {
    const h = this._bare(host);
    if (!h) throw new Error('That is not a web page');
    const map = this.all();
    const n = this.normalize(cfg);
    if (n) map[h] = n; else delete map[h];
    this._save(map);
    return n;
  },
  clear(host) { return this.set(host, null); },

  // --- applying ---------------------------------------------------------
  // The same chain-per-webview pattern Boosts uses: the previous sheet comes
  // out first, quick writes stay in order, a failure is logged and not hidden.
  _write(webview, css) {
    if (typeof webview.insertCSS !== 'function') throw new Error('This page cannot take a stylesheet');
    const run = async () => {
      const old = webview._vexReadabilityKey;
      webview._vexReadabilityKey = null;
      // A navigation already dropped the old sheet; removing a key that is gone
      // may be refused, which must not stop the new sheet going in.
      if (old && typeof webview.removeInsertedCSS === 'function') {
        try { await webview.removeInsertedCSS(old); } catch { /* already gone with the old page */ }
      }
      if (css) webview._vexReadabilityKey = await webview.insertCSS(css);
    };
    webview._vexReadabilityChain = (webview._vexReadabilityChain || Promise.resolve())
      .then(run)
      .catch(err => console.error('[Readability] could not apply the stylesheet:', err && err.message));
    return webview._vexReadabilityChain;
  },

  applyTo(webview, url) {
    if (!webview) return false;
    const host = this.hostOf(url);
    // A pack preset is not the person's own choice: it is never applied in a
    // private window or a Tor / routed tab (the guard that stops remembering).
    const cfg = host ? (this.get(host) || (this.canRemember(webview) ? this._pack.get(host) : null) || null) : null;
    // A site with nothing set still clears what an earlier page left behind.
    if (!cfg && !webview._vexReadabilityKey) return false;
    this._write(webview, cfg ? this.buildCss(cfg) : '');
    return !!cfg;
  },

  refreshHost(host) {
    const h = this._bare(host);
    if (!h || typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return 0;
    let n = 0;
    for (const tab of (TabManager.tabs || [])) {
      if (this.hostOf(tab.url) !== h) continue;
      const wv = WebviewManager.webviews && WebviewManager.webviews.get(tab.id);
      if (!wv) continue;
      try { this.applyTo(wv, tab.url); n++; } catch (err) { console.error('[Readability] refresh failed:', err); }
    }
    return n;
  },

  // Every open tab again (a pack's presets came or went).
  refreshAll() {
    if (typeof TabManager === 'undefined') return 0;
    const hosts = new Set((TabManager.tabs || []).map(t => this.hostOf(t.url)).filter(Boolean));
    let n = 0;
    for (const h of hosts) n += this.refreshHost(h);
    return n;
  },

  // A private window or a Tor / routed tab keeps no list of sites.
  canRemember(webview) {
    const p = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    if (!p) return true;
    if (p.isPrivateWindow) return false;
    return !webview || p.canFillWebview(webview);
  },

  // --- the dialog -------------------------------------------------------
  open() {
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const host = tab ? this.hostOf(tab.url) : '';
    if (!host) { window.showToast?.('Open a web page first'); return null; }
    const wv = typeof WebviewManager !== 'undefined' && WebviewManager.webviews ? WebviewManager.webviews.get(tab.id) : null;
    const remember = this.canRemember(wv);
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    document.getElementById('vex-readability')?.remove();
    const cur = this.get(host) || { font: this.FONT.def, contrast: this.CONTRAST.def, width: this.WIDTH.def };
    const m = document.createElement('div');
    m.id = 'vex-readability';
    m.style.cssText = 'position:fixed;inset:0;z-index:100052;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center';
    const row = (id, label, r, val) => `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text);margin-bottom:4px">
          <label for="${id}">${label}</label><output id="${id}-out" style="color:var(--text-muted)"></output>
        </div>
        <input id="${id}" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${val}" style="width:100%">
      </div>`;
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Readability for ${esc(host)}" style="width:380px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,0.5));padding:18px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">Readability</span>
        <button id="rd-close" type="button" aria-label="Close" title="Close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;line-height:0">${VexIcons.svg('x', { size: 14 })}</button>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;word-break:break-all">${esc(host)} — remembered for this site and applied every time it loads.</div>
      ${row('rd-font', 'Text size', this.FONT, cur.font)}
      ${row('rd-contrast', 'Text contrast', this.CONTRAST, cur.contrast)}
      ${row('rd-width', 'Content width', this.WIDTH, cur.width)}
      ${remember ? '' : '<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:12px">This is a private or Tor tab, so the choice applies only while this page is open and is not remembered.</div>'}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="rd-reset" type="button" class="btn-secondary" style="padding:8px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px">Reset this site</button>
        <button id="rd-done" type="button" class="btn-primary" style="padding:8px 14px;background:var(--primary,var(--accent));color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600">Done</button>
      </div>
    </div>`;
    document.body.appendChild(m);

    const q = (id) => m.querySelector('#' + id);
    const read = () => ({ font: Number(q('rd-font').value), contrast: Number(q('rd-contrast').value), width: Number(q('rd-width').value) });
    const label = () => {
      const c = read();
      q('rd-font-out').textContent = c.font + '%';
      q('rd-contrast-out').textContent = c.contrast + '%';
      q('rd-width-out').textContent = c.width === 0 ? 'the site’s own' : c.width + ' px';
    };
    const apply = () => {
      label();
      const c = read();
      try {
        if (remember) this.set(host, c);
        if (wv) this._write(wv, this.buildCss(c));
        if (remember) this.refreshHost(host);
      } catch (err) { window.showToast?.(err.message, 'error'); }
    };
    ['rd-font', 'rd-contrast', 'rd-width'].forEach(id => q(id).addEventListener('input', apply));
    q('rd-reset').addEventListener('click', () => {
      q('rd-font').value = this.FONT.def; q('rd-contrast').value = this.CONTRAST.def; q('rd-width').value = this.WIDTH.def;
      apply();
    });
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { e.preventDefault(); close(); }
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    q('rd-close').addEventListener('click', close);
    q('rd-done').addEventListener('click', close);
    label();
    setTimeout(() => q('rd-font').focus(), 30);
    return m;
  },

  // --- Settings › Reading -------------------------------------------------
  describe(cfg) {
    const bits = [];
    if (cfg.font !== this.FONT.def) bits.push('text ' + cfg.font + '%');
    if (cfg.contrast !== this.CONTRAST.def) bits.push('contrast ' + cfg.contrast + '%');
    if (cfg.width !== this.WIDTH.def) bits.push('width ' + cfg.width + ' px');
    return bits.join(' · ');
  },

  renderSettings(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const sites = Object.entries(this.all()).sort((a, b) => a[0].localeCompare(b[0]));
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">A text size, contrast and content width remembered for each site and applied when it loads. Set the site in front from Ctrl+K › Readability for this site.</p>
      ${sites.length ? sites.map(([host, cfg]) => `
        <div class="site-settings-row" data-host="${esc(host)}">
          <div class="site-settings-info">
            <div class="site-settings-host">${esc(host)}</div>
            <div class="site-settings-what">${esc(this.describe(cfg))}</div>
          </div>
          <button type="button" class="btn-secondary-sm" data-act="reset">Reset</button>
        </div>`).join('') : '<div class="muted" style="font-size:12px">No site has its own readability yet.</div>'}`;
    container.querySelectorAll('[data-act="reset"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const host = btn.closest('[data-host]').dataset.host;
        try { this.clear(host); this.refreshHost(host); } catch (err) { window.showToast?.(err.message, 'error'); return; }
        this.renderSettings(container);
      });
    });
  },

  init() {
    const apply = (e) => {
      const id = e && e.detail && e.detail.tabId;
      if (!id || typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return;
      const tab = (TabManager.tabs || []).find(t => t.id === id);
      const wv = WebviewManager.webviews && WebviewManager.webviews.get(id);
      if (!tab || !wv) return;
      try { this.applyTo(wv, (e.detail && e.detail.url) || tab.url); }
      catch (err) { console.error('[Readability]', err); }
    };
    document.addEventListener('vex:tab-settled', apply);
    document.addEventListener('vex:tab-navigated', apply);
    if (window.VexSettingsGroups) {
      VexSettingsGroups.register({ id: 'site-readability', title: 'Reading — readability per site', render: (c) => this.renderSettings(c) });
    }
    if (window.VexModuleCommands) {
      VexModuleCommands.set('readability:', [{
        id: 'readability:tune', label: 'Readability for this site', hint: 'Text size, contrast and content width, remembered for this site',
        icon: 'type', action: () => { try { this.open(); } catch (err) { window.showToast?.('Could not open: ' + ((err && err.message) || err), 'error'); } },
      }]);
    }
  },
};

if (typeof window !== 'undefined') {
  window.SiteReadability = SiteReadability;
  if (typeof document !== 'undefined' && document.getElementById) SiteReadability.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { SiteReadability };
