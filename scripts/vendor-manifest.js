#!/usr/bin/env node
// A hash manifest for src/renderer/vendor (the third-party code Vex ships:
// jsQR, and the runtimes `npm run build:vendor` copies out of node_modules).
//
//   node scripts/vendor-manifest.js --write            record the tree as it is now
//   node scripts/vendor-manifest.js --check            compare src/renderer/vendor with the record
//   node scripts/vendor-manifest.js --check --asar <app.asar>   compare the vendor files inside a built app.asar
//
// Why: these files run in the browser's own windows. If a dependency bump, a
// compromised install or a stray file changes one, nobody reads 60 MB of
// minified code in a diff; a hash list in git makes the change visible and
// makes the release check fail until a human has run --write and looked at the
// diff of scripts/vendor-manifest.json. verify-packaged-boot.js runs the --asar
// form on the app that is about to be uploaded; CI runs the plain form.
//
// The record lives in scripts/vendor-manifest.json: relative path -> SHA-256.
// Reads only; --write is the only thing that writes, and only that one file.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const VENDOR = path.join(root, 'src', 'renderer', 'vendor');
const MANIFEST = path.join(__dirname, 'vendor-manifest.json');
const IN_ASAR = 'src/renderer/vendor/';

// Text files are hashed with LF line endings: git may check a text file out with CRLF (autocrlf, Windows CI), and the
// copy inside a built app.asar has whatever the build machine had. The bytes that matter do not differ by that.
const TEXT = /\.(?:js|mjs|css|json|md|txt)$|(?:^|\/)[^/.]*LICENSE[^/.]*$/i;
const sha256 = (buf, rel = '') => {
  const body = TEXT.test(rel) ? Buffer.from(buf.toString('latin1').split('\r\n').join('\n'), 'latin1') : buf;
  return crypto.createHash('sha256').update(body).digest('hex');
};

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

// { rel: sha256 } for a folder on disk.
function hashTree(dir = VENDOR) {
  const files = {};
  for (const rel of walk(dir)) files[rel] = sha256(fs.readFileSync(path.join(dir, rel)), rel);
  return files;
}
// { rel: sha256 } for the vendor files inside a built app.asar.
function hashAsar(asarFile) {
  const asar = require('@electron/asar');
  const files = {};
  for (const entry of asar.listPackage(asarFile)) {
    const rel = String(entry).replace(/\\/g, '/').replace(/^\//, '');
    if (!rel.startsWith(IN_ASAR)) continue;
    try { files[rel.slice(IN_ASAR.length)] = sha256(asar.extractFile(asarFile, rel.split('/').join(path.sep)), rel.slice(IN_ASAR.length)); }
    catch (err) { if (!/directory or link/i.test(String(err && err.message))) throw err; }   // listPackage also lists folders
  }
  return files;
}

// What differs between the recorded files and the actual ones.
function compare(recorded, actual) {
  const problems = [];
  for (const [rel, hash] of Object.entries(recorded)) {
    if (!(rel in actual)) problems.push('missing: ' + rel);
    else if (actual[rel] !== hash) problems.push('changed: ' + rel);
  }
  for (const rel of Object.keys(actual)) if (!(rel in recorded)) problems.push('not in the record: ' + rel);
  return problems;
}

function readManifest(file = MANIFEST) {
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { throw new Error('cannot read ' + path.relative(root, file) + ' (' + err.message + '). Run: node scripts/vendor-manifest.js --write'); }
  if (!m || m.v !== 1 || !m.files || typeof m.files !== 'object') throw new Error(path.relative(root, file) + ' is not a vendor manifest');
  return m;
}

function check({ asarFile = null, dir = VENDOR, manifestFile = MANIFEST } = {}) {
  const m = readManifest(manifestFile);
  const actual = asarFile ? hashAsar(asarFile) : hashTree(dir);
  const problems = compare(m.files, actual);
  return { ok: problems.length === 0, problems, count: Object.keys(m.files).length };
}

function write({ dir = VENDOR, manifestFile = MANIFEST } = {}) {
  const files = hashTree(dir);
  if (!Object.keys(files).some(f => f.startsWith('runtime/'))) throw new Error('src/renderer/vendor/runtime is not built; run `npm run build:vendor` first so the record covers it');
  fs.writeFileSync(manifestFile, JSON.stringify({ v: 1, note: 'SHA-256 of every file under src/renderer/vendor. Regenerate with: node scripts/vendor-manifest.js --write (after `npm run build:vendor`) and READ the diff.', files }, null, 1) + '\n');
  return Object.keys(files).length;
}

function main(argv = process.argv.slice(2)) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes('--write')) { console.log('vendor-manifest: recorded ' + write() + ' files in scripts/vendor-manifest.json'); return; }
  if (!argv.includes('--check')) throw new Error('usage: vendor-manifest.js --write | --check [--asar <app.asar>]');
  const r = check({ asarFile: arg('--asar') ? path.resolve(arg('--asar')) : null });
  if (!r.ok) {
    console.error('vendor-manifest: the vendored third-party files differ from scripts/vendor-manifest.json:');
    for (const p of r.problems.slice(0, 40)) console.error('  - ' + p);
    if (r.problems.length > 40) console.error('  ... and ' + (r.problems.length - 40) + ' more');
    console.error('If you changed a dependency on purpose: npm run build:vendor, node scripts/vendor-manifest.js --write, read the diff, commit it.');
    process.exit(1);
  }
  console.log('vendor-manifest: ' + r.count + ' vendored files match the record' + (arg('--asar') ? ' (inside app.asar)' : ''));
}

if (require.main === module) {
  try { main(); } catch (err) { console.error('vendor-manifest: ' + ((err && err.message) || err)); process.exit(1); }
}

module.exports = { hashTree, hashAsar, compare, check, write, readManifest, IN_ASAR };
