// === Vex Settings UI enhancer ===
// Turns the flat list of .setting-group blocks into vivid, color-coded category
// cards and builds a sticky chip-nav to jump between them. Pure presentation —
// it never touches the existing inputs/ids, so all settings handlers keep working.
// Called by SidebarManager.showPanel whenever Settings opens (idempotent).

const SettingsUI = {
  // Small inline SVGs (stroked with currentColor so they follow the category
  // colour and the theme). Rendered inside a shared 24x24 viewBox.
  ICONS: {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H13a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3.3-4-6-9-6Z"/><circle cx="8" cy="10" r="1.1"/><circle cx="12" cy="7.5" r="1.1"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.7-7 9c-4.1-1.3-7-4.8-7-9V6l7-3Z"/>',
    pencil: '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="M14 6l4 4"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7l8-11h-6l1-7Z"/>',
    save: '<path d="M5 4h11l3 3v13H5V4Z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    folders: '<path d="M3 8V6a2 2 0 0 1 2-2h3l2 2h5a2 2 0 0 1 2 2v1"/><rect x="3" y="8" width="18" height="12" rx="2"/>',
    pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 3v6h-6"/>',
    spark: '<path d="M12 3l2.1 5.6L20 11l-5.9 2.4L12 19l-2.1-5.6L4 11l5.9-2.4L12 3Z"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.6A6 6 0 0 1 21 20"/>',
    memory: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    plug: '<path d="M9 3v6M15 3v6"/><path d="M6 9h12v3a6 6 0 0 1-12 0V9Z"/><path d="M12 18v3"/>',
    star: '<path d="M12 4l2.4 5.2l5.6.7l-4.1 3.8l1.1 5.5L12 16.5L7 19.2l1.1-5.5L4 9.9l5.6-.7L12 4Z"/>',
    rocket: '<path d="M12 3c3.5 2 5.5 5.5 5.5 9.5L14 16h-4l-3.5-3.5C6.5 8.5 8.5 5 12 3Z"/><path d="M10 16l-2 5l4-2l4 2l-2-5"/>',
    key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15.5 12v2.5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17h14"/>',
    bookOpen: '<path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2c1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2Z"/><path d="M12 6.5V19"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7L11.5 7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7L12.5 17"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
    layers: '<path d="M12 3l9 5l-9 5l-9-5l9-5Z"/><path d="M3 13l9 5l9-5"/>',
    cursor: '<path d="M6 3l12 8l-5 1.2L15.5 18l-2.4 1l-2.6-5.6L6 17V3Z"/>',
    puzzle: '<path d="M10 4h4v2.2a1.8 1.8 0 1 0 3.6 0V4H20v4h-2.2a1.8 1.8 0 1 0 0 3.6H20V20h-4.4v-2.2a1.8 1.8 0 1 0-3.6 0V20H4v-4.4h2.2a1.8 1.8 0 1 0 0-3.6H4V8h6V4Z"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    cloud: '<path d="M7 18a4 4 0 0 1 .6-8A5.5 5.5 0 0 1 18 10.5a3.75 3.75 0 0 1-.4 7.5H7Z"/>',
    box: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5v-9Z"/><path d="M3 7.5L12 12l9-4.5M12 12v9"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>',
  },

  // First match wins, so the order matters: "Tab Layout" has to reach Appearance
  // before the Layout row, and "Personalization" has to reach its own category
  // before Personas (it contains the substring "persona") — it used to be filed
  // under Personas and got no nav chip of its own.
  CATS: [
    { name: 'General',         icon: 'search',   color: '#6366f1', match: ['general', 'search engine'] },
    { name: 'Browser',         icon: 'globe',    color: '#0ea5e9', match: ['default browser'] },
    { name: 'Appearance',      icon: 'palette',  color: '#a855f7', match: ['appearance', 'theme', 'gui style', 'tab layout'] },
    { name: 'Layout',          icon: 'grid',     color: '#c084fc', match: ['layout'] },
    { name: 'Sidebar',         icon: 'panel',    color: '#818cf8', match: ['sidebar'] },
    { name: 'Privacy',         icon: 'shield',   color: '#22c55e', match: ['privacy', 'security'] },
    { name: 'Autofill',        icon: 'pencil',   color: '#4ade80', match: ['autofill'] },
    { name: 'Performance',     icon: 'bolt',     color: '#f97316', match: ['performance', 'sleep'] },
    { name: 'Sessions',        icon: 'save',     color: '#f59e0b', match: ['session'] },
    { name: 'Workspaces',      icon: 'folders',  color: '#14b8a6', match: ['workspace'] },
    { name: 'Location',        icon: 'pin',      color: '#ef4444', match: ['location'] },
    { name: 'Sync',            icon: 'refresh',  color: '#06b6d4', match: ['sync'] },
    { name: 'AI',              icon: 'spark',    color: '#d4a574', match: ['ai backend', 'assistant'] },
    { name: 'Personalization', icon: 'user',     color: '#f0abfc', match: ['personalization'] },
    { name: 'Personas',        icon: 'users',    color: '#8b5cf6', match: ['persona'] },
    { name: 'AI Memory',       icon: 'memory',   color: '#c084fc', match: ['ai memory'] },
    { name: 'On-Device',       icon: 'monitor',  color: '#2dd4bf', match: ['on-device', 'webgpu'] },
    { name: 'MCP',             icon: 'plug',     color: '#38bdf8', match: ['mcp'] },
    { name: 'Skills',          icon: 'star',     color: '#fbbf24', match: ['skill'] },
    { name: 'Boosts',          icon: 'rocket',   color: '#f472b6', match: ['boost'] },
    { name: 'Passwords',       icon: 'key',      color: '#34d399', match: ['password'] },
    { name: 'Focus',           icon: 'target',   color: '#fb7185', match: ['focus'] },
    { name: 'Library',         icon: 'book',     color: '#38bdf8', match: ['library'] },
    { name: 'Reading',         icon: 'bookOpen', color: '#818cf8', match: ['reading', 'accessibility'] },
    { name: 'Recall',          icon: 'clock',    color: '#2dd4bf', match: ['recall'] },
    { name: 'Chains',          icon: 'link',     color: '#a3a3a3', match: ['chain'] },
    { name: 'Shortcuts',       icon: 'keyboard', color: '#94a3b8', match: ['shortcut'] },
    { name: 'Tab Groups',      icon: 'layers',   color: '#fb923c', match: ['tab grouping'] },
    { name: 'History',         icon: 'clock',    color: '#7dd3fc', match: ['history'] },
    { name: 'Extras',          icon: 'cursor',   color: '#60a5fa', match: ['browsing extras', 'gesture'] },
    { name: 'Extensions',      icon: 'puzzle',   color: '#10b981', match: ['extension'] },
    { name: 'Permissions',     icon: 'lock',     color: '#eab308', match: ['permission'] },
    { name: 'Cloud',           icon: 'cloud',    color: '#67e8f9', match: ['cloud'] },
    { name: 'Data',            icon: 'box',      color: '#ec4899', match: ['data', 'reset', 'export'] },
    { name: 'About',           icon: 'info',     color: '#64748b', match: ['about', 'version', 'update'] },
  ],

  // Which tab layout actually applies, given the stored Tab Layout choice and
  // the active GUI style. Glass and the browser looks lay the window out
  // themselves (body[data-gui-style] is set only for those), so they win over
  // the stored choice — applying a stored 'vertical' under one of them put the
  // top tab strip and the vertical rail on screen at the same time.
  resolveTabLayout(stored, guiStyle) {
    if (guiStyle) return 'horizontal';
    return stored === 'vertical' ? 'vertical' : 'horizontal';
  },

  // One <svg> wrapper for every category mark.
  _svg(iconName, size) {
    const body = this.ICONS[iconName] || this.ICONS.gear;
    return '<svg class="set-cat-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  },

  _matchCat(text) {
    for (const c of this.CATS) {
      if (c.match.some(m => text.includes(m))) return c;
    }
    return { name: 'Other', icon: 'gear', color: 'var(--primary)' };
  },

  // Live-filter the setting groups by the search query. Hiding the chip nav while
  // searching keeps the result list clean.
  _filter(root, query) {
    const q = (query || '').trim().toLowerCase();
    const groups = Array.from(root.querySelectorAll('.setting-group'));
    let any = false;
    groups.forEach(g => {
      const match = !q || (g.textContent || '').toLowerCase().includes(q);
      g.style.display = match ? '' : 'none';
      if (match) any = true;
    });
    const nav = (root.parentElement || root).querySelector('.set-nav');
    if (nav) nav.style.display = q ? 'none' : '';
    this._syncPad(root);
    let empty = root.querySelector('.set-empty');
    if (q && !any) {
      if (!empty) { empty = document.createElement('div'); empty.className = 'set-empty'; empty.style.cssText = 'color:var(--text-muted);font-size:13px;padding:20px 4px'; root.appendChild(empty); }
      empty.textContent = 'No settings match “' + query + '”.';
      empty.style.display = '';
    } else if (empty) { empty.style.display = 'none'; }
  },

  enhance() {
    const root = document.querySelector('#panel-settings .settings-content');
    if (!root) return;
    const groups = Array.from(root.children).filter(el => el.classList && el.classList.contains('setting-group'));
    if (!groups.length) return;

    // Build the toolbar (search + chip nav) as a FIXED flex header OUTSIDE the
    // scrolling .settings-content — i.e. a sibling in #panel-settings (a flex
    // column). This pins it reliably without depending on position:sticky, which
    // proved flaky in this layout.
    const panel = root.parentElement || root;            // #panel-settings
    let toolbar = panel.querySelector('.set-toolbar');
    let nav, search;
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'set-toolbar';
      const inner = document.createElement('div');
      inner.className = 'set-toolbar-inner';
      search = document.createElement('input');
      search.className = 'set-search';
      search.type = 'search';
      search.placeholder = 'Search settings…';
      search.spellcheck = false;
      nav = document.createElement('div');
      nav.className = 'set-nav';
      inner.appendChild(search);
      inner.appendChild(nav);
      toolbar.appendChild(inner);
      panel.insertBefore(toolbar, root);                 // pinned over the scroll area
      search.addEventListener('input', () => SettingsUI._filter(root, search.value));
      // Keep the scroll area's top padding matched to the (variable-height) toolbar.
      window.addEventListener('resize', () => SettingsUI._syncPad(root));
    } else {
      nav = toolbar.querySelector('.set-nav');
      search = toolbar.querySelector('.set-search');
    }
    nav.innerHTML = '';
    const seen = new Set();

    groups.forEach((g, i) => {
      const labelEl = g.querySelector('.setting-label');
      const text = (labelEl ? labelEl.textContent : '').toLowerCase();
      const cat = this._matchCat(text);
      g.style.setProperty('--cat-color', cat.color);
      if (!g.id) g.id = 'setcat-' + i;

      if (labelEl && !labelEl.querySelector('.set-emoji')) {
        const chip = document.createElement('span');
        chip.className = 'set-emoji';
        chip.innerHTML = this._svg(cat.icon, 15);
        labelEl.insertBefore(chip, labelEl.firstChild);
      }

      if (!seen.has(cat.name)) {
        seen.add(cat.name);
        const navChip = document.createElement('button');
        navChip.className = 'set-nav-chip';
        navChip.style.setProperty('--chip-color', cat.color);
        navChip.innerHTML = this._svg(cat.icon, 13) + '<span>' + cat.name + '</span>';
        navChip.addEventListener('click', () => g.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        nav.appendChild(navChip);
      }
    });

    // Push the scroll content below the absolute toolbar (and let anchored jumps
    // clear it too). Measured after the chips are in, so wrapping is accounted for.
    this._syncPad(root);
  },

  // Match the scroll area's top padding + scroll-padding to the toolbar height.
  _syncPad(root) {
    if (!root) return;
    const panel = root.parentElement || root;
    const tb = panel.querySelector('.set-toolbar');
    if (!tb) return;
    const h = (tb.offsetHeight || 88) + 8;
    root.style.paddingTop = h + 'px';
    root.style.scrollPaddingTop = h + 'px';
  },

  // Deep link into a settings sub-section: open the Settings panel, scroll the
  // element with the given id into view and flash it briefly. Retries over a
  // few animation frames instead of a timing-sensitive setTimeout — the settings
  // markup is static, so the element normally exists on the first frame.
  openSection(anchorId) {
    if (!anchorId) return;
    const mgr = (typeof SidebarManager !== 'undefined') ? SidebarManager : window.SidebarManager;
    if (mgr && typeof mgr.openPanel === 'function') mgr.openPanel('settings');
    else if (mgr && typeof mgr.showPanel === 'function') mgr.showPanel('settings');
    else if (typeof window.openPanel === 'function') window.openPanel('settings');
    let tries = 0;
    const attempt = () => {
      const el = document.getElementById(anchorId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.remove('settings-anchor-flash');
        void el.offsetWidth; // restart the animation if it was already running
        el.classList.add('settings-anchor-flash');
        setTimeout(() => el.classList.remove('settings-anchor-flash'), 1300);
      } else if (++tries < 10) {
        requestAnimationFrame(attempt);
      }
    };
    requestAnimationFrame(attempt);
  },
};

if (typeof window !== 'undefined') window.SettingsUI = SettingsUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { SettingsUI };
