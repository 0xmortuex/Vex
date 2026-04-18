// === Vex: Horizontal tab bar renderer ===
// Reads state from TabManager (tabs / groups / activeTabId) and projects it
// into #top-tabs-list. Auto-invoked whenever TabManager.rebuildAllTabs or
// renderTabUpdate runs (we monkey-patch them to fire our render too).

const HorizontalTabs = (() => {

  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function _host(url) { try { return new URL(url).hostname; } catch { return ''; } }

  function isActive() { return document.body.dataset.tabLayout === 'horizontal'; }

  function render() {
    if (!isActive()) return;
    if (typeof TabManager === 'undefined') return;
    const container = document.getElementById('top-tabs-list');
    if (!container) return;

    const tabs = TabManager.tabs || [];
    const groups = TabManager.groups || [];
    const activeId = TabManager.activeTabId;
    container.innerHTML = '';

    // Pinned first (compact)
    const pinned = tabs.filter(t => t.pinned);
    for (const tab of pinned) container.appendChild(_renderTab(tab, activeId));

    // Ungrouped unpinned
    for (const tab of tabs.filter(t => !t.pinned && !t.groupId)) {
      container.appendChild(_renderTab(tab, activeId));
    }

    // Grouped tabs with a colored label + colored top-strip
    for (const group of groups) {
      const groupTabs = tabs.filter(t => !t.pinned && t.groupId === group.id);
      if (!groupTabs.length) continue;
      const label = document.createElement('div');
      label.className = 'top-group-label';
      label.style.background = group.color || '#6366f1';
      label.textContent = group.name;
      label.title = `${group.name} \u00b7 ${groupTabs.length} tab${groupTabs.length === 1 ? '' : 's'} \u00b7 right-click for options`;
      label.addEventListener('click', () => {
        group.collapsed = !group.collapsed;
        if (typeof VexStorage !== 'undefined') VexStorage.saveGroups(TabManager.groups);
        render();
      });
      label.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        TabManager.showGroupContextMenu?.(e, group.id);
      });
      container.appendChild(label);

      if (group.collapsed) continue; // Hide member tabs when collapsed

      for (const tab of groupTabs) {
        const el = _renderTab(tab, activeId);
        el.classList.add('in-group');
        el.style.setProperty('--group-color', group.color || '#6366f1');
        container.appendChild(el);
      }
    }
  }

  function _renderTab(tab, activeId) {
    const el = document.createElement('div');
    el.className = 'top-tab';
    if (tab.pinned) el.classList.add('pinned');
    if (tab.id === activeId) el.classList.add('active');
    if (tab.loading) el.classList.add('loading');
    el.dataset.tabId = tab.id;
    el.title = `${tab.title || 'New Tab'}\n${tab.url || ''}`;

    let favicon = tab.favicon;
    if (!favicon) {
      const host = _host(tab.url || '');
      if (host) favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=16`;
    }
    const audio = tab.audible && !tab.muted ? '<span class="audio-indicator" title="Playing">\ud83d\udd0a</span>'
                : tab.muted              ? '<span class="audio-indicator" title="Muted">\ud83d\udd07</span>'
                : '';

    el.innerHTML = `
      ${favicon ? `<img class="tab-favicon" src="${_esc(favicon)}" onerror="this.style.display='none'">` : '<span class="tab-favicon"></span>'}
      ${audio}
      <span class="tab-title">${_esc(tab.title || 'New Tab')}</span>
      <button class="tab-close" title="Close tab" aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="1" y1="1" x2="9" y2="9"/>
          <line x1="9" y1="1" x2="1" y2="9"/>
        </svg>
      </button>
    `;

    el.addEventListener('click', (e) => {
      // If click originated on or inside the close button (e.g. on the SVG),
      // skip the tab switch entirely.
      if (e.target.closest('.tab-close')) return;
      TabManager.switchTab(tab.id);
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); e.stopPropagation(); TabManager.closeTab(tab.id); }
    });
    const closeBtn = el.querySelector('.tab-close');
    if (closeBtn) {
      // mousedown fires before click; stop it here so the parent tab never
      // "selects" during the press that's meant to close an inactive tab.
      closeBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
      closeBtn.addEventListener('mouseup', (e) => {
        e.stopPropagation();
      });
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        TabManager.closeTab(tab.id);
      });
    }
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      TabManager.showContextMenu?.(e, tab);
    });
    return el;
  }

  function _patchTabManager() {
    if (typeof TabManager === 'undefined' || TabManager.__horizWired) return;
    TabManager.__horizWired = true;
    // Wrap rebuildAllTabs + renderTabUpdate to also refresh us
    const origRebuild = TabManager.rebuildAllTabs?.bind(TabManager);
    if (origRebuild) {
      TabManager.rebuildAllTabs = function () { origRebuild(); render(); };
    }
    const origUpdate = TabManager.renderTabUpdate?.bind(TabManager);
    if (origUpdate) {
      TabManager.renderTabUpdate = function (tab) { origUpdate(tab); render(); };
    }
    // switchTab changes activeTabId; patch it so the active class updates
    const origSwitch = TabManager.switchTab?.bind(TabManager);
    if (origSwitch) {
      TabManager.switchTab = function (id) { origSwitch(id); render(); };
    }
    // closeTab only removes the sidebar .tab-item; for inactive tabs it never
    // triggers switchTab, so without this patch the stale .top-tab stays in
    // the horizontal bar and the user has to "click to close" twice.
    const origClose = TabManager.closeTab?.bind(TabManager);
    if (origClose) {
      TabManager.closeTab = function (id) { origClose(id); render(); };
    }
  }

  // Toggle narrow/very-narrow classes based on the *average* width each tab
  // would get in the container. This is more stable than per-tab measurement
  // because freshly rendered tabs may briefly measure at their flex-basis
  // (200 px) before the browser settles the layout, causing false-negative
  // "wide" reads. CSS container queries aren't reliable in Electron 30's
  // Chromium, so we compute this in JS.
  function applyTabSizeClasses() {
    const container = document.getElementById('top-tabs-list');
    if (!container) return;
    const tabs = Array.from(container.querySelectorAll('.top-tab:not(.pinned)'));
    if (!tabs.length) return;

    // Measure actual rendered widths — pinned tabs share the bar but shouldn't
    // factor into the average, and the old container-width/count estimate
    // mis-classified when a pinned row or group label was present.
    let total = 0;
    for (const t of tabs) total += t.getBoundingClientRect().width;
    const avg = total / tabs.length;

    const narrow     = avg < 80;   // below ~6 chars — hide title
    const veryNarrow = avg < 56;   // too tight for close button

    for (const tab of tabs) {
      tab.classList.toggle('narrow', narrow);
      tab.classList.toggle('very-narrow', veryNarrow);
    }
  }

  // Wrap render so size classes are re-applied on every refresh.
  const _origRender = render;
  render = function () {
    _origRender();
    requestAnimationFrame(applyTabSizeClasses);
  };

  function init() {
    _patchTabManager();
    document.getElementById('btn-new-tab-top')?.addEventListener('click', () => {
      try { TabManager.createTab(typeof START_URL !== 'undefined' ? START_URL : 'vex://start', true); }
      catch { TabManager.createTab('about:blank', true); }
    });
    // Wheel scroll fallback — only fires when overflow is present (50+ tabs).
    const list = document.getElementById('top-tabs-list');
    if (list) {
      list.addEventListener('wheel', (e) => {
        if (!e.deltaY || list.scrollWidth <= list.clientWidth) return;
        e.preventDefault();
        list.scrollLeft += e.deltaY;
      }, { passive: false });
    }
    // Re-evaluate narrow classes whenever the bar itself resizes (sidebar
    // toggles, devtools open, window resize, etc.) and on explicit resize.
    const bar = document.getElementById('top-tab-bar');
    if (bar && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => applyTabSizeClasses()).observe(bar);
    }
    window.addEventListener('resize', () => requestAnimationFrame(applyTabSizeClasses));
    render();
    // Double-RAF so layout is fully settled before the first measurement.
    requestAnimationFrame(() => requestAnimationFrame(applyTabSizeClasses));
  }

  return { init, render };
})();

window.HorizontalTabs = HorizontalTabs;
