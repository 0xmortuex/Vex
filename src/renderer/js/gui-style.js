// === Vex GUI Style switcher ("Classic" vs "Glass") =====================
// A whole-UI look toggle. Classic = the current Vex (default, untouched).
// Glass = frosted-glass skin + the new layout (tabs ON TOP, with a Chrome-style
// shortcuts/speed-dial bar where the tabs used to be). All the visual work is in
// css/gui-glass.css under body[data-gui-style="glass"]; this module just toggles
// the attribute, forces the horizontal tab strip in Glass, and builds the
// shortcuts bar. Persisted in localStorage 'vex.guiStyle'.
(function () {
  const KEY = 'vex.guiStyle';
  let _prevTabLayout = null;

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
      if (Array.isArray(sc) && sc.length) return sc.filter(s => s && s.url);
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
    return `hsl(${h % 360}, 55%, 45%)`;
  }
  function labelFor(s) {
    if (s.name) return s.name;
    try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return s.url; }
  }
  function faviconUrl(url) {
    try { return 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(new URL(url).hostname); } catch { return ''; }
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
        if (wv && typeof wv.loadURL === 'function') { wv.loadURL(url); return; }
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
    add.innerHTML = '<span class="ic">＋</span><span>Add shortcut</span>';
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
    style = (style === 'glass') ? 'glass' : 'classic';
    if (style === 'glass') {
      try {
        const cur = document.body.dataset.tabLayout || 'horizontal';
        if (cur !== 'horizontal') { _prevTabLayout = cur; document.body.dataset.tabLayout = 'horizontal'; }
      } catch {}
      buildBar();
      document.body.dataset.guiStyle = 'glass';
      try { window.HorizontalTabs?.render?.(); } catch {}
      moveWindowControls(true);
    } else {
      document.body.removeAttribute('data-gui-style');
      try { if (_prevTabLayout) { document.body.dataset.tabLayout = _prevTabLayout; _prevTabLayout = null; } } catch {}
      moveWindowControls(false);
    }
    try { localStorage.setItem(KEY, style); } catch {}
    // Persist for the start page (served by main.js, separate origin) — and AWAIT
    // the write before reloading open home tabs, otherwise they re-serve before
    // the file lands and stay on the old style.
    try { await window.vex?.setGuiStyle?.(style); } catch {}
    try { window.Onboarding?._reloadStartPages?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent('vex:gui-style', { detail: { style } })); } catch {}
  }

  function current() { try { return localStorage.getItem(KEY) || 'classic'; } catch { return 'classic'; } }

  function init() { apply(current()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.addEventListener('storage', (e) => {
    if (e.key === 'vex.shortcuts' && document.body.dataset.guiStyle === 'glass') {
      const b = document.getElementById('gui-shortcuts-bar'); if (b) renderBar(b);
    }
  });

  window.VexGuiStyle = { set: apply, get: current, render: () => { const b = document.getElementById('gui-shortcuts-bar'); if (b) renderBar(b); } };
})();
