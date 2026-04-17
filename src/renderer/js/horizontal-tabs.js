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
      <span class="tab-close" title="Close">\u00d7</span>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return;
      TabManager.switchTab(tab.id);
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); TabManager.closeTab(tab.id); }
    });
    el.querySelector('.tab-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      TabManager.closeTab(tab.id);
    });
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
  }

  function init() {
    _patchTabManager();
    document.getElementById('btn-new-tab-top')?.addEventListener('click', () => {
      try { TabManager.createTab(typeof START_URL !== 'undefined' ? START_URL : 'vex://start', true); }
      catch { TabManager.createTab('about:blank', true); }
    });
    render();
  }

  return { init, render };
})();

window.HorizontalTabs = HorizontalTabs;
