// === Toolbar limit — at most four icons on the right of the toolbar ===
// The right side of the address toolbar had grown to six or seven icon
// buttons. THE RULE: in normal use at most four icons are in sight by default:
// Downloads, Profiles, the "more" button that holds the rest, and the Inbox
// bell or the Settings gear. The bell and the gear are conditional extras that
// appear only when they have something to show (the bell while the Inbox holds
// something, the gear while the sidebar is off), so they do not crowd the bar.
// Every other button is folded into that "more" menu (js/toolbar-overflow.js):
// still one click and one arrow key away, and still on Ctrl+K and its own
// shortcut. "Show in toolbar" (Settings > Layout) puts any of them back.
//
//   vex.toolbarShown   JSON array of button ids kept in the toolbar. Absent
//                      means the default four above. Reset removes it.
//
// A profile that had already rearranged or hidden toolbar buttons (the layout
// editor's vex.layout) keeps what it had: migrate() writes every button as
// shown, once, so an update never takes a button away from someone who chose
// their toolbar. The layout editor's own hide still works on top of this.
(function () {
  'use strict';

  const KEY = 'vex.toolbarShown';
  const LAYOUT_KEY = 'vex.layout';

  // Every button that may be folded, in toolbar order, with its Settings label.
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
  const DEFAULT_SHOWN = ['btn-downloads-top', 'btn-profile', 'btn-attention', 'btn-settings-top'];

  function readStored() {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('[ToolbarLimit] ' + KEY + ' is not valid JSON: ' + err.message); }
    if (!Array.isArray(v)) throw new Error('[ToolbarLimit] ' + KEY + ' must be an array of button ids');
    return v;
  }

  function shownIds() { return readStored() || DEFAULT_SHOWN.slice(); }
  function isShown(id) { return shownIds().includes(id); }
  // The buttons the toolbar folds away right now (ids).
  function foldedIds() { const s = new Set(shownIds()); return IDS.filter(id => !s.has(id)); }

  function announce() { window.dispatchEvent(new CustomEvent('vex:toolbar-shown')); }

  function setShown(id, on) {
    if (!IDS.includes(id)) throw new Error('[ToolbarLimit] unknown toolbar button: ' + id);
    const s = new Set(shownIds());
    if (on) s.add(id); else s.delete(id);
    localStorage.setItem(KEY, JSON.stringify(IDS.filter(x => s.has(x))));
    announce();
  }

  function reset() { localStorage.removeItem(KEY); announce(); }

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
    localStorage.setItem(KEY, JSON.stringify(IDS));
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
    }
  }

  const api = { KEY, ITEMS, IDS, DEFAULT_SHOWN, shownIds, isShown, foldedIds, setShown, reset, migrate, init, renderSettings };
  if (typeof window !== 'undefined') window.ToolbarLimit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof localStorage !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})();
