// === Vex layout editor (Phase 1: toolbar + sidebar rail) ===
// "A browser built for you." An in-place customize mode: toggle it on and the
// top-toolbar buttons and the sidebar icon rail become drag-to-reorder and
// hideable, right where they live — no settings list to hunt through.
//
// Scope is deliberate:
//   • Toolbar buttons reorder WITHIN their group (left cluster, the back/fwd/
//     reload group, right cluster) — cross-zone moves are a later phase.
//   • The sidebar rail reuses the sidebar's OWN persistence (vex.sidebarOrder /
//     vex.panelOverrides via SidebarManager) so it stays in sync with the
//     Settings → Sidebar manager — one source of truth, no drift.
//   • Toolbar order/hidden live in their own vex.layout blob (auto-mirrored to
//     disk by storage.js, no IPC).
// The URL bar, window controls, logo and the Glass shortcuts bar are left alone.
const LayoutEditor = {
  KEY: 'vex.layout',

  // Toolbar groups: each item's DEFAULT home container + order. "Everything" in
  // the chrome is fair game — logo, workspace switcher, sync dot, the address bar
  // and its buttons — not just the plain nav buttons. Back/Fwd/Reload move as one
  // unit (#nav-buttons) so #top-bar-left has no fixed element in its middle,
  // which keeps cross-zone reconstruction clean.
  GROUPS: [
    { container: 'top-bar-left',  items: ['vex-logo', 'workspace-switcher', 'sync-indicator', 'btn-toggle-tabs-left', 'nav-buttons', 'btn-onboarding'] },
    { container: 'top-bar',       items: ['url-bar-wrapper'] },
    { container: 'url-bar',       items: ['btn-copy-url', 'btn-ai-summarize'] },
    { container: 'top-bar-right', items: ['btn-tor', 'btn-notes-top', 'btn-extensions', 'btn-toggle-ai', 'btn-split', 'btn-command'] },
  ],
  // Zones an item can be dragged BETWEEN (the top bar's button clusters + the
  // address-bar interior). Each holds interchangeable button-like controls.
  ZONES: ['top-bar-left', 'url-bar', 'top-bar-right'],
  // Whole top-bar sections that can be reordered as blocks (Phase 3) — e.g. move
  // the address bar to the left, or swap the two clusters. Grabbed by a grip so
  // it never clashes with dragging a button that lives inside a region.
  REGIONS: ['top-bar-left', 'url-bar-wrapper', 'top-bar-right'],
  LABELS: {
    'vex-logo': 'Vex logo', 'workspace-switcher': 'Workspace switcher', 'sync-indicator': 'Sync indicator',
    'btn-toggle-tabs-left': 'Sidebar toggle', 'nav-buttons': 'Back / Forward / Reload', 'btn-onboarding': 'Setup wizard',
    'url-bar-wrapper': 'Address bar', 'btn-copy-url': 'Copy URL', 'btn-ai-summarize': 'Summarize',
    'btn-tor': 'Tor', 'btn-notes-top': 'Notes', 'btn-extensions': 'Extensions',
    'btn-toggle-ai': 'AI panel', 'btn-split': 'Split screen', 'btn-command': 'Command bar',
  },

  _isZone(el) { return !!(el && el.id && this.ZONES.includes(el.id)); },
  // Where movable items sit inside a zone: before the window controls in the
  // right cluster (Classic keeps them there), appended otherwise.
  _zoneAnchor(zone) {
    if (zone.id === 'top-bar-right') { const wc = document.getElementById('window-controls'); return (wc && wc.parentElement === zone) ? wc : null; }
    return null;
  },

  _editing: false,

  _load() { try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch { return {}; } },
  _save(o) { try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch {} },

  _allToolbarIds() { return this.GROUPS.reduce((a, g) => a.concat(g.items), []); },

  // The Glass shortcuts live in vex.shortcuts (an absent key means "show the
  // defaults" — matching gui-style.js's loadShortcuts). We read/write that key
  // directly and let VexGuiStyle.render() repaint the bar — VexGuiStyle.set is
  // the GUI-STYLE setter, not this.
  _shortcuts() {
    try { const sc = JSON.parse(localStorage.getItem('vex.shortcuts') || 'null'); if (Array.isArray(sc)) return sc.filter(s => s && s.url); } catch {}
    try { return (window.VexGuiStyle && VexGuiStyle.defaults()) || []; } catch { return []; }
  },
  _setShortcuts(arr) {
    try { localStorage.setItem('vex.shortcuts', JSON.stringify(arr)); } catch {}
    try { if (window.VexGuiStyle && VexGuiStyle.render) VexGuiStyle.render(); } catch {}
  },

  // Apply saved toolbar order + hidden state. Called on boot and whenever the
  // GUI style changes (Glass relocates the window controls, which can shift the
  // right cluster's anchor). The rail is applied by SidebarManager itself.
  applyLayout() {
    const L = this._load();
    const order = L.order || {};
    // Region order: reorder the whole sections inside #top-bar (the drag region
    // overlay is absolute, so leaving it in place is fine). Done before items so
    // zone placement below still lands correctly inside each moved region.
    if (Array.isArray(L.regions) && L.regions.length) {
      const topbar = document.getElementById('top-bar');
      if (topbar) L.regions.forEach(id => { const n = document.getElementById(id); if (n && this.REGIONS.includes(id)) topbar.appendChild(n); });
    }
    // Cross-zone placement: an item's home is whichever zone lists its id (each
    // id is listed in at most one). Move each into its zone, in the saved order.
    // Items not listed anywhere keep their HTML-default spot.
    this.ZONES.forEach(zoneId => {
      const zone = document.getElementById(zoneId); if (!zone) return;
      const ids = order[zoneId]; if (!ids || !ids.length) return;
      const anchor = this._zoneAnchor(zone);
      ids.forEach(id => { const n = document.getElementById(id); if (n) zone.insertBefore(n, anchor); });
    });
    const hidden = L.hidden || {};
    this._allToolbarIds().forEach(id => {
      const n = document.getElementById(id);
      if (n) n.style.display = hidden[id] ? 'none' : '';
    });
  },

  // ---- Enter / exit the in-place editor ----
  toggle() { this._editing ? this.exit() : this.enter(); },

  enter() {
    if (this._editing) return;
    this._editing = true;
    this._injectStyle();
    document.body.classList.add('layout-editing');
    // Bind handlers once so we can detach exactly these on exit.
    this._onDragStart = this._onDragStart || this._dragStart.bind(this);
    this._onDragOver = this._onDragOver || this._dragOver.bind(this);
    this._onDrop = this._onDrop || this._drop.bind(this);
    this._onDragEnd = this._onDragEnd || this._dragEnd.bind(this);
    this._onZoneDragOver = this._onZoneDragOver || this._zoneDragOver.bind(this);
    this._onRegionDragStart = this._onRegionDragStart || this._regionDragStart.bind(this);
    this._onRegionDragOver = this._onRegionDragOver || this._regionDragOver.bind(this);
    this._onRegionDrop = this._onRegionDrop || this._regionDrop.bind(this);
    this._onRegionDragEnd = this._onRegionDragEnd || this._regionDragEnd.bind(this);
    this._clickBlocker = this._clickBlocker || ((e) => {
      const item = e.target.closest && e.target.closest('[data-layout-item]');
      if (item && !(e.target.closest && e.target.closest('.le-ctl'))) { e.preventDefault(); e.stopPropagation(); }
    });
    document.addEventListener('click', this._clickBlocker, true);
    this.ZONES.forEach(id => { const z = document.getElementById(id); if (z) z.addEventListener('dragover', this._onZoneDragOver); });
    this._decorated = new Set();
    this._decorate();
    this._decorateRegions();
    this._buildBar();
    try { window.showToast?.('🧩 Edit layout — drag to reorder, ✕ to hide'); } catch {}
  },

  exit() {
    if (!this._editing) return;
    this._editing = false;
    document.body.classList.remove('layout-editing');
    document.removeEventListener('click', this._clickBlocker, true);
    this.ZONES.forEach(id => { const z = document.getElementById(id); if (z) z.removeEventListener('dragover', this._onZoneDragOver); });
    const nodes = this._decorated ? Array.from(this._decorated) : Array.from(document.querySelectorAll('[data-layout-item]'));
    nodes.forEach(n => {
      n.removeAttribute('data-layout-item');
      n.removeAttribute('draggable');
      n.removeEventListener('dragstart', this._onDragStart);
      n.removeEventListener('dragover', this._onDragOver);
      n.removeEventListener('drop', this._onDrop);
      n.removeEventListener('dragend', this._onDragEnd);
      delete n._leItem;
    });
    // Region grips + listeners.
    this.REGIONS.forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      el.classList.remove('le-region', 'le-region-dragging');
      el.removeEventListener('dragover', this._onRegionDragOver);
      el.removeEventListener('drop', this._onRegionDrop);
    });
    // Global sweep: a shortcuts-bar re-render (VexGuiStyle.set) can strand ✕
    // badges on replaced chips, so never rely on the tracked set alone here.
    document.querySelectorAll('.le-x, .le-region-grip').forEach(x => x.remove());
    document.querySelectorAll('[data-layout-item]').forEach(n => n.removeAttribute('data-layout-item'));
    this._decorated = null;
    if (this._bar) { this._bar.remove(); this._bar = null; }
  },

  // Every editable chrome element, each tagged with the region that owns its
  // persistence: 'toolbar' (vex.layout), 'rail' (SidebarManager), 'shortcuts'
  // (VexGuiStyle / vex.shortcuts).
  _editableItems() {
    const list = [];
    // Find each known toolbar control by id WHEREVER it currently lives — after a
    // cross-zone move its parent no longer matches its default group container.
    this.GROUPS.forEach(g => {
      g.items.forEach(id => { const n = document.getElementById(id); if (n && n.parentElement) list.push({ n, region: 'toolbar', container: n.parentElement.id, id }); });
    });
    const rail = document.getElementById('icon-sidebar');
    if (rail) {
      for (const el of Array.from(rail.children)) {
        if (el.classList && el.classList.contains('sidebar-spacer')) break;
        if (el.classList && el.classList.contains('sidebar-icon') && el.dataset.panel) list.push({ n: el, region: 'rail', panel: el.dataset.panel });
      }
    }
    const sbar = document.getElementById('gui-shortcuts-bar');    // Glass speed-dial chips
    if (sbar) {
      Array.from(sbar.querySelectorAll('.gsc:not(.gsc-add)')).forEach((el, idx) => {
        el.dataset.scIdx = idx;
        list.push({ n: el, region: 'shortcuts', idx });
      });
    }
    return list;
  },

  _decorate() {
    this._decorated = this._decorated || new Set();
    this._editableItems().forEach(it => {
      const n = it.n;
      if (!n.offsetWidth && !n.offsetHeight) return;            // not visible (hidden / display:none) → skip
      if (this._decorated.has(n)) return;                       // idempotent — no duplicate listeners
      this._decorated.add(n);
      n._leItem = it;
      n.setAttribute('data-layout-item', '1');
      n.setAttribute('draggable', 'true');
      if (!n.querySelector(':scope > .le-x')) {
        const x = document.createElement('span');
        x.className = 'le-x le-ctl';
        x.textContent = '✕';
        x.title = it.region === 'shortcuts' ? 'Remove this shortcut' : 'Hide';
        x.setAttribute('draggable', 'false');
        x.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
        x.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); this._hide(n._leItem); });
        n.appendChild(x);
      }
      n.addEventListener('dragstart', this._onDragStart);
      n.addEventListener('dragover', this._onDragOver);
      n.addEventListener('drop', this._onDrop);
      n.addEventListener('dragend', this._onDragEnd);
    });
  },

  // ---- Drag to reorder / move between zones ----
  // Toolbar buttons in a zone can be dropped into ANY zone (Tor to the left,
  // Back to the right, a button into the address bar). Rail icons and shortcut
  // chips reorder only within their own container.
  _dragStart(e) {
    const item = e.target.closest('[data-layout-item]'); if (!item) return;
    this._drag = item; this._dragContainer = item.parentElement;
    this._dragRegion = (item._leItem && item._leItem.region) || 'toolbar';
    this._dragCross = this._dragRegion === 'toolbar' && this._isZone(item.parentElement);
    item.classList.add('le-dragging');
    try { e.dataTransfer.setData('text/plain', 'le'); e.dataTransfer.effectAllowed = 'move'; } catch {}
  },
  _dragOver(e) {
    if (!this._drag) return;
    const over = e.target.closest('[data-layout-item]');
    if (!over || over === this._drag) return;
    const dest = over.parentElement;
    const sameContainer = dest === this._drag.parentElement;
    if (!sameContainer && !(this._dragCross && this._isZone(dest))) return;
    e.preventDefault();
    const r = over.getBoundingClientRect();
    const horizontal = dest.id !== 'icon-sidebar';
    const before = horizontal ? (e.clientX < r.left + r.width / 2) : (e.clientY < r.top + r.height / 2);
    dest.insertBefore(this._drag, before ? over : over.nextSibling);
  },
  // Dropping onto a zone's empty space (past its buttons) drops at the end.
  _zoneDragOver(e) {
    if (!this._drag || !this._dragCross) return;
    const zone = e.currentTarget;
    if (!this._isZone(zone)) return;
    if (e.target.closest('[data-layout-item]')) return;         // an item handles it
    e.preventDefault();
    zone.insertBefore(this._drag, this._zoneAnchor(zone));
  },
  _drop(e) { if (this._drag) e.preventDefault(); },
  _dragEnd() {
    if (!this._drag) return;
    this._drag.classList.remove('le-dragging');
    if (this._dragRegion === 'toolbar') this._persistToolbar();
    else this._persistOrder(this._drag.parentElement);          // rail / shortcuts
    this._drag = null; this._dragContainer = null; this._dragRegion = null; this._dragCross = false;
  },

  // Snapshot every zone's current button order (cross-zone moves touch two zones).
  _persistToolbar() {
    const L = this._load(); L.order = L.order || {};
    this.ZONES.forEach(zoneId => {
      const zone = document.getElementById(zoneId); if (!zone) return;
      L.order[zoneId] = Array.from(zone.children).filter(n => n.hasAttribute && n.hasAttribute('data-layout-item')).map(n => n.id).filter(Boolean);
    });
    this._save(L);
  },

  // ---- Region drag (Phase 3): move whole sections by their grip ----
  _decorateRegions() {
    this.REGIONS.forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      el.classList.add('le-region');
      if (!el.querySelector(':scope > .le-region-grip')) {
        const g = document.createElement('span');
        g.className = 'le-region-grip le-ctl';
        g.textContent = '⠿';
        g.title = 'Drag to move this whole section';
        g.setAttribute('draggable', 'true');
        g.addEventListener('dragstart', this._onRegionDragStart);
        g.addEventListener('dragend', this._onRegionDragEnd);
        el.appendChild(g);
      }
      el.addEventListener('dragover', this._onRegionDragOver);
      el.addEventListener('drop', this._onRegionDrop);
    });
  },
  _regionDragStart(e) {
    const grip = e.target.closest('.le-region-grip'); if (!grip) return;
    this._regionDrag = grip.parentElement;
    e.stopPropagation();
    this._regionDrag.classList.add('le-region-dragging');
    try { e.dataTransfer.setData('text/plain', 'region'); e.dataTransfer.effectAllowed = 'move'; } catch {}
  },
  _regionDragOver(e) {
    if (!this._regionDrag) return;
    const over = e.currentTarget;
    if (over === this._regionDrag || !this.REGIONS.includes(over.id)) return;
    e.preventDefault(); e.stopPropagation();
    const topbar = document.getElementById('top-bar'); if (!topbar) return;
    const r = over.getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    topbar.insertBefore(this._regionDrag, before ? over : over.nextSibling);
  },
  _regionDrop(e) { if (this._regionDrag) { e.preventDefault(); e.stopPropagation(); } },
  _regionDragEnd() {
    if (!this._regionDrag) return;
    this._regionDrag.classList.remove('le-region-dragging');
    this._persistRegions();
    this._regionDrag = null;
  },
  _persistRegions() {
    const topbar = document.getElementById('top-bar'); if (!topbar) return;
    const order = Array.from(topbar.children).filter(n => this.REGIONS.includes(n.id)).map(n => n.id);
    const L = this._load(); L.regions = order; this._save(L);
  },

  _persistOrder(container) {
    if (!container) return;
    if (container.id === 'icon-sidebar') {
      const panels = [];
      for (const el of Array.from(container.children)) {
        if (el.classList && el.classList.contains('sidebar-spacer')) break;
        if (el.classList && el.classList.contains('sidebar-icon') && el.dataset.panel) panels.push(el.dataset.panel);
      }
      try { SidebarManager._saveOrder(panels); } catch {}
    } else if (container.id === 'gui-shortcuts-bar') {
      // Rebuild the shortcuts array to match the new chip order (each chip
      // remembers its original index). Writing vex.shortcuts re-renders the bar,
      // so re-decorate the fresh chips afterwards.
      const arr = this._shortcuts();
      const reordered = Array.from(container.querySelectorAll('.gsc:not(.gsc-add)'))
        .map(c => arr[parseInt(c.dataset.scIdx, 10)]).filter(Boolean);
      if (reordered.length === arr.length && arr.length) { this._setShortcuts(reordered); this._refresh(); }
    } else {
      const L = this._load(); L.order = L.order || {};
      L.order[container.id] = Array.from(container.children).filter(n => n.hasAttribute && n.hasAttribute('data-layout-item')).map(n => n.id).filter(Boolean);
      this._save(L);
    }
  },

  // ---- Hide / restore ----
  _hide(it) {
    if (!it) return;
    if (it.region === 'rail') {
      try { SidebarManager.setPanelOverride(it.panel, { hidden: true }); } catch {}
    } else if (it.region === 'shortcuts') {
      // Shortcuts are your own content — ✕ removes it (re-add with the + chip).
      const arr = this._shortcuts();
      const idx = parseInt(it.n.dataset.scIdx, 10);
      if (idx >= 0 && idx < arr.length) { arr.splice(idx, 1); this._setShortcuts(arr); }
    } else {
      const L = this._load(); L.hidden = L.hidden || {}; L.hidden[it.id] = true; this._save(L);
      const n = document.getElementById(it.id); if (n) n.style.display = 'none';
    }
    this._refresh();
  },

  _restore(item) {
    if (item.region === 'rail') {
      try { SidebarManager.setPanelOverride(item.panel, { hidden: false }); } catch {}
    } else {
      const L = this._load(); if (L.hidden) delete L.hidden[item.id]; this._save(L);
      const n = document.getElementById(item.id); if (n) n.style.display = '';
    }
    this._refresh();
  },

  // Everything currently hidden, for the restore tray.
  _hiddenList() {
    const out = [];
    const L = this._load(); const th = L.hidden || {};
    this._allToolbarIds().forEach(id => { if (th[id]) out.push({ region: 'toolbar', id, label: this.LABELS[id] || id }); });
    let ov = {}; try { ov = JSON.parse(localStorage.getItem('vex.panelOverrides') || '{}'); } catch {}
    const rail = document.getElementById('icon-sidebar');
    if (rail) {
      for (const el of Array.from(rail.children)) {
        if (el.classList && el.classList.contains('sidebar-spacer')) break;
        if (el.classList && el.classList.contains('sidebar-icon') && el.dataset.panel) {
          const p = el.dataset.panel;
          if (ov[p] && ov[p].hidden) out.push({ region: 'rail', panel: p, label: (ov[p].name || el.title || p) });
        }
      }
    }
    return out;
  },

  _resetToolbar() {
    const L = this._load(); L.order = {}; L.hidden = {}; L.regions = []; this._save(L);
    // Regions back to default order.
    const topbar = document.getElementById('top-bar');
    if (topbar) this.REGIONS.forEach(id => { const n = document.getElementById(id); if (n) topbar.appendChild(n); });
    // Move every control back into its DEFAULT zone, in default order (this also
    // pulls back anything that had crossed into another zone), and un-hide all.
    this.GROUPS.forEach(g => {
      if (!this.ZONES.includes(g.container)) return;            // address bar (non-zone) stays put
      const zone = document.getElementById(g.container); if (!zone) return;
      const anchor = this._zoneAnchor(zone);
      g.items.forEach(id => { const n = document.getElementById(id); if (n) zone.insertBefore(n, anchor); });
    });
    this._allToolbarIds().forEach(id => { const n = document.getElementById(id); if (n) n.style.display = ''; });
    this._refresh();
    try { window.showToast?.('Toolbar layout reset'); } catch {}
  },

  // One-click preset layouts (Phase 4). Each is a full vex.layout blob applied on
  // top of a clean slate. "Default" clears everything.
  PRESETS: {
    minimal: { hidden: { 'sync-indicator': 1, 'btn-onboarding': 1, 'btn-tor': 1, 'btn-notes-top': 1, 'btn-extensions': 1, 'btn-copy-url': 1, 'btn-ai-summarize': 1, 'workspace-switcher': 1 }, order: {}, regions: [] },
    essentials: { hidden: { 'btn-onboarding': 1, 'sync-indicator': 1, 'btn-tor': 1 }, order: {}, regions: [] },
  },
  applyPreset(name) {
    if (name === 'default') { this._resetToolbar(); return; }
    const p = this.PRESETS[name]; if (!p) return;
    this._save(JSON.parse(JSON.stringify(p)));
    // Reset positions to default first, then apply the preset's hides.
    this.GROUPS.forEach(g => {
      if (!this.ZONES.includes(g.container)) return;
      const zone = document.getElementById(g.container); if (!zone) return;
      const anchor = this._zoneAnchor(zone);
      g.items.forEach(id => { const n = document.getElementById(id); if (n) zone.insertBefore(n, anchor); });
    });
    const topbar = document.getElementById('top-bar');
    if (topbar) this.REGIONS.forEach(id => { const n = document.getElementById(id); if (n) topbar.appendChild(n); });
    this.applyLayout();
    this._refresh();
    try { window.showToast?.('Applied the ' + name + ' layout'); } catch {}
  },

  _refresh() { if (this._editing) { this._decorate(); this._decorateRegions(); this._renderTray(); } },

  // ---- Floating control bar ----
  _buildBar() {
    if (this._bar) this._bar.remove();
    const bar = document.createElement('div');
    bar.id = 'le-bar'; bar.className = 'le-ctl';
    bar.innerHTML =
      '<span class="le-bar-title">🧩 Editing layout</span>' +
      '<div id="le-tray" class="le-tray"></div>' +
      '<div class="le-bar-actions">' +
        '<span class="le-tray-label" style="opacity:.7">Presets:</span>' +
        '<button id="le-preset-default" class="le-btn" title="Everything visible, default order">Default</button>' +
        '<button id="le-preset-essentials" class="le-btn" title="Hide the rarely-used extras">Essentials</button>' +
        '<button id="le-preset-minimal" class="le-btn" title="Strip the toolbar down to the basics">Minimal</button>' +
        '<button id="le-reset" class="le-btn" title="Reset the toolbar buttons to default (sidebar resets live in Settings → Sidebar)">Reset</button>' +
        '<button id="le-done" class="le-btn le-primary">Done ✓</button>' +
      '</div>';
    document.body.appendChild(bar);
    this._bar = bar;
    bar.querySelector('#le-done').addEventListener('click', () => this.exit());
    bar.querySelector('#le-reset').addEventListener('click', () => this._resetToolbar());
    bar.querySelector('#le-preset-default').addEventListener('click', () => this.applyPreset('default'));
    bar.querySelector('#le-preset-essentials').addEventListener('click', () => this.applyPreset('essentials'));
    bar.querySelector('#le-preset-minimal').addEventListener('click', () => this.applyPreset('minimal'));
    this._renderTray();
  },

  _renderTray() {
    const tray = this._bar && this._bar.querySelector('#le-tray'); if (!tray) return;
    const list = this._hiddenList();
    tray.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'le-tray-label' + (list.length ? '' : ' le-muted');
    label.textContent = list.length ? 'Hidden — click to restore:' : 'Nothing hidden';
    tray.appendChild(label);
    list.forEach(it => {
      const c = document.createElement('button');
      c.className = 'le-chip'; c.textContent = '+ ' + it.label;
      c.addEventListener('click', () => this._restore(it));
      tray.appendChild(c);
    });
  },

  _injectStyle() {
    if (document.getElementById('le-style')) return;
    const css = `
      body.layout-editing [data-layout-item]{ position:relative; outline:1.5px dashed var(--accent,#d4a574); outline-offset:2px; border-radius:6px; cursor:grab; }
      body.layout-editing [data-layout-item].le-dragging{ opacity:.4; cursor:grabbing; }
      body.layout-editing #icon-sidebar [data-layout-item]{ outline-offset:-2px; }
      .le-x{ position:absolute; top:-6px; right:-6px; width:15px; height:15px; border-radius:50%; background:#e5484d; color:#fff; font-size:9px; line-height:15px; text-align:center; cursor:pointer; z-index:6; box-shadow:0 1px 3px rgba(0,0,0,.45); }
      .le-x:hover{ transform:scale(1.15); }
      body.layout-editing .le-region{ position:relative; outline:2px solid var(--primary,var(--accent,#d4a574)); outline-offset:-2px; border-radius:8px; }
      body.layout-editing .le-region.le-region-dragging{ opacity:.5; }
      .le-region-grip{ position:absolute; top:1px; left:1px; z-index:8; width:15px; height:15px; border-radius:4px; background:var(--primary,var(--accent,#d4a574)); color:#111; font-size:11px; line-height:15px; text-align:center; cursor:grab; box-shadow:0 1px 3px rgba(0,0,0,.4); }
      .le-region-grip:active{ cursor:grabbing; }
      #le-bar{ position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:100000; display:flex; gap:14px; align-items:center; flex-wrap:wrap; max-width:92vw;
        background:var(--surface,#222); color:var(--text,#eee); border:1px solid var(--border,#444); border-radius:12px; padding:10px 14px; box-shadow:0 8px 30px rgba(0,0,0,.4); font-family:'Outfit',sans-serif; }
      #le-bar .le-bar-title{ font-size:12.5px; font-weight:600; }
      #le-bar .le-tray{ display:flex; gap:6px; align-items:center; flex-wrap:wrap; max-width:52vw; }
      #le-bar .le-tray-label{ font-size:11px; opacity:.75; } #le-bar .le-muted{ opacity:.45; }
      #le-bar .le-chip{ background:var(--surface-2,var(--surface,#333)); border:1px solid var(--border,#555); color:var(--text,#eee); border-radius:14px; padding:3px 9px; font-size:11px; cursor:pointer; }
      #le-bar .le-chip:hover{ background:var(--accent,#d4a574); color:#111; border-color:transparent; }
      #le-bar .le-btn{ background:var(--surface-2,var(--surface,#333)); border:1px solid var(--border,#555); color:var(--text,#eee); border-radius:8px; padding:6px 12px; font-size:12.5px; cursor:pointer; }
      #le-bar .le-btn:hover{ filter:brightness(1.12); }
      #le-bar .le-primary{ background:var(--primary,var(--accent,#d4a574)); color:#111; font-weight:600; border-color:transparent; }
    `;
    const style = document.createElement('style');
    style.id = 'le-style'; style.textContent = css;
    document.head.appendChild(style);
  },

  init() {
    try { this.applyLayout(); } catch {}
    window.addEventListener('vex:gui-style', () => { try { this.applyLayout(); } catch {} });
    // Settings → Appearance → Layout → "Edit layout": close Settings so the
    // toolbar/rail are visible, then drop into customize mode.
    const btn = document.getElementById('btn-edit-layout');
    if (btn) btn.addEventListener('click', () => {
      try { SidebarManager.hideActivePanel?.(); } catch {}
      this.enter();
    });
  },
};

if (typeof window !== 'undefined') {
  window.LayoutEditor = LayoutEditor;
  if (document.readyState !== 'loading') LayoutEditor.init();
  else document.addEventListener('DOMContentLoaded', () => LayoutEditor.init());
}
if (typeof module !== 'undefined' && module.exports) module.exports = { LayoutEditor };
