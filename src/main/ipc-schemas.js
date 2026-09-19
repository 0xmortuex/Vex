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
define('app:started window-minimize window-maximize window-close storage:flushed storage:flush-failed storage:flush browsing:clear-data get-start-page-path get-start-page-url get-user-data-path persist-get-all adblocker-get-state app:metrics close-pip-window is-pip-open oauth-popup:dismiss screen-share:get-quality recall:clear recall:stats privacy:get-config privacy:tracker-stats privacy:tracker-reset vault:list vault:health totp:list totp:codes permissions:renderer-ready permissions:list permissions:clear-all hid:renderer-ready downloads:open-folder toggle-fullscreen is-fullscreen open-private-window identity:create tor:create check-for-updates widevine:status widevine:retry download-update install-update get-app-version updates:list app:restart app:focus fx:rates theme:get-custom-image set-as-default-browser is-default-browser sidebar-config:get app:processes app:diagnostics ollama:ensure app:safe-mode system:gpu system:dev-ports hotkeys:get extensions:release-idle extensions:list extensions:install-folder extensions:install-zip extensions:open-folder discord:install-vencord sync-load-key sync-load-meta sync-clear-state pip:close pip:toggle-pin pip:back-to-tab', []);
define('file:inspect', [string(4096), optional(string(4096))]);
define('app:restore-settings web-suggest qr:make qr:generate permissions:revoke updates:notes totp:delete extensions:uninstall downloads:open-file downloads:show-in-folder vault:get', [string()]);
define('hotkeys:set', [object]);
define('game:watch', [boolean]);
define('game:state', []);
define('rec:start', [oneOf(['mp4', 'webm'])]);
define('rec:chunk', [string(80), value => value instanceof Uint8Array && value.byteLength <= 64 * 1024 * 1024]);
define('rec:finish', [string(80), optional(string(200))]);
define('rec:cancel', [string(80)]);
define('capture:submit', [shape({ kind: string(20), text: string(4000) })]);
define('capture:close capture:done capture:open', []);
define('extensions:set-enabled', [string(160), boolean]);
define('extensions:set-scope', [string(160), string(20)]);
define('downloads:control', [string(160), oneOf(['pause', 'resume', 'cancel'])]);
define('downloads:retry', [web]);
define('extensions:open-popup', [shape({ folder: string(160), x: optional(coordinate), y: optional(coordinate) })]);
define('rss:fetch open-external', [web]);
// The second argument describes the video to float, and comes from the page,
// so every field is checked rather than trusted.
const finite = value => typeof value === 'number' && Number.isFinite(value);
define('open-pip-window', [web, optional(shape({
  src: web,
  currentTime: optional(finite),
  paused: optional(boolean),
  muted: optional(boolean),
  poster: optional(value => value === '' || data.url(value, true)),
  width: optional(finite),
  height: optional(finite),
  title: optional(string(200)),
}))]);
define('adblocker-set-state discord:set-bypass roblox:set-bypass', [boolean]);
define('gui-style:set', [oneOf(['classic','glass'])]);
define('cloud:token-save', [string(4096)]);
define('sync-save-key', [value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)]);
define('persist-set', [string(170), string(12 * 1024 * 1024)]);
define('persist-delete storage-load', [string(170)]);
define('storage-save', [string(64), value => value !== undefined]);
define('storage:history-add', [shape({ url: web, title: optional(string(4096)) })]);
// Desktop notifications and reminders are sent by the main process (see
// src/main/notify.js for why the renderer cannot). `at` is epoch milliseconds.
define('notify:show', [shape({ title: string(200), body: optional(string(2000)) })]);
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
define('reminders:hold', [value => typeof value === 'number' && Number.isFinite(value) && value >= 0]);
// Save a small text file where the user chooses — a calendar entry, an export.
define('file:save-text', [shape({ name: string(200), text: string(1024 * 1024), kind: optional(string(40)) })]);
define('media:list webview:hard-reload devtools:toggle-webview', [integer]);
define('media:download', [integer, web]);
define('page:save', [integer, string(10), optional(string(500))]);
define('page:capture-full', [integer]);
define('links:check', [value => Array.isArray(value) && value.length <= 2000 && value.every(string(4096))]);
// A freshly attached <webview> reports its id as -1; the handler then finds
// the page by URL (and checks ownership itself), so any integer is allowed.
define('devtools:open-for-webcontents', [value => Number.isInteger(value), optional(web)]);
define('devtools:toggle-host', []);
define('spellcheck:replace-misspelling', [integer, string(1024), optional(web)]);
define('vex:set-bg-throttling', [integer, boolean]);
define('app:tab-memory', [value => Array.isArray(value) && value.length <= 10000 && value.every(integer)]);
define('app:open-as-app', [web, optional(string(4096))]);
define('tor:verify routing:get', [optional(string(160))]);
define('routing:set', [optional(string(160)), oneOf(['direct','tor','proxy']), optional(string(2048))]);
define('discord:set-bypass-mode', [oneOf(['off','light','strong']), optional(shape({ preset: optional(value => Number.isInteger(value)), custom: optional(string(4096)) }))]);
define('discord:install-vencord-local', [optional(string())]);
define('theme:set-custom-image', [optional(value => typeof value === 'string' && value.length <= 12 * 1024 * 1024 && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value))]);
define('site:clear-data', [shape({ url: web, partition: optional(string(160)) })]);
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
define('totp:add', [value => string(16384)(value) || shape({ secret: string(16384), label: optional(string(4096)), issuer: optional(string(4096)) })(value)]);
define('permission:respond', [shape({ id: string(160), decision: oneOf(['allow','deny']), remember: optional(boolean) })]);
define('hid:select-respond', [shape({ id: string(160), deviceId: optional(string(1024)) })]);
define('screen-picker:choose', [shape({ id: string(160), sourceId: optional(string(1024)), audio: optional(boolean), width: optional(value => Number.isInteger(value) && value >= 0 && value <= 16384), height: optional(value => Number.isInteger(value) && value >= 0 && value <= 16384), fps: optional(value => Number.isInteger(value) && value >= 0 && value <= 240) })]);
define('sync-save-meta', [shape({ enabled: optional(boolean), email: optional(string(1024)), sessionToken: string(4096), deviceId: string(160), revision: optional(value => Number.isSafeInteger(value) && value >= 0) })]);
define('cloud:request', [shape({ feature: optional(string(80)) })]);
define('api:request', [shape({ url: web, method: optional(oneOf(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])), headers: optional(object), body: optional(string(8 * 1024 * 1024)), binary: optional(boolean) })]);
define('privacy:set-config', [object]);
define('popup-chrome:action', [shape({ action: string(80) })]);
// Guest compatibility bridges use sender-derived identity; legacy arguments are ignored.
define('geolocation:get geolocation:check-permission compatibility:get privacy:config-sync', [optional(string())]);
function validate(channel, args) {
  if (channel.startsWith('@ghostery/')) return; // Vendor-owned API; the outer policy still bounds JSON and verifies its sender.
  const checks = schemas.get(channel);
  if (!checks) throw new Error('IPC channel has no payload contract: ' + channel);
  if (args.length > checks.length || checks.some((check, index) => !check(args[index]))) throw new Error('Invalid payload for ' + channel);
}
module.exports = { validate, schemas };
