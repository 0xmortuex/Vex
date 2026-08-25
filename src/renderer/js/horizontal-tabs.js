// === Vex: Horizontal tab bar renderer ===
// Reads state from TabManager (tabs / groups / activeTabId) and projects it
// into #top-tabs-list. Auto-invoked whenever TabManager.rebuildAllTabs or
// renderTabUpdate runs (we monkey-patch them to fire our render too).

const HorizontalTabs = (() => {

  function _esc(s) { return window.escapeHtml(s); }
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

    // Ungrouped, unstacked, unpinned. Tabs with a stackId are represented by
    // their stack chip below — without this !t.stackId guard they leak into
    // the bar as loose tabs (the Phase 4c "no stack appears" bug).
    for (const tab of tabs.filter(t => !t.pinned && !t.groupId && !t.stackId)) {
      container.appendChild(_renderTab(tab, activeId));
    }

    // Grouped tabs with a colored label + colored top-strip
    for (const group of groups) {
      const groupTabs = tabs.filter(t => !t.pinned && t.groupId === group.id);
      if (!groupTabs.length) continue;
      const label = document.createElement('div');
      label.className = 'top-group-label';
      // Store the group's identity hex as --group-color; the actual pill fill
      // is derived from it per-theme (color-mix) in CSS so light themes get a
      // muted/harmonized pill while dark themes stay vivid. We no longer paint
      // the raw hex directly (was garish on cream/light chrome).
      label.style.setProperty('--group-color', group.color || '#6366f1');
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

    // Tab stacks — Phase 4c. One chip per stack; when expanded, its member
    // tabs follow inline (mirrors the vertical sidebar). The fancier
    // floating-popover expansion is deferred to Phase 4d.
    const stacks = TabManager.stacks || [];
    const expandedIds = TabManager._expandedStackIds;
    for (const stack of stacks) {
      const members = tabs.filter(t => !t.pinned && t.stackId === stack.id);
      if (!members.length) continue;
      const topTab = members.find(t => t.id === stack.topTabId) || members[0];
      const expanded = !!(expandedIds && expandedIds.has(stack.id));

      const chip = document.createElement('div');
      chip.className = 'top-tab top-stack' + (expanded ? ' expanded' : '');
      chip.dataset.stackId = stack.id;
      chip.style.setProperty('--stack-color', stack.color || '#d4a574');
      chip.title = `${stack.name} · ${members.length} tab${members.length === 1 ? '' : 's'} · click to ${expanded ? 'collapse' : 'expand'}, right-click for options`;

      let favicon = topTab.favicon;
      if (!favicon) {
        const host = _host(topTab.url || '');
        if (host) favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=16`;
      }
      chip.innerHTML = `
        ${favicon ? `<img class="tab-favicon" src="${_esc(favicon)}" onerror="this.style.display='none'">` : '<span class="tab-favicon"></span>'}
        <span class="tab-title">${_esc(topTab.title || 'Stack')}</span>
        <span class="top-stack-count">${members.length}</span>
      `;
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) return;
        TabManager.toggleStackExpanded?.(stack.id);
      });
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        TabManager.showStackContextMenu?.(e, stack.id);
      });
      container.appendChild(chip);

      if (expanded) {
        for (const member of members) {
          const el = _renderTab(member, activeId);
          el.classList.add('in-stack');
          el.style.setProperty('--stack-color', stack.color || '#d4a574');
          container.appendChild(el);
        }
      }
    }

    // Sequential zero-padded index, exposed as data-tab-index for any theme
    // that wants a "[01] Title" prefix.
    container.querySelectorAll('.top-tab').forEach((el, i) => {
      el.setAttribute('data-tab-index', String(i + 1).padStart(2, '0'));
    });
  }

  function _renderTab(tab, activeId) {
    const el = document.createElement('div');
    el.className = 'top-tab';
    if (tab.pinned) el.classList.add('pinned');
    if (tab.id === activeId) el.classList.add('active');
    if (tab.loading) el.classList.add('loading');
    if (tab.sleeping) el.classList.add('sleeping');
    el.dataset.tabId = tab.id;
    el.title = `${tab.title || 'New Tab'}\n${tab.url || ''}`;
    // Drag-to-reorder (native HTML5 DnD, same as the vertical sidebar).
    // Stack CHIPS are not draggable (no data-tab-id), but expanded members
    // are — dragging one onto the strip pulls it out of its stack.
    el.draggable = true;

    let favicon = tab.favicon;
    if (!favicon) {
      const host = _host(tab.url || '');
      if (host) favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=16`;
    }
    const audio = tab.audible && !tab.muted ? '<span class="audio-indicator" title="Playing">\ud83d\udd0a</span>'
                : tab.muted              ? '<span class="audio-indicator" title="Muted">\ud83d\udd07</span>'
                : '';
    const sleep = tab.sleeping
      ? '<span class="sleep-indicator" title="Sleeping"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></span>'
      : '';

    el.innerHTML = `
      ${favicon ? `<img class="tab-favicon" src="${_esc(favicon)}" onerror="this.style.display='none'">` : '<span class="tab-favicon"></span>'}
      ${audio}
      <span class="tab-title">${_esc(tab.title || 'New Tab')}</span>
      ${sleep}
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

  // Move draggedId so it sits immediately before/after targetId in
  // TabManager.tabs. The dragged tab adopts the target's section (pinned
  // state + group membership) — the strip renders pinned/loose/grouped tabs
  // in separate passes, so without adoption the tab would teleport out of
  // the spot it was visibly dropped into. Returns true if anything moved.
  function reorderTab(draggedId, targetId, after) {
    if (typeof TabManager === 'undefined') return false;
    const tabs = TabManager.tabs || [];
    const dragged = tabs.find(t => t.id === draggedId);
    const target = tabs.find(t => t.id === targetId);
    if (!dragged || !target || dragged === target) return false;
    // Joining a stack needs its own bookkeeping (topTabId etc.) — in-stack
    // tabs are excluded as drop targets, this is just the safety net.
    if (target.stackId) return false;
    // Dragging a member OUT of its stack routes through removeTabFromStack
    // so topTabId reassignment / auto-disband invariants hold.
    if (dragged.stackId) TabManager.removeTabFromStack?.(dragged.id);
    dragged.pinned = !!target.pinned;
    dragged.groupId = target.groupId || null;
    tabs.splice(tabs.indexOf(dragged), 1);
    tabs.splice(tabs.indexOf(target) + (after ? 1 : 0), 0, dragged);
    TabManager.rebuildAllTabs(); // repaints the sidebar and (via patch) this bar
    TabManager.persistTabs?.();
    return true;
  }

  function _setupDragDrop(list) {
    let dragId = null;

    const clearMarkers = () => {
      list.querySelectorAll('.drop-before, .drop-after').forEach(el =>
        el.classList.remove('drop-before', 'drop-after'));
    };
    // Nearest reorderable tab to the pointer's x — so drops land sensibly on
    // the empty strip tail and on group labels / stack chips, not only when
    // the pointer is exactly over a tab. after = pointer past its midpoint.
    const targetAt = (x) => {
      let best = null, bestDist = Infinity;
      for (const el of list.querySelectorAll('.top-tab[data-tab-id]:not(.in-stack)')) {
        if (el.dataset.tabId === dragId) continue;
        const r = el.getBoundingClientRect();
        const center = r.left + r.width / 2;
        const d = Math.abs(x - center);
        if (d < bestDist) { bestDist = d; best = { el, after: x > center }; }
      }
      return best;
    };

    list.addEventListener('dragstart', (e) => {
      const el = e.target.closest('.top-tab[data-tab-id]');
      if (!el) return;
      dragId = el.dataset.tabId;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    list.addEventListener('dragend', () => {
      dragId = null;
      list.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
      clearMarkers();
    });
    list.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearMarkers();
      const t = targetAt(e.clientX);
      if (t) t.el.classList.add(t.after ? 'drop-after' : 'drop-before');
    });
    list.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      const t = targetAt(e.clientX);
      const id = dragId;
      dragId = null;
      clearMarkers();
      if (t) reorderTab(id, t.el.dataset.tabId, t.after);
    });
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

  // Toggle narrow/very-narrow classes based on the *prospective* width each
  // flexible tab gets: (container width − fixed-width occupants − gaps) ÷ tab
  // count. NEVER measure the tabs' current rendered widths for this — a
  // freshly re-rendered tab (flex-basis 0) measures near zero for a frame,
  // which mis-applies .very-narrow, and a tab already forced small by a size
  // class then reads that forced width back on every subsequent pass. That
  // feedback loop was the "tabs shrink on every switch and stop covering the
  // bar" bug: one early mis-measure ratcheted the whole strip down to 40 px
  // chips it could never grow back from.
  function applyTabSizeClasses() {
    const container = document.getElementById('top-tabs-list');
    if (!container) return;
    const tabs = Array.from(container.querySelectorAll('.top-tab:not(.pinned)'));
    if (!tabs.length) return;
    const total = container.clientWidth;
    if (!total) return; // hidden bar (vertical layout) — nothing to size

    // Pinned tabs and group labels occupy fixed width; their measurement is
    // safe (their size never depends on the classes this function toggles).
    let fixed = 0;
    container.querySelectorAll('.top-tab.pinned, .top-group-label').forEach(el => {
      fixed += el.getBoundingClientRect().width;
    });
    fixed += 2 * Math.max(0, container.children.length - 1); // flex gap: 2px

    const avg = (total - fixed) / tabs.length;

    const narrow     = avg < 80;   // below ~6 chars — hide title
    const veryNarrow = avg < 56;   // too tight for close button

    for (const tab of tabs) {
      tab.classList.toggle('narrow', narrow);
      tab.classList.toggle('very-narrow', veryNarrow);
    }

    // The wheel-scroll fallback can leave a stale scrollLeft behind after
    // tabs close or shrink; with overflow:hidden that shows up as tabs
    // bunched left of a dead gap at the strip's right edge. Clamp it.
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    if (container.scrollLeft > maxScroll) container.scrollLeft = maxScroll;
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
      _setupDragDrop(list);
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

  return { init, render, reorderTab };
})();

window.HorizontalTabs = HorizontalTabs;
