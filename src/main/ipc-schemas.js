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
define('file:inspect', [string(4096), optional(string(4096))]);
define('archive:list', [string(4096)]);
define('downloads:set-rules', [value => Array.isArray(value) && value.length <= 50 && value.every(object)]);
define('app:restore-settings web-suggest qr:make qr:generate permissions:revoke totp:delete extensions:uninstall downloads:open-file downloads:show-in-folder vault:get', [string()]);
define('hotkeys:set', [object]);
define('game:watch', [boolean]);
define('game:state', []);
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
define('downloads:ask-where', [string(4 * 1024 * 1024 + 64)]);
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
define('tor:cancel', []);
define('tor:status tor:stop', []);
define('guest:page-shortcut', [shape({ key: string(1), shift: boolean })]);
define('rss:fetch open-external', [web]);
define('mail:compose', [shape({ subject: string(300), body: string(8000) })]);
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
define('persist-set', [string(170), string(12 * 1024 * 1024)]);
define('persist-delete storage-load', [string(170)]);
// Many preference keys in one write: [[key, value or null to delete], ...].
define('persist-apply', [value => Array.isArray(value) && value.length > 0 && value.length <= 5000 && value.every(e => Array.isArray(e) && e.length === 2 && string(170)(e[0]) && (e[1] === null || string(12 * 1024 * 1024)(e[1])))]);
define('storage-save', [string(64), value => value !== undefined]);
// Desktop notifications and reminders are sent by the main process (see
// src/main/notify.js for why the renderer cannot). `at` is epoch milliseconds.
// A password or one-time code to copy, and how long until it is cleared.
define('clipboard:write-secret', [value => typeof value === 'string' && value.length > 0 && value.length <= 10000, optional(value => Number.isInteger(value) && value >= 5 && value <= 300)]);
define('notify:show',[shape({ title: string(200), body: optional(string(2000)) })]);
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
define('discord:set-bypass-mode', [oneOf(['off','light','strong']), optional(shape({ preset: optional(value => Number.isInteger(value)), custom: optional(string(4096)) }))]);
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
define('siterules:set', [object]);
// The saved decisions one tab's page is held to, by the page's id (main.js).
define('permissions:list-for-page', [integer]);
// The site panel (js/site-panel.js): one permission of a tab's page set to
// allow, block or ask; all of its site's reset; the certificate it was served with.
define('permissions:set-for-page', [integer, value => typeof value === 'string' && /^(?:camera|microphone|geolocation|notifications|clipboard-read|display-capture|midi|midiSysex|popups|external:[a-z][a-z0-9+.-]{0,40})$/.test(value), oneOf(['allow', 'deny', 'ask'])]);
define('permissions:reset-for-page site:certificate', [integer]);
// The pages of a tab just closed, whose saved back lists go (session-security.js).
define('tabs:closed', [value => Array.isArray(value) && value.length <= 10 && value.every(integer)]);
// A tab's back list read by its page's id, and handed back for the page made
// for it again (session-security.js, carryHistory, which checks each entry).
define('tabs:history', [integer]);
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
define('recall:forget', [shape({ url: optional(web), host: optional(string(253)) })]);
define('vault:save', [shape({ host: string(253), username: string(4096), password: string(16384) })]);
define('vault:delete', [shape({ host: string(253), username: string(4096) })]);
// Import from another browser (main/browser-import.js): a browser and a profile
// id from browser-import:sources, never a path; the CSV is chosen in main.
define('browser-import:sources browser-import:passwords-csv', []);
define('browser-import:read', [oneOf(['chrome', 'edge', 'brave', 'firefox']), string(400)]);
define('totp:add', [value => string(16384)(value) || shape({ secret: string(16384), label: optional(string(4096)), issuer: optional(string(4096)) })(value)]);
// remember: true / false, 'session' (this visit) or 'day'. It said boolean,
// and "Allow this visit" sends 'session' — so that button was refused and the
// site's request hung until it timed out (v2.31.95 to v2.32.33).
define('permission:respond', [shape({ id: string(160), decision: oneOf(['allow','deny']), remember: optional(oneOf([true, false, 'session', 'day'])) })]);
define('hid:select-respond', [shape({ id: string(160), deviceId: optional(string(1024)) })]);
define('screen-picker:choose', [shape({ id: string(160), sourceId: optional(string(1024)), audio: optional(boolean), width: optional(value => Number.isInteger(value) && value >= 0 && value <= 16384), height: optional(value => Number.isInteger(value) && value >= 0 && value <= 16384), fps: optional(value => Number.isInteger(value) && value >= 0 && value <= 240) })]);
define('sync-save-meta', [shape({ enabled: optional(boolean), email: optional(string(1024)), sessionToken: string(4096), deviceId: string(160), revision: optional(value => Number.isSafeInteger(value) && value >= 0) })]);
define('cloud:request', [shape({ feature: optional(string(80)) })]);
// "Ask Vex about this image": the tab page's id, the picture's address, and
// whether the person agreed to send a private or Tor tab's picture (main.js).
define('image:for-ai', [integer, web, optional(boolean)]);
// mcpServer: the id of an MCP server whose token main adds to the request.
define('api:request', [shape({ url: web, method: optional(oneOf(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])), headers: optional(object), body: optional(string(8 * 1024 * 1024)), binary: optional(boolean), mcpServer: optional(string(80)) })]);
// An MCP server's token, kept encrypted in main; an empty one removes it.
define('mcp:auth-set', [string(80), string(4096)]);
define('privacy:set-config', [object]);
define('popup-chrome:action', [shape({ action: string(80) })]);
// A page's alert / confirm / prompt (preload-webview.js, main/page-dialogs.js):
// the preload cuts the text to 10000 characters; anything longer is refused.
// Whether a page's window.open had user activation (preload-webview.js).
define('popup:activation', [boolean]);
define('page-dialog', [shape({ type: oneOf(['alert', 'confirm', 'prompt']), message: string(10000), value: optional(string(10000)) })]);
// The window's answer to one (renderer/js/page-dialogs.js).
define('page-dialog:answer', [shape({ id: string(64), ok: boolean, value: optional(string(10000)), stop: optional(boolean) })]);
// The window's answer to "Leave site?" (main/leave-page.js).
define('page:leave-answer', [shape({ id: string(64), leave: boolean })]);
// Guest compatibility bridges use sender-derived identity; legacy arguments are ignored.
define('geolocation:get geolocation:check-permission compatibility:get privacy:config-sync', [optional(string())]);
// Profiles (src/main/profiles.js, js/profiles-ui.js): ids are 'default' or
// p-xxxxxxxx; the look is a name, a #rrggbb colour and a VexIcons name.
const profileId = value => typeof value === 'string' && /^(?:default|p-[a-z0-9]{8})$/.test(value);
const profileLook = value => object(value) && Object.keys(value).every(k => ['name', 'color', 'icon'].includes(k))
  && optional(string(40))(value.name) && optional(v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))(value.color)
  && optional(v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(v))(value.icon);
define('profiles:list', []);
define('profiles:create', [profileLook]);
define('profiles:update', [profileId, profileLook]);
define('profiles:open profiles:delete profiles:shortcut', [profileId]);
function validate(channel, args) {
  if (channel.startsWith('@ghostery/')) return; // Vendor-owned API; the outer policy still bounds JSON and verifies its sender.
  const checks = schemas.get(channel);
  if (!checks) throw new Error('IPC channel has no payload contract: ' + channel);
  if (args.length > checks.length || checks.some((check, index) => !check(args[index]))) throw new Error('Invalid payload for ' + channel);
}
module.exports = { validate, schemas };
