// === What changed since I last looked, per workspace (T2-046) ===================
//
// Coming back to a workspace in the morning, the question is "did anything move
// while I was away?". This answers it from what Vex already watches: the pages
// you asked it to watch (Page watch) that sit in that workspace. Only pages with
// a REAL change since you last had the workspace in front are listed, each with
// the one-line summary of what changed (lines added / removed).
//
//   A watch belongs to a workspace when one of the workspace's tabs is the
//   watched page or a page under it (same site, same path or deeper).
//   "Last looked" = the moment you left the workspace (or closed Vex with it in
//   front). The first time a workspace is seen there is nothing to compare, so
//   nothing is news.
//
//   VexChanged.matches / since    pure
//   Morning Brief section "Changed since you looked" (the workspace in front)
//   Ctrl+K "What changed": every workspace with changes, "Mark as looked"
//   Switching INTO a workspace after 3 hours or more away offers it (a useful
//   notice through the attention gate)
//
// Not built here, and why: new comments on GitHub and relevant new mail need an
// account or token and a rule for "relevant" that only you can give. The list
// reads page watches only; GitHub release/run watches keep their own notices.
// Reads only; sends nothing.

const VexChanged = {
  PREF: 'vex.changed.enabled',
  SEEN: 'vex.changed.seen',          // { [workspaceId]: ms you last had it in front }
  MIN_AWAY_MS: 3 * 3600 * 1000,
  FEATURE: 'workspace-changes',
  _ws: null,

  enabled() { return VexPlanKit.flag(this.PREF); },
  setEnabled(on) { return VexPlanKit.setFlag(this.PREF, on); },

  // ---- pure ----------------------------------------------------------------------------
  key(url) {
    try { const u = new URL(String(url)); return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, ''); } catch { return ''; }
  },
  // Is the watched page one of the tab urls, or under one of them / over one of them?
  matches(watchUrl, tabUrls) {
    const w = this.key(watchUrl);
    if (!w) return false;
    return (tabUrls || []).some(t => { const k = this.key(t); return k && (k === w || w.startsWith(k + '/') || k.startsWith(w + '/')); });
  },
  // Watches (PageWatch records) that changed after `since` and live in these tabs.
  changed(watches, tabUrls, since) {
    if (!since) return [];
    return (watches || []).filter(w => w && w.lastChangedAt > since && !w.paused && this.matches(w.url, tabUrls))
      .sort((a, b) => b.lastChangedAt - a.lastChangedAt);
  },
  summaryOf(history) {
    if (!Array.isArray(history) || history.length < 2) return 'changed';
    if (typeof PageWatchDiff === 'undefined') return 'changed';
    const a = history[history.length - 2], b = history[history.length - 1];
    const d = PageWatchDiff.lineDiff(a.text || '', b.text || '');
    return PageWatchDiff.summarize(d).headline;
  },

  // ---- the stores -----------------------------------------------------------------------------
  seen() {
    const o = VexPlanKit.readJson(this.SEEN, {});
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  stamp(wsId, now = Date.now()) {
    if (!wsId) return;
    const o = this.seen();
    o[wsId] = now;
    VexPlanKit.writeJson(this.SEEN, o);
  },
  // saved: read the workspace's saved tab list even when it is the active one. A switch changes activeId
  // before the new tabs are on screen, so the open tabs would still be the old workspace's.
  _tabUrls(wsId, saved = false) {
    if (typeof WorkspaceManager === 'undefined') throw new Error('Workspaces are not loaded');
    if (!saved && wsId === WorkspaceManager.activeId) {
      if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
      return TabManager.tabs.map(t => t.url);
    }
    const ws = WorkspaceManager.workspaces.find(w => w.id === wsId);
    return ws && Array.isArray(ws.tabs) ? ws.tabs.map(t => t.url) : [];
  },
  // -> [{ watch, at, summary }] for one workspace.
  forWorkspace(wsId, now = Date.now(), saved = false) {
    if (typeof PageWatch === 'undefined') throw new Error('Page watch is not loaded');
    const seen = this.seen();
    if (!seen[wsId]) { this.stamp(wsId, now); return []; }     // first sight: the baseline, not news
    return this.changed(PageWatch.list(), this._tabUrls(wsId, saved), seen[wsId])
      .map(w => ({ watch: w, at: w.lastChangedAt, summary: this.summaryOf(PageWatch.history(w.id)) }));
  },
  all(now = Date.now()) {
    if (typeof WorkspaceManager === 'undefined') throw new Error('Workspaces are not loaded');
    const out = [];
    const errors = [];
    for (const ws of WorkspaceManager.workspaces) {
      try { const items = this.forWorkspace(ws.id, now); if (items.length) out.push({ ws, items }); }
      catch (err) { errors.push(ws.name + ': ' + err.message); }
    }
    return { groups: out, errors };
  },

  // ---- Morning Brief ---------------------------------------------------------------------------------
  briefModule() {
    return {
      id: 'workspace-changes', title: 'Changed since you looked', icon: 'activity',
      isEnabled: () => this.enabled(),
      build: async () => {
        if (typeof WorkspaceManager === 'undefined') return null;
        const ws = WorkspaceManager.getActive();
        if (!ws) return null;
        const items = this.forWorkspace(ws.id);
        if (!items.length) return null;
        return {
          summary: items.length + (items.length === 1 ? ' watched page' : ' watched pages') + ' changed in ' + ws.name + '.',
          lines: items.slice(0, 5).map(i => ({ text: VexPlanKit.line(i.watch.title || i.watch.url, 80), detail: i.summary + ' · ' + new Date(i.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }), url: /^https?:/i.test(i.watch.url) ? i.watch.url : '' })),
        };
      },
    };
  },

  // ---- the dialog --------------------------------------------------------------------------------------
  open() {
    if (!this.enabled()) { window.showToast?.('What changed is switched off in Settings', 'info'); return; }
    if (typeof VexUsage !== 'undefined') VexUsage.touch('workspace-changes');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-changed', title: 'What changed since you looked', sub: 'Watched pages in each workspace that changed since you last had that workspace in front.' });
    let res;
    try { res = this.all(); } catch (err) { body.appendChild(VexSettingsGroups.note('Could not read: ' + err.message)); return; }
    if (!res.groups.length) body.appendChild(VexSettingsGroups.note('Nothing changed in any workspace.'));
    for (const g of res.groups) {
      const h = document.createElement('div');
      h.className = 'vex-platform-note'; h.style.fontWeight = '650'; h.textContent = g.ws.name + ' · ' + g.items.length;
      body.appendChild(h);
      const list = document.createElement('div'); list.className = 'vexsr-list';
      for (const i of g.items) {
        const { row } = VexPlanKit.listRow(i.summary, VexPlanKit.line(i.watch.title || i.watch.url, 80));
        row.style.cursor = 'pointer'; row.tabIndex = 0; row.setAttribute('role', 'button');
        const go = () => { try { if (typeof TabManager === 'undefined') throw new Error('Tabs are not loaded'); TabManager.createTab(i.watch.url, true); } catch (err) { window.showToast?.(err.message, 'error'); } };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        list.appendChild(row);
      }
      body.appendChild(list);
      body.appendChild(VexSettingsGroups.button('Mark ' + g.ws.name + ' as looked', () => { try { this.stamp(g.ws.id); list.remove(); h.remove(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
    }
    if (res.errors.length) body.appendChild(VexSettingsGroups.note('Could not read: ' + res.errors.join('; ')));
  },

  // ---- watching the active workspace ------------------------------------------------------------------------
  // Called on every tab change: cheap, it only compares the workspace id.
  onTabsChanged(now = Date.now()) {
    if (!this.enabled() || typeof WorkspaceManager === 'undefined') return false;
    const cur = WorkspaceManager.activeId;
    if (this._ws === cur) return false;
    const prev = this._ws;
    this._ws = cur;
    if (prev == null) return false;                       // start-up: remember where we are
    const before = this.seen()[cur] || 0;
    this.stamp(prev, now);                               // leaving the old one is "looking"
    if (!before || now - before < this.MIN_AWAY_MS) return false;
    const items = this.forWorkspace(cur, now, true);
    if (!items.length) return false;
    this.stamp(cur, now);
    if (typeof VexAttention === 'undefined') throw new Error('The attention gate is not loaded');
    const ws = WorkspaceManager.getActive();
    const n = items.length;
    VexAttention.notify({
      feature: this.FEATURE, label: 'Changes in a workspace', urgency: 'useful', id: cur + ':' + Math.floor(now / 3600000),
      title: n + (n === 1 ? ' watched page changed' : ' watched pages changed') + ' in ' + (ws ? ws.name : 'this workspace'), body: items[0].summary + ': ' + VexPlanKit.line(items[0].watch.title || items[0].watch.url, 60),
      action: { label: 'Show', key: 'open' },
    }, () => window.showToast?.(n + (n === 1 ? ' watched page changed' : ' watched pages changed') + ' while you were away', 'info', 10000, { action: { label: 'Show', run: () => this.open() } }));
    return true;
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof WorkspaceManager !== 'undefined') this._ws = WorkspaceManager.activeId;
    window.addEventListener('vex-tabs-changed', () => {
      try { this.onTabsChanged(); } catch (err) { window.VexProblems?.note('What changed', 'Could not check the workspace you switched to', err); }
    });
    const leave = () => { try { if (this.enabled() && typeof WorkspaceManager !== 'undefined') this.stamp(WorkspaceManager.activeId); } catch (err) { window.VexProblems?.note('What changed', 'Could not remember when you left', err); } };
    window.addEventListener('beforeunload', leave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => { if (key !== 'open') throw new Error('Unknown action ' + key); this.open(); });
    if (typeof VexLedger !== 'undefined') VexLedger.registerStop('changed-off', () => { this.setEnabled(false); });
    return true;
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Lists the pages you watch (Page watch) that changed in a workspace since you last had it in front, with what changed. Offered when you switch to a workspace after 3 hours or more away. Ctrl+K › What changed.'));
    el.appendChild(VexSettingsGroups.button('Show what changed', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexChanged = VexChanged;
  window.VexBriefModules = window.VexBriefModules || [];
  window.VexBriefModules.push(VexChanged.briefModule());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'workspace-changes', title: 'What changed since you looked', keywords: 'workspace changed since last looked page watch diff morning', before: 'about', build: (el) => VexChanged.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'workspace-changes', label: 'What changed since I last looked', hint: 'Watched pages that changed in each workspace', icon: 'activity', action: () => VexChanged.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexChanged };
