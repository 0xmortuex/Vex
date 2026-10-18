#!/usr/bin/env node
// Builds docs/FEATURES.md: every Vex feature, grouped, with the Ctrl+K phrase that
// opens it, where its switch is, and whether it starts off.
//
// It is generated, not written: the list of features is the feature manifests
// (src/renderer/js/feature-manifests.js), the one-sentence description is the
// catalogue entry that names the manifest (`feature:` in feature-catalog.js, or an
// entry with the same id), and the Ctrl+K phrases are the labels of the commands
// the manifest lists, read from the source that registers them.
//
//   node scripts/gen-features-doc.js           write docs/FEATURES.md
//   node scripts/gen-features-doc.js --check   exit 1 if docs/FEATURES.md is out of date
//
// A manifest that no catalogue entry describes is an error, so a feature cannot
// be added without a doc line (tests/renderer/featureDocs.test.js).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'src/renderer/js');
const OUT = path.join(ROOT, 'docs/FEATURES.md');

const unq = (s) => s.replace(/\\(['"\\])/g, '$1');

function loadManifests() {
  let all = null;
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'VexRegistry');
  const prev = globalThis.VexRegistry;
  globalThis.VexRegistry = { defineAll: (m) => { all = m; } };
  const file = path.join(JS, 'feature-manifests.js');
  delete require.cache[file];
  try { require(file); } finally {
    if (had) globalThis.VexRegistry = prev; else delete globalThis.VexRegistry;
    delete require.cache[file];
  }
  if (!Array.isArray(all)) throw new Error('feature-manifests.js did not define any manifests');
  return all;
}

function loadCatalog() {
  const file = path.join(JS, 'feature-catalog.js');
  delete require.cache[file];
  const { VexFeatures } = require(file);
  delete require.cache[file];
  return VexFeatures;
}

// Command id -> label, for commands registered with { id, label } or cmd('id', 'label').
function commandLabels() {
  const out = {};
  for (const f of fs.readdirSync(JS)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    for (const m of src.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
      if (!out[m[1]]) out[m[1]] = unq(m[2] !== undefined ? m[2] : m[3]);
    }
    for (const m of src.matchAll(/\bcmd\('([^']+)',\s*'((?:[^'\\]|\\.)*)'/g)) {
      if (!out[m[1]]) out[m[1]] = unq(m[2]);
    }
  }
  return out;
}

const STATE = {
  new: 'New: starts off on an existing profile until you switch it on',
  beta: 'Beta: starts off on an existing profile until you switch it on',
};

// opts.manifests / opts.catalog replace what is read from disk (for the test).
function build(opts = {}) {
  const manifests = opts.manifests || loadManifests();
  const catalog = opts.catalog || loadCatalog();
  const labels = commandLabels();
  const entryOf = new Map();
  for (const item of catalog.ITEMS) {
    if (item.feature && !entryOf.has(item.feature)) entryOf.set(item.feature, item);
  }
  for (const item of catalog.ITEMS) if (!entryOf.has(item.id)) entryOf.set(item.id, item);

  const missing = [];
  const documented = new Set();
  const byCat = new Map(catalog.CATS.map(c => [c.id, []]));
  for (const m of manifests) {
    const item = entryOf.get(m.id);
    if (!item || !item.what) { missing.push(m.id); continue; }
    documented.add(item.id);
    const cmds = (m.commands || []).filter(c => labels[c]).map(c => '"' + labels[c] + '"');
    const itemCmd = item.cmd && labels[item.cmd] && !(m.commands || []).includes(item.cmd) ? ['"' + labels[item.cmd] + '"'] : [];
    const phrases = cmds.concat(itemCmd);
    const where = [];
    if (phrases.length) where.push('Ctrl+K: ' + phrases.join(', '));
    if (item.where) where.push('Settings > ' + item.where);
    else if (item.setting && item.setting.label) where.push('Settings > ' + item.setting.label);
    else if (m.group) where.push('Settings > ' + m.group);
    if (!where.length) {
      const named = /Settings (?:>|›) ([^.;,]+)/.exec(item.what);
      where.push(named ? 'Settings > ' + named[1].trim() : 'no command; it works by itself');
    }
    const state = STATE[m.maturity] || (m.killSwitch === 'none' ? 'always on, no switch' : '');
    const line = [
      '- **' + (item.name || m.title) + '** (`' + m.id + '`): ' + item.what.replace(/\s+/g, ' ').trim(),
      item.id !== m.id ? '  - Catalogue: (`' + item.id + '`).' : '',
      '  - Open: ' + where.join('; ') + '.',
      state ? '  - Default: ' + state + '.' : '',
    ].filter(Boolean).join('\n');
    (byCat.get(item.cat) || byCat.get('unique')).push(line);
  }
  if (missing.length) {
    const err = new Error('Feature manifests with no catalogue entry (add `feature: \'<id>\'` to an entry in feature-catalog.js): ' + missing.join(', '));
    err.missing = missing;
    throw err;
  }

  // Older built-in features also belong in the reference, even when they
  // have no manifest. Do not silently reduce "all features" to new modules.
  for (const item of catalog.ITEMS) {
    if (documented.has(item.id)) continue;
    const where = [];
    if (item.cmd) where.push('Ctrl+K: "' + (labels[item.cmd] || item.name || item.id) + '"');
    if (item.panel) where.push('sidebar panel: ' + item.panel);
    if (item.setting) where.push('Settings > ' + (item.setting.label || item.setting.id || item.setting.section));
    if (!where.length) where.push('Library > ' + (item.name || item.id) + ' > How it works');
    const line = '- **' + (item.name || item.id) + '** (`' + item.id + '`): ' + item.what.replace(/\s+/g, ' ').trim()
      + '\n  - Open: ' + where.join('; ') + '.';
    (byCat.get(item.cat) || byCat.get('unique')).push(line);
  }

  const parts = [
    '# Vex features',
    '',
    'Generated by `node scripts/gen-features-doc.js` from the feature manifests and the catalogue. Do not edit by hand: change the manifest or the catalogue entry and run the script again. `tests/renderer/featureDocs.test.js` fails when this file is out of date or a manifest has no line.',
    '',
    'How to read it: `Ctrl+K` is the command bar; type the quoted phrase. "Settings > X" is the section whose heading starts with X. A feature marked New starts switched off on a profile that already existed (a brand-new profile uses the feature\'s own default).',
    '',
  ];
  let total = 0;
  for (const c of catalog.CATS) {
    const lines = byCat.get(c.id);
    if (!lines.length) continue;
    total += lines.length;
    parts.push('## ' + c.name, '', c.blurb, '', lines.join('\n'), '');
  }
  parts.splice(4, 0, 'Features listed: ' + total + '.', '');
  return { text: parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', manifests, catalog: catalog.ITEMS, missing, total };
}

function main() {
  const check = process.argv.includes('--check');
  const { text, total } = build();
  const norm = (s) => s.replace(/\r\n/g, '\n');
  if (check) {
    const have = fs.existsSync(OUT) ? norm(fs.readFileSync(OUT, 'utf8')) : '';
    if (have !== text) {
      console.error('docs/FEATURES.md is out of date. Run: node scripts/gen-features-doc.js');
      process.exit(1);
    }
    console.log('docs/FEATURES.md is up to date (' + total + ' features).');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log('Wrote docs/FEATURES.md (' + total + ' features).');
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(err.message); process.exit(1); }
}
module.exports = { build };
