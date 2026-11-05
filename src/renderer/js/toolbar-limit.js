// === Toolbar placement — which buttons sit on the right of the toolbar, and in what order ===
// The right side of the address toolbar had grown to six or seven icon
// buttons, so by default four icons are in sight: Downloads, Profiles, the
// "more" button that holds the rest, and the Inbox bell or the Settings gear.
// The bell and the gear are conditional extras that appear only when they have
// something to show (the bell while the Inbox holds something, the gear while
// the sidebar is off), so they do not crowd the bar. Every other button is
// folded into that "more" menu (js/toolbar-overflow.js): still one click and
// one arrow key away, and still on Ctrl+K and its own shortcut.
//
// That four is only the DEFAULT. A person may put as many buttons in the bar
// as they like (the address bar shrinks to make room, and what still does not
// fit goes into the menu on its own, js/toolbar-overflow.js), put them in any
// order, and also put any sidebar panel's button there (a placed panel is
// "panel:<id>", drawn by js/toolbar-customize.js, which also has the
// right-click menus, the dragging and the "Customize toolbar" dialog).
//
//   vex.toolbarShown   JSON array of ids kept in the toolbar, in the order they
//                      are drawn. Absent means the default four. Reset removes it.
//   vex.toolbarMenu    JSON array of ids in the "more" menu, in menu order. A
//                      button that is neither here nor in the toolbar is folded
//                      into the menu (a toolbar button) or left only in the
//                      sidebar (a panel). Absent means the menu is in toolbar order.
//
// A profile that had already rearranged or hidden toolbar buttons (the layout
// editor's vex.layout) keeps what it had: migrate() writes every button as
// shown, in the layout editor's order, once, so an update never takes a button
// away from someone who chose their toolbar.
(function () {
  'use strict';

  const KEY = 'vex.toolbarShown';
  const MENU_KEY = 'vex.toolbarMenu';
  const LAYOUT_KEY = 'vex.layout';
  const PANEL = 'panel:';
  const PANEL_RE = /^panel:[A-Za-z0-9_-]+$/;
  const PROXY_PREFIX = 'btn-tbp-';

  // Every toolbar button that may be moved, in toolbar order, with its Settings label.
  const ITEMS = [
    { id: 'btn-incognito', label: 'Private window' },
    { id: 'btn-tor', label: 'Tor tab' },
    { id: 'btn-notes-top', label: 'Notes' },
    { id: 'btn-attention', label: 'Inbox' },
    { id: 'btn-downloads-top', label: 'Downloads' },
    { id: 'btn-extensions', label: 'Quick tools & extensions' },
    { id: 'btn-dev-dash', label: 'Developer dashboard' },
    { id: 'btn-toggle-ai', label: 'AI panel' },
    { id: 'btn-split', label: 'Split screen' },
    { id: 'btn-settings-top', label: 'Settings' },
    { id: 'btn-command', label: 'Command bar' },
    { id: 'btn-profile', label: 'Profiles' },
  ];
  const IDS = ITEMS.map(i => i.id);
  // In the order the bar draws them.
  const DEFAULT_SHOWN = ['btn-attention', 'btn-downloads-top', 'btn-settings-top', 'btn-profile'];

  const isPanel = (id) => typeof id === 'string' && PANEL_RE.test(id);
  const isBuiltin = (id) => IDS.includes(id);
  const isKnown = (id) => isBuiltin(id) || isPanel(id);
  const panelOf = (id) => (isPanel(id) ? id.slice(PANEL.length) : null);
  const panelId = (panel) => {
    const id = PANEL + panel;
    if (!isPanel(id)) throw new Error('[ToolbarLimit] not a usable panel name: ' + panel);
    return id;
  };
  // The id of the button element that stands for it in the page.
  const elementId = (id) => (isPanel(id) ? PROXY_PREFIX + panelOf(id) : id);

  function readList(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('[ToolbarLimit] ' + key + ' is not valid JSON: ' + err.message); }
    if (!Array.isArray(v)) throw new Error('[ToolbarLimit] ' + key + ' must be an array of button ids');
    if (v.some(x => typeof x !== 'string')) throw new Error('[ToolbarLimit] ' + key + ' must hold only button ids');
    // A button this version does not know (from a newer Vex through Sync) is left out of what is drawn.
    const seen = new Set();
    return v.filter(id => isKnown(id) && !seen.has(id) && seen.add(id));
  }

  function shownIds() { return readList(KEY) || DEFAULT_SHOWN.slice(); }
  function isShown(id) { return shownIds().includes(id); }
  // The ids in the more menu, in menu order: the saved order first, then every
  // folded toolbar button the saved order does not name, in toolbar order.
  function menuIds() {
    const bar = new Set(shownIds());
    const saved = (readList(MENU_KEY) || []).filter(id => !bar.has(id));
    const named = new Set(saved);
    return saved.concat(IDS.filter(id => !bar.has(id) && !named.has(id)));
  }
  // The toolbar buttons the bar folds away right now (ids). A panel in the menu is not one: see menuIds().
  function foldedIds() { return menuIds().filter(isBuiltin); }
  // Where an id is now: 'bar', 'menu' or 'none' (a panel that is only in the sidebar).
  function where(id) {
    if (shownIds().includes(id)) return 'bar';
    return menuIds().includes(id) ? 'menu' : 'none';
  }

  function announce() { window.dispatchEvent(new CustomEvent('vex:toolbar-shown')); }

  function save(bar, menu) {
    localStorage.setItem(KEY, JSON.stringify(bar));
    localStorage.setItem(MENU_KEY, JSON.stringify(menu));
    announce();
  }
  function check(id) {
    if (!isKnown(id)) throw new Error('[ToolbarLimit] unknown toolbar button: ' + id);
  }

  // Put an id in the bar or the menu (or, for a panel, nowhere), at a place in
  // that list (the end when no place is given).
  function place(id, to, index) {
    check(id);
    if (to !== 'bar' && to !== 'menu' && to !== 'none') throw new Error('[ToolbarLimit] cannot place a button in "' + to + '"');
    if (to === 'none' && isBuiltin(id)) throw new Error('[ToolbarLimit] a toolbar button goes to the bar or the menu, not nowhere: ' + id);
    const bar = shownIds().filter(x => x !== id);
    const menu = menuIds().filter(x => x !== id);
    const list = to === 'bar' ? bar : to === 'menu' ? menu : null;
    if (list) {
      const at = Number.isInteger(index) ? Math.max(0, Math.min(index, list.length)) : list.length;
      list.splice(at, 0, id);
    }
    save(bar, menu);
  }

  function setShown(id, on) {
    check(id);
    if (on) place(id, 'bar'); else place(id, isPanel(id) ? 'none' : 'menu');
  }

  // One step (delta -1 or 1) along the list the id is in, over the neighbours `skip` does not name (a button that is out of
  // sight, like the Inbox bell with nothing in it, is stepped over so the move shows). False when it is already at that end
  // (nothing written).
  function move(id, delta, skip) {
    check(id);
    const w = where(id);
    if (w === 'none') throw new Error('[ToolbarLimit] ' + id + ' is not in the toolbar or the menu');
    const list = w === 'bar' ? shownIds() : menuIds();
    const i = list.indexOf(id);
    let j = i + delta;
    while (j >= 0 && j < list.length && typeof skip === 'function' && skip(list[j])) j += delta;
    if (j < 0 || j >= list.length) return false;
    list.splice(i, 1);
    list.splice(j, 0, id);
    if (w === 'bar') save(list, menuIds()); else save(shownIds(), list);
    return true;
  }

  // Drop `id` next to `target`, in whichever list the target is in.
  function moveNextTo(id, target, after) {
    check(id); check(target);
    if (id === target) return;
    const w = where(target);
    if (w === 'none') throw new Error('[ToolbarLimit] ' + target + ' is not in the toolbar or the menu');
    const bar = shownIds().filter(x => x !== id);
    const menu = menuIds().filter(x => x !== id);
    const list = w === 'bar' ? bar : menu;
    list.splice(list.indexOf(target) + (after ? 1 : 0), 0, id);
    save(bar, menu);
  }

  // Two buttons trade places, also across the bar and the menu.
  function swap(a, b) {
    check(a); check(b);
    if (a === b) return;
    const bar = shownIds(), menu = menuIds();
    const wa = bar.includes(a) ? bar : menu.includes(a) ? menu : null;
    const wb = bar.includes(b) ? bar : menu.includes(b) ? menu : null;
    if (!wa || !wb) throw new Error('[ToolbarLimit] both buttons must be in the toolbar or the menu to swap');
    const ia = wa.indexOf(a), ib = wb.indexOf(b);
    wa[ia] = b;
    wb[ib] = a;
    save(bar, menu);
  }

  function reset() {
    localStorage.removeItem(KEY);
    localStorage.removeItem(MENU_KEY);
    announce();
  }

  // Once, before anything reads the key: a profile with its own toolbar layout
  // keeps every button where it was.
  function migrate() {
    if (localStorage.getItem(KEY) !== null) return false;
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return false;
    let L;
    try { L = JSON.parse(raw); } catch (err) { throw new Error('[ToolbarLimit] ' + LAYOUT_KEY + ' is not valid JSON: ' + err.message); }
    if (!L || typeof L !== 'object') return false;
    const hidden = L.hidden && typeof L.hidden === 'object' && Object.values(L.hidden).some(Boolean);
    const ordered = L.order && typeof L.order === 'object' && Object.values(L.order).some(a => Array.isArray(a) && a.length);
    const regions = Array.isArray(L.regions) && L.regions.length > 0;
    if (!hidden && !ordered && !regions) return false;
    // The layout editor's order for the right cluster first, so drawing the saved order does not undo it.
    const laid = L.order && Array.isArray(L.order['top-bar-right']) ? L.order['top-bar-right'].filter(isBuiltin) : [];
    const all = laid.concat(IDS.filter(id => !laid.includes(id)));
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  }

  // ---- Settings > Layout: "Show in toolbar" -------------------------------
  function renderSettings(box) {
    box.textContent = '';
    const shown = new Set(shownIds());
    for (const it of ITEMS) {
      const row = document.createElement('label');
      row.className = 'setting-toggle-row tb-limit-row';
      const name = document.createElement('span');
      name.textContent = it.label;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = shown.has(it.id);
      cb.dataset.tbId = it.id;
      cb.setAttribute('aria-label', 'Show ' + it.label + ' in toolbar');
      cb.addEventListener('change', () => setShown(it.id, cb.checked));
      row.append(name, cb);
      box.appendChild(row);
    }
  }

  function init() {
    migrate();
    const box = document.getElementById('toolbar-buttons-list');
    if (box) {
      renderSettings(box);
      window.addEventListener('vex:toolbar-shown', () => renderSettings(box));
      const resetBtn = document.getElementById('btn-toolbar-buttons-reset');
      if (resetBtn) resetBtn.addEventListener('click', reset);
      const custom = document.getElementById('btn-toolbar-customize');
      if (custom) {
        custom.addEventListener('click', () => {
          if (!window.ToolbarCustomize) throw new Error('[ToolbarLimit] the toolbar customizer has not finished loading yet; try again in a moment');
          window.ToolbarCustomize.open();
        });
      }
    }
  }

  const api = {
    KEY, MENU_KEY, ITEMS, IDS, DEFAULT_SHOWN, PANEL, PROXY_PREFIX,
    isPanel, isBuiltin, isKnown, panelOf, panelId, elementId,
    shownIds, isShown, menuIds, foldedIds, where,
    place, setShown, move, moveNextTo, swap, reset, migrate, init, renderSettings,
  };
  if (typeof window !== 'undefined') window.ToolbarLimit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof localStorage !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})();
