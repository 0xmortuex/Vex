const GUEST_CHANNELS = new Set(['compatibility:get', 'geolocation:check-permission', 'geolocation:get', 'privacy:config-sync', 'screen-share:get-quality',
  '@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled']);
const TARGET_CHANNELS = new Set(['vex:set-bg-throttling', 'media:list', 'media:download', 'webview:hard-reload',
  'devtools:toggle-webview', 'devtools:open-for-webcontents', 'spellcheck:replace-misspelling']);
const PRIVATE_DISABLED = /^(?:browsing:|cloud:|site:clear-data|sync-|recall:|vault:save|vault:delete|totp:add|totp:delete|routing:set|extensions:|discord:|roblox:|theme:set|privacy:set|privacy:tracker-reset|permissions:revoke|permissions:clear|gui-style:set|install-update|app:restart)/;
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
      // Start page preloads expose only these two read-only features.
      const start = event.senderFrame?.url || '';
      if (!(host && /^file:.*\/renderer\/start\.html(?:[?#]|$)/i.test(start) && ['web-suggest', 'theme:get-custom-image'].includes(channel))) {
        throw new Error('Untrusted IPC sender');
      }
    }
    if (TARGET_CHANNELS.has(channel) && !security.ownsTarget(event, args[0])) throw new Error('Target belongs to another window');
    if (channel === 'app:tab-memory' && (!Array.isArray(args[0]) || args[0].some(id => !security.ownsTarget(event, id)))) throw new Error('Invalid tab ownership');
    return host;
  }
  ipcMain.handle = (channel, callback) => handle(channel, async (event, ...args) => {
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
    catch {
      if (channel === 'privacy:config-sync') event.returnValue = { farble: false };
      if (channel === 'compatibility:get') event.returnValue = { suppressPasskeys: false };
    }
  });
}
module.exports = { installIpcPolicy, validatePayload };
