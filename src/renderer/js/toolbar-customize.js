// === Customize the toolbar: right-click, drag, and any button from anywhere ==============================================
// The right of the toolbar (Inbox, Downloads, Profiles, Settings, AI ... and the three-dot "More tools" menu) is the person's own:
//   - RIGHT-CLICK a button: Move left / Move right, Move to the three-dot menu (or Remove from toolbar for a panel), its settings,
//     Customize toolbar..., Reset toolbar. Right-click a row of the three-dot menu: Move up / Move down / Move to the toolbar.
//     Right-click empty room or the three-dot button: Customize toolbar..., Reset toolbar. Opened with the menu key or Shift+F10
//     they are worked with the arrow keys like the tab menu.
//   - DRAG a button (mouse, pen or finger): along the bar to move it, onto another button to swap places, onto the three-dot
//     button or into its open menu to fold it, and out of the menu into the bar. Esc puts it back.
//   - ANY BUTTON CAN BE PLACED: the "Customize toolbar" dialog lists every toolbar button and every sidebar panel button (read
//     from the rail itself, so a new panel or a pinned site is on the list without anyone editing it). A placed panel is a
//     second button for the sidebar's: it opens and closes that panel, shows its active state, unread badge and tooltip.
// The model (what is where, in what order, saved) is js/toolbar-limit.js; the bar squeezing buttons into the menu when the window is
// too narrow is js/toolbar-overflow.js. This file is only the hands: loaded after start-up (js/lazy-boot.js).
const ToolbarCustomize = (() => {
  'use strict';

  const L = () => window.ToolbarLimit;
  const O = () => window.ToolbarOverflow;
  const tr = (s) => (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup ? (VexI18nUI.lookup(s) || s) : s);
  const toast = (msg, kind) => (kind ? window.showToast?.(msg, kind) : window.showToast?.(msg));
  const right = () => document.getElementById('top-bar-right');
  const THRESHOLD = 5;                 // px the pointer travels before a press becomes a drag
  const SIDE = 0.3;                    // the outer 30% of a button on each side means "before" / "after"; the middle means "swap"
  const APP_SETTINGS = {               // where a toolbar button's own settings are (SettingsUI.openSection ids)
    'btn-profile': 'settings-profiles',
    'btn-extensions': 'extensions-panel-content',
    'btn-toggle-ai': 'personas-panel-content',
  };
  const BADGE = '.panel-badge, .icon-badge, .ps-play';

  // Every failure of a change is shown, never swallowed.
  function attempt(fn) {
    try { return fn(); }
    catch (err) { toast(err.message, 'error'); window.VexProblems?.note('Toolbar', err.message, err); return undefined; }
  }

  // ---- The catalogue: what can be placed -------------------------------------------------------------------------------
  // Toolbar buttons first, then the rail's panel buttons, read from the page as it is now.
  function railButtons() {
    return [...document.querySelectorAll('#icon-sidebar .sidebar-icon[data-panel]')]
      .filter(b => !String(b.dataset.panel).startsWith('gameguide_') && /^[A-Za-z0-9_-]+$/.test(b.dataset.panel));
  }
  function panelLabel(panel, btn) {
    if (typeof SidebarManager !== 'undefined' && SidebarManager.panelLabel) return SidebarManager.panelLabel(panel);
    return ((btn && btn.title) || panel).replace(/\s*\(.*\)\s*$/, '').split(' — ')[0];
  }
  function iconNodes(src) {
    return [...src.childNodes].filter(n => !(n.nodeType === 1 && n.matches(BADGE)));
  }
  function iconHtml(src) {
    const box = document.createElement('span');
    iconNodes(src).forEach(n => box.appendChild(n.cloneNode(true)));
    return box.innerHTML;
  }
  // [{ id, kind: 'button' | 'panel', group, label, iconHtml }] in the order they are listed in the dialog.
  function catalog() {
    const out = [];
    for (const it of L().ITEMS) {
      const el = document.getElementById(it.id);
      const svg = el && el.querySelector('svg');
      out.push({ id: it.id, kind: 'button', group: 'Toolbar buttons', label: it.label, iconHtml: svg ? svg.outerHTML : '' });
    }
    const taken = new Set(out.map(o => o.label));
    for (const b of railButtons()) {
      const panel = b.dataset.panel;
      const url = typeof SidebarManager !== 'undefined' && SidebarManager._isUrlPanel ? SidebarManager._isUrlPanel(panel) : false;
      const group = panel.startsWith('site_') ? 'Pinned sites' : url ? 'Apps' : 'Sidebar panels';
      // Notes and Downloads are a toolbar button and a sidebar panel: told apart by "(sidebar)".
      const label = panelLabel(panel, b);
      out.push({ id: L().panelId(panel), kind: 'panel', group, label: taken.has(label) ? label + ' (sidebar)' : label, iconHtml: iconHtml(b) });
    }
    return out;
  }
  function labelOf(id) {
    const it = catalog().find(c => c.id === id);
    return it ? it.label : id;
  }

  // ---- Panel buttons in the bar ----------------------------------------------------------------------------------------
  // A placed panel is a button of its own that mirrors the rail's: same icon, tooltip, active state and badge, and a click is
  // the rail button's click (so Shift+click opens beside, Start opens the New Tab page, and every rule the rail has applies).
  const sourceOf = (panel) => railButtons().find(b => b.dataset.panel === panel) || null;

  function makeProxy(id) {
    const panel = L().panelOf(id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = L().elementId(id);
    btn.className = 'nav-btn tb-panel-btn';
    btn.dataset.tbId = id;
    btn.dataset.tbPanel = panel;
    btn.innerHTML = '<span class="tb-panel-ico" aria-hidden="true"></span><span class="tb-panel-badge" aria-hidden="true" hidden></span>';
    btn.addEventListener('click', (e) => {
      const src = sourceOf(panel);
      if (!src) throw new Error('[ToolbarCustomize] the sidebar has no button for "' + panel + '" any more');
      src.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey }));
    });
    return btn;
  }

  function refreshProxy(btn) {
    const src = sourceOf(btn.dataset.tbPanel);
    if (!src) { btn.remove(); return; }
    const badge = src.querySelector(BADGE);
    const badgeText = badge ? badge.textContent.trim() : null;
    const sig = [iconHtml(src), src.title, src.classList.contains('active'), badgeText].join('\u0001');
    if (btn._sig === sig) return;
    btn._sig = sig;
    btn.querySelector('.tb-panel-ico').innerHTML = iconHtml(src);
    const label = panelLabel(btn.dataset.tbPanel, src);
    btn.title = src.title || label;
    btn.setAttribute('aria-label', label);
    const on = src.classList.contains('active');
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    const b = btn.querySelector('.tb-panel-badge');
    b.hidden = badgeText === null;
    b.textContent = badgeText || '';
    b.classList.toggle('dot', badgeText === '');
  }

  let watcher = null, refreshQueued = false;
  function refreshAll() {
    const r = right();
    if (r) r.querySelectorAll('.tb-panel-btn').forEach(refreshProxy);
  }
  // A pinned site pinned or unpinned, a badge, the panel in front: the rail changed, so the placed panel buttons follow it.
  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => { refreshQueued = false; sync(); });
  }
  // The rail changes a lot (badges, the open panel); watched only while a panel button is placed.
  function watchRail(on) {
    const rail = document.getElementById('icon-sidebar');
    if (!on || !rail) { if (watcher) { watcher.disconnect(); watcher = null; } return; }
    if (watcher) return;
    watcher = new MutationObserver(queueRefresh);
    watcher.observe(rail, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'title'] });
  }

  // Simple mode (js/simple-mode.js) keeps these toolbar buttons away; until the person customises the toolbar that stands.
  function simpleWithheld(id) {
    return typeof VexSimpleMode !== 'undefined' && VexSimpleMode.isSimple() && VexSimpleMode.TOOLBAR.includes(id) && !L().isCustom();
  }
  // Is this toolbar button to be forced into sight, whatever a look or a mode hides on its own?
  function isPlaced(id, bar, menu) {
    if (simpleWithheld(id)) return false;
    if (menu.includes(id)) return true;
    return bar.includes(id) && (L().isCustom() || !L().DEFAULT_SHOWN.includes(id));
  }

  // Draw what the model says: panel buttons made or removed, the bar's buttons in the saved order.
  function sync() {
    const r = right();
    if (!r) throw new Error('[ToolbarCustomize] #top-bar-right is missing');
    const bar = L().shownIds(), menu = L().menuIds();
    const wanted = new Set(bar.concat(menu).filter(L().isPanel));
    r.querySelectorAll('.tb-panel-btn').forEach(el => { if (!wanted.has(el.dataset.tbId)) el.remove(); });
    const more = r.querySelector('#btn-toolbar-overflow');
    for (const id of wanted) {
      if (document.getElementById(L().elementId(id)) || !sourceOf(L().panelOf(id))) continue;
      r.insertBefore(makeProxy(id), more);
    }
    // A look or a mode that hides a toolbar button on its own (the browser looks hide Notes, "it is on the rail"; Simple mode
    // tucks the power buttons away) must not hide one the model puts in the bar or the three-dot menu: css/toolbar-customize.css
    // reads data-tb-placed. Two honest exceptions: the untouched default bar keeps its own conditional buttons conditional (the
    // Settings gear only while the sidebar is off), and Simple mode keeps its power buttons away until the toolbar is customised
    // (the dialog says so, see simpleWithheld).
    for (const id of L().IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.dataset.tbId = id;
      el.toggleAttribute('data-tb-placed', isPlaced(id, bar, menu));
    }
    refreshAll();
    watchRail(wanted.size > 0);
    order(r, bar);
  }

  // The bar's buttons in the saved order. Only when they are not already in it, so a bar nobody changed is never touched.
  function order(r, bar) {
    const els = bar.map(id => document.getElementById(L().elementId(id))).filter(el => el && r.contains(el));
    const now = [...r.children].filter(el => els.includes(el));
    if (now.length === els.length && now.every((el, i) => el === els[i])) return;
    const mark = document.createComment('tb-order');
    r.insertBefore(mark, now[0] || r.querySelector('#btn-toolbar-overflow'));
    let prev = mark;
    for (const el of els) { prev.after(el); prev = el; }
    mark.remove();
  }

  // ---- Menus (the tab menu's look, placing and keys) -------------------------------------------------------------------
  function showMenu(e, items, label) {
    document.querySelectorAll('.tab-context-menu, .tab-group-context-menu, .context-menu-overlay').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'tab-context-menu tb-ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Toolbar');
    menu.style.left = (e.clientX || 0) + 'px';
    menu.style.top = (e.clientY || 0) + 'px';
    if (label) {
      const head = document.createElement('div');
      head.className = 'tb-ctx-title';
      head.setAttribute('role', 'presentation');
      head.setAttribute('translate', 'no');
      head.textContent = label;
      menu.appendChild(head);
    }
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'tab-context-sep';
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'tab-context-item';
      el.setAttribute('role', 'menuitem');
      el.tabIndex = -1;
      el.textContent = item.label;
      el.addEventListener('click', () => {
        TabManager._dismissMenu(menu);
        attempt(() => { item.action(); if (item.after) item.after(); });
      });
      menu.appendChild(el);
    }
    document.body.appendChild(menu);
    TabManager._clampMenuToViewport(menu, e.clientX || 0, e.clientY || 0);
    TabManager._attachMenuDismissal(menu, { keys: true });
    return menu;
  }

  // The items for one button. `where` is 'bar' or 'menu' (the three-dot list), `id` the model id; null for empty room.
  function menuItems(id, where) {
    const items = [];
    const tail = [
      { label: 'Customize toolbar…', action: () => open() },
      { label: 'Reset toolbar', action: () => { L().reset(); toast('Toolbar put back to the default'); } },
    ];
    if (!id) return tail;
    const list = where === 'bar' ? L().shownIds() : L().menuIds();
    const at = list.indexOf(id);
    const horizontal = where === 'bar';
    // A neighbour that is out of sight (the Inbox bell with nothing in it) is not a place to move to.
    const hidden = (x) => !inSight(x);
    const free = (from, step) => { for (let j = from + step; j >= 0 && j < list.length; j += step) if (!hidden(list[j])) return true; return false; };
    const again = horizontal ? undefined : () => setTimeout(() => O() && O().moreButton().click(), 80);
    if (at >= 0 && free(at, -1)) items.push({ label: horizontal ? 'Move left' : 'Move up', action: () => L().move(id, -1, hidden), after: again });
    if (at >= 0 && free(at, 1)) items.push({ label: horizontal ? 'Move right' : 'Move down', action: () => L().move(id, 1, hidden), after: again });
    if (where === 'bar') items.push({ label: 'Move to the three-dot menu', action: () => L().place(id, 'menu') });
    else items.push({ label: 'Move to the toolbar', action: () => L().place(id, 'bar') });
    if (L().isPanel(id)) items.push({ label: 'Remove from toolbar', action: () => L().place(id, 'none') });
    const settings = L().isPanel(id) ? 'sidebar-manager-list' : APP_SETTINGS[id];
    if (settings && typeof SettingsUI !== 'undefined') items.push({ label: 'Open its settings', action: () => SettingsUI.openSection(settings) });
    return [...items, { separator: true }, ...tail];
  }

  function openMenuAt(e, id, where) {
    return showMenu(e, menuItems(id, where), id ? labelOf(id) : '');
  }

  // Is the button there to be seen: in the bar and showing, or a row of the three-dot menu?
  function inSight(id) {
    const el = document.getElementById(L().elementId(id));
    if (!el || el.hidden) return false;
    return el.classList.contains('tb-overflowed') || el.getClientRects().length > 0;
  }

  function onContextMenu(e) {
    if (e.defaultPrevented) return;   // a button with a right-click menu of its own keeps it
    // The three-dot menu's own rows: the menu closes (its keys would fight the context menu's) and the row's menu opens.
    const row = e.target.closest && e.target.closest('.tb-overflow-menu .tb-overflow-item[data-tb-id]');
    if (row) {
      e.preventDefault();
      const id = row.dataset.tbId;
      O().closeMenu();
      openMenuAt(e, id, 'menu');
      return;
    }
    const r = right();
    const t = e.target;
    if (!(t && t.closest)) return;
    const more = O() && O().moreButton();
    if (more && (t === more || more.contains(t))) { e.preventDefault(); openMenuAt(e, null, 'bar'); return; }
    if (!r || !r.contains(t)) {
      // The bar's own empty room, not the address bar, the logo, the tabs button or the window controls.
      const bar = document.getElementById('top-bar');
      if (!(bar && (t === bar || t.id === 'top-bar-drag'))) return;
      e.preventDefault();
      openMenuAt(e, null, 'bar');
      return;
    }
    e.preventDefault();
    const btn = t.closest('[data-tb-id]');
    if (btn && r.contains(btn) && L().where(btn.dataset.tbId) === 'bar') openMenuAt(e, btn.dataset.tbId, 'bar');
    else openMenuAt(e, null, 'bar');
  }

  // ---- Dragging --------------------------------------------------------------------------------------------------------
  // Pure: where would a button dropped at (x, y) go? `items` are the bar's other buttons in bar order, `band` the bar's top and bottom.
  function dropTarget(items, x, y, band) {
    if (y < band.top - 24 || y > band.bottom + 24) return null;
    if (!items.length) return { kind: 'bar-end' };
    for (const it of items) {
      if (x < it.left || x > it.right) continue;
      const f = (x - it.left) / Math.max(1, it.right - it.left);
      if (f < SIDE) return { kind: 'before', id: it.id };
      if (f > 1 - SIDE) return { kind: 'after', id: it.id };
      return { kind: 'swap', id: it.id };
    }
    if (x < items[0].left) return { kind: 'before', id: items[0].id };
    if (x > items[items.length - 1].right) return { kind: 'after', id: items[items.length - 1].id };
    for (let i = 0; i < items.length - 1; i++) if (x > items[i].right && x < items[i + 1].left) return { kind: 'after', id: items[i].id };
    return null;
  }
  // Pure: dropped on the open menu at height y; `rows` are its rows (not the dragged one) top to bottom.
  function menuRowTarget(rows, y) {
    if (!rows.length) return { kind: 'menu-end' };
    for (const r of rows) if (y < (r.top + r.bottom) / 2) return { kind: 'menu-before', id: r.id };
    return { kind: 'menu-after', id: rows[rows.length - 1].id };
  }

  let drag = null;       // { id, from, el, x, y, pointerId, active, ghost, marker, target, marked }
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };

  function barItems(dragId) {
    const r = right();
    return L().shownIds().filter(id => id !== dragId).map(id => document.getElementById(L().elementId(id)))
      .filter(el => el && r.contains(el) && el.getClientRects().length && !el.classList.contains('tb-overflowed'))
      .map(el => ({ id: el.dataset.tbId, el, ...rectOf(el) }));
  }
  function menuRows(dragId) {
    const m = O() && O().menuElement();
    return m ? [...m.querySelectorAll('.tb-overflow-item[data-tb-id]')].filter(el => el.dataset.tbId !== dragId).map(el => ({ id: el.dataset.tbId, el, ...rectOf(el) })) : [];
  }

  function targetAt(x, y) {
    const m = O() && O().menuElement();
    if (m) {
      const mr = m.getBoundingClientRect();
      if (x >= mr.left && x <= mr.right && y >= mr.top && y <= mr.bottom) return menuRowTarget(menuRows(drag.id), y);
    }
    const more = O() && O().moreButton();
    if (more) {
      const r = more.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { kind: 'menu-end' };
    }
    const bar = right().getBoundingClientRect();
    return dropTarget(barItems(drag.id), x, y, { top: bar.top, bottom: bar.bottom });
  }

  function clearMarks() {
    if (drag && drag.marker) drag.marker.hidden = true;
    document.querySelectorAll('.tb-drop-swap').forEach(el => el.classList.remove('tb-drop-swap'));
  }
  function showMark(t) {
    clearMarks();
    if (!t) return;
    const mk = drag.marker;
    const place = (r, vertical, atEnd) => {
      mk.hidden = false;
      mk.className = 'tb-drop-marker ' + (vertical ? 'tb-drop-v' : 'tb-drop-h');
      if (vertical) { mk.style.left = (atEnd ? r.right : r.left) - 1 + 'px'; mk.style.top = r.top + 'px'; mk.style.width = ''; mk.style.height = (r.bottom - r.top) + 'px'; }
      else { mk.style.left = r.left + 'px'; mk.style.top = (atEnd ? r.bottom : r.top) - 1 + 'px'; mk.style.width = (r.right - r.left) + 'px'; mk.style.height = ''; }
    };
    if (t.kind === 'swap') { const it = barItems(drag.id).find(x => x.id === t.id); if (it) it.el.classList.add('tb-drop-swap'); }
    else if (t.kind === 'before' || t.kind === 'after') { const it = barItems(drag.id).find(x => x.id === t.id); if (it) place(it, true, t.kind === 'after'); }
    else if (t.kind === 'bar-end') { const b = right().getBoundingClientRect(); place(b, true, true); }
    else if (t.kind === 'menu-before' || t.kind === 'menu-after') { const row = menuRows(drag.id).find(x => x.id === t.id); if (row) place(row, false, t.kind === 'menu-after'); }
    else if (t.kind === 'menu-end') {
      const rows = menuRows(drag.id);
      if (rows.length) place(rows[rows.length - 1], false, true);
      else if (O()) O().moreButton().classList.add('tb-drop-swap');
    }
  }

  function startDrag(e) {
    const d = drag;
    d.active = true;
    d.ghost = document.createElement('div');
    d.ghost.className = 'tb-drag-ghost';
    d.ghost.setAttribute('aria-hidden', 'true');
    const ico = d.el.querySelector('svg, img');
    if (ico) d.ghost.appendChild(ico.cloneNode(true));
    d.marker = document.createElement('div');
    d.marker.className = 'tb-drop-marker';
    d.marker.hidden = true;
    document.body.append(d.ghost, d.marker);
    d.el.classList.add('tb-dragging');
    document.body.classList.add('tb-drag-active');
    if (O()) O().holdMore(true);
    // A tooltip and a menu belong to the moment before; the drag is the moment now.
    d.el.blur?.();
  }
  function moveDrag(e) {
    const d = drag;
    d.ghost.style.left = (e.clientX + 12) + 'px';
    d.ghost.style.top = (e.clientY + 12) + 'px';
    d.target = targetAt(e.clientX, e.clientY);
    showMark(d.target);
  }
  function endDrag() {
    const d = drag;
    if (!d) return;
    drag = null;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onCancel, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', onCancel);
    if (!d.active) return;
    d.ghost.remove();
    d.marker.remove();
    d.el.classList.remove('tb-dragging');
    document.body.classList.remove('tb-drag-active');
    document.querySelectorAll('.tb-drop-swap').forEach(el => el.classList.remove('tb-drop-swap'));
    if (O()) O().holdMore(false);
    // The press that ended the drag must not also click the button it ends on.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', swallow, true);
    setTimeout(() => document.removeEventListener('click', swallow, true), 0);
  }

  function commit(id, t) {
    const l = L();
    switch (t.kind) {
      case 'before': l.moveNextTo(id, t.id, false); break;
      case 'after': l.moveNextTo(id, t.id, true); break;
      case 'swap': l.swap(id, t.id); break;
      case 'bar-end': l.place(id, 'bar'); break;
      case 'menu-before': l.moveNextTo(id, t.id, false); break;
      case 'menu-after': l.moveNextTo(id, t.id, true); break;
      case 'menu-end': l.place(id, 'menu'); break;
      default: throw new Error('[ToolbarCustomize] unknown drop: ' + t.kind);
    }
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < THRESHOLD) return;
      startDrag(e);
    }
    e.preventDefault();
    moveDrag(e);
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    const t = d.active ? targetAt(e.clientX, e.clientY) : null;
    endDrag();
    if (d.active && t) attempt(() => commit(d.id, t));
  }
  function onCancel() { endDrag(); }
  function onKeyDown(e) {
    if (e.key !== 'Escape' || !drag) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
  }
  function onDown(e) {
    if (e.button !== 0 || drag) return;
    const t = e.target;
    if (!(t && t.closest)) return;
    const row = t.closest('.tb-overflow-menu .tb-overflow-item[data-tb-id]');
    const btn = row ? null : t.closest('#top-bar-right [data-tb-id]');
    const el = row || btn;
    if (!el) return;
    if (btn && L().where(btn.dataset.tbId) !== 'bar') return;
    drag = { id: el.dataset.tbId, from: row ? 'menu' : 'bar', el, x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: false };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onCancel);
  }

  // ---- The dialog ------------------------------------------------------------------------------------------------------
  let dialog = null;

  function iconBox(entry) {
    const s = document.createElement('span');
    s.className = 'tbc-ico';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = entry.iconHtml;
    return s;
  }
  function small(label, text, onClick, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tbc-btn';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.textContent = text;
    b.disabled = !!disabled;
    b.addEventListener('click', () => attempt(onClick));
    return b;
  }

  function withheldNote() {
    const s = document.createElement('span');
    s.className = 'tbc-note';
    s.textContent = 'Hidden while Simple mode is on';
    return s;
  }

  function renderDialog(box) {
    const focus = box.contains(document.activeElement) ? { key: document.activeElement.dataset.focusKey } : null;
    const cat = catalog();
    const byId = new Map(cat.map(c => [c.id, c]));
    const bar = L().shownIds().filter(id => byId.has(id));
    const menu = L().menuIds().filter(id => byId.has(id));
    box.textContent = '';

    const orderList = (title, ids, where) => {
      const sec = document.createElement('section');
      sec.className = 'tbc-sec';
      const h = document.createElement('h4');
      h.textContent = title;
      sec.appendChild(h);
      if (!ids.length) {
        const p = document.createElement('p');
        p.className = 'tbc-empty';
        p.textContent = where === 'bar' ? 'Nothing here: the toolbar shows only the three-dot menu.' : 'Nothing is in the three-dot menu.';
        sec.appendChild(p);
      }
      const ol = document.createElement('ol');
      ol.className = 'tbc-order';
      ids.forEach((id, i) => {
        const e = byId.get(id);
        const li = document.createElement('li');
        li.setAttribute('role', 'group');
        li.setAttribute('aria-label', e.label);
        const name = document.createElement('span');
        name.className = 'tbc-name';
        name.setAttribute('translate', 'no');
        name.textContent = e.label;
        li.append(iconBox(e), name);
        if (e.kind !== 'panel' && simpleWithheld(id)) li.append(withheldNote());
        const horizontal = where === 'bar';
        const prev = small(horizontal ? 'Move left' : 'Move up', horizontal ? '←' : '↑', () => L().move(id, -1), i === 0);
        const next = small(horizontal ? 'Move right' : 'Move down', horizontal ? '→' : '↓', () => L().move(id, 1), i === ids.length - 1);
        prev.dataset.focusKey = 'prev:' + id; next.dataset.focusKey = 'next:' + id;
        li.append(prev, next);
        ol.appendChild(li);
      });
      sec.appendChild(ol);
      return sec;
    };
    box.append(orderList('In the toolbar, left to right', bar, 'bar'), orderList('In the three-dot menu, top to bottom', menu, 'menu'));

    const all = document.createElement('section');
    all.className = 'tbc-sec';
    const ah = document.createElement('h4');
    ah.textContent = 'Every button';
    all.appendChild(ah);
    const groups = ['Toolbar buttons', 'Sidebar panels', 'Apps', 'Pinned sites'];
    for (const g of groups) {
      const list = cat.filter(c => c.group === g);
      if (!list.length) continue;
      const gh = document.createElement('h5');
      gh.textContent = g;
      all.appendChild(gh);
      for (const e of list) {
        const row = document.createElement('div');
        row.className = 'tbc-row';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', e.label);
        const name = document.createElement('span');
        name.className = 'tbc-name';
        name.setAttribute('translate', 'no');
        name.textContent = e.label;
        const sel = document.createElement('select');
        sel.className = 'tbc-select';
        sel.setAttribute('aria-label', 'Place this button');
        sel.dataset.focusKey = 'sel:' + e.id;
        const opts = [['bar', 'In the toolbar'], ['menu', 'In the three-dot menu']];
        if (e.kind === 'panel') opts.push(['none', 'Sidebar only']);
        for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
        sel.value = L().where(e.id);
        sel.addEventListener('change', () => attempt(() => L().place(e.id, sel.value)));
        row.append(iconBox(e), name);
        if (e.kind !== 'panel' && simpleWithheld(e.id)) row.append(withheldNote());
        row.append(sel);
        all.appendChild(row);
      }
    }
    box.appendChild(all);
    if (focus && focus.key) {
      const again = box.querySelector('[data-focus-key="' + CSS.escape(focus.key) + '"]:not(:disabled)');
      if (again) again.focus();
    }
  }

  function close() {
    if (dialog) VexLayer.close(dialog.overlay);
  }

  function open() {
    if (dialog) { dialog.overlay.querySelector('.tbc-dialog').focus(); return dialog.overlay; }
    const opener = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'tbc-overlay';
    overlay.style.cssText = 'inset:0;display:flex;align-items:center;justify-content:center;background:var(--vex-scrim, rgba(0,0,0,0.45))';
    const el = document.createElement('div');
    el.className = 'tbc-dialog';
    el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'tbc-title');
    el.innerHTML = '<h3 id="tbc-title">Customize toolbar</h3>'
      + '<p class="tbc-lead">Put any button on the right of the toolbar, in any order. Drag buttons in the toolbar, or right-click one. The more you add, the shorter the address bar gets; when the window is too narrow the last ones move into the three-dot menu on their own.</p>'
      + '<div class="tbc-body"></div>'
      + '<div class="tbc-actions"><button type="button" data-reset>Reset toolbar</button><button type="button" class="primary" data-done>Done</button></div>';
    overlay.appendChild(el);
    const body = el.querySelector('.tbc-body');
    const redraw = () => renderDialog(body);
    window.addEventListener('vex:toolbar-shown', redraw);
    const finish = () => {
      window.removeEventListener('vex:toolbar-shown', redraw);
      dialog = null;
      if (opener && opener.isConnected && opener.focus) opener.focus();
    };
    dialog = { overlay };
    VexLayer.open(overlay, { tier: 'dialog', id: 'toolbar-customize', onClose: finish });
    renderDialog(body);
    el.querySelector('[data-done]').addEventListener('click', close);
    el.querySelector('[data-reset]').addEventListener('click', () => { L().reset(); toast('Toolbar put back to the default'); });
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close(); });
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
      else if (ev.key === 'Tab' && window.VexFocusTrap?.onTab) window.VexFocusTrap.onTab(ev, el);
    });
    const first = el.querySelector('select, button:not(:disabled)');
    (first || el).focus();
    return overlay;
  }

  // ---- Start ----------------------------------------------------------------------------------------------------------
  function init() {
    const r = right();
    if (!r) throw new Error('[ToolbarCustomize] #top-bar-right is missing');
    sync();
    window.addEventListener('vex:toolbar-shown', sync);
    window.addEventListener('vex-ui-mode-changed', sync);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerdown', onDown, true);
  }

  // Everything init() hooked up, taken down again (the tests, and the leak check, open and close it many times).
  function destroy() {
    window.removeEventListener('vex:toolbar-shown', sync);
    window.removeEventListener('vex-ui-mode-changed', sync);
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('pointerdown', onDown, true);
    watchRail(false);
    close();
    if (drag) endDrag();
  }

  const api = { init, destroy, sync, open, close, catalog, menuItems, dropTarget, menuRowTarget, commit, isDragging: () => !!(drag && drag.active), THRESHOLD, SIDE };
  if (typeof window !== 'undefined') window.ToolbarCustomize = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.ToolbarLimit && document.getElementById('top-bar-right')) init();
  return api;
})();
