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
  // Panels open maximized (Discord, Claude, Prime… are whole apps); '0' once
  // the user has pressed Restore, and Maximize sets it back.
  const MAX_KEY = 'vex.lookSidebarMax';
  const prefersMax = () => { try { return localStorage.getItem(MAX_KEY) !== '0'; } catch { return true; } };
  const DEFAULT_WIDTH = 420;
  const MIN_WIDTH = 260;
  const MIN_PAGE = 320;          // the page keeps at least this much room

  const SIDEBAR_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path class="sb-edge" d="M15 4v16"/></svg>';
  const MAX_ICON = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  const RESTORE_ICON = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="3.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 3.5V1.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
  const CLOSE_ICON ='<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const PLUS_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

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
      <button id="look-sb-beside" title="Close the second panel" hidden></button>
      <button id="look-sb-add" title="Open another panel beside this one" aria-label="Open another panel beside this one">${PLUS_ICON}</button>
      <button id="look-sb-max" title="Maximize" aria-label="Maximize">${MAX_ICON}</button>
      <button id="look-sb-close" title="Close sidebar" aria-label="Close sidebar">${CLOSE_ICON}</button>`;
    container.prepend(head);
    head.querySelector('#look-sb-picker').addEventListener('change', (e) => SidebarManager.showPanel(e.target.value));
    head.querySelector('#look-sb-add').addEventListener('click', (e) => openAddMenu(e.currentTarget));
    head.querySelector('#look-sb-beside').addEventListener('click', () => SidebarManager.closeBeside());
    head.querySelector('#look-sb-max').addEventListener('click', () => {
      const on = !document.body.hasAttribute('data-sidebar-max');
      setMaximized(on);
      try { localStorage.setItem(MAX_KEY, on ? '1' : '0'); } catch {}
    });
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
    // With a second panel beside it (SidebarManager.openBeside): "Discord + Claude".
    const beside = typeof SidebarManager !== 'undefined' ? SidebarManager.sidePanel : null;
    const other = beside ? choices.find(c => c.panel === beside) : null;
    const besideLabel = beside ? (other ? other.label : beside) : '';
    title.textContent = (cur ? cur.label : panel) + (beside ? ' + ' + besideLabel : '');
    const chip = document.getElementById('look-sb-beside');
    const add = document.getElementById('look-sb-add');
    if (chip) {
      chip.hidden = !beside;
      if (beside) {
        chip.textContent = '+ ' + besideLabel;
        chip.insertAdjacentHTML('beforeend', CLOSE_ICON);
        chip.title = 'Close ' + besideLabel;
        chip.setAttribute('aria-label', chip.title);
      }
    }
    // Settings takes the whole area and never shares.
    if (add) add.hidden = panel === 'settings';
  }

  // ---- A second panel beside this one (SidebarManager.openBeside). The
  // toolbar looks (Chrome, Safari, IE) have no icon rail to Shift+click or
  // right-click, so the header's + is their way in: it lists the other
  // panels, and Swap sides once there are two.
  function openAddMenu(anchor) {
    document.querySelectorAll('.tab-context-menu').forEach(m => m.remove());
    const S = SidebarManager;
    const items = panelChoices()
      .filter(c => c.panel !== S.activePanel && c.panel !== S.sidePanel && c.panel !== 'settings')
      .map(c => ({ label: 'Open ' + c.label + ' beside', run: () => S.openBeside(c.panel) }));
    if (S.sidePanel) items.push({ label: 'Swap sides', run: () => S.swapBeside() });
    if (!items.length) items.push({ label: 'No other panel to open' });

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu look-sb-add-menu';
    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const onDown = (ev) => { if (!menu.contains(ev.target)) close(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'tab-context-item' + (it.run ? '' : ' disabled');
      el.textContent = it.label;
      if (it.run) el.addEventListener('click', () => {
        close();
        try { it.run(); } catch (err) { window.showToast?.(err.message, 'error'); }
      });
      menu.appendChild(el);
    }
    const r = anchor.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    document.body.appendChild(menu);
    if (typeof TabManager !== 'undefined' && TabManager._clampMenuToViewport) TabManager._clampMenuToViewport(menu, r.left, r.bottom + 4);
    setTimeout(() => {
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    return menu;
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

  // ---- Firefox / Netscape: the button (and Ctrl+B) hide the whole sidebar —
  // icon rail and any open panel — the way Firefox's Sidebars button does.
  const RAIL_KEY = 'vex.lookRailHidden';
  const railLook = () => document.body.dataset.sbLauncher === 'rail' && document.body.dataset.guiFamily === 'browser';
  function railHidden() { return document.body.classList.contains('look-rail-hidden'); }
  function setRailHidden(hidden) {
    if (hidden && typeof SidebarManager !== 'undefined' && SidebarManager.activePanel) SidebarManager.hideActivePanel();
    document.body.classList.toggle('look-rail-hidden', hidden);
    localStorage.setItem(RAIL_KEY, hidden ? '1' : '0');
    syncButtonLabel();
  }
  function toggleRail() { setRailHidden(!railHidden()); }
  function syncButtonLabel() {
    const btn = document.getElementById('btn-look-sidebar');
    if (!btn) return;
    const label = railLook() ? (railHidden() ? 'Show the sidebar (Ctrl+B)' : 'Hide the sidebar (Ctrl+B)') : 'Show sidebar';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    if (railLook()) btn.classList.toggle('active', !railHidden());
  }

  function toggleFromButton() {
    if (railLook()) { toggleRail(); return; }
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
    if (btn && !railLook()) btn.classList.toggle('active', !!panel);
    syncButtonLabel();
    // A panel opens the way the user last left it — maximized until they press
    // Restore. Closing the sidebar ends it either way.
    setMaximized(!!panel && docked() && prefersMax());
    refreshHeader(panel);
    adoptNav(panel);
  }

  function init() {
    const container = document.getElementById('panels-container');
    if (!container) throw new Error('look-sidebar: #panels-container missing');
    buildHeader(container);
    applyWidth(savedWidth());
    placeButton(buildButton());
    // The sidebar as it was left (Firefox / Netscape).
    if (localStorage.getItem(RAIL_KEY) === '1') document.body.classList.add('look-rail-hidden');

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

  window.VexLookSidebar = { toggle: toggleFromButton, panelChoices, railLook, toggleRail, railHidden };
})();
