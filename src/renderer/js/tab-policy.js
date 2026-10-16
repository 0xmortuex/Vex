// Shared privacy and persistence contract for every tab consumer.
(function () {
  const query = new URLSearchParams(window.location.search);
  const privatePartition = query.get('private') === 'true' ? query.get('partition') : null;
  const isEphemeral = partition => !!partition && !String(partition).startsWith('persist:');
  // A tab whose traffic goes its own way keeps its cookies (persist:), but
  // what is on it stays on that route, as in a Tor tab: a site rule's Tor or
  // proxy route (persist:route-*), a Tor container (persist:container-tor-*),
  // and a container given a Tor or proxy route of its own (Ctrl+K › Route
  // Through Tor / Proxy). They passed canReadWebview, so the AI, email-code
  // filling, Clipboard History and price history read them like any tab
  // (found 2026-10-11). What main says of a container is kept here; until it
  // has answered, the container counts as routed.
  const routedByName = /^persist:(?:route-|container-tor-)/;
  const containerRoutes = new Map();
  const asking = new Set();
  const askRoute = (partition) => {
    if (asking.has(partition) || typeof window.vex?.routingGet !== 'function') return;
    asking.add(partition);
    Promise.resolve(window.vex.routingGet(partition))
      .then(r => { if (!containerRoutes.has(partition)) policy.noteRoute(partition, r && r.mode); })
      .catch(err => console.error('[TabPolicy] could not tell whether ' + partition + ' has a route of its own, so it is treated as routed:', err))
      .finally(() => asking.delete(partition));
  };
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
    isRouted(partition) {
      const p = String(partition || '');
      if (routedByName.test(p)) return true;
      if (!p.startsWith('persist:container-')) return false;
      if (containerRoutes.has(p)) return containerRoutes.get(p);
      askRoute(p);
      return true;
    },
    // Told by whatever sets a container's route (js/container-routing.js).
    noteRoute(partition, mode) {
      if (String(partition || '').startsWith('persist:container-')) containerRoutes.set(partition, mode === 'tor' || mode === 'proxy');
    },
    // Read, recorded or sent anywhere by Vex (the AI, email codes, Clipboard
    // History, price history, Recall…): not a private, Tor or routed tab.
    canReadWebview(webview) {
      return policy.canFillWebview(webview) && !policy.isRouted(webview.getAttribute?.('partition'));
    },
    // Only filled in, on this device (saved logins, 2FA codes, highlights):
    // a routed tab too, as before; a private or Tor tab never.
    canFillWebview(webview) {
      return !privatePartition && !!webview && !isEphemeral(webview.getAttribute?.('partition'));
    },
    // A tab's title, address or text handed to the AI or another feature
    // that sends it out: as canReadWebview, for a tab record.
    canShareTab(tab) { return policy.canPersist(tab) && !policy.isRouted(tab.partition); },
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
        stackId: tab.stackId || null, sleeping: !!tab.sleeping, muted: !!tab.muted, originalUrl: tab.originalUrl || null,
        scrollPosition: tab.scrollPosition || null, keepAwakeUntil: tab.keepAwakeUntil || 0, note: tab.note || '',
        // Kept across a restart (js/essentials.js, js/pinned-home.js): written only when set.
        ...(tab.essential ? { essential: true } : {}),
        ...(typeof tab.homeUrl === 'string' && tab.homeUrl ? { homeUrl: tab.homeUrl } : {}),
        // Only a sleeping tab's figure means anything: an awake tab's is stale.
        memBeforeSleep: tab.sleeping ? policy.sleepMemory(tab) : null,
        ...(history ? { history } : {}) };
    },
    snapshot(tabs, opts) { return tabs.filter(t => policy.canPersist(t)).map(t => policy.serialize(t, opts)); },
    sourceOptions(webview) { return { partition: policy.partitionFor(webview?.getAttribute?.('partition')) }; },
  };
  window.VexTabPolicy = Object.freeze(policy);
})();
