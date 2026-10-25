// === Dark mode for websites (Settings > Appearance) =========================
//
// One file, two readers. The pure rules (which page gets dark mode, and with
// what look) are read by Vex's main process too (require), which answers a
// page's own question while it loads (src/main.js 'darkmode:page'); the rest
// is the window's: the Settings rows, the per-site toggle of the page menu, the
// Preview, and handing a changed decision to the tab that is open.
//
// The work itself is src/dark-mode-preload.js, a preload that runs in the
// page before its first paint. Two engines: "smart" (rewrites the page's
// colours; photos, video and canvas are left alone) and "simple" (the old
// invert-the-page filter, kept as a fallback).
//
//   vex.darkMode.mode        'off' | 'site' | 'all'      (unset: 'site', as before)
//   vex.darkMode.engine      'smart' | 'simple'
//   vex.darkMode.look        {"brightness":100,"contrast":100,"sepia":0}
//   vex.darkMode.keepImages  'false' to dim pictures too (unset: kept as they are)
//   vex.darkMode.neverHosts  hosts left light in 'all' mode
//   vex.darkMode.readerDefer 'false' to run beside Dark Reader (unset: it is left in charge)
//   vex.forceDarkHosts       hosts that are dark in 'site' mode (the list the page menu always kept)
//   vex.forceDarkSites       'true': the retired everywhere flag, read as 'all' while no mode is saved
const VexDarkMode = {
  KEYS: {
    mode: 'vex.darkMode.mode',
    engine: 'vex.darkMode.engine',
    look: 'vex.darkMode.look',
    keepImages: 'vex.darkMode.keepImages',
    never: 'vex.darkMode.neverHosts',
    readerDefer: 'vex.darkMode.readerDefer',
    hosts: 'vex.forceDarkHosts',
    legacyAll: 'vex.forceDarkSites',
  },
  MODES: ['off', 'site', 'all'],
  ENGINES: ['smart', 'simple'],
  LOOK: { brightness: { min: 50, max: 150, def: 100 }, contrast: { min: 50, max: 150, def: 100 }, sepia: { min: 0, max: 100, def: 0 } },
  MAX_HOSTS: 500,

  // --- the rules (pure) -----------------------------------------------------
  rawKeys() { return Object.values(this.KEYS); },

  hostOf(url) {
    let u;
    try { u = new URL(url); } catch (err) { return ''; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.replace(/^www\./, '');
  },

  _list(text) {
    if (text == null || text === '') return [];
    let a;
    try { a = JSON.parse(text); } catch (err) { return []; } // a damaged list names no site rather than every site
    return Array.isArray(a) ? a.filter(h => typeof h === 'string' && h.length > 0 && h.length < 254).slice(0, this.MAX_HOSTS) : [];
  },
  _clamp(v, spec) {
    const n = Number(v);
    if (!Number.isFinite(n)) return spec.def;
    return Math.min(spec.max, Math.max(spec.min, Math.round(n)));
  },
  // `raw` maps each key to the text it is stored as (or null).
  parse(raw) {
    raw = raw || {};
    const K = this.KEYS;
    let mode = raw[K.mode];
    if (!this.MODES.includes(mode)) mode = raw[K.legacyAll] === 'true' ? 'all' : 'site';
    let look = {};
    try { look = JSON.parse(raw[K.look] || '{}') || {}; } catch (err) { look = {}; }
    return {
      mode,
      engine: this.ENGINES.includes(raw[K.engine]) ? raw[K.engine] : 'smart',
      look: {
        brightness: this._clamp(look.brightness, this.LOOK.brightness),
        contrast: this._clamp(look.contrast, this.LOOK.contrast),
        sepia: this._clamp(look.sepia, this.LOOK.sepia),
      },
      keepImages: raw[K.keepImages] !== 'false',
      readerDefer: raw[K.readerDefer] !== 'false',
      hosts: new Set(this._list(raw[K.hosts])),
      never: new Set(this._list(raw[K.never])),
    };
  },

  // ctx: { tor, darkReader, force } — force true is the Preview (on whatever
  // the lists say), false is off.
  decide(raw, url, ctx) {
    ctx = ctx || {};
    const s = this.parse(raw);
    const out = { on: false, reason: '', mode: s.mode, engine: s.engine, look: s.look, keepImages: s.keepImages, invertLogos: s.keepImages };
    const host = this.hostOf(url);
    if (!host) { out.reason = 'not-web'; return out; }
    if (ctx.tor) { out.reason = 'tor'; return out; }
    if (ctx.force === false) { out.reason = 'forced-off'; return out; }
    if (ctx.darkReader && s.readerDefer) { out.reason = 'dark-reader'; return out; }
    if (ctx.force === true) { out.on = true; out.reason = 'preview'; return out; }
    if (s.mode === 'off') { out.reason = 'mode-off'; return out; }
    if (s.mode === 'site') { out.on = s.hosts.has(host); out.reason = out.on ? 'site' : 'not-listed'; return out; }
    out.on = !s.never.has(host);
    out.reason = out.on ? 'all' : 'excepted';
    return out;
  },

  // --- the window ------------------------------------------------------------
  _previewTimer: 0,
  _previewing: null,

  raw() {
    const out = {};
    for (const key of this.rawKeys()) {
      let v = null;
      try { v = localStorage.getItem(key); } catch (err) { console.error('[Dark mode] could not read ' + key + ':', err.message); }
      out[key] = v;
    }
    return out;
  },
  settings() { return this.parse(this.raw()); },
  _save(key, value) {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  },
  _saveList(key, set) { this._save(key, JSON.stringify([...set].sort())); },

  // Does this address get dark mode, by the lists alone (the page menu's label)?
  isOnFor(url) { return this.decide(this.raw(), url).on; },

  _webviews() {
    return (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) ? [...WebviewManager.webviews.values()] : [];
  },
  _isPrivateWindow() { return !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },

  // Gives one tab the decision for the page it shows now. Main judges the Tor
  // and Dark Reader parts itself and answers with the decision it sent.
  pushTo(wv, ctx) {
    if (!window.vex || typeof window.vex.darkModeApply !== 'function') return Promise.reject(new Error('Dark mode cannot be changed from here'));
    let id;
    try { id = wv.getWebContentsId(); } catch (err) { return Promise.resolve(null); } // not attached yet: its own load asks main
    return window.vex.darkModeApply(id, this.raw(), ctx || null).then((d) => {
      this._paintBase(wv, d);
      wv._forceDarkKey = d.on ? d.engine : null; // what the site reset and a site profile read: is this tab dark now
      return d;
    });
  },
  // The element behind the page, so a navigation shows dark, not white, until
  // the page paints.
  _paintBase(wv, decision) {
    if (!wv || !wv.style) return;
    if (decision && decision.on) {
      if (wv.dataset.vexDmBg === undefined) wv.dataset.vexDmBg = wv.style.background || '';
      wv.style.background = decision.base || '#1a1d1e';
    } else if (wv.dataset.vexDmBg !== undefined) {
      wv.style.background = wv.dataset.vexDmBg;
      delete wv.dataset.vexDmBg;
    }
  },
  // A navigation is starting: paint the backdrop for the page it is going to.
  onNavigate(wv, url) {
    try {
      const d = this.decide(this.raw(), url);
      this._paintBase(wv, d.on ? { on: true, base: '#1a1d1e' } : { on: false });
    } catch (err) { console.error('[Dark mode] backdrop:', err.message); }
  },
  refreshAll(ctx) {
    const jobs = this._webviews().map(wv => this.pushTo(wv, ctx).catch(err => console.error('[Dark mode] could not update a tab:', err && err.message)));
    return Promise.all(jobs);
  },

  // The page menu: dark mode for this site, on or off, in whichever mode.
  toggleSite(wv) {
    const url = wv.getURL();
    const host = this.hostOf(url);
    if (!host) { window.showToast?.('Open a page first'); return false; }
    const s = this.settings();
    let on;
    if (s.mode === 'all') {
      on = s.never.has(host);
      if (on) s.never.delete(host); else s.never.add(host);
      this._saveList(this.KEYS.never, s.never);
    } else {
      // Off, or per site: asking for this site turns it on for this site.
      if (s.mode === 'off') this._save(this.KEYS.mode, 'site');
      on = !(s.mode !== 'off' && s.hosts.has(host));
      if (on) s.hosts.add(host); else s.hosts.delete(host);
      this._saveList(this.KEYS.hosts, s.hosts);
    }
    window.showToast?.(on ? `Dark mode on — ${host}` : `Dark mode off — ${host}`);
    this.pushTo(wv).catch(err => window.showToast?.('Could not change dark mode: ' + err.message, 'error'));
    this._changed();
    this._redraw();
    return on;
  },

  _changed() {
    document.dispatchEvent(new CustomEvent('vex:dark-mode-changed'));
  },
  // The Settings rows follow a change made from the page menu.
  _redraw() {
    const h = typeof document !== 'undefined' && document.getElementById('dark-mode-websites-setting');
    if (h) this.renderSettings(h);
  },

  // --- Preview ---------------------------------------------------------------
  startPreview() {
    const wv = (typeof WebviewManager !== 'undefined') && WebviewManager.getActiveWebview();
    if (!wv || !this.hostOf(wv.getURL())) { window.showToast?.('Open a page first'); return false; }
    this.stopPreview(true);
    this._previewing = wv;
    this.pushTo(wv, { force: true }).catch(err => window.showToast?.('Could not preview dark mode: ' + err.message, 'error'));
    this._previewTimer = setTimeout(() => this.stopPreview(), 30000);
    return true;
  },
  stopPreview(quiet) {
    clearTimeout(this._previewTimer);
    const wv = this._previewing;
    this._previewing = null;
    if (wv && !quiet) this.pushTo(wv).catch(err => console.error('[Dark mode] could not end the preview:', err && err.message));
  },
  refreshPreview() {
    if (this._previewing) this.pushTo(this._previewing, { force: true }).catch(err => console.error('[Dark mode] preview:', err && err.message));
  },

  // --- Settings rows ---------------------------------------------------------
  _el(tag, attrs, children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') el.textContent = v; else if (k === 'class') el.className = v; else el.setAttribute(k, v);
    }
    for (const c of children || []) el.appendChild(c);
    return el;
  },
  _row(title, help, control) {
    const label = this._el('span', {}, [document.createTextNode(title)]);
    if (help) {
      label.appendChild(document.createElement('br'));
      label.appendChild(this._el('span', { style: 'font-size:11.5px;color:var(--text-muted)', text: help }));
    }
    return this._el('div', { class: 'setting-toggle-row' }, [label, control]);
  },
  _select(id, label, options, value, onChange) {
    const sel = this._el('select', { id, 'aria-label': label, style: "background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:var(--radius);font-family:'Outfit',sans-serif;font-size:13px" });
    for (const [v, text] of options) { const o = this._el('option', { value: v, text }); sel.appendChild(o); }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  },
  _toggle(id, label, checked, onChange) {
    const input = this._el('input', { type: 'checkbox', id, 'aria-label': label });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return this._el('label', { class: 'toggle' }, [input, this._el('span', { class: 'toggle-slider' })]);
  },
  _slider(id, label, spec, value, onInput) {
    const out = this._el('span', { style: 'min-width:42px;text-align:right;font-size:12px;color:var(--text-muted)', text: value + '%' });
    const input = this._el('input', { type: 'range', id, 'aria-label': label, min: String(spec.min), max: String(spec.max), step: '5', value: String(value), style: 'width:140px' });
    input.addEventListener('input', () => { out.textContent = input.value + '%'; onInput(Number(input.value)); });
    return this._el('span', { style: 'display:inline-flex;align-items:center;gap:8px' }, [input, out]);
  },
  _hostList(title, help, key, listId) {
    const s = this.settings();
    const set = key === this.KEYS.never ? s.never : s.hosts;
    const box = this._el('div', { id: listId, style: 'margin:6px 0 14px' });
    box.appendChild(this._el('div', { style: 'font-size:13px;margin-bottom:2px', text: title }));
    box.appendChild(this._el('div', { style: 'font-size:11.5px;color:var(--text-muted);margin-bottom:6px', text: help }));
    const list = this._el('div', {});
    const draw = () => {
      list.textContent = '';
      const cur = key === this.KEYS.never ? this.settings().never : this.settings().hosts;
      if (!cur.size) list.appendChild(this._el('div', { style: 'font-size:12px;color:var(--text-muted)', text: 'No site yet.' }));
      for (const host of [...cur].sort()) {
        const rm = this._el('button', { type: 'button', class: 'btn-secondary-sm', 'aria-label': 'Remove ' + host, text: 'Remove' });
        rm.addEventListener('click', () => {
          const next = key === this.KEYS.never ? this.settings().never : this.settings().hosts;
          next.delete(host);
          this._saveList(key, next);
          draw();
          this.refreshAll().then(() => this._changed());
        });
        list.appendChild(this._el('div', { class: 'site-settings-row', style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 0' }, [
          this._el('span', { class: 'site-settings-host', text: host }), rm]));
      }
    };
    const input = this._el('input', { type: 'text', 'aria-label': title, placeholder: 'example.com', style: 'flex:1;min-width:0;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:var(--radius);font-size:13px' });
    const add = this._el('button', { type: 'button', class: 'btn-secondary', text: 'Add' });
    const addHost = () => {
      const host = this.hostOf(/^[a-z]+:\/\//i.test(input.value.trim()) ? input.value.trim() : 'https://' + input.value.trim());
      if (!host) { window.showToast?.('That is not a site address', 'error'); return; }
      const next = key === this.KEYS.never ? this.settings().never : this.settings().hosts;
      if (next.size >= this.MAX_HOSTS) { window.showToast?.('The list is full', 'error'); return; }
      next.add(host);
      this._saveList(key, next);
      input.value = '';
      draw();
      this.refreshAll().then(() => this._changed());
    };
    add.addEventListener('click', addHost);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addHost(); } });
    box.appendChild(list);
    box.appendChild(this._el('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [input, add]));
    draw();
    return box;
  },

  renderSettings(host) {
    if (!host) return;
    host.textContent = '';
    const s = this.settings();
    const apply = () => { this.refreshAll().then(() => this.refreshPreview()); this._changed(); };
    const setLook = (name, value) => {
      const look = this.settings().look;
      look[name] = value;
      this._save(this.KEYS.look, JSON.stringify(look));
      apply();
    };
    host.appendChild(this._row('Dark mode for websites',
      'Turns light websites dark. Pages that are already dark, Vex’s own pages and the PDF viewer are left alone.',
      this._select('setting-dark-mode', 'Dark mode for websites', [['off', 'Off'], ['site', 'Per site'], ['all', 'All sites except the ones listed']], s.mode, (v) => { this._save(this.KEYS.mode, v); apply(); this.renderSettings(host); })));
    if (s.mode !== 'off') {
      host.appendChild(this._row('How it is done',
        'Smart changes the page’s colours and keeps photos as they are. Simple invert is the older filter that flips everything.',
        this._select('setting-dark-engine', 'How dark mode is done', [['smart', 'Smart'], ['simple', 'Simple invert']], s.engine, (v) => { this._save(this.KEYS.engine, v); apply(); })));
      host.appendChild(this._row('Brightness', '', this._slider('setting-dark-brightness', 'Brightness', this.LOOK.brightness, s.look.brightness, (v) => setLook('brightness', v))));
      host.appendChild(this._row('Contrast', '', this._slider('setting-dark-contrast', 'Contrast', this.LOOK.contrast, s.look.contrast, (v) => setLook('contrast', v))));
      host.appendChild(this._row('Sepia', '', this._slider('setting-dark-sepia', 'Sepia', this.LOOK.sepia, s.look.sepia, (v) => setLook('sepia', v))));
      host.appendChild(this._row('Keep images as they are',
        'Photos, video and pictures stay as the site made them. Off, they are dimmed a little too.',
        this._toggle('setting-dark-images', 'Keep images as they are', s.keepImages, (on) => { this._save(this.KEYS.keepImages, on ? null : 'false'); apply(); })));
      const status = this._el('span', { id: 'dark-reader-status', style: 'font-size:11.5px;color:var(--text-muted)', text: '' });
      host.appendChild(this._row('Leave Dark Reader in charge',
        'If the Dark Reader extension is installed and on, it keeps doing the job and Vex steps aside.',
        this._toggle('setting-dark-reader', 'Leave Dark Reader in charge', s.readerDefer, (on) => { this._save(this.KEYS.readerDefer, on ? null : 'false'); apply(); })));
      host.appendChild(status);
      if (window.vex && typeof window.vex.darkModeStatus === 'function') {
        window.vex.darkModeStatus().then((st) => {
          status.textContent = st && st.darkReader ? 'Dark Reader is installed and on.' : 'Dark Reader is not installed.';
        }, (err) => { console.error('[Dark mode] could not look for Dark Reader:', err && err.message); });
      }
      if (s.mode === 'site') host.appendChild(this._hostList('Dark on these sites', 'Dark mode is on for the sites below. The page menu adds and removes the site in front.', this.KEYS.hosts, 'dark-hosts'));
      if (s.mode === 'all') host.appendChild(this._hostList('Never dark on these sites', 'These sites stay as they are. The page menu adds and removes the site in front.', this.KEYS.never, 'dark-never'));
      const prev = this._el('button', { type: 'button', class: 'btn-secondary', id: 'dark-preview', text: 'Preview on this page' });
      prev.addEventListener('click', () => {
        if (this._previewing) { this.stopPreview(); prev.textContent = 'Preview on this page'; return; }
        if (this.startPreview()) prev.textContent = 'Stop preview';
      });
      host.appendChild(this._row('Preview', 'Shows the page in front with these settings for 30 seconds, without saving anything for the site.', prev));
    }
  },

  init() {
    this._redraw();
  },
};

if (typeof window !== 'undefined') {
  window.VexDarkMode = VexDarkMode;
  if (typeof document !== 'undefined' && document.getElementById) VexDarkMode.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDarkMode };
