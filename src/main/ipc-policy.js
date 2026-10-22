const GUEST_CHANNELS = new Set(['compatibility:get', 'geolocation:check-permission', 'geolocation:get', 'privacy:config-sync', 'screen-share:get-quality',
  '@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled', 'guest:page-shortcut', 'page-dialog', 'start-page:is-own',
  // A page's passkey request and the list for a field's chooser, from the page
  // preload (preload-passkeys.js); main takes the site from the asking frame.
  'passkeys:request', 'passkeys:cancel', 'passkeys:conditional-list',
  // A page's userscripts (userscripts-preload.js): main judges the tab and the
  // frame's own address; a refused tab is simply given none.
  'userscripts:page', 'userscripts:gm']);
const TARGET_CHANNELS = new Set(['vex:set-bg-throttling', 'panelguard:throttle', 'discord:heap-begin', 'discord:heap-end', 'discord:heap-usage', 'media:list', 'media:download', 'webview:hard-reload',
  'devtools:toggle-webview', 'devtools:open-for-webcontents', 'spellcheck:replace-misspelling', 'spellcheck:add-word', 'page:eval-all-frames', 'permissions:list-for-page', 'tabs:favicon', 'tabs:history', 'tabs:nav-list', 'tabs:preconnect',
  // The site panel's per-page permissions and certificate (main.js): a private
  // window's page keeps its answers in memory, so these stay allowed there.
  'permissions:set-for-page', 'permissions:reset-for-page', 'site:certificate', 'hygiene:perm-stop',
  // Which address one of Vex's own pages in a tab stands for (main/vex-page-address.js).
  'tabs:vex-page-address',
  // A page saved or captured by its id: only one of the asking window's own
  // (security scan L1).
  'page:save', 'page:capture-full', 'pagearchive:save',
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
const PRIVATE_DISABLED = /^(?:websafety:(?:set-sensitivity|allow-host|forget-host|set-paranoid)|siterules:set|adblocker-set-state|browsing:|cloud:|sync-|recall:|pagearchive:|userscripts:(?:install|set-enabled|remove|set-global|set-hosts|clear-values|fetch)|vault:save|vault:delete|vault:update|vault:export-csv|vault:breach-check|passkeys:(?:list|delete|undo-delete|rename)|totp:add|totp:delete|totp:rename|totp:import-migration|totp:export-backup|totp:import-backup|routing:set|routing:forget|routing:prune|extensions:|discord:|roblox:|bypass:|window:keep-on-top|devdesk:|devext:|castlabs:|devbench:|hygiene:|gccbridge:|secondscreen:|pip:memory|theme:set|privacy:set|privacy:tracker-reset|permissions:revoke|permissions:clear|gui-style:set|updates:(?:download|cancel|install|backup)|app:restart|browser-import:|profiles:|reminders:(?:create|import|delete)|mail:(?:add|remove)|app:open-as-app|overlay:open|pcbb:|mcp:auth-set|news:|downloads:(?:choose-folder|set-ask|set-media-names|set-resume|reset-prefs|tidy-plan|tidy-apply|tidy-undo|tidy-history|release-assist|mods-plan|mods-apply|mods-undo|mods-history|motw-check|open-defender|defender-scan|extract-here)|privacy:report|tabsnap:|quiet:|clips-inbox:|playground:|health:|signout:|kb:|packs:|companion:|egress:|journal:|tuning:|attention:|github:|devfeeds:|repos:|startup:|applock:|profilecrypt:|transcribe:|photoprep:|tabs:preconnect|jump:|jumplist:|windows:|sources:|pdftool:|comms:|status:|localsvc:|webhook:|feedback:|spellcheck:set-languages|panelguard:)/;
// Channels only Vex's own window may use — never a page, an extension, the
// Picture-in-Picture pop-out or any other auxiliary window, whatever
// isAuxiliary comes to allow. clipboard:write-secret puts a password on the
// system clipboard (main/secret-clipboard.js). theme:read-wallpaper hands
// back the owner's desktop picture (main/wallpaper.js).
// The sync-secrets-* channels read and write saved passwords and authenticator
// accounts for Vex Sync (main/sync-secrets.js).
// companion:* pairs a phone browser and publishes the Devices view (main/companion.js).
const UI_ONLY_CHANNELS = new Set([
  // The sampling heap profiler on the Discord panel (main/discord-heap.js): Vex's own window only.
  'discord:heap-begin', 'discord:heap-end', 'discord:heap-usage',
  // The language the native dialogs speak (main/i18n-main.js).
  'i18n:set-language',
  // The Queue panel's setup form saves its address and secret.
  'sidebar-config:set-queue',
  // Knowledge base (main/knowledge-base.js): the index holds page text.
  'kb:plan', 'kb:put', 'kb:sync-archive', 'kb:status', 'kb:step', 'kb:search', 'kb:context', 'kb:related', 'kb:related-page', 'kb:keep-out', 'kb:keep-out-clear', 'kb:forget',
  // Cookie report and cleanup, extension usage, crash-proof tab snapshots
  // (they hold typed text) and quiet hours (main/protect.js): never a page's
  // or an extension's call.
  'privacy:report', 'privacy:report-clean', 'extensions:usage-audit', 'tabsnap:save', 'tabsnap:load', 'tabsnap:clear', 'tabsnap:drop',
  'quiet:get', 'quiet:set', 'quiet:held', 'quiet:release', 'quiet:drop',
  // The Attention Budget (main/notify.js): the window's quiet state, and the toasts it held back.
  'attention:state', 'attention:denied', 'attention:clear-denied',
  // Ctrl+Tab by recency (main/mru-keys.js) and the Back/Forward menu's list of a tab's pages.
  'tabs:mru-keys', 'tabs:nav-list', 'tabs:preconnect', 'jump:take', 'jumplist:apply', 'windows:state', 'windows:reopen-closed',
  // Which languages the spell checker uses (main.js, js/spell-lang.js).
  'spellcheck:set-languages', 'spellcheck:state',
  'panelguard:throttle',
  'login-item:get', 'login-item:set', 'clipboard:write-secret', 'clipboard:clear-if', 'open-guest-window',
  'startup:list', 'startup:signatures', 'applock:make-record', 'applock:stores', 'applock:reset', 'applock:lock-on-minimize', 'photoprep:open', 'photoprep:save','theme:read-wallpaper', 'vault:export-csv', 'totp:export-backup', 'totp:import-backup',
  'screen-share:preflight', 'signout:why', 'commit:state',
  // Permission hygiene, what am I signed in to, the kill switch, the incident checklist and the password-field interlock.
  'hygiene:perm-config', 'hygiene:perm-summary', 'hygiene:perm-pin', 'hygiene:perm-decide', 'hygiene:perm-live', 'hygiene:perm-stop',
  'hygiene:signed-in', 'hygiene:kill-site', 'hygiene:site-links', 'hygiene:downloads-scan', 'credguard:check',
  'companion:start', 'companion:publish', 'companion:status', 'companion:stop',
  // Which feature is starting (safe mode's feature isolation) and the ledger of
  // what left this computer: Vex's own window only, never a page's.
  'app:boot-feature', 'app:boot-disabled', 'egress:summary', 'egress:list', 'egress:clear',
  // The GitHub read-only token vault and the developer feeds: Vex's own window only.
  'github:status', 'github:token-set', 'github:token-clear', 'github:token-test', 'github:get',
  'devfeeds:latest', 'devfeeds:advisories', 'devfeeds:ping', 'devfeeds:notes', 'fx:tcmb', 'status:check',
  // Developer desk, plugin dev loop and the Electron ticker: Vex's own window only.
  'devdesk:config', 'devdesk:set-config', 'devdesk:grant-root', 'devdesk:revoke-root', 'devdesk:open-file', 'devdesk:open-terminal', 'devdesk:branch', 'devdesk:ports',
  'devext:pick', 'devext:reload', 'devext:stop', 'devext:status', 'devext:vencord', 'castlabs:behind',
  'devext:vencord-pick', 'devext:vencord-status', 'devext:vencord-reload', 'devext:vencord-restore', 'devext:console-start', 'devext:console-stop', 'devext:console-clear', 'devext:console-list',
  // The sources list's DOI lookup and the PDF toolkit's file picker and writer: Vex's own window only.
  'sources:resolve-doi', 'sources:resolve-id', 'pdftool:pick-files', 'pdftool:run', 'pdftool:forget', 'pdftool:inspect',
  // The owner's announcement webhook and the Vencord bridge file (main/comms-tools.js): Vex's own window only.
  'comms:webhook-status', 'comms:webhook-set', 'comms:webhook-clear', 'comms:webhook-send', 'comms:bridge-status', 'comms:bridge-pick', 'comms:bridge-read', 'comms:bridge-forget', 'comms:status-write',
  // The local-service launcher and the webhook inspector: starting programs and opening a port are Vex's own window only.
  'localsvc:status', 'localsvc:arm', 'localsvc:pick-folder', 'localsvc:add', 'localsvc:pick-program', 'localsvc:add-custom', 'localsvc:remove', 'localsvc:start', 'localsvc:stop', 'localsvc:logs',
  'webhook:start', 'webhook:stop', 'webhook:status', 'webhook:list', 'webhook:get', 'webhook:clear',
  // Sending a version review to the person's own relay (main/feedback-relay.js): Vex's own window only.
  'feedback:send',
  'sync-secrets-seal', 'sync-secrets-apply', 'sync-secrets-describe', 'sync-secrets-put-back',
  // Health check: scans and repairs the profile folder (main/health-check.js).
  'health:scan', 'health:fix', 'health:undo',
  // The agreement at start (js/legal.js): its documents, its "Quit Vex", and
  // whether it is up (main holds its keys back meanwhile).
  'legal:read', 'app:quit', 'legal:gate',
  // Whether Vex was uninstalled by hand and installed again (the note build/installer.nsh leaves in the profile folder): Vex's own window only.
  'setup:take-uninstall-marker',
  // Starting the owner's Game Control Center and choosing where it is
  // (main/game-control-center.js): launching a program is never a page's call.
  'gcc:launch', 'gcc:get', 'gcc:pick', 'gcc:clear',
  // Writing a line into Game Control Center's Black Box folder is never a page's call.
  'pcbb:link-set', 'pcbb:link-state', 'pcbb:tabcost',
  // Game mode (main/game-mode.js): which programs to watch for, and lowering
  // Vex's own process priority, are never a page's call.
  'gamemode:games', 'gamemode:session', 'gamemode:state', 'gamemode:library',
  // Recall's caps and retention (main/recall-index.js): never a page's call.
  'recall:limits',
  // "Site down, or my bypass?" (main/bypass-probe.js): requests an address from this computer.
  'bypass:probe',
  'window:keep-on-top',
  // Game Control Center's file, the second-screen window and the PiP memory (T2-068, T2-049, T2-059):
  // opening a window or reading a file is never a page's call.
  'gccbridge:read', 'secondscreen:open', 'secondscreen:close', 'secondscreen:state', 'pip:memory',
  // Time travel and the tuning advisor (main/state-journal.js,
  // main/tuning-advisor.js): the journal of what was open and the cost
  // history are never a page's to read, write or forget.
  'journal:push', 'journal:list', 'journal:at', 'journal:diff', 'journal:note-versions', 'journal:note-version',
  'journal:stats', 'journal:configure', 'journal:forget', 'tuning:advise', 'tuning:history', 'tuning:forget',
  // Passkeys (main/passkeys.js): answering the sheet, Settings' list and a
  // field's chooser pick are never a page's call.
  'passkeys:answer', 'passkeys:list', 'passkeys:delete', 'passkeys:undo-delete', 'passkeys:rename', 'passkeys:conditional-choose',
  // A watched page read through a hidden tab (main/page-render.js): loading an
  // address is never a page's or an extension's call.
  'pagewatch:render',
  // Web safety settings (main/web-safety.js): what Vex warns about, which
  // sites are trusted and which are in paranoid mode are never a page's call.
  'websafety:get', 'websafety:set-sensitivity', 'websafety:allow-host', 'websafety:forget-host', 'websafety:set-paranoid', 'websafety:check',
  // The site panel's third-party count and a download's explanation (main/safe-web-extras.js): read-only, but only the interface asks.
  'websafety:third-party-count', 'downloads:explain',
  // An AI news toast and the clicks waiting for the interface (js/ai-news.js):
  // raising a notification is never a page's or an extension's call.
  'news:notify', 'news:pending',
  // The userscript manager (main/userscripts.js): installing, switching and
  // deleting code that runs on sites is never a page's call.
  'userscripts:list', 'userscripts:preview', 'userscripts:install', 'userscripts:set-enabled', 'userscripts:remove', 'userscripts:set-global', 'userscripts:set-hosts', 'userscripts:clear-values', 'userscripts:fetch',
  // The API playground (main/api-playground.js): sending a request with
  // headers the person wrote is never a page's or an extension's call.
  'playground:send', 'playground:send-form', 'playground:secrets-keys', 'playground:secrets-apply', 'playground:secrets-migrate',
  // Vex Packs (main/packs-store.js): installing, switching, trusting a signing
  // key and exporting are never a page's, an extension's or an auxiliary
  // window's call. Closed in a private window too (PRIVATE_DISABLED).
  'packs:list', 'packs:items', 'packs:pick-file', 'packs:preview', 'packs:install', 'packs:discard', 'packs:set-enabled', 'packs:uninstall',
  'packs:set-global', 'packs:trust-key', 'packs:untrust-key', 'packs:generate-key', 'packs:export',
  // The quick-capture inbox holds what was clipped (main/capture-inbox.js) and
  // the downloads tidy-up history holds file names: the person's own window only.
  'repos:pick-folder', 'clips-inbox:list', 'clips-inbox:add', 'clips-inbox:remove', 'clips-inbox:clear', 'clips-inbox:stamp', 'downloads:tidy-history', 'downloads:tidy-plan', 'downloads:tidy-apply', 'downloads:tidy-undo',
  'devbench:requests', 'devbench:record-start', 'devbench:record-list', 'devbench:record-stop', 'devbench:overrides-get', 'devbench:overrides-set', 'devbench:overrides-active', 'devbench:overrides-state', 'devbench:overrides-pick-file',
  'devbench:log-pick-file', 'devbench:log-follow-socket', 'devbench:log-poll', 'devbench:log-stop', 'devbench:log-list', 'devbench:pkg',
  // The release-download assistant and the mod desk (main/download-desk.js): file names and hashes, the person's own window only.
  'downloads:set-media-names', 'downloads:set-ask-types', 'downloads:release-assist', 'downloads:mods-plan', 'downloads:mods-apply', 'downloads:mods-undo', 'downloads:mods-history',
  // Which downloads lost their "from the internet" mark, and the Windows Security shortcut: the person's own window only.
  'downloads:motw-check', 'downloads:open-defender', 'downloads:defender-scan',
  // The encrypted profile lock (main/profile-lock-ipc.js): switching it on or off and the passphrase are Vex's own window only.
  // (profilecrypt:unlock and :quit belong to the unlock window, which has no Vex interface; see authorize().)
  'profilecrypt:status', 'profilecrypt:enable', 'profilecrypt:disable', 'profilecrypt:change', 'profilecrypt:new-recovery',
  // Local transcription of the person's own speech (main/transcribe.js): choosing the engine, listening and running it are Vex's own window only.
  'transcribe:config', 'transcribe:pick', 'transcribe:clear', 'transcribe:set', 'transcribe:begin', 'transcribe:chunk', 'transcribe:end',
  // Unpacking an archive writes files into the downloads folder: the person's own window only, closed in a private window.
  'downloads:extract-here']);
function validatePayload(channel, args) {
  require('./ipc-schemas').validate(channel, args);
  const dataContracts = require('../renderer/js/data-contracts');
  dataContracts.json(args);
  if (channel === 'storage-save') dataContracts.storage(args[0], args[1]);
  if (channel === 'persist-set' && /^vex\.(bookmarks|sessions|history|workspaces|groups|stacks|shortcuts)$/.test(args[0])) {
    dataContracts.storage(args[0].slice(4), JSON.parse(args[1]));
  }
  if (channel === 'persist-apply') {
    for (const [key, value] of args[0]) {
      if (!/^(?:vex[._-])[\w.:-]{1,160}$/.test(key)) throw new Error('Invalid preference key');
      if (value !== null && /^vex\.(bookmarks|sessions|history|workspaces|groups|stacks|shortcuts)$/.test(key)) dataContracts.storage(key.slice(4), JSON.parse(value));
    }
  }
  const contracts = require('./contracts');
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
// The last refusals, for the diagnostics bundle (js/diagnostics-bundle.js): when, which channel and the
// refusal's own reason, never the payload. Bounded; oldest first out.
const MAX_REFUSALS = 50;
const _refusals = [];
function noteRefusal(channel, err) {
  _refusals.push({ at: Date.now(), channel: String(channel).slice(0, 80), reason: String((err && err.message) || err).slice(0, 120) });
  while (_refusals.length > MAX_REFUSALS) _refusals.shift();
}
function recentRefusals() { return _refusals.slice().reverse(); }

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
      // The unlock window of an encrypted profile (main/profile-unlock.js) is its own window before
      // Vex's interface exists; it may use its two channels (the handler also checks the sender).
      if (/^file:.*\/renderer\/profile-unlock\.html(?:[?#]|$)/i.test(senderUrl) && ['profilecrypt:unlock', 'profilecrypt:quit'].includes(channel)) return host;
      // Start page preloads expose only these two read-only features. Vex's
      // own start.html, by its whole path: any file named renderer/start.html
      // passed before (audit SE6, 2026-10-10).
      if (!(host && ['web-suggest', 'theme:get-custom-image'].includes(channel) && security.isStartPageFile(senderUrl))) {
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
    let host;
    try { host = authorize(channel, event, args); } catch (err) { noteRefusal(channel, err); throw err; }
    if (host?.privatePartition) {
      if (channel === 'storage-load') return host.data[args[0]] ?? null;
      if (channel === 'storage-save') { host.data[args[0]] = structuredClone(args[1]); return true; }
      if (channel === 'storage:flush') return true;
      if (channel === 'persist-get-all') return { ...host.persist };
      if (channel === 'persist-set') { host.persist[args[0]] = args[1]; return true; }
      if (channel === 'persist-delete') { delete host.persist[args[0]]; return true; }
      if (channel === 'persist-apply') { for (const [key, value] of args[0]) { if (value === null) delete host.persist[key]; else host.persist[key] = value; } return true; }
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
      noteRefusal(channel, err);
      if (channel === 'privacy:config-sync') { event.returnValue = { farble: false }; return; }
      if (channel === 'compatibility:get') { event.returnValue = { suppressPasskeys: false }; return; }
      // A page's alert / confirm / prompt waits on this answer (sendSync), so a
      // refused one still answers: as cancelled, never left waiting for ever.
      // The start-page check waits on this one (sendSync): refused, it is told no.
      if (channel === 'userscripts:page') { try { event.returnValue = { scripts: [] }; } catch (replyErr) { console.error('[IPC] could not answer "userscripts:page":', replyErr.message); } return; }
      // The preload waits on this one (sendSync) while the window loads: refused, it is told none are left out.
      if (channel === 'app:boot-disabled') { console.warn('[IPC] refused "app:boot-disabled": %s', (err && err.message) || err); try { event.returnValue = []; } catch (replyErr) { console.error('[IPC] could not answer "app:boot-disabled":', replyErr.message); } return; }
      if (channel === 'start-page:is-own') { try { event.returnValue = false; } catch (replyErr) { console.error('[IPC] could not answer "' + channel + '":', replyErr.message); } return; }
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
module.exports = { installIpcPolicy, validatePayload, UI_ONLY_CHANNELS, recentRefusals, noteRefusal };
