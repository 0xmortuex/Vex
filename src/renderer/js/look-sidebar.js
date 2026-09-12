// === Docked sidebars (browser looks + Glass) ==============================
// In the browser looks (css/gui-browser.css) Vex's panels (Discord, Spotify,
// notes, …) live in the sidebar that look's real browser has, docked beside
// the page instead of covering it (SidebarManager._docksBesidePage):
//   Chrome        a toolbar button opens a side panel on the right, with a
//                 panel picker in its header
//   Safari, XP    the same on the left (Safari's sidebar, IE's Explorer bar)
//   Firefox, 98   the icon rail stays on screen at the left, the panel beside it
// gui-style.js stamps body[data-sb-side] and body[data-sb-launcher] from its
// STYLES registry; sidebar.js stamps body[data-sidebar-panel] and fires
// 'vex:panel-changed'. This module adds the three pieces those need: the
// panel header (picker or title, and a close button), the toolbar button, and
// the drag handle that sets the panel's width.
(function () {
  const WIDTH_KEY = 'vex.lookSidebarWidth';
  const LAST_KEY = 'vex.lookSidebarLast';
  const DEFAULT_WIDTH = 420;
  const MIN_WIDTH = 260;
  const MIN_PAGE = 320;          // the page keeps at least this much room

  const SIDEBAR_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path class="sb-edge" d="M15 4v16"/></svg>';
  const MAX_ICON = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  const RESTORE_ICON = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="3.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 3.5V1.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
  const CLOSE_ICON ='<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  // Every style that has a sidebar (the browser looks and Glass) docks its
  // panels; gui-style.js stamps body[data-sb-side] for those.
  const docked = () => !!document.body.dataset.sbSide;
  const side = () => document.body.dataset.sbSide || 'left';

  // The panels on offer: the rail's buttons the user has not hidden, in the
  // rail's order. The house button opens the New Tab page, not a panel.
  function panelChoices() {
    return [...document.querySelectorAll('#icon-sidebar .sidebar-icon[data-panel]')]
      .filter(b => b.dataset.panel !== 'start' && b.style.display !== 'none')
      .map(b => ({ panel: b.dataset.panel, label: (b.title || b.dataset.panel).replace(/\s*\(.*\)\s*$/, '').split(' — ')[0] }));
  }

  function clampWidth(w) {
    const area = document.getElementById('content-area');
    const max = Math.max(MIN_WIDTH, (area ? area.getBoundingClientRect().width : window.innerWidth) - MIN_PAGE);
    return Math.round(Math.min(Math.max(w, MIN_WIDTH), max));
  }
  function applyWidth(w) {
    const px = clampWidth(w);
    document.body.style.setProperty('--look-sb-w', px + 'px');
    return px;
  }
  function savedWidth() {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(w) && w > 0 ? w : DEFAULT_WIDTH;
  }

  // ---- Header: picker (toolbar launchers) or title (rail launchers) + close
  function buildHeader(container) {
    const head = document.createElement('div');
    head.id = 'look-sb-head';
    head.innerHTML = `<select id="look-sb-picker" aria-label="Sidebar panel"></select>
      <span id="look-sb-title"></span>
      <span id="look-sb-nav"></span>
      <button id="look-sb-max" title="Maximize" aria-label="Maximize">${MAX_ICON}</button>
      <button id="look-sb-close" title="Close sidebar" aria-label="Close sidebar">${CLOSE_ICON}</button>`;
    container.prepend(head);
    head.querySelector('#look-sb-picker').addEventListener('change', (e) => SidebarManager.showPanel(e.target.value));
    head.querySelector('#look-sb-max').addEventListener('click', () => setMaximized(!document.body.hasAttribute('data-sidebar-max')));
    head.querySelector('#look-sb-close').addEventListener('click', () => SidebarManager.hideActivePanel());

    const grip = document.createElement('div');
    grip.id = 'look-sb-resize';
    grip.title = 'Drag to resize';
    container.appendChild(grip);
    grip.addEventListener('pointerdown', startResize);
  }

  function refreshHeader(panel) {
    const picker = document.getElementById('look-sb-picker');
    const title = document.getElementById('look-sb-title');
    if (!picker || !title || !panel) return;
    const choices = panelChoices();
    picker.innerHTML = '';
    for (const c of choices) {
      const o = document.createElement('option');
      o.value = c.panel; o.textContent = c.label;
      picker.appendChild(o);
    }
    picker.value = panel;
    const cur = choices.find(c => c.panel === panel);
    title.textContent = cur ? cur.label : panel;
  }

  // ---- Maximize: the open panel takes the whole page area (Discord, Prime,
  // Roblox… are whole apps), and the same button puts it back in the sidebar.
  // Closing the sidebar ends it.
  function setMaximized(on) {
    if (on) document.body.dataset.sidebarMax = '';
    else document.body.removeAttribute('data-sidebar-max');
    const btn = document.getElementById('look-sb-max');
    if (!btn) return;
    btn.innerHTML = on ? RESTORE_ICON : MAX_ICON;
    btn.title = on ? 'Restore to sidebar' : 'Maximize';
    btn.setAttribute('aria-label', btn.title);
  }

  // ---- A web panel's back / forward / reload bar (sidebar.js _addPanelNav)
  // moves into the header here, instead of taking a strip of the narrow panel.
  // Outside the looks, or for another panel, it goes back into its panel.
  function adoptNav(panel) {
    const slot = document.getElementById('look-sb-nav');
    if (!slot) return;
    for (const nav of [...slot.children]) {
      if (docked() && nav.dataset.panel === panel) continue;
      const home = document.getElementById('panel-' + nav.dataset.panel);
      if (home) home.prepend(nav);
      else nav.remove();   // its panel was removed (an unpinned site)
    }
    if (!docked() || !panel) return;
    const nav = document.getElementById('panel-' + panel)?.querySelector(':scope > .panel-navbar');
    if (nav) slot.appendChild(nav);
  }

  // ---- Resize: drag the panel's inner edge. Pages are separate processes and
  // swallow pointer moves, so a shield covers them for the length of the drag.
  function startResize(e) {
    e.preventDefault();
    const container = document.getElementById('panels-container');
    const startX = e.clientX;
    const startW = container.getBoundingClientRect().width;
    const dir = side() === 'right' ? -1 : 1;
    const shield = document.createElement('div');
    shield.id = 'look-sb-shield';
    document.body.appendChild(shield);
    // Save the width we set, not the measured one: the panel animates its
    // width, so measuring on release reads the old size.
    let width = startW;
    const move = (ev) => { width = applyWidth(startW + dir * (ev.clientX - startX)); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      shield.remove();
      try { localStorage.setItem(WIDTH_KEY, String(width)); } catch {}
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---- Toolbar button (Chrome, Safari, XP): toggles the sidebar, reopening
  // the panel used last.
  function buildButton() {
    const btn = document.createElement('button');
    btn.id = 'btn-look-sidebar';
    btn.title = 'Show sidebar';
    btn.setAttribute('aria-label', 'Show sidebar');
    btn.innerHTML = SIDEBAR_ICON;
    btn.addEventListener('click', toggleFromButton);
    return btn;
  }

  function toggleFromButton() {
    if (SidebarManager.activePanel) { SidebarManager.hideActivePanel(); return; }
    const choices = panelChoices();
    if (!choices.length) throw new Error('No sidebar panels to show — every panel is hidden in Settings › Sidebar');
    let last = '';
    try { last = localStorage.getItem(LAST_KEY) || ''; } catch {}
    SidebarManager.showPanel(choices.some(c => c.panel === last) ? last : choices[0].panel);
  }

  // Safari keeps its sidebar button at the far left of the toolbar; Chrome and
  // IE keep theirs with the other tool buttons on the right.
  function placeButton(btn) {
    const host = side() === 'right'
      ? document.getElementById('top-bar-right')
      : (document.body.dataset.guiStyle === 'safari' ? document.getElementById('top-bar-left') : document.getElementById('top-bar-right'));
    if (!host) throw new Error('Toolbar not found for the sidebar button');
    const anchor = host.id === 'top-bar-left' ? host.firstChild : document.getElementById('btn-command');
    if (anchor && anchor.parentElement === host) host.insertBefore(btn, anchor);
    else host.appendChild(btn);
  }

  function sync() {
    const btn = document.getElementById('btn-look-sidebar');
    if (btn && docked()) placeButton(btn);
    const panel = typeof SidebarManager !== 'undefined' ? SidebarManager.activePanel : null;
    if (btn) btn.classList.toggle('active', !!panel);
    if (!panel || !docked()) setMaximized(false);
    refreshHeader(panel);
    adoptNav(panel);
  }

  function init() {
    const container = document.getElementById('panels-container');
    if (!container) throw new Error('look-sidebar: #panels-container missing');
    buildHeader(container);
    applyWidth(savedWidth());
    placeButton(buildButton());

    document.addEventListener('vex:panel-changed', (e) => {
      const panel = e.detail && e.detail.panel;
      if (panel && docked()) { try { localStorage.setItem(LAST_KEY, panel); } catch {} }
      sync();
    });
    // Switching into or out of a look with a panel open: re-show it so it
    // docks (or covers the page again) under the new layout.
    window.addEventListener('vex:gui-style', () => {
      applyWidth(savedWidth());
      if (typeof SidebarManager !== 'undefined' && SidebarManager.activePanel) SidebarManager.showPanel(SidebarManager.activePanel);
      sync();
    });
    window.addEventListener('resize', () => applyWidth(savedWidth()));
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.VexLookSidebar = { toggle: toggleFromButton, panelChoices };
})();
