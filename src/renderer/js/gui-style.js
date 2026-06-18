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

  function getShortcuts() {
    try {
      const sc = JSON.parse(localStorage.getItem('vex.shortcuts') || 'null');
      if (Array.isArray(sc) && sc.length) return sc.filter(s => s && s.url);
    } catch {}
    return DEFAULT_SHORTCUTS;
  }

  // Deterministic chip color from the hostname (no network / favicon fetches —
  // instant + reliable, same approach as the smart search bar).
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

  function navigate(url) {
    try {
      if (window.WebviewManager && typeof WebviewManager.getActiveWebview === 'function') {
        const wv = WebviewManager.getActiveWebview();
        if (wv && typeof wv.loadURL === 'function') { wv.loadURL(url); return; }
      }
    } catch {}
    // Fallback: drop it in the address bar and submit.
    try {
      const i = document.getElementById('url-input');
      if (i) { i.value = url; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
    } catch {}
  }

  function renderBar(bar) {
    bar.innerHTML = '';
    for (const s of getShortcuts().slice(0, 18)) {
      const el = document.createElement('div');
      el.className = 'gsc';
      el.title = s.url;
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.style.background = hostColor(s.url);
      ic.textContent = labelFor(s).slice(0, 1).toUpperCase();
      const label = document.createElement('span');
      label.textContent = labelFor(s);
      el.appendChild(ic); el.appendChild(label);
      el.addEventListener('click', () => navigate(s.url));
      bar.appendChild(el);
    }
    const edit = document.createElement('div');
    edit.className = 'gsc gsc-edit';
    edit.textContent = '✎ Edit';
    edit.addEventListener('click', () => {
      // Open Settings and jump to the dedicated shortcuts editor (add/remove/reorder).
      try {
        document.querySelector('.sidebar-icon[data-panel="settings"]')?.click();
        setTimeout(() => {
          const ed = document.getElementById('shortcuts-editor-content');
          if (ed) ed.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      } catch {}
    });
    bar.appendChild(edit);
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
