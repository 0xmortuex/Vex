// Shared privacy and persistence contract for every tab consumer.
(function () {
  const query = new URLSearchParams(window.location.search);
  const privatePartition = query.get('private') === 'true' ? query.get('partition') : null;
  const isEphemeral = partition => !!partition && !String(partition).startsWith('persist:');
  const policy = {
    isPrivateWindow: !!privatePartition,
    // A private window opened for sharing the screen (Ctrl+K › Share this page in a clean window).
    isCleanWindow: !!privatePartition && query.get('clean') === 'true',
    defaultPartition: privatePartition || 'persist:main',
    partitionFor(partition) { return privatePartition || partition || 'persist:main'; },
    // The saved-tab contract's own URL test (js/data-contracts.js), not a
    // look-alike: a prefix check let through an address longer than 8192
    // characters (a sign-in redirect carrying its state in the query) or one
    // that does not parse, and that one tab made every tab, workspace and
    // session save reject with "Invalid tab URL", so the stored session went
    // stale (found 2026-10-10).
    canRestore(tab) { return !!tab && !isEphemeral(tab.partition) && window.VexDataContracts.url(tab.url); },
    canPersist(tab) { return !privatePartition && policy.canRestore(tab); },
    canReadWebview(webview) {
      return !privatePartition && !!webview && !isEphemeral(webview.getAttribute?.('partition'));
    },
    // What a tab used just before it slept, so the Memory panel can still say
    // "(was 219 MB)" after a restart. Saved state is user-writable JSON, so
    // anything but { mb: finite >= 0, shared: boolean } is dropped.
    sleepMemory(tab) {
      const m = tab && tab.memBeforeSleep;
      return m && typeof m === 'object' && Number.isFinite(m.mb) && m.mb >= 0 && typeof m.shared === 'boolean'
        ? { mb: m.mb, shared: m.shared } : null;
    },
    // A tab's back list (js/webview.js, main/session-security.js): kept with
    // the tab on this device only, so it is asked for ({ history: true }) by
    // the saved session, the recently closed list and Undo, and left out of
    // what is synced, a saved session or a workspace. Main checks every entry
    // before using it; only its shape is checked here.
    savedHistory(tab) {
      const h = tab && tab.history;
      return h && typeof h === 'object' && Array.isArray(h.entries) && h.entries.length >= 2 && h.entries.length <= 50
        && Number.isInteger(h.index) && h.index >= 0 && h.index < h.entries.length ? h : null;
    },
    serialize(tab, opts) {
      const history = opts && opts.history ? policy.savedHistory(tab) : null;
      return { id: tab.id, url: tab.url, title: tab.title || '', favicon: tab.favicon || null,
        partition: tab.partition || null, pinned: !!tab.pinned, groupId: tab.groupId || null,
        stackId: tab.stackId || null, sleeping: !!tab.sleeping, originalUrl: tab.originalUrl || null,
        scrollPosition: tab.scrollPosition || null, keepAwakeUntil: tab.keepAwakeUntil || 0, note: tab.note || '',
        // Only a sleeping tab's figure means anything: an awake tab's is stale.
        memBeforeSleep: tab.sleeping ? policy.sleepMemory(tab) : null,
        ...(history ? { history } : {}) };
    },
    snapshot(tabs, opts) { return tabs.filter(t => policy.canPersist(t)).map(t => policy.serialize(t, opts)); },
    sourceOptions(webview) { return { partition: policy.partitionFor(webview?.getAttribute?.('partition')) }; },
  };
  window.VexTabPolicy = Object.freeze(policy);
})();
