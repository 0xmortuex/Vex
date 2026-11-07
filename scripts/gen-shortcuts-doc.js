#!/usr/bin/env node
// Writes docs/KEYBOARD-SHORTCUTS.md: the master table of every key Vex answers,
// built from the code that answers it (the renderer's shortcut registry and the
// main process's key rules), so the table cannot drift from the keys.
//
//   node scripts/gen-shortcuts-doc.js          rewrite the file
//   node scripts/gen-shortcuts-doc.js --check  exit 1 if the file is out of date
//
// tests/renderer/shortcutMaster.test.js runs the --check half, so adding or moving a key
// without regenerating the table fails the build.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'KEYBOARD-SHORTCUTS.md');
const Registry = require(path.join(ROOT, 'src/renderer/js/shortcuts-registry.js'));
const Guest = require(path.join(ROOT, 'src/main/guest-shortcuts.js'));

// Keys the registry does not list: main.js answers them itself, or a window of
// Vex does (src/main/window-keys.js, app.js). `fixedKeys()` supplies the names
// for the rest; these add the ones it leaves out.
const EXTRA = [
  ['F12', 'Developer tools of the Vex window (docked)', 'main.js handleWindowKeys (window-keys.js)', 'Vex window and every page in it'],
  ['Ctrl+Shift+F12', 'Developer tools of the Vex window (own window)', 'main.js handleWindowKeys (window-keys.js)', 'Vex window and every page in it'],
  ['Ctrl+Shift+J', 'Developer tools of the page or panel in front', 'main.js handleWindowKeys (window-keys.js)', 'Vex window and every page in it'],
  ['Ctrl+Shift+I', 'Developer tools of the tab in front (toggle)', 'main.js handleDevToolsShortcut -> devtools:toggle-request', 'Vex window and every page in it'],
  ['Ctrl+Shift+N', 'Notes', 'main.js (window) and guest-shortcuts.js PAGE_FIRST (page)', 'Vex window; in a page when the page leaves it alone'],
  ['Escape', 'Close the overlay, popup or sheet in front', 'each overlay’s own key handler', 'whatever is open'],
];

function wantedKeys(all) {
  // The window sends every key that has a handler; here no handler is registered, so take them all.
  const out = new Set(Object.values(all).map(d => d.current));
  for (const k of ['Ctrl+Alt+1', 'Ctrl+Alt+2', 'Ctrl+Alt+3']) out.add(k);
  return out;
}

function parse(combo) {
  const parts = combo.split('+');
  let key = parts.pop();
  if (key === '') { key = '+'; parts.pop(); }
  const named = { Left: 'ArrowLeft', Right: 'ArrowRight', Space: ' ' };
  let k = named[key] || key;
  const shift = parts.includes('Shift');
  if (k.length === 1) k = shift ? k.toUpperCase() : k.toLowerCase();
  return { type: 'keyDown', key: k, control: parts.includes('Ctrl'), alt: parts.includes('Alt'), shift, meta: false };
}

// Keys main.js takes from a page in a handler of its own (not guest-shortcuts.js shortcutFor).
const TAKEN_BY_MAIN = {
  'Ctrl+K': 'taken before the page (not on discord.com or slack.com)',
  'Ctrl+Alt+D': 'taken before the page',
  'F11': 'taken before the page',
  'F12': 'taken before the page',
  'Ctrl+Shift+F12': 'taken before the page',
  'Ctrl+Shift+J': 'taken before the page',
  'Ctrl+Shift+I': 'taken before the page',
  'Ctrl+Alt+H': 'taken before the page (works while Vex is hidden, Windows-wide)',
  'Ctrl+Tab': 'taken before the page',
  'Ctrl+Shift+Tab': 'taken before the page',
};

// How a key reaches Vex while a web page has the focus.
function pageRoute(combo, wanted) {
  if (TAKEN_BY_MAIN[combo]) return TAKEN_BY_MAIN[combo];
  const input = parse(combo);
  const hit = Guest.shortcutFor(input, { wanted });
  if (hit) return hit.channel === 'guest-shortcut' ? 'passed up before the page' : 'taken before the page';
  if (input.control && !input.alt && /^[a-zA-Z0-9]$/.test(input.key)) {
    const p = Guest.pageShortcut({ key: input.key.toLowerCase(), shift: input.shift }, { wanted });
    if (p) return 'the page has it first';
  }
  return 'not reachable from a page';
}

function documentedIn(combo, sources) {
  const where = [];
  if (sources.readme.includes('`' + combo + '`')) where.push('README');
  if (sources.faq.includes(combo)) where.push('FAQ');
  if (sources.commands.includes("shortcut: '" + combo + "'")) where.push('Ctrl+K hint');
  return where.length ? where.join(', ') : 'Settings list only';
}

function buildRows() {
  const all = Registry.getAllShortcuts();
  const wanted = wantedKeys(all);
  const sources = {
    readme: fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'),
    faq: fs.readFileSync(path.join(ROOT, 'src/renderer/js/faq-data.js'), 'utf8'),
    commands: fs.readFileSync(path.join(ROOT, 'src/renderer/js/command.js'), 'utf8'),
  };
  const rows = [];
  for (const [id, d] of Object.entries(all)) {
    let where;
    if (d.system) where = 'main.js before-input-event (Vex window) + registry';
    else if (d.cmd) where = 'registry runs Ctrl+K command `' + d.cmd + '`';
    else where = 'registry handler in app.js';
    rows.push({ combo: d.current, id, action: d.label, category: d.category, where, page: pageRoute(d.current, wanted), documented: documentedIn(d.current, sources), rebind: d.system ? 'fixed' : 'yes' });
  }
  const fixed = Registry.fixedKeys();
  const listed = new Set(rows.map(r => r.combo));
  for (const [combo, label] of Object.entries(fixed)) {
    if (listed.has(combo) || /^Ctrl\+[1-9]$/.test(combo)) continue;
    rows.push({ combo, id: '-', action: label, category: 'Fixed', where: 'main.js / app.js, outside the registry', page: pageRoute(combo, wanted), documented: documentedIn(combo, sources), rebind: 'fixed' });
  }
  rows.push({ combo: 'Ctrl+1 ... Ctrl+9', id: '-', action: 'Go to tab 1 ... 8 / the last tab (9)', category: 'Fixed', where: 'main.js (window) + guest-shortcuts.js (page)', page: 'taken before the page', documented: 'README', rebind: 'fixed' });
  for (const [combo, action, where, ctx] of EXTRA) {
    if (listed.has(combo) || fixed[combo]) continue;
    rows.push({ combo, id: '-', action, category: 'Fixed', where, page: ctx, documented: documentedIn(combo, sources), rebind: 'fixed' });
  }
  return rows;
}

function render() {
  const rows = buildRows();
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const out = [
    '# Keyboard shortcuts: the master table',
    '',
    '<!-- Generated by scripts/gen-shortcuts-doc.js. Do not edit by hand: change the key, then run `node scripts/gen-shortcuts-doc.js`. tests/renderer/shortcutMaster.test.js fails when this file is out of date. -->',
    '',
    'Every key Vex answers, read from the code that answers it.',
    '',
    '- **Where handled**: the registry (`src/renderer/js/shortcuts-registry.js`, handlers in `app.js`) fires a key while Vex’s own interface has the focus. A fixed key is also taken by `src/main.js` (`before-input-event`) first.',
    '- **In a web page**: how the key reaches Vex while a page has the focus (`src/main/guest-shortcuts.js`, `src/preload-webview.js`). *Taken before the page*: the page never hears it. *Passed up before the page*: sent to the registry as the key, so a rebinding holds. *The page has it first*: the page’s own handler runs first and Vex acts only when the page left the key alone (Ctrl+B is bold in an editor, Ctrl+Shift+M mutes you in Discord).',
    '- **Text fields**: every registry key needs Ctrl or Alt or is a function key, so none of them types a letter away. Editing keys (Ctrl+C/V/X/A/Z/Y, Ctrl+Backspace, Ctrl+Left/Right, ...) cannot be bound.',
    '- **AltGr keyboards (Turkish Q, German, French, Polish...)**: Windows reports AltGr as Ctrl+Alt, so AltGr+Q types `@` and AltGr+E `€`. A Ctrl+Alt letter is read from the physical key (`event.code`) when AltGr changed the key (`altGrLetter` in `shortcuts-registry.js` and `guest-shortcuts.js`, and the page preload for pages), so Ctrl+Alt+Q still means the key cap Q. Inside a text field that character is typed instead and the shortcut stays quiet; elsewhere it fires. On Turkish Q AltGr types a character on A, E, Q, S, T (and I); German: E, M, Q; French AZERTY: E.',
    '- **Rebind**: Settings > Keyboard Shortcuts. *fixed* keys are answered by the main process and keep their key.',
    '',
    '| Key | Action | Id | Where handled | In a web page | Rebind | Documented in |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) out.push('| `' + esc(r.combo) + '` | ' + esc(r.action) + ' | ' + r.id + ' | ' + esc(r.where) + ' | ' + r.page + ' | ' + r.rebind + ' | ' + esc(r.documented) + ' |');
  out.push('');
  return out.join('\n');
}

module.exports = { buildRows, render, DOC };

if (require.main === module) {
  const text = render();
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : '';
    if (have.replace(/\r\n/g, '\n') !== text) { console.error('docs/KEYBOARD-SHORTCUTS.md is out of date: run node scripts/gen-shortcuts-doc.js'); process.exit(1); }
    console.log('docs/KEYBOARD-SHORTCUTS.md is up to date');
  } else {
    fs.writeFileSync(DOC, text);
    console.log('wrote ' + path.relative(ROOT, DOC) + ' (' + text.split('\n').length + ' lines)');
  }
}
