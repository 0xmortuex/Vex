// === Extension keyboard shortcuts (chrome.commands) ===
//
// An extension names its commands in its manifest, each with a suggested key
// ("Ctrl+Shift+Y", per platform). Chrome binds those keys for it, lets you
// change or remove them, and tells the extension through
// chrome.commands.onCommand; "_execute_action" opens its toolbar popup.
//
// Here a key is written the way Vex's own shortcut registry writes one
// ("Ctrl+Shift+Y", modifiers in the order Ctrl, Alt, Shift), so the two can
// be compared. A key Vex itself answers is never given to an extension: Vex's
// shortcut keeps working and the extension's is shown as taken, as Chrome
// refuses a key the browser uses. Main (main.js) holds the bindings and fires
// them from the window's and every page's before-input-event, before the page
// hears the key, as Chrome does with an extension's shortcut.

const { PLAIN, SHIFTED, PAGE_FIRST } = require('./guest-shortcuts');

// The commands that open the toolbar button's popup (or fire its onClicked).
const ACTION_COMMANDS = new Set(['_execute_action', '_execute_browser_action', '_execute_page_action']);

// Chrome's key names → the key as Vex writes it.
const NAMED = {
  Comma: ',', Period: '.', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Space: 'Space', Insert: 'Insert', Delete: 'Delete', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right',
};
const TO_CHROME = { ',': 'Comma', '.': 'Period' };

// "Ctrl+Shift+Y" (Chrome's way) → { combo } in Vex's way, or { error }.
function normalizeKey(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 60) return { error: 'no key' };
  const parts = text.split('+').map(s => s.trim());
  if (parts.some(p => !p)) return { error: `"${text}" is not a key` };
  const keyPart = parts.pop();
  const mods = new Set();
  for (const m of parts) {
    if (m === 'Ctrl' || m === 'Command' || m === 'MacCtrl') mods.add('Ctrl');
    else if (m === 'Alt') mods.add('Alt');
    else if (m === 'Shift') mods.add('Shift');
    else if (m === 'Search') return { error: `${text} uses the Search key, which Windows keyboards do not have` };
    else return { error: `"${m}" is not a modifier key` };
  }
  let key;
  if (/^[A-Za-z]$/.test(keyPart)) key = keyPart.toUpperCase();
  else if (/^[0-9]$/.test(keyPart)) key = keyPart;
  else if (/^F([1-9]|1[0-2])$/.test(keyPart)) key = keyPart;
  else if (Object.prototype.hasOwnProperty.call(NAMED, keyPart)) key = NAMED[keyPart];
  else if (/^Media(NextTrack|PlayPause|PrevTrack|Stop)$/.test(keyPart)) return { error: `${text} is a media key, which Vex does not give extensions` };
  else return { error: `"${keyPart}" is not a key an extension shortcut can use` };
  return checkCombo(comboOf(mods, key));
}

function comboOf(mods, key) {
  const out = [];
  if (mods.has('Ctrl')) out.push('Ctrl');
  if (mods.has('Alt')) out.push('Alt');
  if (mods.has('Shift')) out.push('Shift');
  out.push(key);
  return out.join('+');
}

// Chrome's rules for an extension's key: Ctrl or Alt with a key, not both
// (Ctrl+Alt is AltGr on many keyboards, and typing would set it off).
function checkCombo(combo) {
  const parts = combo.split('+');
  const has = (m) => parts.slice(0, -1).includes(m);
  if (!has('Ctrl') && !has('Alt')) return { error: `${toChrome(combo)} needs Ctrl or Alt` };
  if (has('Ctrl') && has('Alt')) return { error: `${toChrome(combo)} uses Ctrl and Alt together, which is AltGr on many keyboards` };
  return { combo };
}

// Vex's way → Chrome's way, for chrome.commands.getAll and the settings page.
function toChrome(combo) {
  if (!combo) return '';
  const parts = combo.split('+');
  const key = parts.pop();
  return parts.concat(TO_CHROME[key] || key).join('+');
}

// The key pressed, from before-input-event's input (or a keydown in the
// settings page: { key, code, ctrl, alt, shift }). The physical key decides,
// so Ctrl+Shift+1 is not read as Ctrl+Shift+!.
function comboFromInput(input) {
  if (!input) return '';
  const key = String(input.key || '');
  if (!key || ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(key)) return '';
  const code = String(input.code || '');
  let k = '';
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) k = m[1];
  else if ((m = /^Digit([0-9])$/.exec(code))) k = m[1];
  else if (code === 'Comma') k = ',';
  else if (code === 'Period') k = '.';
  else if (/^F([1-9]|1[0-2])$/.test(code)) k = code;
  else if (key === ' ' || code === 'Space') k = 'Space';
  else if (key.startsWith('Arrow')) k = key.slice(5);
  else if (['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].includes(key)) k = key;
  else if (/^[a-z0-9]$/i.test(key)) k = key.toUpperCase();
  else if (/^F([1-9]|1[0-2])$/.test(key)) k = key;
  else if (key === ',' || key === '.') k = key;
  if (!k) return '';
  const mods = new Set();
  if (input.control || input.ctrl || input.meta) mods.add('Ctrl');
  if (input.alt) mods.add('Alt');
  if (input.shift) mods.add('Shift');
  return comboOf(mods, k);
}

// Keys Vex answers in main.js itself (the window's and the pages'
// before-input-event), or that belong to the page or to Windows. The renderer's
// own shortcuts arrive separately (main.js _guestWantedKeys).
const FIXED_VEX_KEYS = (() => {
  const keys = new Map();
  const add = (combo, label) => { if (!keys.has(combo)) keys.set(combo, label); };
  const LABELS = {
    'new-tab': 'New Tab', 'close-tab': 'Close Tab', 'focus-address-bar': 'Focus URL Bar', 'reload-tab': 'Reload Page',
    'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out', 'zoom-reset': 'Reset Zoom', 'reopen-last-closed': 'Reopen Closed Tab',
    'toggle-tabs-sidebar': 'Toggle Tabs Sidebar', 'toggle-history': 'History Panel', 'toggle-mute-tab': 'Mute Tab',
    'bookmark-current': 'Bookmark Page', 'print-page': 'Print Page', 'view-source': 'View Page Source',
    'toggle-sessions': 'Sessions Menu', 'toggle-split': 'Split Screen', 'sleep-current-tab': 'Sleep Tab',
    'toggle-ai-panel': 'Toggle AI Panel', 'toggle-memory': 'Memory Panel', 'toggle-schedules': 'Schedules Panel',
    'toggle-history-ai': 'Open History in AI Search',
  };
  const keyName = (k) => (k.length === 1 ? k.toUpperCase() : k);
  for (const [k, ch] of Object.entries(PLAIN)) add('Ctrl+' + keyName(k), LABELS[ch] || ch);
  for (const [k, ch] of Object.entries(SHIFTED)) add('Ctrl+Shift+' + keyName(k), LABELS[ch] || ch);
  for (const [k, ch] of Object.entries(PAGE_FIRST.plain)) add('Ctrl+' + keyName(k), LABELS[ch] || ch);
  for (const [k, ch] of Object.entries(PAGE_FIRST.shifted)) add('Ctrl+Shift+' + keyName(k), LABELS[ch] || ch);
  for (let n = 1; n <= 9; n++) add('Ctrl+' + n, 'Go to tab ' + n);
  [['Ctrl+K', 'Command Bar'], ['Ctrl+F', 'Find in Page'], ['Ctrl+Shift+N', 'Notes'], ['Ctrl+Shift+P', 'Picture-in-Picture'],
    ['Ctrl+Shift+R', 'Hard Reload'], ['Ctrl+Shift+I', 'Developer tools'], ['Ctrl+Shift+J', 'Developer tools'], ['Ctrl+Shift+C', 'Developer tools'],
    ['Ctrl+Tab', 'Next Tab'], ['Ctrl+Shift+Tab', 'Previous Tab'],
    ['Alt+Left', 'Back'], ['Alt+Right', 'Forward'], ['Alt+F4', 'Close the window'], ['Alt+Space', 'the Windows window menu'],
    ['Ctrl+C', 'Copy'], ['Ctrl+V', 'Paste'], ['Ctrl+X', 'Cut'], ['Ctrl+A', 'Select all'], ['Ctrl+Z', 'Undo'], ['Ctrl+Y', 'Redo'], ['Ctrl+S', 'the page’s Save'],
  ].forEach(([c, l]) => add(c, l));
  return keys;
})();

// The commands a manifest names: [{ name, description, suggested, suggestedError }].
function parseCommands(manifest) {
  const commands = manifest && manifest.commands;
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) return [];
  const out = [];
  for (const name of Object.keys(commands).slice(0, 100)) {
    const c = commands[name] && typeof commands[name] === 'object' ? commands[name] : {};
    const s = c.suggested_key;
    let text = null;
    if (typeof s === 'string') text = s;
    else if (s && typeof s === 'object') text = typeof s.windows === 'string' ? s.windows : (typeof s.default === 'string' ? s.default : null);
    let suggested = null, suggestedError = null;
    if (text) { const r = normalizeKey(text); suggested = r.combo || null; suggestedError = r.error || null; }
    const description = typeof c.description === 'string' ? c.description : (ACTION_COMMANDS.has(name) ? 'Activate the extension' : '');
    out.push({ name, description, suggested, suggestedError, global: c.global === true });
  }
  return out;
}

// Which key each command of each extension has now.
//   extensions: [{ folder, id, name, manifest, localize? }], in a fixed order;
//     localize(text) turns a "__MSG_name__" description into its words
//   overrides:  { [folder]: { [command]: combo | '' } } — '' is "no key"
//   vexKeyLabel(combo): the Vex shortcut on that key, or null
// → { byCombo: Map(combo → { folder, id, command }), byFolder: { [folder]: [row] } }
//   row: { name, description, shortcut, suggested, source, conflict, conflictWith }
function resolve(extensions, overrides, vexKeyLabel) {
  const byCombo = new Map();
  const byFolder = {};
  const owner = new Map(); // combo → extension name holding it
  const rows = [];
  for (const ext of extensions) {
    byFolder[ext.folder] = [];
    for (const cmd of parseCommands(ext.manifest)) {
      const mine = overrides && overrides[ext.folder] && Object.prototype.hasOwnProperty.call(overrides[ext.folder], cmd.name) ? overrides[ext.folder][cmd.name] : undefined;
      const description = typeof ext.localize === 'function' ? (ext.localize(cmd.description) || cmd.description) : cmd.description;
      const row = { name: cmd.name, description, shortcut: '', suggested: cmd.suggested ? toChrome(cmd.suggested) : '',
        suggestedError: cmd.suggestedError, source: mine === undefined ? (cmd.suggested ? 'suggested' : 'none') : (mine ? 'user' : 'removed'),
        conflict: null, conflictWith: null, want: mine === undefined ? cmd.suggested : (mine || null) };
      byFolder[ext.folder].push(row);
      rows.push({ ext, row });
    }
  }
  // Keys you chose first, then the suggested ones, in extension order.
  for (const pass of ['user', 'suggested']) {
    for (const { ext, row } of rows) {
      if (row.source !== pass || !row.want) continue;
      const vex = vexKeyLabel(row.want);
      if (vex) { row.conflict = 'vex'; row.conflictWith = vex; continue; }
      if (owner.has(row.want)) { row.conflict = 'extension'; row.conflictWith = owner.get(row.want); continue; }
      owner.set(row.want, ext.name);
      byCombo.set(row.want, { folder: ext.folder, id: ext.id, command: row.name });
      row.shortcut = toChrome(row.want);
    }
  }
  for (const { row } of rows) delete row.want;
  return { byCombo, byFolder };
}

// The keys you chose, beside the extensions: { [folder]: { [command]: combo | '' } }.
const OVERRIDES_FILE = 'shortcuts.json';
function readOverrides(extensionsDir) {
  const fs = require('fs');
  const file = require('path').join(extensionsDir, OVERRIDES_FILE);
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The extension shortcuts file is corrupt: expected an object of folder → shortcuts');
  const out = {};
  for (const [folder, cmds] of Object.entries(parsed)) {
    if (!cmds || typeof cmds !== 'object' || Array.isArray(cmds)) continue;
    for (const [name, combo] of Object.entries(cmds)) {
      if (combo !== '' && !(typeof combo === 'string' && checkCombo(combo).combo)) continue;
      (out[folder] = out[folder] || {})[name] = combo;
    }
  }
  return out;
}
function writeOverrides(extensionsDir, data) {
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(extensionsDir, { recursive: true });
  const file = path.join(extensionsDir, OVERRIDES_FILE);
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
}

module.exports = { ACTION_COMMANDS, FIXED_VEX_KEYS, OVERRIDES_FILE, normalizeKey, checkCombo, toChrome, comboFromInput, parseCommands, resolve, readOverrides, writeOverrides };
