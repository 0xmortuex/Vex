// Shared privacy and persistence contract for every tab consumer.
(function () {
  const query = new URLSearchParams(window.location.search);
  const privatePartition = query.get('private') === 'true' ? query.get('partition') : null;
  const isEphemeral = partition => !!partition && !String(partition).startsWith('persist:');
  const policy = {
    isPrivateWindow: !!privatePartition,
    defaultPartition: privatePartition || 'persist:main',
    partitionFor(partition) { return privatePartition || partition || 'persist:main'; },
    canRestore(tab) { return !!tab && !isEphemeral(tab.partition) && typeof tab.url === 'string' && /^(https?:|about:|file:|vex:)/i.test(tab.url); },
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
    serialize(tab) {
      return { id: tab.id, url: tab.url, title: tab.title || '', favicon: tab.favicon || null,
        partition: tab.partition || null, pinned: !!tab.pinned, groupId: tab.groupId || null,
        stackId: tab.stackId || null, sleeping: !!tab.sleeping, originalUrl: tab.originalUrl || null,
        scrollPosition: tab.scrollPosition || null, keepAwakeUntil: tab.keepAwakeUntil || 0,
        // Only a sleeping tab's figure means anything: an awake tab's is stale.
        memBeforeSleep: tab.sleeping ? policy.sleepMemory(tab) : null };
    },
    snapshot(tabs) { return tabs.filter(t => policy.canPersist(t)).map(t => policy.serialize(t)); },
    sourceOptions(webview) { return { partition: policy.partitionFor(webview?.getAttribute?.('partition')) }; },
  };
  window.VexTabPolicy = Object.freeze(policy);
})();
