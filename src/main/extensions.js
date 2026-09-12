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

module.exports = {
  DISABLED_FILE, readMessages, localize, slugFromName, pickIcon, pickPages,
  archiveProblem, disabledPath, readDisabled, writeDisabled
};
