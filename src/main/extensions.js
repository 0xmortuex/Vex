// Pure helpers behind the Chrome-extension manager: manifest localization, the
// install folder slug, icon selection, archive diagnostics and the
// enabled/disabled store. They live here rather than in main.js so they can be
// unit-tested without booting Electron.
//
// Errors are raised, never swallowed: a corrupt _locales file or a corrupt
// state file throws, and the caller records the reason against that extension
// so the manager can show it instead of silently listing a half-broken entry.
const fs = require('fs');
const path = require('path');

const DISABLED_FILE = '.disabled.json';

// Chrome lets any manifest string be a "__MSG_key__" placeholder resolved from
// _locales. Without resolving it, a localized extension lists as the literal
// "__MSG_extName__" — and worse, that text becomes its install folder slug.
function readMessages(extPath, defaultLocale) {
  const locales = [];
  if (typeof defaultLocale === 'string' && defaultLocale) locales.push(defaultLocale);
  if (!locales.includes('en')) locales.push('en');
  for (const locale of locales) {
    const file = path.join(extPath, '_locales', locale, 'messages.json');
    if (!fs.existsSync(file)) continue;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const messages = Object.create(null);
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value.message === 'string') messages[key] = value.message;
    }
    return messages;
  }
  return Object.create(null);
}

// An unknown key keeps its placeholder rather than collapsing to an empty
// string, so a partly-translated extension still shows something identifiable.
function localize(value, messages) {
  if (typeof value !== 'string') return value;
  return value.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (token, key) =>
    (messages && Object.prototype.hasOwnProperty.call(messages, key)) ? messages[key] : token);
}

function slugFromName(name) {
  const slug = String(name || 'extension')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'extension';
}

function _largestIcon(icons) {
  if (typeof icons === 'string') return icons || null;
  if (!icons || typeof icons !== 'object') return null;
  const sizes = Object.keys(icons)
    .map(Number)
    .filter(size => Number.isFinite(size))
    .sort((a, b) => b - a);
  for (const size of sizes) {
    const file = icons[String(size)];
    if (typeof file === 'string' && file) return file;
  }
  return null;
}

// The manager shows the extension's identity icon (manifest.icons); the toolbar
// action icon is the fallback for extensions that only declare one.
function pickIcon(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  return _largestIcon(manifest.icons)
    || _largestIcon(manifest.action && manifest.action.default_icon)
    || _largestIcon(manifest.browser_action && manifest.browser_action.default_icon)
    || null;
}

// The popup/options pages an extension exposes, as manifest-relative paths.
function pickPages(manifest) {
  if (!manifest || typeof manifest !== 'object') return { popup: null, options: null };
  const action = manifest.action || manifest.browser_action || null;
  const popup = action && typeof action.default_popup === 'string' ? action.default_popup : null;
  const optionsUi = manifest.options_ui && typeof manifest.options_ui.page === 'string' ? manifest.options_ui.page : null;
  const options = typeof manifest.options_page === 'string' ? manifest.options_page : optionsUi;
  return { popup: popup || null, options: options || null };
}

// Chrome keeps an action popup between 25x25 and 800x600 and otherwise sizes
// it to its content. Vex used a 160x100 floor and only ever grew the window,
// so Stylus's 246x117 popup sat in an empty 328x464 box (found 2026-09-29).
const POPUP_MIN = 25, POPUP_MAX_W = 800, POPUP_MAX_H = 600;
function clampPopupSize(w, h) {
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new TypeError('clampPopupSize: width and height must be numbers');
  return [Math.min(POPUP_MAX_W, Math.max(POPUP_MIN, Math.ceil(w))), Math.min(POPUP_MAX_H, Math.max(POPUP_MIN, Math.ceil(h)))];
}

// PowerShell's Compress-Archive writes "dir\file" entry names. Chromium (and
// Vex's own zip validator) require "/" separators, so such an archive fails
// with an opaque "Unsafe archive path" — this turns it into an actionable
// message instead of leaving the user to guess.
function archiveProblem(entryNames) {
  if (!Array.isArray(entryNames)) throw new TypeError('archiveProblem: entryNames must be an array');
  if (entryNames.some(name => typeof name === 'string' && name.includes('\\'))) {
    return 'This .zip stores paths with Windows "\\" separators (PowerShell\'s Compress-Archive does that); Chrome extensions need "/" separators. Re-zip the folder with File Explorer (right-click → Send to → Compressed folder), or use "Install from folder" instead.';
  }
  return null;
}

function disabledPath(extensionsDir) {
  return path.join(extensionsDir, DISABLED_FILE);
}

function readDisabled(extensionsDir) {
  const file = disabledPath(extensionsDir);
  if (!fs.existsSync(file)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(parsed)) throw new Error('Extension state file is corrupt: expected an array of folder names');
  return new Set(parsed.filter(name => typeof name === 'string'));
}

function writeDisabled(extensionsDir, folders) {
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(disabledPath(extensionsDir), JSON.stringify([...folders], null, 2));
}

// ---- Where an extension is loaded ------------------------------------------
// The browsing sessions get every extension. The app panels' partitions
// (Discord, Spotify…) get only the ones whose content scripts name that site:
// a generic extension does nothing useful there, and one with a persistent
// background page (Manifest v2 — uBlock Origin) ran one idle copy per
// partition, a process and ~35 MB each, eleven times over. Scope 'everywhere'
// overrides that for an extension the user wants in every panel regardless.
const SCOPE_FILE = 'scope.json';
const BROWSING_PARTITIONS = ['persist:main', 'persist:container-work', 'persist:container-personal', 'persist:container-shopping'];
const APP_PARTITIONS = {
  'persist:discord': ['discord.com', 'discordapp.com'],
  'persist:whatsapp': ['whatsapp.com'],
  'persist:claude': ['claude.ai', 'anthropic.com', 'gemini.google.com', 'chatgpt.com', 'openai.com'],
  'persist:spotify': ['spotify.com'],
  'persist:netflix': ['netflix.com', 'primevideo.com', 'amazon.com', 'disneyplus.com', 'roku.com'],
  'persist:roblox': ['roblox.com'],
};
const GENERIC_MATCH = /^(<all_urls>|\*:\/\/\*\/|https?:\/\/\*\/|file:\/\/)/;

// The sites an extension's content scripts run on: { generic, hosts }.
// generic is true when a pattern matches every site.
function contentHosts(manifest) {
  const hosts = new Set();
  let generic = false;
  const scripts = Array.isArray(manifest && manifest.content_scripts) ? manifest.content_scripts : [];
  for (const cs of scripts) {
    for (const m of (Array.isArray(cs && cs.matches) ? cs.matches : [])) {
      if (typeof m !== 'string') continue;
      if (GENERIC_MATCH.test(m)) { generic = true; continue; }
      const mm = m.match(/^[a-z*]+:\/\/([^/]+)\//i);
      if (mm) hosts.add(mm[1].replace(/^\*\./, '').toLowerCase());
    }
  }
  return { generic, hosts: [...hosts] };
}

function hostMatches(patternHost, appHost) {
  return patternHost === appHost || patternHost.endsWith('.' + appHost) || appHost.endsWith('.' + patternHost);
}

// The partitions (beyond the default session) an extension is loaded into.
function partitionsFor(manifest, scope) {
  const { generic, hosts } = contentHosts(manifest);
  if (scope === 'everywhere') return { partitions: [...BROWSING_PARTITIONS, ...Object.keys(APP_PARTITIONS)], generic, hosts };
  const apps = Object.keys(APP_PARTITIONS).filter(p => APP_PARTITIONS[p].some(a => hosts.some(h => hostMatches(h, a))));
  return { partitions: [...BROWSING_PARTITIONS, ...apps], generic, hosts };
}

function scopePath(extensionsDir) {
  return path.join(extensionsDir, SCOPE_FILE);
}

// { <folder>: 'everywhere' } — only the override is recorded.
function readScopes(extensionsDir) {
  const file = scopePath(extensionsDir);
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Extension scope file is corrupt: expected an object of folder → scope');
  const out = {};
  for (const [k, v] of Object.entries(parsed)) if (v === 'everywhere') out[k] = v;
  return out;
}

function writeScopes(extensionsDir, scopes) {
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(scopePath(extensionsDir), JSON.stringify(scopes, null, 2));
}

// Where an installed extension came from, so it can be fetched again later:
// { <folder>: { webstore: '<32-letter id>' } } for a Web Store install, or
// { <folder>: { catalog: '<catalogue id>', tag, file, digest } } for one
// fetched from its publisher's GitHub releases (main/extension-sources.js).
// A folder with no entry was installed from a file or a folder.
const SOURCES_FILE = 'sources.json';
function sourcesPath(extensionsDir) {
  return path.join(extensionsDir, SOURCES_FILE);
}
function readSources(extensionsDir) {
  const file = sourcesPath(extensionsDir);
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Extension sources file is corrupt: expected an object of folder → source');
  const out = {};
  for (const [folder, src] of Object.entries(parsed)) {
    if (src && typeof src.webstore === 'string' && /^[a-p]{32}$/.test(src.webstore)) out[folder] = { webstore: src.webstore };
    else if (src && typeof src.catalog === 'string' && /^[a-z0-9-]{1,60}$/.test(src.catalog)) {
      const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : null);
      out[folder] = { catalog: src.catalog, tag: str(src.tag), file: str(src.file), digest: str(src.digest) };
    }
  }
  return out;
}

// ---- Access to file:// pages ------------------------------------------------
// Chrome leaves "Allow access to file URLs" off for every extension until the
// person turns it on; Vex loaded every extension with it on (security scan
// M6). fileaccess.json holds { allow: { <folder>: true } }; a folder with no
// entry has no access. The file's absence means Vex has not yet made the
// switch: the first start that sees no file writes one, keeping access only
// for an extension whose manifest names file:// pages itself (its job is
// to work on local files), and records those as `kept` so its card can say so.
const FILE_ACCESS_FILE = 'fileaccess.json';
function fileAccessPath(extensionsDir) {
  return path.join(extensionsDir, FILE_ACCESS_FILE);
}

// The file:// patterns a manifest names (host permissions or content-script
// matches). <all_urls> is not counted: it means "every site", which Chrome
// itself does not take as a wish for local files.
function fileUrlPatterns(manifest) {
  const m = manifest || {};
  const strs = (v) => (Array.isArray(v) ? v.filter(s => typeof s === 'string') : []);
  const out = new Set();
  for (const p of [...strs(m.permissions), ...strs(m.host_permissions), ...strs(m.optional_host_permissions)]) if (/^file:\/\//i.test(p)) out.add(p);
  for (const cs of (Array.isArray(m.content_scripts) ? m.content_scripts : [])) {
    for (const p of strs(cs && cs.matches)) if (/^file:\/\//i.test(p)) out.add(p);
  }
  return [...out];
}

// null when Vex has not written the file yet (see above).
function readFileAccess(extensionsDir) {
  const file = fileAccessPath(extensionsDir);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Extension file-access file is corrupt: expected an object');
  const pick = (o) => {
    const out = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (v === true) out[k] = true;
    return out;
  };
  return { allow: pick(parsed.allow), kept: pick(parsed.kept) };
}

function writeFileAccess(extensionsDir, state) {
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(fileAccessPath(extensionsDir), JSON.stringify({ allow: state.allow || {}, kept: state.kept || {} }, null, 2));
}

// The first state: entries is [{ folder, manifest }] of what is installed.
function migrateFileAccess(entries) {
  const allow = {}, kept = {};
  for (const e of entries || []) {
    if (e && e.manifest && fileUrlPatterns(e.manifest).length) { allow[e.folder] = true; kept[e.folder] = true; }
  }
  return { allow, kept };
}
function writeSources(extensionsDir, sources) {
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(sourcesPath(extensionsDir), JSON.stringify(sources, null, 2));
}

// An update sets the installed copy aside in extensions-replaced/<folder>-<ms>
// until the new one has loaded. Once it has, every set-aside copy of that
// folder goes — one left by an update that was cut short too — and so does
// the folder itself when nothing else is left in it: an empty
// extensions-replaced stayed behind after every update (found 2026-09-29).
function tidyReplaced(backupDir, folder) {
  if (!fs.existsSync(backupDir)) return;
  const mine = new RegExp('^' + String(folder).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d+$');
  for (const n of fs.readdirSync(backupDir).filter(x => mine.test(x))) {
    fs.rmSync(path.join(backupDir, n), { recursive: true, force: true });
  }
  if (!fs.readdirSync(backupDir).length) fs.rmdirSync(backupDir);
}

// ---- chrome.storage.sync in content scripts ---------------------------------
// Electron's storage.sync fails in every context. Vex's stand-in for it
// (vexStorageSyncShim) reaches an extension's pages through
// preload-webview.js and its service worker through preload-extension-sw.js,
// but a content script runs in the extension's own isolated world inside a
// web page, where no preload reaches. Material Icons for GitHub read its
// settings there with storage.sync.get, threw '"sync" is not available in
// this instance of Chrome' and never changed an icon (found 2026-10-04).
// So an extension that keeps storage gets the same shim as a file of its own,
// listed first in each of its content-script entries: it runs before the
// extension's scripts, in their world. A content script in the page's own
// world ("world": "MAIN") has no chrome.storage, and a css-only entry no
// world at all; both are left as they are.
const CONTENT_SHIM_FILE = 'vex-storage-sync.js';
const SHIM_BEGIN = '// === BEGIN vex-storage-sync-shim ===';
const SHIM_END = '// === END vex-storage-sync-shim ===';

// The shim file, from the shim block of a preload's source text (the one copy
// Vex keeps of it; a test holds the two preloads' copies identical).
function contentShimSource(preloadText) {
  const text = String(preloadText || '').replace(/\r\n/g, '\n');
  const start = text.indexOf(SHIM_BEGIN);
  const end = text.indexOf(SHIM_END);
  if (start < 0 || end < start) throw new Error('contentShimSource: the preload has no vex-storage-sync-shim block');
  return '// Written by Vex: chrome.storage.sync for this extension\'s content scripts.\n'
    + '// Electron has no storage.sync; Vex keeps it in storage.local. Vex rewrites this file.\n'
    + text.slice(start, end + SHIM_END.length) + '\n'
    + 'vexStorageSyncShim(typeof chrome !== \'undefined\' ? chrome : null);\n';
}

// { uses, manifest }: uses is whether the extension gets the shim at all (it
// keeps storage and has a content-script entry running JavaScript in its own
// world); manifest is the manifest with the shim listed first in each such
// entry, or null when it already is.
function withContentShim(manifest) {
  const none = { uses: false, manifest: null };
  if (!manifest || typeof manifest !== 'object') return none;
  const perms = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  if (!perms.includes('storage') || !Array.isArray(manifest.content_scripts)) return none;
  const isShim = (f) => typeof f === 'string' && f.replace(/^\.?\//, '') === CONTENT_SHIM_FILE;
  let uses = false, changed = false;
  const scripts = manifest.content_scripts.map((cs) => {
    if (!cs || typeof cs !== 'object' || !Array.isArray(cs.js) || !cs.js.some(f => !isShim(f))) return cs;
    if (String(cs.world || 'ISOLATED').toUpperCase() === 'MAIN') return cs;
    uses = true;
    if (isShim(cs.js[0]) && !cs.js.slice(1).some(isShim)) return cs;
    changed = true;
    return { ...cs, js: [CONTENT_SHIM_FILE, ...cs.js.filter(f => !isShim(f))] };
  });
  return { uses, manifest: changed ? { ...manifest, content_scripts: scripts } : null };
}

module.exports = {
  CONTENT_SHIM_FILE, contentShimSource, withContentShim,
  tidyReplaced, SOURCES_FILE, readSources, writeSources,
  FILE_ACCESS_FILE, fileUrlPatterns, readFileAccess, writeFileAccess, migrateFileAccess,
  DISABLED_FILE, SCOPE_FILE, BROWSING_PARTITIONS, APP_PARTITIONS,
  readMessages, localize, slugFromName, pickIcon, pickPages, clampPopupSize,
  archiveProblem, disabledPath, readDisabled, writeDisabled,
  contentHosts, partitionsFor, readScopes, writeScopes
};
