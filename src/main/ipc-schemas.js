const data = require('../renderer/js/data-contracts');
const string = (max = 8192) => value => typeof value === 'string' && value.length <= max;
const optional = check => value => value == null || check(value);
const boolean = value => typeof value === 'boolean';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value > 0;
const coordinate = value => Number.isInteger(value) && value >= 0 && value <= 20000;
const web = value => data.url(value, true);
const oneOf = values => value => values.includes(value);
const shape = fields => value => object(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
const schemas = new Map();
function define(names, checks) { for (const name of names.split(' ')) schemas.set(name, checks); }
define('app:started window-minimize window-maximize window-close storage:flushed storage:flush-failed storage:flush browsing:clear-data browsing:clear-history get-start-page-path get-start-page-url get-user-data-path persist-get-all adblocker-get-state app:metrics close-pip-window is-pip-open oauth-popup:dismiss screen-share:get-quality recall:clear recall:stats privacy:get-config privacy:tracker-stats privacy:tracker-reset vault:list vault:health totp:list totp:codes permissions:renderer-ready permissions:list permissions:clear-all hid:renderer-ready downloads:open-folder toggle-fullscreen is-fullscreen identity:create tor:create check-for-updates widevine:status widevine:retry get-app-version updates:list app:restart app:focus fx:rates set-as-default-browser is-default-browser sidebar-config:get app:processes app:diagnostics ollama:ensure app:safe-mode system:gpu system:dev-ports hotkeys:get extensions:release-idle extensions:list extensions:install-folder extensions:install-zip extensions:open-folder discord:install-vencord sync-load-key sync-load-meta routing:get-all sync-clear-state pip:close pip:toggle-pin pip:back-to-tab', []);
define('extensions:install-catalog', [string(60)]);
// The documents Vex ships, by name (src/main/legal-docs.js), and "Quit Vex".
define('legal:read', [oneOf(['PRIVACY.md', 'TERMS.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])]);
define('app:quit', []);
// Feature isolation in safe mode (main/safe-mode.js) and the ledger of what left this computer (main/egress-ledger.js).
define('app:boot-feature', [string(64), oneOf(['start', 'done'])]);
define('app:boot-disabled', []);
define('egress:summary', [optional(value => Number.isFinite(value) && value > 0 && value <= 31 * 24 * 3600 * 1000)]);
define('egress:list', [optional(object)]);
define('egress:clear', []);
// Game Control Center (src/main/game-control-center.js): no arguments at all,
// so a caller cannot name a program or a path to start.
define('gcc:launch', []);
define('gcc:get', []);
define('gcc:pick', []);
define('gcc:clear', []);
// Tab cost for Game Control Center's Black Box (src/main/pcbb-link.js). The
// line itself is checked by the Black Box library's own schema in main.
define('pcbb:link-set', [boolean]);
define('pcbb:link-state', []);
define('pcbb:tabcost', [object]);
define('legal:gate', [boolean]);
// Keep Vex's own window on top (src/main/keep-on-top.js).
define('window:keep-on-top', [boolean]);
// A Chrome Web Store link or a 32-letter extension id; main finds the id in it
// and refuses anything else (src/main/webstore.js).
define('extensions:webstore-preview extensions:install-webstore', [string(2048)]);
// Installing a picked .zip / .crx / folder after its permissions dialog: the
// token main handed out with the preview (32 hex characters).
define('extensions:install-picked', [value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)]);
// Automatic extension updates (src/main/extension-updates.js) and the
// per-extension "Allow access to file URLs" switch.
define('extensions:update-status extensions:update-check', []);
define('extensions:set-auto-update', [boolean]);
define('extensions:update-approve', [string(160)]);
define('extensions:set-file-access', [string(160), boolean]);
// The update cover (js/update-notifier.js): a version such as 2.35.0.
const version = value => typeof value === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}[0-9A-Za-z.+-]{0,40}$/.test(value);
define('updates:upcoming-notes updates:download updates:install', [version]);
define('updates:cancel', []);
// The backup made before an update (src/main/update-backups.js): the version
// it is named after and the backup file's text; then listed and read back by name.
define('updates:backup-save', [version, string(10 * 1024 * 1024)]);
define('updates:backups', []);
define('updates:backup-read', [string(120)]);
// Health check (src/main/health-check.js): a scan takes nothing; a repair
// names finding ids from that scan (never paths) and whether the person
// agreed to the ones that need a yes; an undo names the run it returned.
define('health:scan', []);
define('health:fix', [value => Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every(string(300)), optional(boolean)]);
define('health:undo', [value => typeof value === 'string' && /^\d{8}-\d{6}(?:-\d{1,3})?$/.test(value)]);
define('file:inspect', [string(4096), optional(string(4096))]);
define('archive:list', [string(4096)]);
define('downloads:set-rules', [value => Array.isArray(value) && value.length <= 50 && value.every(object)]);
// Which finished downloads are still on disk (js/downloads-panel.js).
define('downloads:exist', [value => Array.isArray(value) && value.length <= 1000 && value.every(string(4096))]);
// Settings > Downloads (src/main/download-prefs.js): the folder comes only
// from main's own folder dialog, so choosing it takes no argument.
define('downloads:prefs downloads:choose-folder downloads:reset-prefs', []);
define('downloads:set-ask', [boolean]);
// Developer helpers > repositories (js/repo-registry.js): the folder comes only from main's own
// folder dialog, so choosing it takes no argument.
define('repos:pick-folder', []);
// Delete or drag out a finished download (src/main/download-files.js).
define('downloads:delete-file downloads:start-drag', [string(4096)]);
// Tidy the downloads folder (src/main/download-tidy.js): preview, apply a
// preview by its id, undo the newest tidy-up. No path ever comes from here.
define('downloads:tidy-plan', [value => Number.isSafeInteger(value) && value >= 0 && value <= 3650]);
define('downloads:tidy-apply', [string(64)]);
define('downloads:tidy-undo downloads:tidy-history', []);
define('web-suggest qr:make qr:generate permissions:revoke totp:delete extensions:uninstall downloads:open-file downloads:show-in-folder vault:get', [string()]);
define('hotkeys:set', [object]);
define('game:watch', [boolean]);
define('game:state', []);
// Game mode (src/main/game-mode.js): the user's game list, and the session the
// renderer starts or ends. No path or command can be named through either.
define('gamemode:games', [value => Array.isArray(value) && value.length <= 64 && value.every(shape({ id: string(80), name: string(120), exe: string(260), launcher: optional(boolean) })), boolean]);
define('gamemode:session', [shape({ on: boolean, warm: optional(boolean), app: optional(string(120)), holds: optional(value => Array.isArray(value) && value.length <= 8 && value.every(oneOf(['extensionUpdates', 'sync', 'indexing', 'recall']))) })]);
define('gamemode:state', []);
define('gamemode:library', []);
// Game Control Center's one file (gccbridge:read takes nothing: main reads a fixed path), the
// second-screen window (http/https pages only, re-checked in main) and the PiP memory (T2-068,
// T2-049, T2-059).
define('gccbridge:read secondscreen:close secondscreen:state', []);
define('secondscreen:open', [shape({
  pages: value => Array.isArray(value) && value.length >= 1 && value.length <= 12 && value.every(shape({ title: optional(string(200)), url: string(2048) })),
  index: optional(value => Number.isInteger(value) && value >= 0 && value < 12),
  zoom: optional(value => typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 3),
})]);
define('pip:memory', [shape({ context: optional(string(80)), hideOverGame: optional(boolean) })]);
// Time travel and the tuning advisor (src/main/state-journal.js,
// src/main/tuning-advisor.js). Sizes are bounded here and again where used.
const journalTs = value => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
define('journal:push', [value => object(value) && Array.isArray(value.tabs) && value.tabs.length <= 400
  && (value.notes === undefined || (Array.isArray(value.notes) && value.notes.length <= 2000))
  && (value.reminders === undefined || (Array.isArray(value.reminders) && value.reminders.length <= 400))]);
define('journal:list', [optional(shape({ from: optional(journalTs), to: optional(journalTs) }))]);
define('journal:at', [journalTs]);
define('journal:diff', [journalTs, journalTs]);
define('journal:note-versions', [string(80)]);
define('journal:note-version', [string(80), journalTs]);
define('journal:stats journal:forget tuning:history tuning:forget', []);
define('journal:configure', [shape({ retentionDays: optional(value => Number.isInteger(value) && value >= 1 && value <= 365), enabled: optional(boolean) })]);
define('tuning:advise', [value => object(value) && (value.rows === undefined || (Array.isArray(value.rows) && value.rows.length <= 500))
  && (value.jobs === undefined || (Array.isArray(value.jobs) && value.jobs.length <= 300))]);
// On battery or on mains (src/main/power-watch.js).
define('power:watch power:lean', [boolean]);
define('power:status', []);
define('rec:start', [oneOf(['mp4', 'webm', 'gif'])]);
define('rec:own-window', []);
define('app:idle-seconds', []);
define('overlay:close', []);
// The third argument is the partition of the tab the page comes from: main
// refuses a private, off-the-record or Tor one (main.js, _refuseMainProfileCopy).
define('overlay:open', [web, optional(value => typeof value === 'number' && value >= 0.2 && value <= 1), optional(string(160))]);
define('rec:chunk', [string(80), value => value instanceof Uint8Array && value.byteLength <= 64 * 1024 * 1024]);
define('rec:finish', [string(80), optional(string(200))]);
define('rec:cancel', [string(80)]);
define('capture:submit', [shape({ kind: string(20), text: string(4000) })]);
define('capture:close capture:open', []);
// The text clips inbox (src/main/capture-inbox.js).
// Developer bench (renderer js/dev-bench.js; main/request-log.js, response-overrides.js, log-tail.js,
// pkg-intel.js). Files only ever come from main's own dialogs; the tailer follows a granted id.
define('devbench:requests', [integer]);
define('devbench:overrides-get devbench:overrides-pick-file devbench:log-pick-file devbench:log-list', []);
define('devbench:overrides-set', [object]);
define('devbench:overrides-active', [boolean]);
define('devbench:overrides-state', [string(2048)]);
define('devbench:log-follow-socket', [string(300)]);
define('devbench:log-poll', [string(40), optional(value => Number.isSafeInteger(value) && value >= 0)]);
define('devbench:log-stop', [string(40)]);
define('devbench:pkg', [oneOf(['npm', 'pypi', 'crates']), string(220)]);
define('clips-inbox:list clips-inbox:clear', []);
define('clips-inbox:add', [string(4000)]);
define('clips-inbox:remove', [string(80)]);
// The interface's answer to one captured line (js/quick-capture.js). It was
// declared with no arguments, so every answer was refused and the box sat on
// "Saving…" until "Vex did not answer" (found 2026-09-29).
define('capture:done', [shape({ id: string(40), ok: boolean, said: optional(string(4000)), error: optional(string(4000)) })]);
define('extensions:set-enabled', [string(160), boolean]);
define('extensions:set-scope', [string(160), string(20)]);
define('downloads:control', [string(160), oneOf(['pause', 'resume', 'cancel'])]);
// The address, and the id the panel knows the download by: main retries it
// through the session the first attempt used (src/main/downloads.js).
define('downloads:retry', [web, optional(string(160))]);
define('downloads:ask-where downloads:mine', [string(4 * 1024 * 1024 + 64)]);
define('image:copy', [string(4 * 1024 * 1024 + 64), string(200)]);
define('extensions:open-popup', [shape({ folder: string(160), x: optional(coordinate), y: optional(coordinate), tab: optional(integer) })]);
define('extensions:popup-tab', []);
// An extension's tabs.query/get: which page is the tab in front (main.js, _activeTabsFor).
define('extensions:active-tabs', []);
define('extensions:open-tab', [shape({ url: string(8192), active: optional(boolean) })]);
// An extension's tabs.remove: the tabs' page ids (main.js, _closeTabsForExtension).
define('extensions:close-tab', [shape({ ids: value => Array.isArray(value) && value.length > 0 && value.length <= 500 && value.every(Number.isSafeInteger) })]);
// An extension's menus, badge and shortcuts (main.js _extApi checks the rest).
define('extensions:api', [shape({ op: string(40), args: optional(object) })]);
// The interface: what the extensions show, a click on an item or a button,
// and the extensions' shortcuts.
const extId = value => typeof value === 'string' && /^[a-p]{32}$/.test(value);
const menuItemId = value => (typeof value === 'string' && value.length <= 512) || Number.isSafeInteger(value);
const pageId = optional(integer);
define('extensions:ui-state extensions:commands', []);
define('extensions:menu-click', [shape({ partition: string(160), id: extId, item: menuItemId, tab: pageId, ctx: shape({
  kind: oneOf(['page', 'action']), pageUrl: optional(string(8192)), frameUrl: optional(string(8192)), selectionText: optional(string(10000)),
  linkUrl: optional(string(8192)), srcUrl: optional(string(8192)), mediaType: optional(oneOf(['', 'image', 'video', 'audio'])), editable: optional(boolean),
}) })]);
define('extensions:set-pinned', [string(160), boolean]);
// Uninstall with Undo (js/vex-undo.js): switched off now, removed when the
// toast goes (extensions:uninstall) or on the next start; Undo turns it back on.
define('extensions:uninstall-later extensions:uninstall-undo', [string(160)]);
// Clear all site permissions' Undo: the token clear-all answered with.
define('permissions:clear-undo', [value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)]);
// The site panel's Reset, and its Undo: the token reset-for-page answered with.
define('permissions:reset-for-page-undo', [value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)]);
define('extensions:action-click', [shape({ partition: string(160), id: extId, tab: pageId })]);
define('extensions:set-command-key', [shape({ folder: string(160), command: string(200), reset: optional(boolean),
  key: optional(shape({ key: string(40), code: optional(string(40)), ctrl: boolean, alt: boolean, shift: boolean })) })]);
// The interface's answer to an extension's tabs.create: the tab it made.
define('tab:created-for-extension', [shape({ id: string(40), ok: boolean, tabId: optional(integer), url: optional(string(8192)), active: optional(boolean), error: optional(string(4000)) })]);
define('vex-lock:state', [boolean]);
define('vex-lock:unlock', [string(12)]);
define('vex-lock:verify', [string(12)]);
define('tor:cancel', []);
define('tor:status tor:stop', []);
define('guest:page-shortcut', [shape({ key: string(1), shift: boolean })]);
define('rss:fetch open-external', [web]);
define('mail:compose', [shape({ subject: string(300), body: string(8000), to: optional(string(320)) })]);
// The second argument describes the video to float, and comes from the page,
// so every field is checked rather than trusted.
const finite = value => typeof value === 'number' && Number.isFinite(value);
// The opener's look and its Simple/Full mode (js/simple-mode.js): a private
// window keeps its own storage, so it has neither unless it is told.
define('open-private-window', [optional(string(40)), optional(oneOf(['simple', 'full']))]);
define('open-clean-window', [web, optional(string(40)), optional(oneOf(['simple', 'full']))]);
define('open-pip-window', [web, optional(shape({
  src: web,
  currentTime: optional(finite),
  paused: optional(boolean),
  muted: optional(boolean),
  poster: optional(value => value === '' || data.url(value, true)),
  width: optional(finite),
  height: optional(finite),
  title: optional(string(200)),
})), integer]);   // the tab page's id: the pop-out uses its session
define('adblocker-set-state discord:set-bypass roblox:set-bypass', [boolean]);
define('gui-style:set', [oneOf(['classic','glass'])]);
define('cloud:token-save', [string(4096)]);
define('sync-save-key', [value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)]);
// Phone browser (src/main/companion.js): the Devices view, re-checked in main.
define('companion:start', [shape({ relayUrl: string(2048), view: value => object(value) && Array.isArray(value.devices) && value.devices.length <= 20 })]);
define('companion:publish', [value => object(value) && Array.isArray(value.devices) && value.devices.length <= 20]);
define('companion:status companion:stop', []);
// Saved passwords and authenticator accounts in Vex Sync (main/sync-secrets.js):
// sealed items { id, t, s } only, never a password or a secret.
const secretKind = oneOf(['passwords', 'authenticator', 'passkeys']);
const sealedItem = shape({ id: value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), t: value => Number.isSafeInteger(value) && value >= 0, s: string(65536) });
const sealedList = value => Array.isArray(value) && value.length <= 20000 && value.every(sealedItem);
define('sync-secrets-seal', [value => Array.isArray(value) && value.length >= 1 && value.length <= 3 && value.every(secretKind)]);
define('sync-secrets-apply', [value => object(value) && Object.keys(value).length <= 3 && Object.entries(value).every(([kind, list]) => secretKind(kind) && sealedList(list))]);
define('sync-secrets-describe', [value => Array.isArray(value) && value.length <= 5000 && value.every(item => object(item) && secretKind(item.kind) && typeof item.id === 'string' && item.id.length <= 64 && string(65536)(item.s))]);
define('sync-secrets-put-back', [shape({ kind: secretKind, id: string(64), item: optional(sealedItem) })]);
// Passkeys (src/main/passkeys.js): the page's request is checked field by
// field in main; the window answers the sheet and manages the list by
// credential id. No private key is ever an argument or a result.
define('passkeys:request', [object]);
define('passkeys:cancel passkeys:conditional-list', [string(64)]);
define('passkeys:conditional-choose', [string(64), string(1400), optional(string(24))]);
define('passkeys:answer', [string(64), object]);
define('passkeys:list', []);
define('passkeys:delete passkeys:undo-delete', [string(1400)]);
define('passkeys:rename', [string(1400), string(200)]);
define('persist-set', [string(170), string(12 * 1024 * 1024)]);
define('persist-delete storage-load', [string(170)]);
// Many preference keys in one write: [[key, value or null to delete], ...].
define('persist-apply', [value => Array.isArray(value) && value.length > 0 && value.length <= 5000 && value.every(e => Array.isArray(e) && e.length === 2 && string(170)(e[0]) && (e[1] === null || string(12 * 1024 * 1024)(e[1])))]);
define('storage-save', [string(64), value => value !== undefined]);
// Desktop notifications and reminders are sent by the main process (see
// src/main/notify.js for why the renderer cannot). `at` is epoch milliseconds.
// A password or one-time code to copy, and how long until it is cleared.
define('clipboard:write-secret', [value => typeof value === 'string' && value.length > 0 && value.length <= 10000, optional(value => Number.isInteger(value) && value >= 5 && value <= 300)]);
// urgency / feature / id: the Attention Budget (src/main/notify.js). No urgency is "asked".
define('notify:show',[shape({ title: string(200), body: optional(string(2000)), urgency: optional(oneOf(['critical', 'asked', 'useful', 'ambient'])), feature: optional(string(64)), id: optional(string(120)) })]);
// The window tells main whether it is a bad moment for a toast (js/attention-state.js).
define('attention:state', [shape({ quiet: boolean, reason: string(40), until: value => Number.isFinite(value) && value >= 0 })]);
define('attention:denied attention:clear-denied', []);
// An AI news toast (src/main/news-toast.js checks it again): a tag the toast's
// buttons carry back, an https address, short text. main.js 'news:notify'.
const httpsOnly = value => typeof value === 'string' && value.length <= 2048 && (() => { try { return new URL(value).protocol === 'https:'; } catch { return false; } })();
define('news:notify', [shape({
  title: string(120), body: optional(string(400)), silent: optional(boolean),
  tag: value => typeof value === 'string' && /^news-[A-Za-z0-9_-]{1,56}$/.test(value),
  url: optional(httpsOnly),
})]);
define('news:pending', []);
// A reminder is timed (`at`, optionally repeating) or site-triggered (`site`);
// either may carry the page it is about and an urgent flag.
const weekdayList = value => Array.isArray(value) && value.length > 0 && value.length <= 7 && value.every(d => Number.isInteger(d) && d >= 0 && d <= 6);
define('reminders:create', [shape({
  message: string(2000),
  at: optional(integer),
  url: optional(web),
  // A named cadence, or an alarm's set of weekdays (0 = Sunday).
  repeat: optional(value => ['daily', 'weekdays', 'weekly'].includes(value) || weekdayList(value)),
  site: optional(string(253)),
  urgent: optional(boolean),
  kind: optional(oneOf(['reminder', 'alarm', 'timer', 'review'])),
  sound: optional(boolean),
  // The job profile it was set under, so Today can separate work from the rest.
  job: optional(string(64)),
})]);
define('reminders:ack', [value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)]);
// Reminders that arrived through Vex Sync; the engine validates each field.
define('reminders:import', [value => Array.isArray(value) && value.length <= 500 && value.every(object)]);
define('reminders:list', []);
define('reminders:delete', [value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)]);
define('reminders:visited', [string(253)]);
define('reminders:hold', [value => typeof value === 'number' && Number.isFinite(value) && value >= 0, optional(oneOf(['focus', 'meeting']))]);
// Save a small text file where the user chooses — a calendar entry, an export.
define('file:save-text', [shape({ name: string(200), text: string(1024 * 1024), kind: optional(string(40)) })]);
define('calendar:fetch', [string(4096)]);
define('page:save-epub', [shape({ title: string(500), url: string(4096), xhtml: string(8 * 1024 * 1024) })]);
define('media:list webview:hard-reload devtools:toggle-webview', [integer]);
define('media:download', [integer, web]);
define('page:save', [integer, string(10), optional(string(500))]);
define('page:capture-full', [integer]);
// Archive library (main/archive-library.js): the tab to keep and the text read
// from it; a saved copy is named by its id.
const archiveId = value => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value);
define('pagearchive:save', [integer, shape({ title: optional(string(500)), text: optional(string(100000)) })]);
define('pagearchive:list', []);
define('pagearchive:search', [string(512)]);
define('pagearchive:find', [web]);
define('pagearchive:open pagearchive:export pagearchive:remove', [archiveId]);
define('page:eval-all-frames', [integer, string(256 * 1024), optional(boolean)]);
define('mail:accounts', []);
define('mail:add', [shape({ email: string(320), password: string(512), host: optional(string(255)), port: optional(integer), secure: optional(boolean) })]);
define('mail:remove', [string(64)]);
define('mail:inbox', [string(64), optional(integer), optional(integer)]);
define('mail:message', [string(64), integer]);
// The tag is optional: with none, the notes are for the running version —
// which is how "What's new" asks after an update. Requiring it rejected that
// call, so the popup never appeared after an update (2026-09-07 to v2.32.31).
define('updates:notes', [optional(string(40))]);
define('discord:lite', [boolean]);
define('crawl:fetch', [string(4096), optional(value => value === 'text/html' || value === 'text/plain')]);
define('links:check', [value => Array.isArray(value) && value.length <= 2000 && value.every(string(4096))]);
// A freshly attached <webview> reports its id as -1; the handler then finds
// the page by URL (and checks ownership itself), so any integer is allowed.
define('devtools:open-for-webcontents', [value => Number.isInteger(value), optional(web)]);
define('devtools:toggle-host', []);
define('spellcheck:replace-misspelling', [integer, string(1024), optional(web)]);
define('vex:set-bg-throttling', [integer, boolean]);
define('app:tab-memory', [value => Array.isArray(value) && value.length <= 10000 && value.every(integer)]);
// Every key the renderer's shortcut registry answers to, as written combos.
define('shortcuts:guest-keys', [value => Array.isArray(value) && value.length <= 300 && value.every(v => string(64)(v))]);
// The shortcut editor is (not) recording a key: main's own keys stand aside.
define('shortcuts:capturing', [boolean]);
define('app:open-as-app', [web, optional(string(4096)), optional(string(160))]);
define('tor:verify routing:get', [optional(string(160))]);
define('routing:set', [optional(string(160)), oneOf(['direct','tor','proxy']), optional(string(2048))]);
// All of Vex at once, and the check that says whether it is really working.
define('routing:set-all', [oneOf(['direct', 'tor', 'proxy']), optional(string(2048))]);
define('routing:check', [optional(string(160))]);
// A site route no rule uses, and the partitions the site rules use (js/site-routes.js).
define('routing:forget', [string(160)]);
define('routing:prune', [value => Array.isArray(value) && value.length <= 500 && value.every(string(160))]);
// 'auto' is the Auto-configure sweep (js/discord-bypass.js); it was missing
// here, so every Auto-configure was refused before it started.
define('bypass:probe', [string(2048)]);
define('discord:set-bypass-mode', [oneOf(['off','light','strong','auto']), optional(shape({ preset: optional(value => Number.isInteger(value)), custom: optional(string(4096)) }))]);
define('discord:install-vencord-local', [optional(string())]);
// Light and dark (src/main/system-theme.js): is Windows in dark mode.
define('system-theme:get', []);
// A New Tab background image: your own theme's (by its id, js/theme-studio.js),
// or without an id the old single Custom Image.
const themeId = value => typeof value === 'string' && /^user-[a-z]{4,24}$/.test(value);
define('theme:get-custom-image', [optional(themeId)]);
define('theme:set-custom-image', [optional(value => typeof value === 'string' && value.length <= 12 * 1024 * 1024 && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)), optional(themeId)]);
// A theme from your Windows wallpaper (src/main/wallpaper.js): read only.
define('theme:read-wallpaper', []);
// Website appearance (src/main/website-appearance.js): light or dark for pages.
define('theme:set-website-appearance', [oneOf(['system', 'light', 'dark'])]);
define('site:clear-data cookies:list', [shape({ url: web, partition: optional(string(160)) })]);
// Editing one cookie: the name and the three things that decide which cookie
// of that name it is (domain, path, secure) come straight back from the list.
const cookieRef = {
  url: web,
  partition: optional(string(160)),
  name: string(4096),
  domain: optional(string(253)),
  path: optional(string(1024)),
  secure: optional(boolean),
};
const timestamp = value => value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
define('dict:lookup', [string(40)]);
define('net:latency', []);
define('games:free', []);
define('system:memory', []);
// The channels to ask about: a kind and a name each, nothing else.
define('live:check', [value => Array.isArray(value) && value.length <= 30 && value.every(c => object(c) && (c.kind === 'twitch' || c.kind === 'youtube') && typeof c.name === 'string' && c.name.length <= 80)]);
define('clips:folder', [optional(boolean)]);
define('clips:list', [optional(string(4096))]);
// A file dropped on the AI panel: its bytes, and what it was called.
define('doc:text', [value => value instanceof Uint8Array && value.byteLength <= 32 * 1024 * 1024, string(300)]);
define('siterules:get', []);
// A watched page read through a hidden tab (src/main/page-render.js): the
// address and, for one part of it, a selector and the words it began with.
define('pagewatch:render', [shape({ url: web, selector: optional(string(200)), anchor: optional(string(200)) })]);
// Settings > Start Vex when I sign in to Windows (main/login-item.js): read
// what Windows holds; set it on or off, minimised or not.
define('login-item:get', []);
define('login-item:set', [boolean, boolean]);
define('siterules:set', [object]);
// The saved decisions one tab's page is held to, by the page's id (main.js).
define('permissions:list-for-page', [integer]);
// The site panel (js/site-panel.js): one permission of a tab's page set to
// allow, block or ask; all of its site's reset; the certificate it was served with.
define('permissions:set-for-page', [integer, value => typeof value === 'string' && /^(?:camera|microphone|geolocation|notifications|clipboard-read|display-capture|midi|midiSysex|popups|automatic-downloads|external:[a-z][a-z0-9+.-]{0,40})$/.test(value), oneOf(['allow', 'deny', 'ask'])]);
define('permissions:reset-for-page site:certificate tabs:vex-page-address', [integer]);
// The pages of a tab just closed, whose saved back lists go (session-security.js).
define('tabs:closed', [value => Array.isArray(value) && value.length <= 10 && value.every(integer)]);
// A tab's back list read by its page's id, and handed back for the page made
// for it again (session-security.js, carryHistory, which checks each entry).
define('tabs:history', [integer]);
// The Back/Forward menu's list (tabs:nav-list) and Ctrl+Tab by recency being on or off (tabs:mru-keys).
define('tabs:nav-list', [integer]);
define('tabs:mru-keys', [boolean]);
// The tab in front changed: its page, for extensions' tabs.onActivated.
define('tabs:activated', [integer]);
define('tabs:carry-history', [value => typeof value === 'string' && /^c\d{1,9}$/.test(value), string(160),
  shape({ entries: value => Array.isArray(value) && value.length <= 50 && value.every(object), index: value => Number.isInteger(value) && value >= 0 })]);
// A tab's icon fetched through the tab's own session, by its page's id
// (src/main/favicon-fetch.js).
define('tabs:favicon', [integer, web]);
// A private window asking which sites the main window's Tor and proxy rules
// name, to say they do not apply there (js/site-routes.js).
define('siteroutes:routed-hosts', []);
define('cookies:remove', [shape(cookieRef)]);
define('cookies:set', [shape({ ...cookieRef, value: string(16384), httpOnly: optional(boolean), expires: timestamp })]);
define('translate:text', [shape({ text: string(100000), tl: value => typeof value === 'string' && /^[a-z-]{2,16}$/i.test(value) })]);
define('recall:index', [shape({ url: web, text: optional(string(100000)), title: optional(string(4096)) })]);
const count = (max) => value => value == null || (Number.isSafeInteger(value) && value >= 0 && value <= max);
define('recall:search', [string(512), optional(shape({
  limit: count(200), offset: count(100000), sort: optional(oneOf(['relevance', 'newest', 'oldest'])),
  since: count(Number.MAX_SAFE_INTEGER), until: count(Number.MAX_SAFE_INTEGER), site: optional(string(253)),
}))]);
define('recall:limits', [shape({ days: optional(value => Number.isInteger(value) && value >= 7 && value <= 3650), maxMB: optional(value => Number.isFinite(value) && value >= 1 && value <= 64), maxPages: optional(value => Number.isInteger(value) && value >= 100 && value <= 10000) })]);
define('recall:forget', [shape({ url: optional(web), host: optional(string(253)) })]);
// Recall by meaning (src/main/recall-vectors.js): the embedding model and the
// local Ollama address, the hosts Recall is told to stay out of, and how many
// pages one step may read.
const meaningArgs = shape({
  model: optional(string(100)), baseUrl: optional(string(100)),
  excluded: optional(value => Array.isArray(value) && value.length <= 1000 && value.every(host => typeof host === 'string' && host.length <= 253)),
  batch: optional(count(20)), limit: optional(count(100)),
});
define('recall:meaning-status recall:meaning-step', [meaningArgs]);
define('recall:meaning-search', [string(512), meaningArgs]);
define('recall:meaning-forget', []);
// Knowledge base (src/main/knowledge-ipc.js): what the person keeps. Items come
// from the renderer's own stores; main refuses private/Tor/routed ones again.
const kbKind = oneOf(['bookmark', 'note', 'sticky', 'readlater', 'highlight', 'archive']);
const kbArgs = shape({
  model: optional(string(100)), baseUrl: optional(string(100)),
  excluded: optional(value => Array.isArray(value) && value.length <= 1000 && value.every(host => typeof host === 'string' && host.length <= 253)),
  batch: optional(count(20)), limit: optional(count(100)),
  since: count(Number.MAX_SAFE_INTEGER), until: count(Number.MAX_SAFE_INTEGER),
  kinds: optional(value => Array.isArray(value) && value.length <= 6 && value.every(kbKind)),
  manual: optional(boolean),
});
const kbKinds = value => Array.isArray(value) && value.length <= 6 && value.every(kbKind);
define('kb:plan', [
  value => Array.isArray(value) && value.length <= 20000 && value.every(e => e && typeof e === 'object' && typeof e.id === 'string' && e.id.length <= 300 && kbKind(e.kind) && typeof e.h === 'string' && e.h.length <= 40),
  optional(kbKinds),
]);
define('kb:put', [
  value => Array.isArray(value) && value.length <= 100 && value.every(i => i && typeof i === 'object' && typeof i.id === 'string' && i.id.length <= 300 && kbKind(i.kind)
    && (i.title == null || (typeof i.title === 'string' && i.title.length <= 4096))
    && (i.text == null || (typeof i.text === 'string' && i.text.length <= 100000))
    && (i.url == null || (typeof i.url === 'string' && i.url.length <= 8192))
    && (i.at == null || Number.isFinite(i.at))
    && (i.h == null || (typeof i.h === 'string' && i.h.length <= 40))
    && (i.partition == null || (typeof i.partition === 'string' && i.partition.length <= 200))
    && (i.private == null || typeof i.private === 'boolean') && (i.routed == null || typeof i.routed === 'boolean')),
  optional(kbArgs),
]);
define('kb:sync-archive kb:status kb:step', [optional(kbArgs)]);
define('kb:search kb:context', [string(512), optional(kbArgs)]);
define('kb:related', [string(300), optional(kbArgs)]);
define('kb:related-page', [shape({ title: optional(string(4096)), url: optional(string(8192)), text: optional(string(20000)) }), optional(kbArgs)]);
define('kb:keep-out', [string(300), optional(boolean)]);
define('kb:keep-out-clear kb:forget', []);
define('vault:save', [shape({ host: string(253), username: string(4096), password: string(16384), note: optional(string(4096)) })]);
define('vault:update', [shape({ host: string(253), username: string(4096), newUsername: string(4096), password: optional(string(16384)), note: optional(string(4096)) })]);
define('vault:export-csv vault:breach-check', []);
define('totp:import-migration', [string(65536)]);
define('totp:export-backup totp:import-backup', [string(1024)]);
define('totp:rename', [string(256), string(4096), string(4096)]);
define('vault:delete', [shape({ host: string(253), username: string(4096) })]);
// Import from another browser (main/browser-import.js): a browser and a profile
// id from browser-import:sources, never a path; the CSV is chosen in main.
define('browser-import:sources browser-import:passwords-csv', []);
define('browser-import:read', [oneOf(require('./browser-import').BROWSERS), string(400)]);
define('totp:add', [value => string(16384)(value) || shape({ secret: string(16384), label: optional(string(4096)), issuer: optional(string(4096)) })(value)]);
// remember: true / false, 'session' (this visit) or 'day'. It said boolean,
// and "Allow this visit" sends 'session' — so that button was refused and the
// site's request hung until it timed out (v2.31.95 to v2.32.33).
define('permission:respond', [shape({ id: string(160), decision: oneOf(['allow','deny']), remember: optional(oneOf([true, false, 'session', 'day'])) })]);
define('hid:select-respond', [shape({ id: string(160), deviceId: optional(string(1024)) })]);
define('screen-share:preflight', [integer]);
define('commit:state', []);
define('signout:why', [optional(string(255))]);
// Permission hygiene, what am I signed in to, the kill switch, the incident checklist and the password-field interlock
// (main/permission-hygiene.js, signed-in.js, incident-scan.js, credential-guard.js). The kill switch names a site, never a path.
define('hygiene:perm-config', [optional(object)]);
define('hygiene:perm-summary hygiene:perm-live hygiene:signed-in hygiene:downloads-scan', []);
define('hygiene:perm-pin', [string(2048), boolean]);
define('hygiene:perm-decide', [string(80), oneOf(['allow', 'deny'])]);
define('hygiene:perm-stop', [integer]);
define('hygiene:kill-site hygiene:site-links', [string(253)]);
define('credguard:check', [string(2048)]);
define('screen-picker:choose', [shape({ id: string(160), sourceId: optional(string(1024)), audio: optional(boolean), width: optional(value => Number.isInteger(value) && value >= 0 && value <= 16384), height: optional(value => Number.isInteger(value) && value >= 0 && value <= 16384), fps: optional(value => Number.isInteger(value) && value >= 0 && value <= 240) })]);
define('sync-save-meta', [shape({ enabled: optional(boolean), email: optional(string(1024)), sessionToken: string(4096), deviceId: string(160), revision: optional(value => Number.isSafeInteger(value) && value >= 0) })]);
define('cloud:request', [shape({ feature: optional(string(80)) })]);
// "Ask Vex about this image": the tab page's id, the picture's address, and
// whether the person agreed to send a private or Tor tab's picture (main.js).
define('image:for-ai', [integer, web, optional(boolean)]);
// mcpServer: the id of an MCP server whose token main adds to the request.
// publicOnly: the AI agent's reads, refused for this machine and the local network.
define('api:request', [shape({ url: web, method: optional(oneOf(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])), headers: optional(object), body: optional(string(8 * 1024 * 1024)), binary: optional(boolean), mcpServer: optional(string(80)), publicOnly: optional(boolean), viewer: optional(boolean), allowLocal: optional(boolean), egress: optional(string(40)) })]);
// API playground (main/api-playground.js): one request from the request
// builder. Headers are name/value text; main checks every name and value.
// allowLocal: the person switched on "Allow localhost" for this request.
define('playground:send', [shape({ url: web, method: oneOf(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']), headers: optional(object), body: optional(string(1024 * 1024)), allowLocal: optional(boolean) })]);
// An MCP server's token, kept encrypted in main; an empty one removes it.
define('mcp:auth-set', [string(80), string(4096)]);
// The GitHub read-only token vault (main/github-vault.js) and the developer
// feeds (main/dev-feeds.js). The token goes in once and never comes back out;
// the path is checked against a list of read endpoints in main.
define('github:status github:token-clear github:token-test', []);
define('github:token-set', [string(400)]);
define('github:get', [string(400), optional(shape({ authed: optional(boolean) }))]);
define('devfeeds:latest', [oneOf(['npm', 'pypi']), string(120)]);
define('devfeeds:advisories', [oneOf(['npm', 'pypi']), string(120), string(60)]);
define('devfeeds:ping', [string(300)]);
// Developer desk (main/dev-desk.js), plugin dev loop (main/dev-extension.js) and the Electron
// ticker (main/castlabs-ticker.js). Folders come only from main's folder dialog; a path to open
// is checked against the granted folders in main.
define('devdesk:config devdesk:grant-root devext:pick devext:reload devext:stop devext:status devext:vencord', []);
define('devdesk:set-config', [shape({ enabled: optional(boolean), editor: optional(string(20)), terminal: optional(string(20)) })]);
define('devdesk:revoke-root devdesk:open-terminal devdesk:branch', [string(500)]);
define('devdesk:open-file', [shape({ path: string(500), line: optional(integer), col: optional(integer) })]);
define('castlabs:behind', [optional(boolean)]);
define('devdesk:ports', [value => Array.isArray(value) && value.length <= 12 && value.every(p => Number.isInteger(p) && p >= 1024 && p <= 65535)]);
define('privacy:set-config', [object]);
define('popup-chrome:action', [shape({ action: string(80) })]);
// A page's alert / confirm / prompt (preload-webview.js, main/page-dialogs.js):
// the preload cuts the text to 10000 characters; anything longer is refused.
define('page-dialog', [shape({ type: oneOf(['alert', 'confirm', 'prompt']), message: string(10000), value: optional(string(10000)) })]);
// The window's answer to one (renderer/js/page-dialogs.js).
define('page-dialog:answer', [shape({ id: string(64), ok: boolean, value: optional(string(10000)), stop: optional(boolean) })]);
// The window's answer to "Leave site?" (main/leave-page.js).
define('page:leave-answer', [shape({ id: string(64), leave: boolean })]);
// Guest compatibility bridges use sender-derived identity; legacy arguments are ignored.
define('geolocation:get geolocation:check-permission compatibility:get privacy:config-sync', [optional(string())]);
// Whether the asking page is Vex's own New Tab page, judged by main from the
// frame's own address (preload-webview.js _isVexStartPage).
define('start-page:is-own', []);
// Profiles (src/main/profiles.js, js/profiles-ui.js): ids are 'default' or
// p-xxxxxxxx; the look is a name, a #rrggbb colour and a VexIcons name.
const profileId = value => typeof value === 'string' && /^(?:default|p-[a-z0-9]{8})$/.test(value);
const profileLook = value => object(value) && Object.keys(value).every(k => ['name', 'color', 'icon'].includes(k))
  && optional(string(40))(value.name) && optional(v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))(value.color)
  && optional(v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(v))(value.icon);
// Userscripts (main/userscripts.js). A page's own script asks only for its
// list and, by the id main gave it, one of a few operations; the manager's
// channels are Vex's own window only (ipc-policy.js).
define('userscripts:page userscripts:list', []);
define('userscripts:gm', [shape({ id: string(64), op: oneOf(['setValue', 'deleteValue', 'xhr', 'xhr-abort', 'clipboard', 'notification', 'openTab']), args: value => Array.isArray(value) && value.length <= 4 })]);
define('userscripts:preview', [string(450000), optional(string(64))]);
define('userscripts:install', [shape({ source: string(450000), anyHost: optional(boolean), sourceUrl: optional(string(2000)), replaceId: optional(string(64)) })]);
define('userscripts:set-enabled', [string(64), boolean]);
define('userscripts:remove userscripts:clear-values', [string(64)]);
define('userscripts:set-global', [boolean]);
define('userscripts:set-hosts', [string(64), value => Array.isArray(value) && value.length <= 30 && value.every(h => typeof h === 'string' && h.length <= 253)]);
define('userscripts:fetch', [web]);
// Vex Packs (main/packs.js, main/packs-store.js). The window never hands main
// content to install: a pack is previewed (main judges the text) and then
// installed by the one-use token main gave back. Main re-validates everything.
const packToken = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
const packIdArg = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
define('packs:list packs:items packs:pick-file', []);
define('packs:preview', [string(300000)]);
define('packs:install', [packToken, optional(boolean)]);
define('packs:discard', [packToken]);
define('packs:set-enabled', [packIdArg, boolean]);
define('packs:uninstall', [packIdArg]);
define('packs:set-global', [boolean]);
define('packs:trust-key', [packIdArg, optional(string(60))]);
define('packs:untrust-key', [string(40)]);
define('packs:generate-key', [optional(boolean)]);
define('packs:export', [shape({ id: string(64), name: string(80), authorName: string(60), description: optional(string(600)), sign: boolean,
  items: value => Array.isArray(value) && value.length >= 1 && value.length <= 200 && value.every(object) })]);
// Web safety (src/main/web-safety.js, js/web-safety-ui.js): the sensitivity,
// the sites not to warn about, paranoid mode per origin, and a check of one
// address. Vex's own window only.
define('websafety:get', []);
define('websafety:set-sensitivity', [oneOf(['off', 'standard', 'strict'])]);
define('websafety:allow-host websafety:forget-host', [string(253)]);
define('websafety:set-paranoid', [string(2048), boolean]);
define('websafety:check', [string(2048)]);
define('profiles:list', []);
define('profiles:create', [profileLook]);
define('profiles:update', [profileId, profileLook]);
define('profiles:open profiles:delete profiles:shortcut', [profileId]);
// Privacy report card, extension usage audit, crash-proof tabs and quiet hours
// (src/main/protect.js). Reads take no argument; the cleanup names at most 50
// sites; a snapshot is bounded again in main/tab-snapshots.js.
define('privacy:report extensions:usage-audit tabsnap:load tabsnap:clear quiet:get quiet:held quiet:release quiet:drop', []);
define('privacy:report-clean', [value => Array.isArray(value) && value.length >= 1 && value.length <= 50 && value.every(string(255))]);
define('tabsnap:save', [shape({
  entries: value => Array.isArray(value) && value.length <= 60 && value.every(object),
  keepUrls: value => Array.isArray(value) && value.length <= 200 && value.every(string(2048)),
  closedUrls: optional(value => Array.isArray(value) && value.length <= 50 && value.every(string(2048))),
  dropUrls: optional(value => Array.isArray(value) && value.length <= 50 && value.every(string(2048))),
})]);
define('tabsnap:drop', [string(2048)]);
define('quiet:set', [object]);
function validate(channel, args) {
  if (channel.startsWith('@ghostery/')) return; // Vendor-owned API; the outer policy still bounds JSON and verifies its sender.
  const checks = schemas.get(channel);
  if (!checks) throw new Error('IPC channel has no payload contract: ' + channel);
  if (args.length > checks.length || checks.some((check, index) => !check(args[index]))) throw new Error('Invalid payload for ' + channel);
}
module.exports = { validate, schemas };
