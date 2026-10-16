const { contextBridge, ipcRenderer, webUtils } = require('electron');
function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// === open-url buffering (cold-start link race fix) ===
// On a COLD start (Vex not already running) the main process sends the clicked
// link via the 'open-url' IPC at the window's did-finish-load. But the renderer
// only registers its handler late in its async init (after PersistentStorage /
// ThemeManager / TabManager.init …), so that first message arrived before any
// listener existed and was dropped — Vex opened to the start page instead of
// the link. Fix: subscribe HERE at preload-eval time (which runs before the
// page's scripts) and buffer URLs until the renderer attaches its callback.
//
// This mirrors createOpenUrlBuffer() in main-helpers.js (the tested spec) —
// preload is sandboxed and can't require() it, so keep the two in sync.
let _openUrlCb = null;
const _openUrlBuffer = [];
ipcRenderer.on('open-url', (_, url) => {
  if (_openUrlCb) {
    try { _openUrlCb(url); } catch { console.error('[Vex URL] URL handler failed'); }
  } else {
    console.log('[Vex URL] preload: no handler yet — buffering URL');
    _openUrlBuffer.push(url);
  }
});

contextBridge.exposeInMainWorld('vex', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  // The agreement at start (js/legal.js): a shipped document's text, and quitting Vex.
  legalRead: (name) => ipcRenderer.invoke('legal:read', name),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  // Game Control Center (Ctrl+K, and its row in Settings): start it, read or
  // choose or forget where it is. Main finds the program; nothing is passed.
  gccLaunch: () => ipcRenderer.invoke('gcc:launch'),
  gccGet: () => ipcRenderer.invoke('gcc:get'),
  gccPick: () => ipcRenderer.invoke('gcc:pick'),
  gccClear: () => ipcRenderer.invoke('gcc:clear'),
  // "Tell Game Control Center which tab was busy" (src/main/pcbb-link.js).
  pcbbLinkSet: (on) => ipcRenderer.invoke('pcbb:link-set', !!on),
  pcbbLinkState: () => ipcRenderer.invoke('pcbb:link-state'),
  pcbbTabCost: (data) => ipcRenderer.invoke('pcbb:tabcost', data),
  // It is up, or gone: main's own keys for this window stand aside meanwhile.
  legalGate: (up) => ipcRenderer.send('legal:gate', up),

  // Toggle background throttling on a live webContents (kept-awake tabs).
  setBackgroundThrottling: (wcId, enabled) => ipcRenderer.invoke('vex:set-bg-throttling', wcId, enabled),

  // Per-container routing (Tor / custom proxy / direct) for a session partition.
  routingSet: (partition, mode, custom) => ipcRenderer.invoke('routing:set', partition, mode, custom),
  routingGet: (partition) => ipcRenderer.invoke('routing:get', partition),
  // A site route no rule uses any more, and the partitions the rules do use.
  routingForget: (partition) => ipcRenderer.invoke('routing:forget', partition),
  routingPrune: (used) => ipcRenderer.invoke('routing:prune', used),
  // All of Vex through one route, and a real check of whether it is working.
  routingSetAll: (mode, custom) => ipcRenderer.invoke('routing:set-all', mode, custom),
  routingGetAll: () => ipcRenderer.invoke('routing:get-all'),
  routingCheck: (partition) => ipcRenderer.invoke('routing:check', partition),

  // Storage
  saveData: (key, data) => ipcRenderer.invoke('storage-save', key, data),
  loadData: (key) => ipcRenderer.invoke('storage-load', key),
  clearBrowsingData: () => ipcRenderer.invoke('browsing:clear-data'),
  clearHistory: () => ipcRenderer.invoke('browsing:clear-history'),
  flushStorage: () => ipcRenderer.invoke('storage:flush'),
  cloudRequest: body => ipcRenderer.invoke('cloud:request', body),
  saveCloudToken: token => ipcRenderer.invoke('cloud:token-save', token),
  onFlushRequested: cb => {
    const listener = () => Promise.resolve(cb()).then(() => ipcRenderer.send('storage:flushed')).catch(() => ipcRenderer.send('storage:flush-failed'));
    ipcRenderer.on('storage:flush-request', listener);
    return () => ipcRenderer.removeListener('storage:flush-request', listener);
  },

  // Smart Searchbar — Google Suggest web predictions, proxied through main to
  // dodge CORS (Google Suggest sends no Access-Control-Allow-Origin). Returns
  // string[] (fail-silent: [] on any error).
  webSuggest: (query) => ipcRenderer.invoke('web-suggest', query),

  // Tab management
  getStartPagePath: () => ipcRenderer.invoke('get-start-page-path'),
  getStartPageUrl: () => ipcRenderer.invoke('get-start-page-url'),

  // Ad blocker
  getAdBlockerState: () => ipcRenderer.invoke('adblocker-get-state'),
  setAdBlockerState: (enabled) => ipcRenderer.invoke('adblocker-set-state', enabled),

  // Events from main
  onCommandBar: (callback) => subscribe('toggle-command-bar', callback),
  onZoomIn: (callback) => subscribe('zoom-in', callback),
  onZoomOut: (callback) => subscribe('zoom-out', callback),
  onZoomReset: (callback) => subscribe('zoom-reset', callback),
  onFindInPage: (callback) => subscribe('find-in-page', callback),
  onNewTab: (callback) => subscribe('new-tab', callback),
  onCloseTab: (callback) => subscribe('close-tab', callback),
  onReloadTab: (callback) => subscribe('reload-tab', callback),
  // Core browser shortcuts forwarded from a focused page's <webview> guest
  // (they don't reach the host document otherwise).
  onFocusAddressBar: (callback) => subscribe('focus-address-bar', callback),
  onDictateToggle: (callback) => subscribe('dictate-toggle', callback),
  // A shortcut pressed while a page had focus, passed up so the renderer's
  // own registry (and any rebinding) still decides what it does.
  onGuestShortcut: (callback) => subscribe('guest-shortcut', callback),
  // Which key combinations the renderer's registry answers to, so a key
  // pressed while a page has the focus can be passed up to it.
  setGuestShortcutKeys: (combos) => ipcRenderer.send('shortcuts:guest-keys', combos),
  // The shortcut editor is recording: main lets Ctrl+T, F11 and its other own
  // keys through to the page instead of acting on them (clears after 15 s).
  setShortcutCapturing: (on) => ipcRenderer.invoke('shortcuts:capturing', on),
  onNextTab: (callback) => subscribe('next-tab', callback),
  onPrevTab: (callback) => subscribe('prev-tab', callback),
  onJumpToTab: (callback) => subscribe('jump-to-tab', callback),
  onBookmarkCurrent: (callback) => subscribe('bookmark-current', callback),
  onHardReloadTab: (callback) => subscribe('hard-reload-tab', callback),
  hardReloadWebview: (webContentsId) => ipcRenderer.invoke('webview:hard-reload', webContentsId),
  onNavigateBack: (callback) => subscribe('navigate-back', callback),
  onNavigateForward: (callback) => subscribe('navigate-forward', callback),

  // Split & PiP
  onToggleSplit: (callback) => subscribe('toggle-split', callback),
  onTogglePip: (callback) => subscribe('toggle-pip', callback),
  // pageId: the tab's page; the pop-out loads in that tab's own session.
  openPipWindow: (url, media, pageId) => ipcRenderer.invoke('open-pip-window', url, media, pageId),
  closePipWindow: () => ipcRenderer.invoke('close-pip-window'),
  isPipOpen: () => ipcRenderer.invoke('is-pip-open'),
  // Fires when the pop-out goes away, with 'closed' or 'back-to-tab'. The
  // renderer owns the source tab (main only ever gets a URL), so it is the
  // only side that can un-mute it and switch back to it.
  onPipClosed: (callback) => subscribe('pip:closed', callback),

  // Downloads (with progress tracking)
  onTabCreateFromExternal: (cb) => subscribe('tab:create-from-external', cb),
  // Which tab an extension's tabs.create made (requestId from the request above).
  tabCreatedForExtension: (payload) => ipcRenderer.send('tab:created-for-extension', payload),

  // Peek overlay (shift+click a link → floating preview)
  onPeekOpen: (cb) => subscribe('peek:open', cb),

  // OAuth/login popup backdrop — the auth popup is a REAL (opener-connected)
  // child window dressed like Peek; main dims Vex behind it via these events,
  // and a backdrop click dismisses the frameless popup.
  onOAuthPopupOpen: (cb) => subscribe('oauth-popup:open', cb),
  onOAuthPopupClose: (cb) => subscribe('oauth-popup:close', cb),
  dismissOAuthPopup: () => ipcRenderer.send('oauth-popup:dismiss'),

  // Generic main → renderer toast (e.g. Discord pop-out pin feedback).
  onToast: (cb) => subscribe('vex:toast', cb),
  // Fires once when a Discord stream pop-out window opens (discoverability hint).
  onDiscordPopoutOpen: (cb) => subscribe('vex:discord-popout-open', cb),

  // RSS feeds (fetched in main to dodge CORS)
  rssFetch: (url) => ipcRenderer.invoke('rss:fetch', url),

  // QR code + resource metrics
  qrMake: (text) => ipcRenderer.invoke('qr:make', text),
  appMetrics: () => ipcRenderer.invoke('app:metrics'),
  // Real per-tab memory: pass the materialized tabs' <webview> webContents ids,
  // get back { totalKB, byId: { id: {memKB, pid, shared} } }.
  tabMemory: (ids) => ipcRenderer.invoke('app:tab-memory', ids),
  // Every process Vex runs, with the pages / panels / extension pages in each
  // (Memory panel › Processes).
  processes: () => ipcRenderer.invoke('app:processes'),
  // Health since launch: crashes, hangs, helper processes gone, extension
  // errors, the updater's last word, startup timings (Memory panel › Health).
  diagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  // Make sure the local Ollama server is running (starts it when it is not).
  ollamaEnsure: () => ipcRenderer.invoke('ollama:ensure'),
  // How full the graphics card is — null when there is no NVIDIA card.
  gpu: () => ipcRenderer.invoke('system:gpu'),
  // Dev servers listening on this machine.
  devPorts: () => ipcRenderer.invoke('system:dev-ports'),
  // What a downloaded file is, before it is opened.
  fileInspect: (filePath, from) => ipcRenderer.invoke('file:inspect', filePath, from),
  // System-wide hotkeys (mute Discord from inside a game).
  hotkeysGet: () => ipcRenderer.invoke('hotkeys:get'),
  hotkeysSet: (config) => ipcRenderer.invoke('hotkeys:set', config),
  onHotkey: (cb) => subscribe('hotkey:action', cb),
  // A full-screen game started or stopped (src/main/game-watch.js).
  gameWatch: (on) => ipcRenderer.invoke('game:watch', !!on),
  gameState: () => ipcRenderer.invoke('game:state'),
  onGameState: (cb) => subscribe('game:state', cb),
  // Game mode (src/main/game-mode.js).
  gameModeGames: (games, watch) => ipcRenderer.invoke('gamemode:games', games, !!watch),
  gameModeSession: (s) => ipcRenderer.invoke('gamemode:session', s),
  gameModeState: () => ipcRenderer.invoke('gamemode:state'),
  // Time travel (src/main/state-journal.js; js/time-travel.js) and the tuning
  // advisor (src/main/tuning-advisor.js; js/tuning-advisor-ui.js).
  journalPush: (snapshot) => ipcRenderer.invoke('journal:push', snapshot),
  journalList: (range) => ipcRenderer.invoke('journal:list', range),
  journalAt: (ts) => ipcRenderer.invoke('journal:at', ts),
  journalDiff: (a, b) => ipcRenderer.invoke('journal:diff', a, b),
  journalNoteVersions: (id) => ipcRenderer.invoke('journal:note-versions', id),
  journalNoteVersion: (id, ts) => ipcRenderer.invoke('journal:note-version', id, ts),
  journalStats: () => ipcRenderer.invoke('journal:stats'),
  journalConfigure: (cfg) => ipcRenderer.invoke('journal:configure', cfg),
  journalForget: () => ipcRenderer.invoke('journal:forget'),
  tuningAdvise: (metrics) => ipcRenderer.invoke('tuning:advise', metrics),
  tuningHistory: () => ipcRenderer.invoke('tuning:history'),
  tuningForget: () => ipcRenderer.invoke('tuning:forget'),
  // On battery or on mains (src/main/power-watch.js; js/battery-mode.js).
  powerWatch: (on) => ipcRenderer.invoke('power:watch', !!on),
  powerStatus: () => ipcRenderer.invoke('power:status'),
  powerLean: (on) => ipcRenderer.invoke('power:lean', !!on),
  onPowerState: (cb) => subscribe('power:state', cb),
  // The quick-capture window hands its line here to be carried out.
  onCaptureTake: (cb) => subscribe('capture:take', cb),
  captureDone: (payload) => ipcRenderer.send('capture:done', payload),
  captureOpen: () => ipcRenderer.invoke('capture:open'),
  // Safe mode: why this launch is stripped down, and a backup at this first start that failed.
  safeMode: () => ipcRenderer.invoke('app:safe-mode'),
  // "The interface is up": what stops this launch counting as a failed one.
  started: () => ipcRenderer.send('app:started'),
  // "Read free": clear one site's data in its partition to reset metered paywalls.
  clearSiteData: (opts) => ipcRenderer.invoke('site:clear-data', opts),
  // One cookie at a time, in the tab's own partition.
  // The words inside a file dropped on the AI panel.
  docText: (bytes, name) => ipcRenderer.invoke('doc:text', bytes, name),
  // Which of the channels you follow are live right now.
  liveCheck: (channels) => ipcRenderer.invoke('live:check', channels),
  // How much memory this machine has, and the ceiling that suits it.
  systemMemory: () => ipcRenderer.invoke('system:memory'),
  // The folder your recordings land in, and what is in it.
  clipsFolder: (pick) => ipcRenderer.invoke('clips:folder', pick),
  clipsList: (dir) => ipcRenderer.invoke('clips:list', dir),
  // Text kept from the capture box (Ctrl+Enter): main holds it, so it lands
  // even while Vex is hidden or behind a game.
  clipsInboxList: () => ipcRenderer.invoke('clips-inbox:list'),
  clipsInboxAdd: (text) => ipcRenderer.invoke('clips-inbox:add', text),
  clipsInboxRemove: (id) => ipcRenderer.invoke('clips-inbox:remove', id),
  clipsInboxClear: () => ipcRenderer.invoke('clips-inbox:clear'),
  onClipsInboxChanged: (cb) => subscribe('clips-inbox:changed', cb),
  // What is free to keep on Epic and Steam this week.
  freeGames: () => ipcRenderer.invoke('games:free'),
  // Per-site switches: JavaScript, cookies, third-party content.
  siteRulesGet: () => ipcRenderer.invoke('siterules:get'),
  siteRulesSet: (rules) => ipcRenderer.invoke('siterules:set', rules),
  // The switches as they are now, sent to every window whenever they change.
  onSiteRulesChanged: (callback) => subscribe('siterules:changed', callback),
  // How long a few well-known services take to answer, and yours for comparison.
  netLatency: () => ipcRenderer.invoke('net:latency'),
  // What a word means, asked of a dictionary from the main process.
  dictLookup: (word) => ipcRenderer.invoke('dict:lookup', word),
  cookiesList: (opts) => ipcRenderer.invoke('cookies:list', opts),
  cookiesRemove: (opts) => ipcRenderer.invoke('cookies:remove', opts),
  cookiesSet: (opts) => ipcRenderer.invoke('cookies:set', opts),
  // Media grabber: list/download media detected on a tab (by its webContents id).
  mediaList: (wcId) => ipcRenderer.invoke('media:list', wcId),
  mediaDownload: (wcId, url) => ipcRenderer.invoke('media:download', wcId, url),
  // Keep the page you are on: 'pdf', or 'mhtml' (one file that opens offline).
  pageSave: (wcId, format, title) => ipcRenderer.invoke('page:save', wcId, format, title),
  pageArchiveSave: (wcId, details) => ipcRenderer.invoke('pagearchive:save', wcId, details),
  pageArchiveList: () => ipcRenderer.invoke('pagearchive:list'),
  pageArchiveSearch: (query) => ipcRenderer.invoke('pagearchive:search', query),
  pageArchiveFind: (url) => ipcRenderer.invoke('pagearchive:find', url),
  pageArchiveOpen: (id) => ipcRenderer.invoke('pagearchive:open', id),
  pageArchiveExport: (id) => ipcRenderer.invoke('pagearchive:export', id),
  pageArchiveRemove: (id) => ipcRenderer.invoke('pagearchive:remove', id),
  // The whole page as one PNG, not just what is on screen.
  captureFullPage: (wcId) => ipcRenderer.invoke('page:capture-full', wcId),
  // One script in every frame of a tab (a player inside an iframe included).
  evalAllFrames: (wcId, code, userGesture) => ipcRenderer.invoke('page:eval-all-frames', wcId, code, !!userGesture),
  // Which of these links answer, from an empty session (no cookies sent).
  checkLinks: (urls) => ipcRenderer.invoke('links:check', urls),
  // A watched page read as a hidden tab would show it (main/page-render.js).
  pageWatchRender: (opts) => ipcRenderer.invoke('pagewatch:render', opts),
  crawlFetch: (url, accept) => ipcRenderer.invoke('crawl:fetch', url, accept),
  setDiscordLite: (on) => ipcRenderer.invoke('discord:lite', on),
  mail: {
    accounts: () => ipcRenderer.invoke('mail:accounts'),
    add: (account) => ipcRenderer.invoke('mail:add', account),
    remove: (id) => ipcRenderer.invoke('mail:remove', id),
    // before: a UID — the page of messages older than it (Load more).
    inbox: (id, limit, before) => ipcRenderer.invoke('mail:inbox', id, limit, before),
    message: (id, uid) => ipcRenderer.invoke('mail:message', id, uid),
  },
  // Screen recording: start a file, append chunks as they arrive, then save.
  recStart: (ext) => ipcRenderer.invoke('rec:start', ext),
  recOwnWindow: () => ipcRenderer.invoke('rec:own-window'),
  idleSeconds: () => ipcRenderer.invoke('app:idle-seconds'),
  // partition: the tab the page is from; main refuses a private, off-the-record or Tor one.
  overlayOpen: (url, opacity, partition) => ipcRenderer.invoke('overlay:open', url, opacity, partition),
  overlayClose: () => ipcRenderer.invoke('overlay:close'),
  onOverlayOpacity: (callback) => subscribe('overlay:opacity-changed', callback),
  onLockVex: (callback) => subscribe('lock-vex', callback),
  recChunk: (id, bytes) => ipcRenderer.invoke('rec:chunk', id, bytes),
  recFinish: (id, name) => ipcRenderer.invoke('rec:finish', id, name),
  recCancel: (id) => ipcRenderer.invoke('rec:cancel', id),
  // Discord censorship bypass (DoH + SNI fragmentation on persist:discord).
  discordBypass: (on) => ipcRenderer.send('discord:set-bypass', on),
  // Bypass mode: 'off' | 'light' (built-in) | 'strong' (ByeDPI).
  // opts = { preset?: number (>=0 forces, else auto-tune), custom?: string }.
  // Returns { ok, mode, preset?, auto?, port?, error? }.
  setDiscordBypassMode: (mode, opts) => ipcRenderer.invoke('discord:set-bypass-mode', mode, opts),
  // One-click Vencord install into the Discord panel.
  installVencord: () => ipcRenderer.invoke('discord:install-vencord'),
  // Install a LOCAL Vencord build (your custom userplugins/plugins). Optional
  // path points at the build's extension-chrome.zip or its repo/dist folder.
  installVencordLocal: (path) => ipcRenderer.invoke('discord:install-vencord-local', path),
  // Auto-configure sweep progress: { phase:'testing'|'done', label, i, total, ok, via, preset }.
  onDiscordBypassProgress: (cb) => subscribe('discord:bypass-progress', cb),
  // Screen-share source picker (Discord Go Live / Share Screen).
  onScreenPickerOpen: (cb) => subscribe('screen-picker:open', cb),
  // Why a share would be (or was) refused: the checks for one tab, and the reasons of this session.
  // Why was a site's sign-in lost? A site (host) or nothing for the latest of all: lines with the rule that ended it.
  // Windows' commit headroom (the memory limit programs can still promise), and the level changes while Game mode runs.
  commitState: () => ipcRenderer.invoke('commit:state'),
  onCommitPressure: (cb) => subscribe('commit:pressure', cb),
  signoutWhy: (host) => ipcRenderer.invoke('signout:why', host),
  screenSharePreflight: (wcId) => ipcRenderer.invoke('screen-share:preflight', wcId),
  onScreenShareRefused: (cb) => subscribe('screen-picker:refused', cb),
  chooseScreenSource: (id, sourceId, opts) => ipcRenderer.invoke('screen-picker:choose', Object.assign({ id, sourceId }, opts || {})),
  // Roblox panel block-bypass (shares Discord's ByeDPI).
  setRobloxBypass: (on) => ipcRenderer.invoke('roblox:set-bypass', on),
  // Persist the GUI Style so the start page (served by main, separate origin) can match.
  setGuiStyle: (style) => ipcRenderer.invoke('gui-style:set', style),

  // Full-text recall (memex) + translate (both run in main)
  recallIndex: (entry) => ipcRenderer.invoke('recall:index', entry),
  recallSearch: (q, options) => ipcRenderer.invoke('recall:search', q, options),
  recallStats: () => ipcRenderer.invoke('recall:stats'),
  recallForget: (target) => ipcRenderer.invoke('recall:forget', target),
  recallClear: () => ipcRenderer.invoke('recall:clear'),
  // Recall by meaning (local Ollama embeddings only).
  recallMeaningStatus: (args) => ipcRenderer.invoke('recall:meaning-status', args),
  recallMeaningStep: (args) => ipcRenderer.invoke('recall:meaning-step', args),
  recallMeaningSearch: (q, args) => ipcRenderer.invoke('recall:meaning-search', q, args),
  recallMeaningForget: () => ipcRenderer.invoke('recall:meaning-forget'),
  // Knowledge base: what you keep, searchable on this PC (src/main/knowledge-ipc.js).
  kbPlan: (entries, covers) => ipcRenderer.invoke('kb:plan', entries, covers),
  kbPut: (items, args) => ipcRenderer.invoke('kb:put', items, args),
  kbSyncArchive: (args) => ipcRenderer.invoke('kb:sync-archive', args),
  kbStatus: (args) => ipcRenderer.invoke('kb:status', args),
  kbStep: (args) => ipcRenderer.invoke('kb:step', args),
  kbSearch: (question, args) => ipcRenderer.invoke('kb:search', question, args),
  kbContext: (question, args) => ipcRenderer.invoke('kb:context', question, args),
  kbRelated: (id, args) => ipcRenderer.invoke('kb:related', id, args),
  kbRelatedPage: (page, args) => ipcRenderer.invoke('kb:related-page', page, args),
  kbKeepOut: (id, on) => ipcRenderer.invoke('kb:keep-out', id, on),
  kbKeepOutClear: () => ipcRenderer.invoke('kb:keep-out-clear'),
  kbForget: () => ipcRenderer.invoke('kb:forget'),
  translateText: (text, tl) => ipcRenderer.invoke('translate:text', { text, tl }),

  // Privacy hardening (fingerprint farbling, DoH, tracker tally) — all in main
  privacyGetConfig: () => ipcRenderer.invoke('privacy:get-config'),
  privacySetConfig: (cfg) => ipcRenderer.invoke('privacy:set-config', cfg),
  privacyTrackerStats: () => ipcRenderer.invoke('privacy:tracker-stats'),
  privacyTrackerReset: () => ipcRenderer.invoke('privacy:tracker-reset'),

  // Generic HTTP request (API client + page-change monitor), runs in main
  apiRequest: (opts) => ipcRenderer.invoke('api:request', opts),
  // API playground (js/api-playground.js): one request, sent from main with a
  // short timeout; resolves { ok, status, … } or { ok:false, error }.
  playgroundSend: (req) => ipcRenderer.invoke('playground:send', req),
  // An MCP server's token, kept encrypted in main; '' removes it.
  mcpAuthSet: (id, token) => ipcRenderer.invoke('mcp:auth-set', id, token),

  // Password vault (safeStorage-encrypted in main)
  vaultList: () => ipcRenderer.invoke('vault:list'),
  vaultGet: (host) => ipcRenderer.invoke('vault:get', host),
  vaultHealth: () => ipcRenderer.invoke('vault:health'),
  vaultSave: (entry) => ipcRenderer.invoke('vault:save', entry),
  vaultDelete: (q) => ipcRenderer.invoke('vault:delete', q),
  vaultUpdate: (q) => ipcRenderer.invoke('vault:update', q),
  // Main asks where and writes the file; no password crosses for it.
  vaultExportCsv: () => ipcRenderer.invoke('vault:export-csv'),
  // Only with the breach check turned on (Password Health); main sends the
  // first five characters of each password's SHA-1 and nothing else.
  vaultBreachCheck: () => ipcRenderer.invoke('vault:breach-check'),
  // Import from another browser (main/browser-import.js). The passwords CSV is
  // chosen, read and saved in main; only hosts and usernames come back.
  browserImportSources: () => ipcRenderer.invoke('browser-import:sources'),
  browserImportRead: (browser, profileId) => ipcRenderer.invoke('browser-import:read', browser, profileId),
  browserImportPasswordsCsv: () => ipcRenderer.invoke('browser-import:passwords-csv'),
  // TOTP authenticator (2FA). Secrets stay in the main process — the renderer
  // only ever gets metadata (totpList) and the finished 6-digit codes (totpCodes).
  totpList: () => ipcRenderer.invoke('totp:list'),
  totpCodes: () => ipcRenderer.invoke('totp:codes'),
  totpAdd: (input) => ipcRenderer.invoke('totp:add', input),
  totpDelete: (id) => ipcRenderer.invoke('totp:delete', id),
  totpRename: (id, issuer, label) => ipcRenderer.invoke('totp:rename', id, issuer, label),
  // Google Authenticator's otpauth-migration:// export link (many accounts).
  totpImportMigration: (uri) => ipcRenderer.invoke('totp:import-migration', uri),
  // A passphrase-encrypted backup file; main asks where and reads/writes it.
  totpExportBackup: (passphrase) => ipcRenderer.invoke('totp:export-backup', passphrase),
  totpImportBackup: (passphrase) => ipcRenderer.invoke('totp:import-backup', passphrase),

  // Permission prompts (geolocation, mic, camera, notifications, ...)
  onPermissionRequest:  (cb) => subscribe('permission:request', cb),
  onPermissionExpired:  (cb) => subscribe('permission:expired', cb),
  // A page's pop-up the blocker refused (main/popup-blocker.js): { pageId, origin, url }.
  onPopupBlocked:       (cb) => subscribe('popup:blocked', cb),
  permissionsRendererReady: () => ipcRenderer.send('permissions:renderer-ready'),
  permissionRespond:    (payload) => ipcRenderer.invoke('permission:respond', payload),
  permissionsList:      () => ipcRenderer.invoke('permissions:list'),
  // A page's alert / confirm / prompt, asked over its own tab or panel
  // (src/main/page-dialogs.js, js/page-dialogs.js).
  onPageDialog:      (cb) => subscribe('page-dialog:show', cb),
  onPageDialogClose: (cb) => subscribe('page-dialog:close', cb),
  pageDialogAnswer:  (payload) => ipcRenderer.send('page-dialog:answer', payload),
  // "Leave site?" for a page that asks before it is left (main/leave-page.js).
  onPageLeaveAsk:    (cb) => subscribe('page:leave-ask', cb),
  pageLeaveAnswer:   (payload) => ipcRenderer.send('page:leave-answer', payload),
  // The decisions one tab's page is held to (its container's own, or a
  // private window's), by the page's webContents id.
  permissionsListForPage: (id) => ipcRenderer.invoke('permissions:list-for-page', id),
  // The site panel: one permission of that page set to 'allow', 'deny' or
  // 'ask'; every one of its site's reset; the certificate it was served with.
  permissionsSetForPage: (id, permission, decision) => ipcRenderer.invoke('permissions:set-for-page', id, permission, decision),
  // -> { decisions, undo }: the token puts every reset answer back.
  permissionsResetForPage: (id) => ipcRenderer.invoke('permissions:reset-for-page', id),
  permissionsResetForPageUndo: (token) => ipcRenderer.invoke('permissions:reset-for-page-undo', token),
  siteCertificate: (id) => ipcRenderer.invoke('site:certificate', id),
  // The address one of Vex's own pages in a tab stands for (main/vex-page-address.js).
  vexPageAddress: (id) => ipcRenderer.invoke('tabs:vex-page-address', id),
  // A tab closed: its pages' saved back lists are dropped at once.
  tabClosed:            (pageIds) => ipcRenderer.send('tabs:closed', pageIds),
  tabHistory:           (pageId) => ipcRenderer.invoke('tabs:history', pageId),
  // The tab in front changed (extensions' chrome.tabs.onActivated).
  tabActivated:         (pageId) => ipcRenderer.send('tabs:activated', pageId),
  carryTabHistory:      (token, partition, list) => ipcRenderer.send('tabs:carry-history', token, partition, list),
  // A tab's icon fetched through the tab's own session, as a data: URL.
  tabFavicon:           (pageId, url) => ipcRenderer.invoke('tabs:favicon', pageId, url),
  // Which sites the main window's Tor and proxy rules name (for a private window).
  siteRoutesRoutedHosts: () => ipcRenderer.invoke('siteroutes:routed-hosts'),
  permissionsRevoke:    (key) => ipcRenderer.invoke('permissions:revoke', key),
  permissionsClearAll:  () => ipcRenderer.invoke('permissions:clear-all'),
  permissionsClearUndo: (token) => ipcRenderer.invoke('permissions:clear-undo', token),

  onDownloadStarted:  (cb) => subscribe('download-started', cb),
  onDownloadProgress: (cb) => subscribe('download-progress', cb),
  onDownloadComplete: (cb) => subscribe('download-complete', cb),
  downloadsOpenFile:     (p) => ipcRenderer.invoke('downloads:open-file', p),
  downloadsShowInFolder: (p) => ipcRenderer.invoke('downloads:show-in-folder', p),
  downloadsExist:        (paths) => ipcRenderer.invoke('downloads:exist', paths),
  downloadsOpenFolder:   ()  => ipcRenderer.invoke('downloads:open-folder'),
  // Where a File dropped on the window lives on disk (js/tab-strip-drop.js);
  // File.path is gone from Electron.
  pathForFile:           (file) => webUtils.getPathForFile(file),
  // A file Vex downloaded: to the Recycle Bin, or dragged out of the panel.
  downloadsDeleteFile:   (p) => ipcRenderer.invoke('downloads:delete-file', p),
  downloadsStartDrag:    (p) => ipcRenderer.invoke('downloads:start-drag', p),
  // Tidy the downloads folder: preview, apply that preview, undo.
  downloadsTidyPlan:     (minAgeDays) => ipcRenderer.invoke('downloads:tidy-plan', minAgeDays),
  downloadsTidyApply:    (planId) => ipcRenderer.invoke('downloads:tidy-apply', planId),
  downloadsTidyUndo:     () => ipcRenderer.invoke('downloads:tidy-undo'),
  downloadsTidyHistory:  () => ipcRenderer.invoke('downloads:tidy-history'),
  // Pause / resume / cancel a transfer that is still running, and re-request one
  // that failed. `action` is 'pause' | 'resume' | 'cancel'.
  downloadsControl:      (id, action) => ipcRenderer.invoke('downloads:control', id, action),
  downloadsRetry:        (url, id) => ipcRenderer.invoke('downloads:retry', url, id),
  downloadsAskWhere:     (url) => ipcRenderer.invoke('downloads:ask-where', url),
  downloadsMine:         (url) => ipcRenderer.invoke('downloads:mine', url),
  copyImageFrom:         (url, partition) => ipcRenderer.invoke('image:copy', url, partition),
  // A picture for the AI, fetched through its tab's own session; a private or
  // Tor tab's only with confirmed (else { needsConsent, kind }).
  imageForAi:            (pageId, url, confirmed) => ipcRenderer.invoke('image:for-ai', pageId, url, !!confirmed),

  // Notes & Sessions shortcuts
  onToggleNotes: (callback) => subscribe('toggle-notes', callback),
  onToggleSessions: (callback) => subscribe('toggle-sessions', callback),

  // Phase 4: History, Memory, Sleep, Restore
  onReopenLastClosed: (callback) => subscribe('reopen-last-closed', callback),
  onToggleHistory: (callback) => subscribe('toggle-history', callback),
  onToggleHistoryAi: (callback) => subscribe('toggle-history-ai', callback),
  onToggleMemory: (callback) => subscribe('toggle-memory', callback),
  onSleepCurrentTab: (callback) => subscribe('sleep-current-tab', callback),
  onPrintPage: (callback) => subscribe('print-page', callback),
  setLockState: (locked) => ipcRenderer.send('vex-lock:state', !!locked),
  // Main checks the PIN itself; only then is Vex unlocked (src/main/lock-pin.js).
  unlockLock: (pin) => ipcRenderer.invoke('vex-lock:unlock', pin),
  // The same check without unlocking anything: asking again before a secret
  // is shown (js/vex-lock.js recheck).
  verifyLockPin: (pin) => ipcRenderer.invoke('vex-lock:verify', pin),
  cancelTor: () => ipcRenderer.invoke('tor:cancel'),
  onViewSource: (callback) => subscribe('view-source', callback),
  onSaveSessionBeforeQuit: (callback) => subscribe('save-session-before-quit', callback),

  // Phase 5
  onToggleReadingMode: (callback) => subscribe('toggle-reading-mode', callback),
  onTakeScreenshot: (callback) => subscribe('take-screenshot', callback),

  // Phase 6: fullscreen, private, mute
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
  onFullscreenChanged: (callback) => subscribe('fullscreen-changed', callback),
  openPrivateWindow: (look, uiMode) => ipcRenderer.invoke('open-private-window', look, uiMode),
  openCleanWindow: (url, look, uiMode) => ipcRenderer.invoke('open-clean-window', url, look, uiMode),
  // New Identity: a throwaway isolated session (random consistent Chrome UA).
  createIdentity: () => ipcRenderer.invoke('identity:create'),
  // Tor session: isolated, proxied through a local Tor SOCKS5 (max security).
  createTor: () => ipcRenderer.invoke('tor:create'),
  verifyTor: (partition) => ipcRenderer.invoke('tor:verify', partition),
  // Progress while Vex downloads + bootstraps its own Tor (no Tor Browser needed).
  // cb({ phase:'download'|'bootstrap', value, detail }). Returns an unsubscribe fn.
  onTorProgress: (cb) => { const h = (_e, p) => { try { cb(p); } catch {} }; ipcRenderer.on('tor:progress', h); return () => { try { ipcRenderer.removeListener('tor:progress', h); } catch {} }; },
  // Vex's own Tor: whether it runs (and which pages use it), stopping it, and
  // hearing when it starts or stops — for the "Tor is running" indicator.
  torStatus: () => ipcRenderer.invoke('tor:status'),
  stopTor: () => ipcRenderer.invoke('tor:stop'),
  onTorState: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('tor:state', h); return () => ipcRenderer.removeListener('tor:state', h); },
  // A Tor route's page starting Tor again after it stopped, and a Tor page
  // that cannot load because Tor is not running.
  onTorReviving: (callback) => subscribe('tor:reviving', callback),
  onTorRevived: (callback) => subscribe('tor:revived', callback),
  onTorPageDown: (callback) => subscribe('tor:page-down', callback),
  onToggleMuteTab: (callback) => subscribe('toggle-mute-tab', callback),

  // Tabs sidebar toggle
  onToggleTabsSidebar: (callback) => subscribe('toggle-tabs-sidebar', callback),

  // Phase 8: Schedules
  onToggleSchedules: (callback) => subscribe('toggle-schedules', callback),

  // Phase 7A: AI
  onToggleAiPanel: (callback) => subscribe('toggle-ai-panel', callback),

  // Phase 9: Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  widevineStatus: () => ipcRenderer.invoke('widevine:status'),
  widevineRetry: () => ipcRenderer.invoke('widevine:retry'),
  // The update cover (js/update-notifier.js, src/main/updates.js).
  // Settings › Health check (src/main/health-check.js)
  health: {
    scan: () => ipcRenderer.invoke('health:scan'),
    fix: (ids, confirmed) => ipcRenderer.invoke('health:fix', ids, confirmed === true),
    undo: (run) => ipcRenderer.invoke('health:undo', run),
  },
  updates: {
    upcomingNotes: (version) => ipcRenderer.invoke('updates:upcoming-notes', version),
    download: (version) => ipcRenderer.invoke('updates:download', version),
    cancel: () => ipcRenderer.invoke('updates:cancel'),
    install: (version) => ipcRenderer.invoke('updates:install', version),
    saveBackup: (version, text) => ipcRenderer.invoke('updates:backup-save', version, text),
    listBackups: () => ipcRenderer.invoke('updates:backups'),
    readBackup: (name) => ipcRenderer.invoke('updates:backup-read', name),
    onProgress: (cb) => subscribe('updates:progress', cb),
    onInstallFailed: (cb) => subscribe('updates:install-failed', cb),
  },
  // Profiles (js/profiles-ui.js, src/main/profiles.js): each one a separate Vex.
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    create: (look) => ipcRenderer.invoke('profiles:create', look),
    update: (id, look) => ipcRenderer.invoke('profiles:update', id, look),
    open: (id) => ipcRenderer.invoke('profiles:open', id),
    remove: (id) => ipcRenderer.invoke('profiles:delete', id),
    createShortcut: (id) => ipcRenderer.invoke('profiles:shortcut', id),
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getReleaseNotes: (tag) => ipcRenderer.invoke('updates:notes', tag),
  getReleaseList: () => ipcRenderer.invoke('updates:list'),
  restartApp: () => ipcRenderer.invoke('app:restart'),
  focusWindow: () => ipcRenderer.invoke('app:focus'),

  // Desktop notifications are sent by the main process — the renderer is a
  // file:// page and Chromium denies it the Notification API. Resolves once
  // Windows has shown the toast; rejects with the reason when it did not.
  notify: (title, body, opts) => ipcRenderer.invoke('notify:show', { title, body: body == null ? '' : String(body), ...(opts && opts.urgency ? { urgency: opts.urgency } : {}), ...(opts && opts.feature ? { feature: opts.feature } : {}), ...(opts && opts.id ? { id: String(opts.id) } : {}) }),
  // The Attention Budget for OS toasts (main/notify.js).
  attention: {
    state: (s) => ipcRenderer.invoke('attention:state', s),
    denied: () => ipcRenderer.invoke('attention:denied'),
    clearDenied: () => ipcRenderer.invoke('attention:clear-denied'),
  },
  // AI news (js/ai-news.js): a Windows toast with Open and "Mute this source"
  // buttons. `tag` starts "news-"; `url` is https only. A click or a button
  // arrives as news:waiting, and pending() hands over what was clicked.
  news: {
    notify: (payload) => ipcRenderer.invoke('news:notify', payload),
    pending: () => ipcRenderer.invoke('news:pending'),
    onWaiting: (cb) => subscribe('news:waiting', cb),
  },
  // A password or one-time code onto the clipboard; the main process empties
  // it after `seconds` if it is still there, focus or no focus.
  copySecret: (text, seconds) => ipcRenderer.invoke('clipboard:write-secret', text, seconds),
  // Web safety (main/web-safety.js): lookalike addresses, risky downloads,
  // over-asking prompts and per-site paranoid mode. Each answers the whole
  // current state: { sensitivity, allow: [host], paranoid: [origin] }.
  webSafety: {
    get: () => ipcRenderer.invoke('websafety:get'),
    setSensitivity: (level) => ipcRenderer.invoke('websafety:set-sensitivity', level),
    allowHost: (host) => ipcRenderer.invoke('websafety:allow-host', host),
    forgetHost: (host) => ipcRenderer.invoke('websafety:forget-host', host),
    setParanoid: (origin, on) => ipcRenderer.invoke('websafety:set-paranoid', origin, !!on),
    check: (address) => ipcRenderer.invoke('websafety:check', address),
  },
  // Reminders live in the main process so they survive a reload and, on
  // Windows, a closed Vex (Task Scheduler wakes it). `at` is epoch ms.
  reminders: {
    // `at` is epoch ms for a timed reminder; `extra` may carry url, repeat
    // (daily | weekdays | weekly), site (fires next time that host opens)
    // and urgent (fires even during a focus session).
    create: (message, at, extra) => ipcRenderer.invoke('reminders:create', { message, ...(at != null ? { at } : {}), ...(extra || {}) }),
    list: () => ipcRenderer.invoke('reminders:list'),
    delete: (id) => ipcRenderer.invoke('reminders:delete', id),
    visited: (host) => ipcRenderer.invoke('reminders:visited', host),
    ack: (id) => ipcRenderer.invoke('reminders:ack', id),
    // Reminders that arrived through Vex Sync from another machine.
    import: (items) => ipcRenderer.invoke('reminders:import', items),
    // who: 'focus' or 'meeting' — each keeps its own hold (main/reminders.js).
    hold: (untilMs, who) => ipcRenderer.invoke('reminders:hold', untilMs, who),
    onFired: (cb) => subscribe('reminders:fired', cb),
    onClicked: (cb) => subscribe('reminders:clicked', cb),
    // A Snooze button on the Windows toast was pressed (handled in main).
    onSnoozed: (cb) => subscribe('reminders:snoozed', cb),
  },
  // Save a small text file where the user chooses (a calendar entry, an export).
  saveTextFile: (name, text, kind) => ipcRenderer.invoke('file:save-text', { name, text, kind }),
  saveEpub: (book) => ipcRenderer.invoke('page:save-epub', book),
  archiveList: (filePath) => ipcRenderer.invoke('archive:list', filePath),
  downloadsSetRules: (rules) => ipcRenderer.invoke('downloads:set-rules', rules),
  downloadsPrefs: () => ipcRenderer.invoke('downloads:prefs'),
  downloadsChooseFolder: () => ipcRenderer.invoke('downloads:choose-folder'),
  downloadsSetAsk: (on) => ipcRenderer.invoke('downloads:set-ask', on),
  downloadsResetPrefs: () => ipcRenderer.invoke('downloads:reset-prefs'),
  calendarFetch: (url) => ipcRenderer.invoke('calendar:fetch', url),
  qrGenerate: (text) => ipcRenderer.invoke('qr:generate', text),
  fxRates: () => ipcRenderer.invoke('fx:rates'),
  openAsApp: (url, title, partition) => ipcRenderer.invoke('app:open-as-app', url, title, partition),
  // A New Tab background image: your own theme's by id (js/theme-studio.js), or
  // with no id the old single Custom Image.
  getCustomThemeImage: (id) => (id ? ipcRenderer.invoke('theme:get-custom-image', id) : ipcRenderer.invoke('theme:get-custom-image')),
  setCustomThemeImage: (dataUrl, id) => (id ? ipcRenderer.invoke('theme:set-custom-image', dataUrl, id) : ipcRenderer.invoke('theme:set-custom-image', dataUrl)),
  // A theme from your Windows wallpaper (js/theme-from-image.js): read only.
  readWallpaper: () => ipcRenderer.invoke('theme:read-wallpaper'),
  // Light and dark (js/theme-auto.js): Windows' app mode, now and on change.
  getSystemDark: () => ipcRenderer.invoke('system-theme:get'),
  // Website appearance (js/website-appearance.js): 'system', 'light' or 'dark'.
  setWebsiteAppearance: (source) => ipcRenderer.invoke('theme:set-website-appearance', source),
  onSystemThemeChanged: (cb) => subscribe('system-theme:changed', cb),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  composeMail: (subject, body, to) => ipcRenderer.invoke('mail:compose', { subject, body, ...(to ? { to } : {}) }),

  // Default browser. Attaches the renderer's handler and immediately flushes any
  // URLs that arrived (and were buffered) before this point — see the early
  // ipcRenderer.on('open-url') subscription at the top of this file.
  onOpenUrl: (cb) => {
    // Only worth saying when there was something to flush. Said every
    // start regardless, it was the first line of every console session
    // and told nobody anything: zero buffered URLs is the normal case.
    if (_openUrlBuffer.length) console.log('[Vex URL] preload: flushing', _openUrlBuffer.length, 'buffered URL(s) to the renderer');
    _openUrlCb = cb;
    while (_openUrlBuffer.length) {
      const url = _openUrlBuffer.shift();
      try { cb(url); } catch { console.error('[Vex URL] URL handler failed'); }
    }
  },
  setAsDefaultBrowser: () => ipcRenderer.invoke('set-as-default-browser'),
  isDefaultBrowser: () => ipcRenderer.invoke('is-default-browser'),
  // Start with Windows: what Windows holds, and changing it (main/login-item.js)
  loginItemGet: () => ipcRenderer.invoke('login-item:get'),
  loginItemSet: (openAtLogin, startMinimised) => ipcRenderer.invoke('login-item:set', openAtLogin, startMinimised),

  // Platform + versions
  platform: process.platform,
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  nodeVersion: process.versions.node,
  getElectronVersion: () => process.versions.electron,
  getChromeVersion: () => process.versions.chrome,
  getNodeVersion: () => process.versions.node,

  // Local sidebar config (userData/sidebar-config.json) — personalized tool URLs
  getSidebarConfig: () => ipcRenderer.invoke('sidebar-config:get'),

  // Persistent storage (survives reinstalls — backs the localStorage shim)
  persistGetAll: () => ipcRenderer.invoke('persist-get-all'),
  persistSet: (key, value) => ipcRenderer.invoke('persist-set', key, value),
  persistDelete: (key) => ipcRenderer.invoke('persist-delete', key),
  // [[key, value or null to delete], ...] saved in one write.
  persistApply: (entries) => ipcRenderer.invoke('persist-apply', entries),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  // Phase 18: Chrome extensions management
  extensionsList:           () => ipcRenderer.invoke('extensions:list'),
  // Folder / .zip / .crx: pick it and see what it asks for; then install that one.
  extensionsInstallFolder:  () => ipcRenderer.invoke('extensions:install-folder'),
  extensionsInstallZip:     () => ipcRenderer.invoke('extensions:install-zip'),
  extensionsInstallPicked:  (token) => ipcRenderer.invoke('extensions:install-picked', token),
  extensionsInstallCatalog: (id) => ipcRenderer.invoke('extensions:install-catalog', id),
  // Automatic updates, and "Allow access to file URLs" per extension.
  extensionsUpdateStatus:   () => ipcRenderer.invoke('extensions:update-status'),
  extensionsUpdateCheck:    () => ipcRenderer.invoke('extensions:update-check'),
  extensionsSetAutoUpdate:  (on) => ipcRenderer.invoke('extensions:set-auto-update', on),
  extensionsUpdateApprove:  (folderName) => ipcRenderer.invoke('extensions:update-approve', folderName),
  extensionsSetFileAccess:  (folderName, allow) => ipcRenderer.invoke('extensions:set-file-access', folderName, allow),
  // A Chrome Web Store link or extension id: what it is and may do, then install it.
  extensionsWebStorePreview: (input) => ipcRenderer.invoke('extensions:webstore-preview', input),
  extensionsInstallWebStore: (input) => ipcRenderer.invoke('extensions:install-webstore', input),
  extensionsUninstall:      (folderName) => ipcRenderer.invoke('extensions:uninstall', folderName),
  extensionsUninstallLater: (folderName) => ipcRenderer.invoke('extensions:uninstall-later', folderName),
  extensionsUninstallUndo:  (folderName) => ipcRenderer.invoke('extensions:uninstall-undo', folderName),
  extensionsOpenFolder:     () => ipcRenderer.invoke('extensions:open-folder'),
  extensionsSetEnabled:     (folderName, enabled) => ipcRenderer.invoke('extensions:set-enabled', folderName, enabled),
  // 'auto' (browsing sessions + the app panels it names) or 'everywhere'.
  extensionsSetScope:       (folderName, scope) => ipcRenderer.invoke('extensions:set-scope', folderName, scope),
  // Free memory now: unload extensions from sessions with no page open.
  extensionsReleaseIdle:    () => ipcRenderer.invoke('extensions:release-idle'),
  extensionsOpenPopup:      (request) => ipcRenderer.invoke('extensions:open-popup', request),
  // Extensions' right-click menu items, toolbar badges and shortcuts (js/ext-ui.js).
  extensionsUiState:        () => ipcRenderer.invoke('extensions:ui-state'),
  onExtensionsUiState:      (callback) => subscribe('extensions:ui-state', callback),
  extensionsMenuClick:      (request) => ipcRenderer.invoke('extensions:menu-click', request),
  extensionsActionClick:    (request) => ipcRenderer.invoke('extensions:action-click', request),
  onExtensionsRunAction:    (callback) => subscribe('extensions:run-action', callback),
  extensionsCommands:       () => ipcRenderer.invoke('extensions:commands'),
  extensionsSetCommandKey:  (request) => ipcRenderer.invoke('extensions:set-command-key', request),
  extensionsSetPinned:      (folderName, pinned) => ipcRenderer.invoke('extensions:set-pinned', folderName, pinned),
  // When each extension last changed and was last used (main/extension-usage.js).
  extensionsUsageAudit:     () => ipcRenderer.invoke('extensions:usage-audit'),

  // Privacy report card (main/privacy-report.js): the cookie half of the weekly
  // page, and its one-click cleanup by registrable domain.
  privacyReport:            () => ipcRenderer.invoke('privacy:report'),
  privacyReportClean:       (domains) => ipcRenderer.invoke('privacy:report-clean', domains),
  // Crash-proof tabs (main/tab-snapshots.js): scroll position and typed text,
  // never from a password field or a private, Tor or burner tab.
  tabSnapshots: {
    save: (payload) => ipcRenderer.invoke('tabsnap:save', payload),
    load: () => ipcRenderer.invoke('tabsnap:load'),
    clear: () => ipcRenderer.invoke('tabsnap:clear'),
  },
  // Quiet hours (main/quiet-hours.js).
  quiet: {
    get: () => ipcRenderer.invoke('quiet:get'),
    set: (cfg) => ipcRenderer.invoke('quiet:set', cfg),
    held: () => ipcRenderer.invoke('quiet:held'),
    release: () => ipcRenderer.invoke('quiet:release'),
    drop: () => ipcRenderer.invoke('quiet:drop'),
  },

  // Phase 13: Vex Sync — encryption key + session metadata
  syncSaveKey: (hex) => ipcRenderer.invoke('sync-save-key', hex),
  syncLoadKey: () => ipcRenderer.invoke('sync-load-key'),
  syncSaveMeta: (meta) => ipcRenderer.invoke('sync-save-meta', meta),
  syncLoadMeta: () => ipcRenderer.invoke('sync-load-meta'),
  syncClearState: () => ipcRenderer.invoke('sync-clear-state'),
  // Saved passwords and authenticator accounts in Vex Sync: sealed and opened
  // by main (main/sync-secrets.js); this window carries only sealed items.
  // Phone browser (main/companion.js).
  companionStart: (request) => ipcRenderer.invoke('companion:start', request),
  companionPublish: (view) => ipcRenderer.invoke('companion:publish', view),
  companionStatus: () => ipcRenderer.invoke('companion:status'),
  companionStop: () => ipcRenderer.invoke('companion:stop'),
  syncSecretsSeal: (kinds) => ipcRenderer.invoke('sync-secrets-seal', kinds),
  syncSecretsApply: (lists) => ipcRenderer.invoke('sync-secrets-apply', lists),
  syncSecretsDescribe: (items) => ipcRenderer.invoke('sync-secrets-describe', items),
  syncSecretsPutBack: (request) => ipcRenderer.invoke('sync-secrets-put-back', request),
  onSyncSecretsChanged: (callback) => subscribe('sync-secrets-changed', callback),
  // Passkeys (main/passkeys.js, js/passkeys.js): the sheet's answer, Settings'
  // list, and a field's chooser pick. Only names and ids cross; a private key
  // never does.
  passkeysAnswer: (id, answer) => ipcRenderer.invoke('passkeys:answer', id, answer),
  passkeysList: () => ipcRenderer.invoke('passkeys:list'),
  passkeysDelete: (credentialId) => ipcRenderer.invoke('passkeys:delete', credentialId),
  passkeysUndoDelete: (token) => ipcRenderer.invoke('passkeys:undo-delete', token),
  passkeysRename: (credentialId, nickname) => ipcRenderer.invoke('passkeys:rename', credentialId, nickname),
  passkeysConditionalChoose: (requestId, credentialId, pin) => ipcRenderer.invoke('passkeys:conditional-choose', requestId, credentialId, pin),
  onPasskeysAsk: (callback) => subscribe('passkeys:ask', callback),
  onPasskeysAskCancel: (callback) => subscribe('passkeys:ask-cancel', callback),
  onPasskeysNotice: (callback) => subscribe('passkeys:notice', callback),
  // Userscripts (main/userscripts.js, js/userscripts.js): the manager's list and
  // switches. A page's own scripts never come through here.
  userscripts: {
    list: () => ipcRenderer.invoke('userscripts:list'),
    preview: (source, replaceId) => ipcRenderer.invoke('userscripts:preview', source, replaceId || ''),
    install: (options) => ipcRenderer.invoke('userscripts:install', options),
    setEnabled: (id, on) => ipcRenderer.invoke('userscripts:set-enabled', id, !!on),
    remove: (id) => ipcRenderer.invoke('userscripts:remove', id),
    setGlobal: (on) => ipcRenderer.invoke('userscripts:set-global', !!on),
    setHosts: (id, hosts) => ipcRenderer.invoke('userscripts:set-hosts', id, hosts),
    clearValues: (id) => ipcRenderer.invoke('userscripts:clear-values', id),
    fetch: (url) => ipcRenderer.invoke('userscripts:fetch', url)
  },
  // Vex Packs (main/packs-store.js, js/packs-ui.js). Main judges every pack;
  // install takes only the one-use token a preview returned.
  packs: {
    list: () => ipcRenderer.invoke('packs:list'),
    items: () => ipcRenderer.invoke('packs:items'),
    pickFile: () => ipcRenderer.invoke('packs:pick-file'),
    preview: (text) => ipcRenderer.invoke('packs:preview', text),
    install: (token, trustKey) => ipcRenderer.invoke('packs:install', token, !!trustKey),
    discard: (token) => ipcRenderer.invoke('packs:discard', token),
    setEnabled: (id, on) => ipcRenderer.invoke('packs:set-enabled', id, !!on),
    uninstall: (id) => ipcRenderer.invoke('packs:uninstall', id),
    setGlobal: (on) => ipcRenderer.invoke('packs:set-global', !!on),
    trustKey: (id, label) => ipcRenderer.invoke('packs:trust-key', id, label),
    untrustKey: (fingerprint) => ipcRenderer.invoke('packs:untrust-key', fingerprint),
    generateKey: (replace) => ipcRenderer.invoke('packs:generate-key', !!replace),
    export: (request) => ipcRenderer.invoke('packs:export', request)
  }
});

contextBridge.exposeInMainWorld('vexDevTools', {
  // Renderer notifies main to toggle DevTools for a specific webContents
  onToggleRequest: (cb) => subscribe('devtools:toggle-request', cb),
  // Renderer calls this to toggle DevTools on a specific tab (by webContentsId)
  toggleWebview: (webContentsId) => ipcRenderer.invoke('devtools:toggle-webview', webContentsId),
  // Open DevTools (detached) for a target webContents. Pass the URL as the
  // optional second argument so main can fall back to URL-matching across
  // all live webContents when getWebContentsId() returned -1 (the silent-
  // failure case for Inspect Element on a freshly-attached <webview>).
  openForWebContents: (webContentsId, fallbackUrl) => ipcRenderer.invoke('devtools:open-for-webcontents', webContentsId, fallbackUrl),
  // DevTools for the interface itself (the main window's document), docked
  // at the bottom like F12. Used by the developer dashboard.
  openHost: () => ipcRenderer.invoke('devtools:toggle-host'),
  // Legacy callback support (kept for compatibility, but not used)
  onToggle: (cb) => subscribe('devtools:toggle', cb),
});

contextBridge.exposeInMainWorld('vexHid', {
  // WebHID device chooser. Main fires 'hid:select-request' when a site calls
  // navigator.hid.requestDevice(); the renderer shows the picker and replies
  // with the chosen deviceId (or '' to cancel) via 'hid:select-respond'.
  onSelectRequest: (cb) => subscribe('hid:select-request', cb),
  rendererReady:   () => ipcRenderer.send('hid:renderer-ready'),
  respond:         (payload) => ipcRenderer.invoke('hid:select-respond', payload),
});

contextBridge.exposeInMainWorld('vexSpellcheck', {
  // Replace a misspelled word with a spellcheck suggestion. replaceMisspelling
  // lives on webContents in the main process — the <webview> tag element does
  // NOT expose it. Pass the guest URL as the third arg so main can URL-match
  // when getWebContentsId() returned -1 on a freshly-attached guest.
  replaceMisspelling: (webContentsId, suggestion, fallbackUrl) =>
    ipcRenderer.invoke('spellcheck:replace-misspelling', webContentsId, suggestion, fallbackUrl),
});
