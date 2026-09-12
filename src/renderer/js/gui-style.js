// === Vex GUI Style switcher (Classic, Glass, and the browser looks) =====
// A whole-UI look toggle. Classic = the current Vex (default, untouched).
// Glass = frosted-glass skin + the new layout (tabs ON TOP, with a Chrome-style
// shortcuts/speed-dial bar where the tabs used to be). All the visual work is in
// css/gui-glass.css under body[data-gui-style="glass"]; this module just toggles
// the attribute, forces the horizontal tab strip in Glass, and builds the
// shortcuts bar. Persisted in localStorage 'vex.guiStyle'. The browser looks
// (Chrome, Firefox, Safari, XP, 98) live in css/gui-browser.css.
(function () {
  const KEY = 'vex.guiStyle';
  let _prevTabLayout = null;

  // Every GUI style and how it lays the window out.
  //   layout  'vex' - Vex's own layout (sidebar rail, vertical tabs possible).
  //           'top' - tabs on top, toolbar, then the bookmarks/shortcuts bar.
  //   family  'browser' - the mainstream-browser looks in css/gui-browser.css,
  //           which share one base and differ only in their variant block.
  //   controls  which row holds minimise/maximise/close: 'tabs' (Chrome,
  //           Firefox) or 'toolbar' (Safari, whose tabs sit under the toolbar).
  //   startPage  the value the home page understands; it only knows its own
  //           looks, so the browser family asks it for 'classic'.
  //   sidebar  how that browser's own sidebar works (js/look-sidebar.js):
  //           side - which side of the page the panel docks on;
  //           launcher - 'toolbar' (a toolbar button + a panel picker in the
  //           panel's header: Chrome's side panel, Safari, IE's Explorer bar)
  //           or 'rail' (an icon strip always on screen: Firefox's sidebar,
  //           Netscape's).
  const STYLES = {
    classic:        { layout: 'vex' },
    glass:          { layout: 'top', controls: 'tabs', startPage: 'glass', sidebar: { side: 'left', launcher: 'rail' } },
    chrome:         { layout: 'top', family: 'browser', controls: 'tabs', sidebar: { side: 'right', launcher: 'toolbar' } },
    'chrome-dark':  { layout: 'top', family: 'browser', controls: 'tabs', sidebar: { side: 'right', launcher: 'toolbar' } },
    firefox:        { layout: 'top', family: 'browser', controls: 'tabs', sidebar: { side: 'left', launcher: 'rail' } },
    'firefox-dark': { layout: 'top', family: 'browser', controls: 'tabs', sidebar: { side: 'left', launcher: 'rail' } },
    safari:         { layout: 'top', family: 'browser', controls: 'toolbar', sidebar: { side: 'left', launcher: 'toolbar' } },
    xp:             { layout: 'top', family: 'browser', controls: 'tabs', sidebar: { side: 'left', launcher: 'toolbar' } },
    win98:          { layout: 'top', family: 'browser', controls: 'tabs', sidebar: { side: 'left', launcher: 'rail' } },
  };
  const isTopLayout = () => (STYLES[document.body.dataset.guiStyle] || {}).layout === 'top';
  const isBrowserLook = () => (STYLES[document.body.dataset.guiStyle] || {}).family === 'browser';

  // Where a browser look takes its colours from (body[data-gui-colors]):
  //   look  - its own palette (Chrome grey, XP blue...), the default
  //   theme - the active colour theme, so every theme recolours every look
  // Kept separately from the style, so switching looks keeps the choice.
  const COLORS_KEY = 'vex.guiColors';
  const COLOR_MODES = ['look', 'theme'];

  const DEFAULT_SHORTCUTS = [
    { name: 'Google', url: 'https://www.google.com' },
    { name: 'YouTube', url: 'https://www.youtube.com' },
    { name: 'Discord', url: 'https://discord.com/app' },
    { name: 'Spotify', url: 'https://open.spotify.com' },
    { name: 'Netflix', url: 'https://www.netflix.com' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'Reddit', url: 'https://www.reddit.com' },
    { name: 'X', url: 'https://x.com' },
  ];

  function loadShortcuts() {
    try {
      const sc = JSON.parse(localStorage.getItem('vex.shortcuts') || 'null');
      // A stored EMPTY array is an intentional "no shortcuts" (the Minimal
      // setup profile) — only a missing/invalid key falls back to defaults.
      if (Array.isArray(sc)) return sc.filter(s => s && s.url);
    } catch {}
    return DEFAULT_SHORTCUTS.map(s => ({ ...s }));
  }
  function saveShortcuts(arr) {
    try { localStorage.setItem('vex.shortcuts', JSON.stringify(arr)); } catch {}
    const b = document.getElementById('gui-shortcuts-bar'); if (b) renderBar(b);
  }

  // Fallback chip color from the hostname (used when a site has no favicon).
  function hostColor(url) {
    let h = 0, host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
    // Dark enough that the white letter on top always reads: at 45% a green or
    // yellow hue left the letter at 2.8:1.
    return `hsl(${h % 360}, 55%, 34%)`;
  }
  function labelFor(s) {
    if (s.name) return s.name;
    try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return s.url; }
  }
  function faviconUrl(url) {
    try { return 'https://' + encodeURIComponent(new URL(url).hostname) + '/favicon.ico'; } catch { return ''; }
  }
  function normalizeUrl(u) {
    u = String(u || '').trim();
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }
  function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function navigate(url) {
    try {
      if (window.WebviewManager && typeof WebviewManager.getActiveWebview === 'function') {
        const wv = WebviewManager.getActiveWebview();
        if (wv && typeof wv.loadURL === 'function') { wv.loadURL(url).catch(() => {}); return; }
      }
    } catch {}
    try {
      const i = document.getElementById('url-input');
      if (i) { i.value = url; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
    } catch {}
  }

  function renderBar(bar) {
    bar.innerHTML = '';
    loadShortcuts().slice(0, 24).forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'gsc';
      el.title = (s.name ? s.name + ' — ' : '') + s.url + '  (right-click to edit)';
      const ic = document.createElement('span');
      ic.className = 'ic';
      const letter = () => { ic.innerHTML = ''; ic.classList.remove('has-img'); ic.textContent = labelFor(s).slice(0, 1).toUpperCase(); ic.style.background = s.color || hostColor(s.url); };
      if (s.color) { letter(); }                       // custom color overrides the logo
      else {
        const fav = faviconUrl(s.url);
        if (fav) {
          ic.classList.add('has-img'); ic.style.background = 'transparent';
          const img = document.createElement('img'); img.src = fav; img.alt = '';
          img.addEventListener('error', letter);       // no favicon → letter chip
          ic.appendChild(img);
        } else letter();
      }
      const label = document.createElement('span');
      label.textContent = labelFor(s);
      el.appendChild(ic); el.appendChild(label);
      el.addEventListener('click', () => navigate(s.url));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); editShortcut(i); });
      bar.appendChild(el);
    });
    const add = document.createElement('div');
    add.className = 'gsc gsc-add';
    add.innerHTML = '<span class="ic"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span><span>Add shortcut</span>';
    add.addEventListener('click', () => editShortcut(-1));
    bar.appendChild(add);
  }

  function injectEditorStyles() {
    if (document.getElementById('gsc-editor-styles')) return;
    const st = document.createElement('style');
    st.id = 'gsc-editor-styles';
    st.textContent = `
      .gsc-ed-ov{position:fixed;inset:0;z-index:2147483500;display:flex;align-items:center;justify-content:center;background:rgba(8,10,14,0.72);backdrop-filter:blur(4px);font-family:inherit;}
      .gsc-ed{width:360px;max-width:92vw;background:var(--surface,#1b1b24);border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:16px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,0.6);color:var(--text,#e9e9ee);}
      .gsc-ed-title{font-size:16px;font-weight:700;margin-bottom:8px;}
      .gsc-ed label{display:block;font-size:11.5px;color:var(--text-muted,#9a9aa5);margin:12px 0 4px;}
      .gsc-ed input[type=text]{width:100%;background:var(--bg,#0e0e16);border:1px solid var(--border,rgba(255,255,255,0.14));color:var(--text,#e9e9ee);border-radius:9px;padding:9px 11px;font-size:13px;font-family:inherit;}
      .gsc-ed-colors{display:flex;align-items:center;gap:10px;}
      .gsc-ed-color{width:46px;height:32px;background:none;border:1px solid var(--border,rgba(255,255,255,0.18));border-radius:8px;cursor:pointer;padding:2px;}
      .gsc-ed-clearcolor{background:transparent;border:1px solid var(--border,rgba(255,255,255,0.18));color:var(--text-muted,#9a9aa5);border-radius:8px;padding:7px 11px;font-size:12px;cursor:pointer;font-family:inherit;}
      .gsc-ed-row{display:flex;align-items:center;gap:8px;margin-top:18px;}
      .gsc-ed-row button{border:1px solid var(--border,rgba(255,255,255,0.18));background:transparent;color:var(--text,#e9e9ee);border-radius:9px;padding:8px 14px;font-size:13px;cursor:pointer;font-family:inherit;}
      .gsc-ed-save{background:var(--primary,#6366f1)!important;border-color:transparent!important;color:#fff!important;font-weight:600;}
      .gsc-ed-del{color:#e0556a!important;border-color:rgba(224,85,106,0.4)!important;}
    `;
    document.head.appendChild(st);
  }

  function editShortcut(index) {
    injectEditorStyles();
    const arr = loadShortcuts();
    const isNew = index < 0;
    const cur = isNew ? { name: '', url: '', color: '' } : Object.assign({ name: '', url: '', color: '' }, arr[index]);
    document.querySelectorAll('.gsc-ed-ov').forEach(e => e.remove());
    const ov = document.createElement('div');
    ov.className = 'gsc-ed-ov';
    ov.innerHTML = `<div class="gsc-ed">
        <div class="gsc-ed-title">${isNew ? 'Add shortcut' : 'Edit shortcut'}</div>
        <label>Name</label>
        <input class="gsc-ed-name" type="text" value="${escAttr(cur.name)}" placeholder="e.g. Reddit">
        <label>Link (URL)</label>
        <input class="gsc-ed-url" type="text" value="${escAttr(cur.url)}" placeholder="https://www.reddit.com">
        <label>Color <span style="opacity:.6">— optional, overrides the logo</span></label>
        <div class="gsc-ed-colors">
          <input class="gsc-ed-color" type="color" value="${/^#[0-9a-f]{6}$/i.test(cur.color) ? cur.color : '#6366f1'}">
          <button class="gsc-ed-clearcolor" type="button">Use logo instead</button>
        </div>
        <div class="gsc-ed-row">
          ${isNew ? '' : '<button class="gsc-ed-del">Delete</button>'}
          <span style="flex:1"></span>
          <button class="gsc-ed-cancel">Cancel</button>
          <button class="gsc-ed-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    let useColor = !!cur.color;
    const colorInput = ov.querySelector('.gsc-ed-color');
    colorInput.addEventListener('input', () => { useColor = true; });
    ov.querySelector('.gsc-ed-clearcolor').addEventListener('click', () => { useColor = false; try { window.showToast?.('Will use the site logo'); } catch {} });
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('.gsc-ed-cancel').addEventListener('click', close);
    const del = ov.querySelector('.gsc-ed-del');
    if (del) del.addEventListener('click', () => { arr.splice(index, 1); saveShortcuts(arr); close(); });
    ov.querySelector('.gsc-ed-save').addEventListener('click', () => {
      const name = ov.querySelector('.gsc-ed-name').value.trim();
      const url = normalizeUrl(ov.querySelector('.gsc-ed-url').value);
      if (!url) { try { window.showToast?.('Enter a link', 'error'); } catch {} return; }
      const entry = { url, name, color: useColor ? colorInput.value : '' };
      if (isNew) arr.push(entry); else arr[index] = entry;
      saveShortcuts(arr); close();
    });
    setTimeout(() => { try { ov.querySelector('.gsc-ed-name').focus(); } catch {} }, 50);
  }

  function buildBar() {
    let bar = document.getElementById('gui-shortcuts-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'gui-shortcuts-bar';
      const top = document.getElementById('top-bar');
      if (top && top.parentNode) top.parentNode.insertBefore(bar, top.nextSibling);
      else document.body.appendChild(bar);
    }
    renderBar(bar);
    return bar;
  }

  // In Glass the tabs are on top, so the window controls (min/max/close) belong
  // on the tab-bar row (top-right) like Chrome — not buried on the toolbar row.
  function moveWindowControls(toGlass) {
    try {
      const wc = document.getElementById('window-controls');
      if (!wc) return;
      if (toGlass) {
        const trailing = document.querySelector('#top-tab-bar .tab-bar-trailing');
        if (trailing && wc.parentElement !== trailing) trailing.appendChild(wc);
      } else {
        const home = document.getElementById('top-bar-right');
        if (home && wc.parentElement !== home) home.appendChild(wc);
      }
    } catch {}
  }

  async function apply(style) {
    if (!STYLES[style]) style = 'classic';
    const def = STYLES[style];
    if (def.layout === 'top') {
      try {
        const cur = document.body.dataset.tabLayout || 'horizontal';
        if (cur !== 'horizontal') { _prevTabLayout = cur; document.body.dataset.tabLayout = 'horizontal'; }
      } catch {}
      buildBar();
      document.body.dataset.guiStyle = style;
      if (def.family) document.body.dataset.guiFamily = def.family;
      else document.body.removeAttribute('data-gui-family');
      if (def.sidebar) {
        document.body.dataset.sbSide = def.sidebar.side;
        document.body.dataset.sbLauncher = def.sidebar.launcher;
      } else {
        document.body.removeAttribute('data-sb-side');
        document.body.removeAttribute('data-sb-launcher');
      }
      try { window.HorizontalTabs?.render?.(); } catch {}
      moveWindowControls(def.controls === 'tabs');
    } else {
      document.body.removeAttribute('data-gui-style');
      document.body.removeAttribute('data-gui-family');
      document.body.removeAttribute('data-sb-side');
      document.body.removeAttribute('data-sb-launcher');
      try { if (_prevTabLayout) { document.body.dataset.tabLayout = _prevTabLayout; _prevTabLayout = null; } } catch {}
      moveWindowControls(false);
    }
    try { localStorage.setItem(KEY, style); } catch {}
    // Persist for the start page (served by main.js, separate origin) — and AWAIT
    // the write before reloading open home tabs, otherwise they re-serve before
    // the file lands and stay on the old style. Only send a value it accepts:
    // anything else fails main's IPC schema.
    try { await window.vex?.setGuiStyle?.(def.startPage || 'classic'); } catch {}
    try { window.Onboarding?._reloadStartPages?.(); } catch {}
    paintStartPages();
    try { window.dispatchEvent(new CustomEvent('vex:gui-style', { detail: { style } })); } catch {}
  }

  function current() {
    try { const s = localStorage.getItem(KEY); return STYLES[s] ? s : 'classic'; } catch { return 'classic'; }
  }

  function currentColors() {
    try { const c = localStorage.getItem(COLORS_KEY); return COLOR_MODES.includes(c) ? c : 'look'; } catch { return 'look'; }
  }

  function applyColors(mode) {
    if (!COLOR_MODES.includes(mode)) throw new Error(`Unknown GUI colour mode: ${mode}`);
    document.body.dataset.guiColors = mode;
    try { localStorage.setItem(COLORS_KEY, mode); } catch {}
    paintStartPages();
    window.dispatchEvent(new CustomEvent('vex:gui-colors', { detail: { mode } }));
  }

  // The New Tab page is its own document, coloured by the colour theme. With a
  // browser look in its own colours that put a dark Matrix page under a light
  // Chrome frame, so there the page is handed the look's palette instead: the
  // look's resolved --b-* values, written over the page's --vex-* tokens.
  // Cards are the page colour nudged toward the text colour, so they read on
  // light and dark looks alike. Empty string = let the colour theme through.
  function startPagePaletteCss() {
    if (!isBrowserLook() || currentColors() !== 'look') return '';
    const cs = getComputedStyle(document.body);
    const b = (n) => {
      const v = cs.getPropertyValue(n).trim();
      if (!v) throw new Error(`Browser look ${document.body.dataset.guiStyle} defines no ${n}`);
      return v;
    };
    const page = b('--b-page'), text = b('--b-text'), dim = b('--b-text-dim');
    const accent = b('--b-accent'), border = b('--b-border');
    const card = (pct) => `color-mix(in srgb, ${page} ${pct}%, ${text})`;
    return `html[data-look-palette] {
      --vex-bg-base: ${page}; --vex-glass-strong: ${card(92)}; --vex-glass-medium: ${card(95)}; --vex-glass-light: ${card(97)};
      --vex-glass-input: ${b('--b-url-bg')};
      --vex-border-subtle: ${border}; --vex-border-medium: ${border}; --vex-border-strong: ${border};
      --vex-border-accent: ${accent}; --vex-border-accent-strong: ${accent};
      --vex-accent: ${accent}; --vex-accent-dim: color-mix(in srgb, ${accent} 18%, transparent); --vex-accent-glow: transparent;
      --vex-text-primary: ${text}; --vex-text-secondary: ${dim}; --vex-text-muted: ${dim};
      --vex-blur-medium: none; --vex-blur-light: none;
    }
    /* The Custom Image theme's darkened photo (an inline style) would sit under
       the look's dark text on light looks - the look's page is plain. */
    html[data-look-palette] body { background-image: none !important; }`;
  }

  // Apply (or clear) that palette in one start-page webview, and keep a copy in
  // the page's own storage (its session is not ours) so the next New Tab can
  // apply it before first paint instead of flashing the colour theme.
  function paintStartPage(webview) {
    const css = startPagePaletteCss();
    // The look's NAME goes over in both colour modes: the page's shapes (tiles,
    // corners, type) belong to the look even when its colours come from the
    // theme. start.html styles html[data-look="chrome"] and friends.
    const look = isBrowserLook() ? document.body.dataset.guiStyle : '';
    const js = `(() => {
      const look = ${JSON.stringify(look)};
      if (look) { document.documentElement.setAttribute('data-look', look); localStorage.setItem('vex.lookName', look); }
      else { document.documentElement.removeAttribute('data-look'); localStorage.removeItem('vex.lookName'); }
      ${css
        ? `let s = document.getElementById('vex-look-palette');
           if (!s) { s = document.createElement('style'); s.id = 'vex-look-palette'; document.head.appendChild(s); }
           s.textContent = ${JSON.stringify(css)}; document.documentElement.setAttribute('data-look-palette', '');
           localStorage.setItem('vex.lookPalette', ${JSON.stringify(css)});`
        : `document.getElementById('vex-look-palette')?.remove(); document.documentElement.removeAttribute('data-look-palette');
           localStorage.removeItem('vex.lookPalette');`}
    })()`;
    return webview.executeJavaScript(js);
  }

  // Repaint every open start page (after a look or colour-mode change).
  function paintStartPages() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews || typeof isStartPage !== 'function') return;
    for (const wv of WebviewManager.webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch { continue; } // not attached yet: dom-ready paints it
      if (isStartPage(url)) paintStartPage(wv).catch(err => console.error('[gui-style] start page palette failed:', err));
    }
  }

  // Picking a colour theme while a browser look shows its own colours would
  // otherwise appear to do nothing, so the look switches to follow the theme.
  // Only real picks count — the startup restore is not a choice.
  document.addEventListener('theme-changed', (e) => {
    if (!e.detail?.userChoice || !isBrowserLook() || currentColors() === 'theme') return;
    applyColors('theme');
    window.showToast?.('The browser look now uses your theme colours — Settings › GUI Style switches back', 'info', 4000);
  });

  function init() {
    document.body.dataset.guiColors = currentColors();
    apply(current());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.addEventListener('storage', (e) => {
    if (e.key === 'vex.shortcuts' && isTopLayout()) {
      const b = document.getElementById('gui-shortcuts-bar'); if (b) renderBar(b);
    }
  });

  window.VexGuiStyle = {
    set: apply,
    get: current,
    styles: () => Object.keys(STYLES),
    isBrowserLook,
    setColors: applyColors,
    getColors: currentColors,
    paintStartPage,
    render: () => { const b = document.getElementById('gui-shortcuts-bar'); if (b) renderBar(b); },
    // The stock shortcut set — the onboarding setup-style step builds its
    // pick-and-choose list from this so the two never drift apart.
    defaults: () => DEFAULT_SHORTCUTS.map(s => ({ ...s })),
  };
})();
