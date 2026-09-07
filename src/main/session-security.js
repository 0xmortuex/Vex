const path = require('path');
const { fileURLToPath } = require('url');
const { randomUUID } = require('crypto');

function createSessionSecurity({ session, webContents, root }) {
  const hosts = new Map();
  const partitions = new WeakMap();
  const sessions = new Set();
  const guestOwners = new Map();
  const uiPath = path.resolve(root, 'renderer/index.html');
  function fromPartition(partition = '', options) {
    if (typeof partition !== 'string' || partition.length > 160 || /[\x00-\x1f]/.test(partition)) throw new Error('Invalid session partition');
    const ses = session.fromPartition(partition, options);
    sessions.add(ses);
    partitions.set(ses, partition);
    return ses;
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
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-redirect', event => event.preventDefault());
    win.webContents.on('will-attach-webview', (event, prefs, params) => {
      try {
        const requested = params.partition || 'persist:main';
        const partition = privatePartition || requested;
        fromPartition(partition);
        delete prefs.preload;
        delete prefs.preloadURL;
        prefs.nodeIntegration = false;
        prefs.nodeIntegrationInSubFrames = false;
        prefs.contextIsolation = true;
        prefs.sandbox = true;
        prefs.webSecurity = true;
        prefs.partition = partition;
        // Explicit session wins over a conflicting renderer-provided partition.
        prefs.session = fromPartition(partition);
      } catch { event.preventDefault(); }
    });
    win.webContents.on('did-attach-webview', (_event, guest) => {
      trackGuest(guest, hostId);
    });
    win.once('closed', () => {
      clearTimeout(host.flushTimer);
      hosts.delete(hostId);
      host.data = host.persist = null;
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
  return { fromPartition, partitionOf, owner, isUiFrame, registerHost, linkGuest, ownsTarget,
    isAuxiliary(event, channel) {
      if (event.senderFrame !== event.sender.mainFrame) return false;
      const preload = event.sender.getLastWebPreferences?.().preload;
      if (channel.startsWith('pip:') && preload === path.join(root, 'preload-pip.js')) return true;
      try { return channel === 'popup-chrome:action' && fileURLToPath(event.senderFrame.url) === path.join(root, 'renderer/popup-chrome.html'); }
      catch { return false; }
    },
    hosts, sessions, newPrivatePartition: () => 'private:' + randomUUID() };
}
module.exports = { createSessionSecurity };
