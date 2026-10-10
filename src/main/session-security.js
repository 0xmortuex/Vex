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
  // Every tab's back list, not only a JavaScript-off one's: sleeping a tab,
  // reopening a closed one and restoring tabs at start build its page again
  // from the address alone, and Back went nowhere (found 2026-10-10). The
  // window keeps each tab's list with the tab (js/webview.js asks for it after
  // every navigation, it is saved with the tab), and hands it back here before
  // the new page is made (carryHistory); restoreHistory above puts it in.
  // Kept small, it is saved with every tab: at most SAVED_ENTRIES around the
  // current page, an address and a short title each, no page state. Only what
  // a tab can go back to: web pages and the New Tab page. The saved file can be
  // edited by hand, so a carried list is checked here as strictly as one read.
  const SAVED_ENTRIES = 12, SAVED_FORWARD = 4, SAVED_URL = 2048, SAVED_TITLE = 120, CARRIED_MAX = 50;
  const startPage = path.resolve(root, 'renderer/start.html');
  function restorableEntry(url) {
    if (typeof url !== 'string' || url.length > SAVED_URL) return false;
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return true;
    if (parsed.protocol === 'vex:') return parsed.hostname === 'start';
    if (parsed.protocol !== 'file:') return false;
    try { return path.resolve(fileURLToPath(parsed)) === startPage; } catch { return false; }
  }
  // { entries: [{ url, title }], index } or null when there is nothing to go
  // back or forward to. A page that cannot be kept (a reading-mode data: page,
  // an error page) is left out; the current one is then the last kept page
  // before it, which is the address the tab itself keeps (js/webview.js).
  function trimHistory(list) {
    if (!list || typeof list !== 'object' || !Array.isArray(list.entries) || !Number.isInteger(list.index)) return null;
    if (list.index < 0 || list.index >= list.entries.length || list.entries.length > 1000) return null;
    const kept = [];
    let index = -1;
    list.entries.forEach((entry, at) => {
      if (!entry || typeof entry !== 'object' || !restorableEntry(entry.url)) return;
      kept.push({ url: entry.url, title: typeof entry.title === 'string' ? entry.title.slice(0, SAVED_TITLE) : '' });
      if (at <= list.index) index = kept.length - 1;
    });
    if (index < 0 || kept.length < 2) return null;
    const forward = Math.min(kept.length - 1 - index, SAVED_FORWARD);
    const back = Math.min(index, SAVED_ENTRIES - 1 - forward);
    return { entries: kept.slice(index - back, index + forward + 1), index: back };
  }
  function readHistory(guest) {
    const nav = guest.navigationHistory;
    return trimHistory({ entries: nav.getAllEntries(), index: nav.getActiveIndex() });
  }
  // A tab's saved list, for the page about to be made for it: the webview
  // names it with vexHistoryFrom=<token>. Per window; taken once.
  const carried = new Map();
  function carryHistory(hostId, token, partition, list) {
    if (typeof token !== 'string' || !/^c\d{1,9}$/.test(token)) throw new Error('Invalid history token');
    const saved = trimHistory(list);
    if (!saved) return false;
    if (!carried.has(hostId)) carried.set(hostId, new Map());
    const mine = carried.get(hostId);
    mine.delete(token);
    mine.set(token, { hostId, partition, ...saved });
    while (mine.size > CARRIED_MAX) mine.delete(mine.keys().next().value);
    return true;
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
    // A target=_blank link or window.open in Vex's own interface (onboarding,
    // the toolbox, the update notes) made a whole new window with this one's
    // preload and <webview> rights, and a page reached in it could build a
    // <webview> with Node in it (security scan H4). A web address opens as a
    // tab of this window instead; nothing else opens at all.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url || '') && !win.isDestroyed()) win.webContents.send('tab:create-from-external', { url });
      return { action: 'deny' };
    });
    win.webContents.on('will-attach-webview', (event, prefs, params) => {
      try {
        const requested = params.partition || 'persist:main';
        const partition = privatePartition || requested;
        fromPartition(partition);
        // A tab built without JavaScript that leaves for a site with it is
        // built again (renderer/js/webview.js), and names the guest it
        // replaces. Only that guest's back list, from this window and this
        // partition, is taken.
        // Or names the list it carried itself (carryHistory above).
        const named = prefs.vexHistoryFrom;
        delete prefs.vexHistoryFrom;
        let saved = null;
        if (typeof named === 'string' && /^c\d{1,9}$/.test(named)) {
          const mine = carried.get(hostId);
          saved = mine?.get(named) || null;
          mine?.delete(named);
          // Built again at the page it was on: the restore loads that page
          // itself. Electron would load the webview's src as well, once the
          // guest attaches, and that load landed as a second copy of the page
          // after the restored ones and cut off the forward list (measured
          // 2026-10-10). Built for another address, its load still lands
          // after them, as a JavaScript-off tab's does.
          if (saved && saved.hostId === hostId && saved.partition === partition && params && params.src === saved.entries[saved.index].url) params.src = '';
        } else {
          const from = Number(named);
          saved = Number.isInteger(from) ? histories.get(from) : null;
          if (saved) histories.delete(from);
        }
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
      carried.delete(hostId);
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
  // For every webContents Vex makes (app.on('web-contents-created')): only a
  // Vex window may hold a <webview>, and registerHost's own handler then
  // strips its preload and turns Node off. Any other page — a popup, an app
  // window, an extension page — trying to attach one is refused, so no page
  // can build a webview with Node or a preload of its choosing (scan H4).
  // A window that shows one web page and is not a Vex window (Open as App,
  // the overlay). Its page runs the session's preloads as a tab's page does,
  // and they asked for the ad blocker's cosmetic filters, the fingerprint
  // and passkey settings and the page's alert/confirm answer, all of which
  // were refused as "Untrusted IPC sender" (2026-10-08). It may use exactly
  // those; page-dialogs.js answers it with the window's own box.
  const webWindows = new Set();
  const WEB_WINDOW_CHANNELS = new Set(['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled',
    'privacy:config-sync', 'compatibility:get', 'page-dialog', 'popup:activation']);
  function registerWebWindow(contents) {
    const id = contents.id;
    webWindows.add(id);
    contents.once('destroyed', () => webWindows.delete(id));
  }
  function guardWebviews(contents) {
    contents.on('will-attach-webview', (event, prefs) => {
      if (hosts.has(contents.id)) return;
      event.preventDefault();
      console.error('[Vex] refused a <webview> in a window that is not a Vex window' + (prefs && (prefs.preload || prefs.nodeIntegration) ? ' (it asked for a preload or Node)' : ''));
    });
  }
  return { fromPartition, onSessionCreated, partitionOf, owner, isUiFrame, registerHost, linkGuest, ownsTarget, forgetHistories, guardWebviews, registerWebWindow,
    readHistory, carryHistory, trimHistory,
    isAuxiliary(event, channel) {
      // Any frame of an Open as App / overlay window: the ad blocker runs in its iframes too.
      if (WEB_WINDOW_CHANNELS.has(channel) && webWindows.has(event.sender.id)) return true;
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
      // pages in the extension's own session. Or its menu items, badge and
      // shortcuts (extensions:api); main.js keeps them per extension.
      if (channel === 'extensions:popup-tab' || channel === 'extensions:open-tab' || channel === 'extensions:close-tab' || channel === 'extensions:active-tabs' || channel === 'extensions:api') return /^chrome-extension:\/\//.test(event.senderFrame.url || '');
      try { return channel === 'popup-chrome:action' && fileURLToPath(event.senderFrame.url) === path.join(root, 'renderer/popup-chrome.html'); }
      catch { return false; }
    },
    hosts, sessions, newPrivatePartition: () => 'private:' + randomUUID() };
}
module.exports = { createSessionSecurity };
