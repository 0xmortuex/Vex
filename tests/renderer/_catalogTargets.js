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
for (const f of fs.readdirSync(jsDir, { recursive: true })) {
  if (!f.endsWith('.js') || /^feature-(catalog|details|manifests)\.js$/.test(f)) continue;
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  for (const m of src.matchAll(/\{\s*id:\s*'([^']+)',\s*label:/g)) commandIds.add(m[1]);
  for (const m of src.matchAll(/\bcmd\('([^']+)',\s*'/g)) commandIds.add(m[1]);
  for (const m of src.matchAll(/VexSettingsGroup\.add\(\s*\{\s*id:\s*'([^']+)'/g)) groupSections.add(m[1]);
  // Older modules mount their own sections, or use VexFun.group(), rather
  // than registering a literal object with the shared Settings builder.
  for (const m of src.matchAll(/\bVexFun\.group\(\s*'([^']+)'/g)) groupSections.add(m[1]);
  // VexMediaKit.register({ id, ... render }) hands straight to VexSettingsGroups.register (render => 'setting-<id>').
  for (const m of src.matchAll(/\bVexMediaKit\.register\(\s*\{\s*id:\s*'([^']+)'/g)) groupSections.add('setting-' + m[1]);
  // A module that builds its own .setting-group and names it with a SETTINGS_ID constant.
  for (const m of src.matchAll(/\bSETTINGS_ID:\s*'([^']+)'/g)) groupSections.add(m[1]);
  for (const m of src.matchAll(/\b([a-zA-Z_$][\w$]*)\.id\s*=\s*'([^']+)'/g)) {
    if (src.includes(m[1] + ".className = 'setting-group'")) groupSections.add(m[2]);
  }
  for (const m of src.matchAll(/(?:VexSettingsGroups|G)\.register\(\s*\{/g)) {
    const head = src.slice(m.index, m.index + 420);
    const literal = /register\(\s*\{\s*id:\s*'([^']+)'/.exec(head);
    const constant = /register\(\s*\{\s*id:\s*(?:this|[\w$]+)\.ID\b/.test(head) && /\bID:\s*'([^']+)'/.exec(src);
    const id = literal?.[1] || constant?.[1];
    if (id && /\b(?:build|render)\s*:/.test(head)) groupSections.add((/\bbuild\s*:/.test(head) ? 'vex-sg-' : 'setting-') + id);
  }
  for (const m of src.matchAll(/VexSettingsGroups\.register\(\s*\{\s*id:\s*'([^']+)',\s*title:\s*'(?:[^'\\]|\\.)*'([\s\S]{0,700}?)\}\s*\)/g)) {
    groupSections.add((/\bbuild\s*:/.test(m[2]) ? 'vex-sg-' : 'setting-') + m[1]);
  }
}

module.exports = { commandIds, groupSections };
