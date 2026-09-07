const data = require('../renderer/js/data-contracts');
const string = (max = 8192) => value => typeof value === 'string' && value.length <= max;
const optional = check => value => value == null || check(value);
const boolean = value => typeof value === 'boolean';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value > 0;
const web = value => data.url(value, true);
const oneOf = values => value => values.includes(value);
const shape = fields => value => object(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
const schemas = new Map();
function define(names, checks) { for (const name of names.split(' ')) schemas.set(name, checks); }
define('window-minimize window-maximize window-close storage:flushed storage:flush-failed storage:flush browsing:clear-data get-start-page-path get-start-page-url get-user-data-path persist-get-all adblocker-get-state app:metrics close-pip-window is-pip-open oauth-popup:dismiss screen-share:get-quality recall:clear privacy:get-config privacy:tracker-stats privacy:tracker-reset vault:list vault:health totp:list totp:codes permissions:renderer-ready permissions:list permissions:clear-all hid:renderer-ready downloads:open-folder toggle-fullscreen is-fullscreen open-private-window identity:create tor:create check-for-updates widevine:status widevine:retry download-update install-update get-app-version updates:list app:restart app:focus fx:rates theme:get-custom-image set-as-default-browser is-default-browser sidebar-config:get extensions:list extensions:install-folder extensions:install-zip extensions:open-folder discord:install-vencord sync-load-key sync-load-meta sync-clear-state pip:close pip:toggle-pin pip:back-to-tab', []);
define('web-suggest qr:make qr:generate recall:search permissions:revoke updates:notes totp:delete extensions:uninstall downloads:open-file downloads:show-in-folder vault:get', [string()]);
define('rss:fetch open-pip-window open-external', [web]);
define('adblocker-set-state discord:set-bypass roblox:set-bypass', [boolean]);
define('gui-style:set', [oneOf(['classic','glass'])]);
define('cloud:token-save', [string(4096)]);
define('sync-save-key', [value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)]);
define('persist-set', [string(170), string(12 * 1024 * 1024)]);
define('persist-delete storage-load', [string(170)]);
define('storage-save', [string(64), value => value !== undefined]);
define('storage:history-add', [shape({ url: web, title: optional(string(4096)) })]);
define('media:list webview:hard-reload devtools:toggle-webview', [integer]);
define('media:download', [integer, web]);
define('devtools:open-for-webcontents', [integer, optional(web)]);
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
define('vault:save', [shape({ host: string(253), username: string(4096), password: string(16384) })]);
define('vault:delete', [shape({ host: string(253), username: string(4096) })]);
define('totp:add', [value => string(16384)(value) || shape({ secret: string(16384), label: optional(string(4096)), issuer: optional(string(4096)) })(value)]);
define('permission:respond', [shape({ id: string(160), decision: oneOf(['allow','deny']), remember: optional(boolean) })]);
define('hid:select-respond', [shape({ id: string(160), deviceId: optional(string(1024)) })]);
define('screen-picker:choose', [shape({ id: string(160), sourceId: optional(string(1024)), audio: optional(boolean), width: optional(value => Number.isInteger(value) && value >= 0 && value <= 16384), height: optional(value => Number.isInteger(value) && value >= 0 && value <= 16384), fps: optional(value => Number.isInteger(value) && value >= 0 && value <= 240) })]);
define('sync-save-meta', [shape({ enabled: optional(boolean), email: optional(string(1024)), sessionToken: string(4096), deviceId: string(160), revision: optional(value => Number.isSafeInteger(value) && value >= 0) })]);
define('cloud:request', [shape({ feature: optional(string(80)) })]);
define('api:request', [shape({ url: web, method: optional(oneOf(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])), headers: optional(object), body: optional(string(8 * 1024 * 1024)) })]);
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
