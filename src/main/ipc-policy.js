const GUEST_CHANNELS = new Set(['compatibility:get', 'geolocation:check-permission', 'geolocation:get', 'privacy:config-sync', 'screen-share:get-quality',
  '@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled', 'guest:page-shortcut', 'page-dialog', 'popup:activation']);
const TARGET_CHANNELS = new Set(['vex:set-bg-throttling', 'media:list', 'media:download', 'webview:hard-reload',
  'devtools:toggle-webview', 'devtools:open-for-webcontents', 'spellcheck:replace-misspelling', 'page:eval-all-frames', 'permissions:list-for-page', 'tabs:favicon',
  // The site panel's per-page permissions and certificate (main.js): a private
  // window's page keeps its answers in memory, so these stay allowed there.
  'permissions:set-for-page', 'permissions:reset-for-page', 'site:certificate',
  // A page saved or captured by its id: only one of the asking window's own
  // (security scan L1).
  'page:save', 'page:capture-full',
  // A picture for the AI, fetched through that page's own session (main.js).
  'image:for-ai']);
// siterules:set: a private window starts with an empty list, and saving it
// wiped every per-site rule. adblocker-set-state: main keeps one switch, so a
// private window turned blocking off for every window (both found 2026-09-29).
// routing:forget/prune follow the main window's site rules, as routing:set does.
// site:clear-data is allowed: main clears the private window's own session
// (main.js, _siteSessionFor). Writes that would land in the main profile are
// not: restoring saved settings, reminders, mail accounts, and a page opened as
// an app or an overlay, which live in persist:main (security scan L2, L3).
const PRIVATE_DISABLED = /^(?:siterules:set|adblocker-set-state|browsing:|cloud:|sync-|recall:|vault:save|vault:delete|totp:add|totp:delete|routing:set|routing:forget|routing:prune|extensions:|discord:|roblox:|theme:set|privacy:set|privacy:tracker-reset|permissions:revoke|permissions:clear|gui-style:set|updates:(?:download|cancel|install|backup)|app:restart|browser-import:|profiles:|app:restore-settings|reminders:(?:create|import|delete)|mail:(?:add|remove)|app:open-as-app|overlay:open|mcp:auth-set)/;
// Channels only Vex's own window may use — never a page, an extension, the
// Picture-in-Picture pop-out or any other auxiliary window, whatever
// isAuxiliary comes to allow. clipboard:write-secret puts a password on the
// system clipboard (main/secret-clipboard.js).
const UI_ONLY_CHANNELS = new Set(['clipboard:write-secret']);
function validatePayload(channel, args) {
  require('./ipc-schemas').validate(channel, args);
  const dataContracts = require('../renderer/js/data-contracts');
  dataContracts.json(args);
  if (channel === 'storage-save') dataContracts.storage(args[0], args[1]);
  if (channel === 'persist-set' && /^vex\.(bookmarks|sessions|history|workspaces|groups|stacks|shortcuts)$/.test(args[0])) {
    dataContracts.storage(args[0].slice(4), JSON.parse(args[1]));
  }
  const contracts = require('./contracts');
  if (channel === 'storage:history-add') contracts.assertHistoryEntry(args[0]);
  if (channel === 'storage-save' && args[0] === 'tabs') contracts.assertTabs(args[1]);
  const encoded = JSON.stringify(args);
  if (encoded.length > 12 * 1024 * 1024) throw new Error('IPC payload too large');
  const visit = (value, depth = 0) => {
    if (depth > 40) throw new Error('IPC payload too deeply nested');
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe property');
      visit(value[key], depth + 1);
    }
  };
  visit(args);
  if (/^storage-(?:load|save)$/.test(channel) && (typeof args[0] !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(args[0]))) throw new Error('Invalid storage key');
  if (/^persist-(?:set|delete)$/.test(channel) && (typeof args[0] !== 'string' || !/^(?:vex[._-])[\w.:-]{1,160}$/.test(args[0]))) throw new Error('Invalid preference key');
}
function installIpcPolicy(ipcMain, security) {
  const handle = ipcMain.handle.bind(ipcMain), on = ipcMain.on.bind(ipcMain);
  function authorize(channel, event, args) {
    validatePayload(channel, args);
    const ui = security.isUiFrame(event);
    const host = security.owner(event.sender);
    if (!ui && !security.isAuxiliary(event, channel) && !(GUEST_CHANNELS.has(channel) && host)) {
      // The quick-capture window is its own BrowserWindow, so it is not a UI
      // frame and not a guest: it may use exactly the two channels it has, and
      // nothing else (renderer/capture.html, preload-capture.js).
      const senderUrl = event.senderFrame?.url || '';
      if (/^file:.*\/renderer\/capture\.html(?:[?#]|$)/i.test(senderUrl) && ['capture:submit', 'capture:close'].includes(channel)) return host;
      // Start page preloads expose only these two read-only features.
      const start = senderUrl;
      if (!(host && /^file:.*\/renderer\/start\.html(?:[?#]|$)/i.test(start) && ['web-suggest', 'theme:get-custom-image'].includes(channel))) {
        throw new Error('Untrusted IPC sender');
      }
    }
    // Past the general rule above, a UI-only channel still needs Vex's own window.
    if (UI_ONLY_CHANNELS.has(channel) && !ui) throw new Error('Not available outside Vex’s own window');
    // A <webview> that has just attached reports its id as -1; the DevTools
    // opener then matches the page by URL and checks ownership itself, so the
    // id check only applies when there is an id to check.
    const idGiven = !(channel === 'devtools:open-for-webcontents' && Number.isInteger(args[0]) && args[0] <= 0);
    if (TARGET_CHANNELS.has(channel) && idGiven && !security.ownsTarget(event, args[0])) throw new Error('Target belongs to another window');
    if (channel === 'app:tab-memory' && (!Array.isArray(args[0]) || args[0].some(id => !security.ownsTarget(event, id)))) throw new Error('Invalid tab ownership');
    return host;
  }
  // The ad blocker's page preload runs in every page of a session, so it also
  // runs in an extension's own pages and in Vex's Picture-in-Picture player,
  // which are nobody's tab. Refusing it there raised "Untrusted IPC sender" in
  // every popup, options page and background page (2026-09-29); there is
  // nothing to hide in those pages, so it is told exactly that.
  function adBlockerNotHere(channel, event) {
    if (!channel.startsWith('@ghostery/adblocker/')) return false;
    const url = String(event.senderFrame?.url || '');
    return /^(chrome-extension|file):/i.test(url) && !security.isUiFrame(event) && !security.owner(event.sender);
  }
  ipcMain.handle = (channel, callback) => handle(channel, async (event, ...args) => {
    if (adBlockerNotHere(channel, event)) return channel.endsWith('/is-mutation-observer-enabled') ? false : undefined;
    const host = authorize(channel, event, args);
    if (host?.privatePartition) {
      if (channel === 'storage-load') return host.data[args[0]] ?? null;
      if (channel === 'storage-save') { host.data[args[0]] = structuredClone(args[1]); return true; }
      if (channel === 'storage:history-add' || channel === 'storage:flush') return true;
      if (channel === 'persist-get-all') return { ...host.persist };
      if (channel === 'persist-set') { host.persist[args[0]] = args[1]; return true; }
      if (channel === 'persist-delete') { delete host.persist[args[0]]; return true; }
      if (channel === 'sync-load-key' || channel === 'sync-load-meta') return null;
      // A private window neither reads nor writes the recall index.
      if (channel === 'recall:search') return { total: 0, hits: [], terms: [], took: 0, private: true };
      if (channel === 'recall:stats') return { pages: 0, bytes: 0, oldest: 0, newest: 0, hosts: [], private: true };
      if (channel === 'gui-style:set') return true;
      // What is typed in a private window is never sent anywhere for
      // suggestions, from its address bar or its New Tab page.
      if (channel === 'web-suggest') return [];
      if (PRIVATE_DISABLED.test(channel)) throw new Error('This operation is unavailable in a private window');
    }
    return callback(event, ...args);
  });
  ipcMain.on = (channel, callback) => on(channel, (event, ...args) => {
    try {
      const host = authorize(channel, event, args);
      if (host?.privatePartition && PRIVATE_DISABLED.test(channel)) return;
      callback(event, ...args);
    }
    catch (err) {
      if (channel === 'privacy:config-sync') { event.returnValue = { farble: false }; return; }
      if (channel === 'compatibility:get') { event.returnValue = { suppressPasskeys: false }; return; }
      // A page's alert / confirm / prompt waits on this answer (sendSync), so a
      // refused one still answers: as cancelled, never left waiting for ever.
      // window.open waits on this one (sendSync): refused, it is told no.
      if (channel === 'popup:activation') { try { event.returnValue = false; } catch (replyErr) { console.error('[IPC] could not answer "popup:activation":', replyErr.message); } return; }
      if (channel === 'page-dialog') {
        console.warn('[IPC] refused "page-dialog": %s', (err && err.message) || err);
        try { event.returnValue = null; } catch (replyErr) { console.error('[IPC] could not answer "page-dialog":', replyErr.message); }
        return;
      }
      // Everything else used to be swallowed without a word, which is how a
      // refused message from the Picture-in-Picture pop-out looked exactly
      // like a button that did nothing. Say which channel was refused and why
      // — never the payload, which is the caller's business.
      console.warn('[IPC] refused "%s": %s', channel, (err && err.message) || err);
    }
  });
}
module.exports = { installIpcPolicy, validatePayload, UI_ONLY_CHANNELS };
