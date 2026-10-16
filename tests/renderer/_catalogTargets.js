// Shared by the catalogue tests: what other modules add to the command bar and to
// Settings by themselves, which command.js and index.html do not list.
//
//   commandIds     ids of commands added with VexExtras.registerCommand({ id, label ... })
//                  or the dev loop's cmd('id', 'label' ...)
//   groupSections  element ids of Settings sections added with VexSettingsGroups.register
//                  ('vex-sg-<id>' when it has build(), else 'setting-<id>')
const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, '../../src/renderer/js');
const commandIds = new Set();
const groupSections = new Set();
for (const f of fs.readdirSync(jsDir)) {
  if (!f.endsWith('.js') || /^feature-(catalog|details|manifests)\.js$/.test(f)) continue;
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  for (const m of src.matchAll(/\{\s*id:\s*'([^']+)',\s*label:/g)) commandIds.add(m[1]);
  for (const m of src.matchAll(/\bcmd\('([^']+)',\s*'/g)) commandIds.add(m[1]);
  for (const m of src.matchAll(/VexSettingsGroup\.add\(\s*\{\s*id:\s*'([^']+)'/g)) groupSections.add(m[1]);
  for (const m of src.matchAll(/VexSettingsGroups\.register\(\s*\{\s*id:\s*'([^']+)',\s*title:\s*'(?:[^'\\]|\\.)*'([\s\S]{0,700}?)\}\s*\)/g)) {
    groupSections.add((/\bbuild\s*:/.test(m[2]) ? 'vex-sg-' : 'setting-') + m[1]);
  }
}

module.exports = { commandIds, groupSections };
