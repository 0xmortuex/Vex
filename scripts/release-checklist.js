#!/usr/bin/env node
// Turns one CHANGELOG entry into a hand-check list (T0-002): one "do this,
// expect that" line per bullet. Read-only; changes no repository file unless
// --out is given.
//
//   node scripts/release-checklist.js                 the newest CHANGELOG entry, as markdown
//   node scripts/release-checklist.js 22.24.6         that version
//   node scripts/release-checklist.js 22.24.6 --out release-check-22.24.6.md
//   node scripts/release-checklist.js --json          the parsed items
//
// The same parser runs inside Vex (Settings › Release check, Ctrl+K "Release
// check", src/renderer/js/release-checklist.js), where each line also gets a
// tick box and a Try it button.
'use strict';

const fs = require('fs');
const path = require('path');
const { VexReleaseChecklist } = require('../src/renderer/js/release-checklist.js');
const { parseChangelogEntry } = require('../src/main-helpers.js');

const ROOT = path.resolve(__dirname, '..');

function entryFor(changelog, version) {
  const md = String(changelog || '');
  const wanted = version || (/^## v(\d+\.\d+\.\d+)/m.exec(md) || [])[1];
  if (!wanted) throw new Error('CHANGELOG.md has no "## vX.Y.Z" entry');
  const entry = parseChangelogEntry(md, wanted);
  // parseChangelogEntry falls back to the first entry when the version is missing: that is wrong here.
  if (!entry || entry.version.replace(/^v/, '') !== wanted) throw new Error(`CHANGELOG.md has no entry for v${wanted}`);
  return entry;
}

function main(argv = process.argv.slice(2)) {
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
  if (argv.includes('--out') && !out) throw new Error('--out needs a file name');
  const version = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
  const entry = entryFor(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version && version.replace(/^v/, ''));
  const text = argv.includes('--json')
    ? JSON.stringify(VexReleaseChecklist.build(entry), null, 2) + '\n'
    : VexReleaseChecklist.markdown(entry);
  if (out) { fs.writeFileSync(path.resolve(out), text); console.log('wrote ' + path.resolve(out)); }
  else process.stdout.write(text);
}

module.exports = { entryFor };

if (require.main === module) {
  try { main(); } catch (err) { console.error('release-checklist: ' + err.message); process.exitCode = 1; }
}
