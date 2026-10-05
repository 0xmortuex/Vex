const path = require('path');
const { fileURLToPath } = require('url');
const { randomUUID } = require('crypto');

function createSessionSecurity({ session, webContents, root, isPipContents }) {
  const hosts = new Map();
  const partitions = new WeakMap();
  const sessions = new Set();
  const guestOwners = new Map();
  const uiPath = path.resolve(root, 'renderer/index.html');
  // Told of every session the first time it is made. A container named by
  // hand or a site route's session is made when its first tab opens, and was
  // never given the permission handler (and the rest) persist:main has
  // (found 2026-09-30).
  const createdListeners = new Set();
  function fromPartition(partition = '', options) {
    if (typeof partition !== 'string' || partition.length > 160 || /[\x00-\x1f]/.test(partition)) throw new Error('Invalid session partition');
    const ses = session.fromPartition(partition, options);
    const first = !partitions.has(ses);
    sessions.add(ses);
    partitions.set(ses, partition);
    if (first) for (const fn of createdListeners) fn(ses, partition);
    return ses;
  }
  // Also told of the sessions made before it asked.
  function onSessionCreated(fn) {
    createdListeners.add(fn);
    for (const ses of [...sessions]) fn(ses, partitions.get(ses));
  }
  function partitionOf(contents) {
    return partitions.get(contents.session) ?? '';
  }
  function trackGuest(guest, hostId) {
    const id = guest.id, ses = guest.session;
    guestOwners.set(id, hostId);
    guest.once('destroyed', () => {
      guestOwners.delete(id);
      const partition = partitions.get(ses);
      if (!partition || partition.startsWith('persist:')) return;
      const remains = webContents.getAllWebContents().some(contents => !contents.isDestroyed() && contents.session === ses);
      if (!remains) {
        sessions.delete(ses);
        Promise.allSettled([ses.clearStorageData(), ses.clearCache(), ses.closeAllConnections()]).catch(() => {});
      }
    });
  }
  // A tab built without JavaScript keeps it off for every site after, so
  // leaving for a site that has it is done in a tab built again, and its back
  // list went with the old one (found 2026-09-29). A guest's history cannot
  // be read once it is gone, so such a guest's list is noted as it navigates
  // and kept after it closes, for the tab that replaces it.
  // A background tab is built again only when it is next shown, so a minute
  // was too short: one shown later came back with no back list (found
  // 2026-09-30). A list is kept until a tab takes it, its window closes, or
  // it is HISTORY_KEEP_MS old; and never more than HISTORY_MAX of them.
  const HISTORY_KEEP_MS = 30 * 60 * 1000, HISTORY_MAX = 50;
  const histories = new Map();
  function keepHistory(guest, hostId) {
    const id = guest.id;
    const note = () => {
      if (guest.isDestroyed()) return;
      const nav = guest.navigationHistory;
      histories.delete(id);   // the newest last, for the cap below
      histories.set(id, { hostId, partition: partitionOf(guest), entries: nav.getAllEntries(), index: nav.getActiveIndex() });
      while (histories.size > HISTORY_MAX) histories.delete(histories.keys().next().value);
    };
    guest.on('did-navigate', note);
    guest.on('did-navigate-in-page', note);
    guest.once('destroyed', () => {
      const kept = histories.get(id);
      if (kept) setTimeout(() => { if (histories.get(id) === kept) histories.delete(id); }, HISTORY_KEEP_MS).unref?.();
    });
  }
  // Done as the new guest attaches, before its first page commits: a used
  // webContents refuses a restore. The guest's own first load (the site it
  // was built for) then lands after the restored entries. That load cuts
  // short the one restore starts, so restore rejects with ERR_ABORTED, which
  // is the expected outcome here and not an error.
  function restoreHistory(guest, saved) {
    if (!saved.entries.length) return;
    let pending;
    try { pending = guest.navigationHistory.restore({ index: saved.index, entries: saved.entries }); }
    catch (error) { console.error('[Vex] could not keep the tab\'s back list:', error.message); return; }
    pending.catch(error => { if (!/ERR_ABORTED/.test(error.message)) console.error('[Vex] could not keep the tab\'s back list:', error.message); });
  }
  function owner(contents) {
    if (!contents || contents.isDestroyed?.()) return null;
    if (hosts.has(contents.id)) return hosts.get(contents.id);
    const explicit = guestOwners.get(contents.id);
    if (explicit) return hosts.get(explicit) || null;
    if (contents.hostWebContents) return owner(contents.hostWebContents);
    const win = contents.getOwnerBrowserWindow?.();
    return win ? hosts.get(win.webContents.id) || null : null;
  }
  function isUiFrame(event) {
    const host = hosts.get(event.sender?.id);
    if (!host || event.senderFrame !== event.sender.mainFrame) return false;
    try { return path.resolve(fileURLToPath(new URL(event.senderFrame.url))) === uiPath; }
    catch { return false; }
  }
  function registerHost(win, privatePartition = null) {
    const hostId = win.webContents.id;
    const host = { win, privatePartition, data: Object.create(null), persist: Object.create(null) };
    win.on('close', event => {
      if (host.allowClose || win.webContents.isDestroyed()) return;
      event.preventDefault();
      if (host.flushing) return;
      host.flushing = true;
      win.webContents.send('storage:flush-request');
      host.flushTimer = setTimeout(() => {
        host.flushing = false;
        if (!win.isDestroyed()) win.webContents.send('vex:toast', 'Saving has not finished. Retry closing when storage is available.');
      }, 8000);
    });
    hosts.set(win.webContents.id, host);
    // The back list a tab built again is to keep (see keepHistory above), by
    // the id of the guest made for it. It went to whichever webview attached
    // next within 5 s, and webviews attach in the background too: a tab
    // restored by another could get the wrong tab's list (found 2026-09-30).
    // Electron makes the guest straight after this event returns, before any
    // other code runs, and here says it attached in that same run (measured
    // 2026-09-30): a 'did-attach-webview' before this run ends is that guest's.
    // Should it come later, a microtask queued here finds the guest instead:
    // the newest webview of this window, made after the event. A refused
    // attach makes none, and its list goes to nobody.
    let expecting = null;
    const carries = new Map();
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-redirect', event => event.preventDefault());
    win.webContents.on('will-attach-webview', (event, prefs, params) => {
      try {
        const requested = params.partition || 'persist:main';
        const partition = privatePartition || requested;
        fromPartition(partition);
        // A tab built without JavaScript that leaves for a site with it is
        // built again (renderer/js/webview.js), and names the guest it
        // replaces. Only that guest's back list, from this window and this
        // partition, is taken.
        const from = Number(prefs.vexHistoryFrom);
        delete prefs.vexHistoryFrom;
        const saved = Number.isInteger(from) ? histories.get(from) : null;
        if (saved) histories.delete(from);
        if (saved && saved.hostId === hostId && saved.partition === partition) {
          const entry = expecting = { saved, before: Math.max(0, ...webContents.getAllWebContents().map(c => c.id)) };
          queueMicrotask(() => {
            if (expecting !== entry) return;   // taken, or another attach began
            expecting = null;
            const guest = webContents.getAllWebContents().find(c => c.id > entry.before && !c.isDestroyed() && c.getType() === 'webview' && c.hostWebContents === win.webContents);
            if (!guest) return;
            carries.set(guest.id, saved);
            guest.once('destroyed', () => carries.delete(guest.id));
          });
        } else expecting = null;
        delete prefs.preload;
        delete prefs.preloadURL;
        prefs.nodeIntegration = false;
        prefs.nodeIntegrationInSubFrames = false;
        prefs.contextIsolation = true;
        prefs.sandbox = true;
        prefs.webSecurity = true;
        // A page's native alert/confirm box belongs to the whole Vex window
        // and disabled all of it. The preload asks over the page's own tab
        // instead (main/page-dialogs.js); this keeps any frame it does not
        // reach from bringing the window-wide box back.
        prefs.disableDialogs = true;
        prefs.partition = partition;
        // Explicit session wins over a conflicting renderer-provided partition.
        prefs.session = fromPartition(partition);
      } catch { event.preventDefault(); }
    });
    win.webContents.on('did-attach-webview', (_event, guest) => {
      trackGuest(guest, hostId);
      let take = carries.get(guest.id);
      carries.delete(guest.id);
      if (!take && expecting && guest.id > expecting.before) { take = expecting.saved; expecting = null; }
      if (take) restoreHistory(guest, take);
      if (guest.getLastWebPreferences?.()?.javascript === false) keepHistory(guest, hostId);
    });
    win.once('closed', () => {
      clearTimeout(host.flushTimer);
      hosts.delete(hostId);
      host.data = host.persist = null;
      for (const [id, saved] of histories) if (saved.hostId === hostId) histories.delete(id);
      for (const [id, ownerId] of guestOwners) if (ownerId === hostId) {
        const guest = webContents.fromId(id);
        try { guest?.close(); } catch {}
        guestOwners.delete(id);
      }
      if (privatePartition) {
        const ses = fromPartition(privatePartition);
        Promise.allSettled([ses.clearStorageData(), ses.clearCache(), ses.closeAllConnections()]).catch(error => console.error('Private cleanup failed', error));
        sessions.delete(ses);
      }
    });
    return host;
  }
  function linkGuest(guest, source) {
    const host = owner(source);
    if (host) {
      trackGuest(guest, host.win.webContents.id);
    }
  }
  function ownsTarget(event, id) {
    if (!Number.isInteger(id) || id <= 0) return false;
    const target = webContents.fromId(id);
    return !!target && owner(target) === owner(event.sender) && !!owner(target);
  }
  // A tab closed: the back lists kept for its pages go now, not HISTORY_KEEP_MS
  // later (found 2026-09-30). Only lists this window noted.
  function forgetHistories(hostId, ids) {
    for (const id of ids) if (histories.get(id)?.hostId === hostId) histories.delete(id);
  }
  return { fromPartition, onSessionCreated, partitionOf, owner, isUiFrame, registerHost, linkGuest, ownsTarget, forgetHistories,
    isAuxiliary(event, channel) {
      if (event.senderFrame !== event.sender.mainFrame) return false;
      // The Picture-in-Picture pop-out, asked of the module that owns it. It
      // used to be recognised by its preload path — which this Electron does
      // not report any more, so every button in the pop-out was refused.
      if (channel.startsWith('pip:')) return !!(isPipContents && isPipContents(event.sender));
      // An extension's own page asking which tab its toolbar popup was opened
      // over (preload-webview.js). main.js answers only the popup's extension.
      // Or asking for a Vex tab (tabs.create, openOptionsPage); main.js opens
      // only web pages and that extension's own pages. Or closing a tab
      // (tabs.remove); main.js closes only a Vex tab in its own session.
      // Or which tab is in front (tabs.query/get); main.js answers only with
      // pages in the extension's own session.
      if (channel === 'extensions:popup-tab' || channel === 'extensions:open-tab' || channel === 'extensions:close-tab' || channel === 'extensions:active-tabs') return /^chrome-extension:\/\//.test(event.senderFrame.url || '');
      try { return channel === 'popup-chrome:action' && fileURLToPath(event.senderFrame.url) === path.join(root, 'renderer/popup-chrome.html'); }
      catch { return false; }
    },
    hosts, sessions, newPrivatePartition: () => 'private:' + randomUUID() };
}
module.exports = { createSessionSecurity };
