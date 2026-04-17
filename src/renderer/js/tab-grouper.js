// === Vex Phase 16: Smart Tab Auto-Grouping ===
// AI clusters open tabs into logical groups, user previews + approves,
// Vex creates the groups and remembers "patterns" so future matching tabs
// can auto-join.

const TabGrouper = (() => {
  const THRESHOLD_UNGROUPED = 12;
  const CHECK_COOLDOWN_MS = 30 * 60 * 1000;

  let lastSuggestionAt = 0;
  let lastGroupedSnapshot = null; // for undo
  let groupPatterns = {};         // groupId -> { pattern, groupName, createdAt }

  const COLOR_HEX = {
    indigo: '#6366f1', cyan: '#06b6d4', green: '#10b981',
    amber: '#f59e0b', red: '#ef4444', violet: '#8b5cf6',
    rose: '#f43f5e', teal: '#14b8a6'
  };

  // ---------- tiny storage wrappers (JSON in localStorage = Phase 11 shim) ----------
  function _load(key, fb) {
    try { const r = localStorage.getItem(key); return r === null ? fb : JSON.parse(r); }
    catch { return fb; }
  }
  function _save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

  function _toast(msg, kind, dur) {
    if (typeof window.showToast === 'function') window.showToast(msg, kind, dur);
  }
  function _esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  // ---------- Tab/group API bridge over TabManager ----------
  function _allTabs() { return (typeof TabManager !== 'undefined') ? TabManager.tabs.slice() : []; }
  function _allGroups() { return (typeof TabManager !== 'undefined') ? TabManager.groups.slice() : []; }

  function _createGroup({ name, color }) {
    if (typeof TabManager === 'undefined') return null;
    const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const group = { id, name, color: color || '#6366f1', collapsed: false };
    TabManager.groups.push(group);
    if (typeof VexStorage !== 'undefined') VexStorage.saveGroups(TabManager.groups);
    return id;
  }

  function _assignTabToGroup(tabId, groupId) {
    if (typeof TabManager === 'undefined') return;
    const tab = TabManager.tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.groupId = groupId || null;
  }

  function _deleteGroup(groupId) {
    if (typeof TabManager === 'undefined') return;
    TabManager.groups = TabManager.groups.filter(g => g.id !== groupId);
    // Orphan any tab still assigned to this group
    for (const t of TabManager.tabs) if (t.groupId === groupId) t.groupId = null;
    if (typeof VexStorage !== 'undefined') VexStorage.saveGroups(TabManager.groups);
  }

  function _afterGroupChanges() {
    if (typeof TabManager === 'undefined') return;
    // IMPORTANT: rebuildAllTabs() internally calls renderGroups() first, then
    // renderTab() for each tab. If we also call renderGroups() after that,
    // it wipes #tab-groups-container (innerHTML = '') and blanks every tab
    // out of every .tab-group-tabs slot, leaving "empty" groups that can't
    // be expanded because there's nothing inside.
    TabManager.rebuildAllTabs?.();
    TabManager.persistTabs?.();
    if (typeof VexStorage !== 'undefined') VexStorage.saveGroups(TabManager.groups);
  }

  // ---------- Init ----------
  function init() {
    lastSuggestionAt = _load('vex.lastGroupSuggestionAt', 0) || 0;
    groupPatterns = _load('vex.groupPatterns', {}) || {};
    // Prune patterns whose group no longer exists
    const liveIds = new Set(_allGroups().map(g => g.id));
    const pruned = {};
    for (const [gid, p] of Object.entries(groupPatterns)) {
      if (liveIds.has(gid)) pruned[gid] = p;
    }
    if (Object.keys(pruned).length !== Object.keys(groupPatterns).length) {
      groupPatterns = pruned;
      _save('vex.groupPatterns', groupPatterns);
    }
    setInterval(maybeAutoSuggest, 60000);
  }

  // ---------- Auto-suggest banner ----------
  function maybeAutoSuggest() {
    if (_load('vex.autoGroupSuggest', true) === false) return;
    if (Date.now() - lastSuggestionAt < CHECK_COOLDOWN_MS) return;
    const ungrouped = _allTabs().filter(t => !t.groupId);
    if (ungrouped.length >= THRESHOLD_UNGROUPED) {
      showSuggestionBanner(ungrouped.length);
      lastSuggestionAt = Date.now();
      _save('vex.lastGroupSuggestionAt', lastSuggestionAt);
    }
  }

  function showSuggestionBanner(count) {
    if (document.getElementById('group-suggestion-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'group-suggestion-banner';
    banner.className = 'group-suggestion-banner';
    banner.innerHTML = `
      <div class="banner-icon">\ud83d\uddc2\ufe0f</div>
      <div class="banner-content">
        <div class="banner-title">You have ${count} ungrouped tabs</div>
        <div class="banner-subtitle">Let Vex AI organize them into groups?</div>
      </div>
      <div class="banner-actions">
        <button class="btn-primary" id="banner-analyze">Organize</button>
        <button class="btn-link" id="banner-dismiss">Not now</button>
      </div>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('show'));
    const close = () => { banner.classList.remove('show'); setTimeout(() => banner.remove(), 300); };
    banner.querySelector('#banner-analyze').addEventListener('click', async () => { close(); await analyzeAndPropose(); });
    banner.querySelector('#banner-dismiss').addEventListener('click', close);
    setTimeout(() => { if (document.body.contains(banner)) close(); }, 60000);
  }

  // ---------- Analyze & propose ----------
  async function analyzeAndPropose(onlyUngrouped = true) {
    const all = _allTabs();
    const tabsToAnalyze = onlyUngrouped ? all.filter(t => !t.groupId) : all;
    if (tabsToAnalyze.length < 3) { _toast('Need at least 3 tabs to propose groupings', 'warn'); return; }

    _toast('Analyzing your tabs...', 'info', 5000);

    try {
      const history = _load('vex.history', []) || [];
      // Phase 12 history entries live as an array (HistoryPanel.entries) OR the
      // shape might be { entries: [] } from older versions — handle both.
      const historyEntries = Array.isArray(history) ? history : (history.entries || []);

      const tabMeta = tabsToAnalyze.map(t => {
        const h = historyEntries.find(e => e && e.url === t.url);
        return {
          id: t.id,
          title: (t.title || '').substring(0, 120),
          url: t.url,
          summary: (h && h.summary) ? String(h.summary).substring(0, 160) : ''
        };
      });

      if (typeof AIRouter === 'undefined') throw new Error('AIRouter not loaded');
      const response = await AIRouter.callAI('groupTabs', { tabs: tabMeta });

      let parsed;
      try {
        const str = String(response.result || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
        parsed = JSON.parse(str);
      } catch {
        throw new Error('AI returned malformed response');
      }

      if (!parsed.groups || parsed.groups.length === 0) {
        _toast(parsed.reasoning || 'No clear groupings found.', 'info', 6000);
        return;
      }

      // Filter: every group needs 2+ tabs and a name
      parsed.groups = parsed.groups.filter(g => g && g.name && Array.isArray(g.tabIds) && g.tabIds.length >= 2);
      if (!parsed.groups.length) { _toast('No strong groupings found.', 'info'); return; }

      showPreviewModal(parsed, tabsToAnalyze);
    } catch (err) {
      _toast(`Grouping failed: ${err.message}`, 'error');
    }
  }

  // ---------- Preview modal ----------
  function showPreviewModal(proposal, sourceTabs) {
    const overlay = document.createElement('div');
    overlay.className = 'sync-modal-overlay';
    overlay.innerHTML = `
      <div class="sync-modal-card group-preview-modal">
        <div class="preview-header">
          <h2 style="margin:0">\ud83d\uddc2\ufe0f Proposed Tab Groups</h2>
          ${proposal.reasoning ? `<p class="preview-reasoning">${_esc(proposal.reasoning)}</p>` : ''}
        </div>
        <div class="preview-groups" id="preview-groups">
          ${proposal.groups.map((g, idx) => renderGroupPreview(g, idx, sourceTabs)).join('')}
        </div>
        ${(proposal.ungrouped && proposal.ungrouped.length) ? `
          <div class="preview-ungrouped">
            <div class="ungrouped-label">Left ungrouped (${proposal.ungrouped.length}):</div>
            <div class="ungrouped-list">
              ${proposal.ungrouped.map(id => {
                const t = sourceTabs.find(s => s.id === id);
                if (!t) return '';
                const label = (t.title || 'Untitled').substring(0, 30);
                return `<span class="ungrouped-tab">${_esc(label)}</span>`;
              }).join('')}
            </div>
          </div>
        ` : ''}
        <div class="preview-options">
          <label>
            <input type="checkbox" id="remember-patterns" checked>
            Remember these patterns &mdash; auto-add matching future tabs to these groups
          </label>
        </div>
        <div class="modal-actions" style="display:flex;gap:8px;margin-top:18px;align-items:center">
          <button class="btn-link" id="preview-cancel">Cancel</button>
          <div style="flex:1"></div>
          <button class="btn-secondary" id="preview-edit-all">Expand all</button>
          <button class="btn-primary" id="preview-apply">Apply (${proposal.groups.length} groups)</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    wirePreviewHandlers(overlay, proposal, sourceTabs);
  }

  function renderGroupPreview(group, idx, sourceTabs) {
    const tabs = (group.tabIds || []).map(id => sourceTabs.find(t => t.id === id)).filter(Boolean);
    const confidence = Math.round((group.confidence || 0) * 100);
    const confClass = confidence > 80 ? 'high' : confidence > 60 ? 'med' : 'low';
    const color = group.color || 'indigo';
    return `
      <details class="group-preview" data-group-idx="${idx}" open>
        <summary>
          <span class="group-preview-emoji">${_esc(group.emoji || '\ud83d\udcc1')}</span>
          <input class="group-preview-name" type="text" value="${_esc(group.name)}" data-field="name">
          <span class="group-preview-color color-${_esc(color)}"></span>
          <span class="group-preview-count">${tabs.length} tabs</span>
          <span class="group-preview-confidence ${confClass}">${confidence}%</span>
        </summary>
        <div class="group-preview-body">
          ${group.pattern ? `<div class="group-preview-pattern"><small>Pattern:</small> ${_esc(group.pattern)}</div>` : ''}
          <div class="group-preview-tabs">
            ${tabs.map(t => {
              let host = ''; try { host = new URL(t.url).hostname; } catch {}
              const title = (t.title || 'Untitled').substring(0, 60);
              return `
                <div class="preview-tab">
                  <input type="checkbox" checked data-tab-id="${_esc(t.id)}">
                  <img src="${host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=16` : ''}" width="14" height="14" onerror="this.style.display='none'">
                  <span>${_esc(title)}</span>
                </div>
              `;
            }).join('')}
          </div>
          <div class="group-preview-actions">
            <button class="btn-link remove-group" data-group-idx="${idx}">Remove this group</button>
          </div>
        </div>
      </details>
    `;
  }

  function wirePreviewHandlers(overlay, proposal, sourceTabs) {
    const edits = {
      groups: JSON.parse(JSON.stringify(proposal.groups)),
      removedGroupIndices: new Set()
    };

    overlay.querySelectorAll('.group-preview-name').forEach(input => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.closest('.group-preview').dataset.groupIdx, 10);
        edits.groups[idx].name = input.value;
      });
      input.addEventListener('click', (e) => e.stopPropagation()); // don't toggle the <details>
    });

    overlay.querySelectorAll('.preview-tab input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const tabId = cb.dataset.tabId;
        const groupIdx = parseInt(cb.closest('.group-preview').dataset.groupIdx, 10);
        const g = edits.groups[groupIdx];
        if (!cb.checked) g.tabIds = g.tabIds.filter(id => id !== tabId);
        else if (!g.tabIds.includes(tabId)) g.tabIds.push(tabId);
      });
    });

    overlay.querySelectorAll('.remove-group').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.groupIdx, 10);
        edits.removedGroupIndices.add(idx);
        btn.closest('.group-preview').style.display = 'none';
        const remaining = edits.groups.length - edits.removedGroupIndices.size;
        overlay.querySelector('#preview-apply').textContent = `Apply (${remaining} groups)`;
      });
    });

    overlay.querySelector('#preview-edit-all').addEventListener('click', () => {
      overlay.querySelectorAll('.group-preview').forEach(el => el.open = true);
    });

    overlay.querySelector('#preview-cancel').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#preview-apply').addEventListener('click', async () => {
      const rememberPatterns = overlay.querySelector('#remember-patterns').checked;
      const finalGroups = edits.groups
        .filter((_, idx) => !edits.removedGroupIndices.has(idx))
        .filter(g => g.tabIds && g.tabIds.length >= 2);

      if (!finalGroups.length) {
        _toast('All groups removed — nothing to apply', 'warn');
        overlay.remove();
        return;
      }

      await applyGroups(finalGroups, rememberPatterns);
      overlay.remove();
    });
  }

  // ---------- Apply ----------
  async function applyGroups(groupsToApply, rememberPatterns) {
    // Snapshot for undo
    const snapshotTabs = _allTabs().map(t => ({ id: t.id, groupId: t.groupId || null }));
    const snapshotGroupIds = new Set(_allGroups().map(g => g.id));
    lastGroupedSnapshot = { tabs: snapshotTabs, originalGroupIds: snapshotGroupIds, timestamp: Date.now() };

    let created = 0;
    for (const g of groupsToApply) {
      const displayName = `${g.emoji ? g.emoji + ' ' : ''}${g.name}`.trim();
      const hex = COLOR_HEX[g.color] || '#6366f1';
      const newGroupId = _createGroup({ name: displayName, color: hex });
      if (!newGroupId) continue;
      for (const tabId of g.tabIds) _assignTabToGroup(tabId, newGroupId);
      if (rememberPatterns && g.pattern) {
        groupPatterns[newGroupId] = {
          pattern: g.pattern,
          groupName: g.name,
          createdAt: new Date().toISOString()
        };
      }
      created++;
    }

    _afterGroupChanges();
    if (rememberPatterns) _save('vex.groupPatterns', groupPatterns);

    if (created > 0) showUndoToast(created);
  }

  function showUndoToast(groupCount) {
    const existing = document.querySelector('.group-apply-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'group-apply-toast';
    el.innerHTML = `
      <span>\u2713 Created ${groupCount} group${groupCount === 1 ? '' : 's'}</span>
      <button class="undo-btn" id="undo-grouping">Undo</button>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    el.querySelector('#undo-grouping').addEventListener('click', () => {
      undoLastGrouping();
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    });
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 10000);
  }

  function undoLastGrouping() {
    if (!lastGroupedSnapshot) { _toast('Nothing to undo', 'warn'); return; }
    const { tabs: snap, originalGroupIds } = lastGroupedSnapshot;

    // Restore each tab's original groupId
    for (const { id, groupId } of snap) _assignTabToGroup(id, groupId || null);

    // Delete groups created after the snapshot
    const current = _allGroups();
    for (const g of current) if (!originalGroupIds.has(g.id)) _deleteGroup(g.id);

    // Drop patterns tied to deleted groups
    const kept = {};
    for (const [gid, p] of Object.entries(groupPatterns)) {
      if (originalGroupIds.has(gid)) kept[gid] = p;
    }
    groupPatterns = kept;
    _save('vex.groupPatterns', groupPatterns);

    _afterGroupChanges();
    lastGroupedSnapshot = null;
    _toast('Undone', 'success');
  }

  // ---------- Public ----------
  function getPatterns() { return { ...groupPatterns }; }
  function clearPatterns() { groupPatterns = {}; _save('vex.groupPatterns', {}); }
  function removePattern(groupId) { delete groupPatterns[groupId]; _save('vex.groupPatterns', groupPatterns); }

  return {
    init,
    analyzeAndPropose,
    undoLastGrouping,
    getPatterns, clearPatterns, removePattern,
    THRESHOLD_UNGROUPED
  };
})();

window.TabGrouper = TabGrouper;
