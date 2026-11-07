#!/usr/bin/env node
// A software bill of materials for Vex: CycloneDX 1.5 JSON, made from
// package-lock.json alone (no network, no npm, no install).
//
//   node scripts/gen-sbom.js                  print the SBOM to standard output
//   node scripts/gen-sbom.js --out sbom.json  write it to a file
//   node scripts/gen-sbom.js --check          build it, validate its shape, print the component count
//
// Every package in the lockfile becomes a component with its exact version, a
// package URL (purl), the lockfile's SHA-512 integrity as a hash, its license
// when the lockfile records one, and `dev` packages are marked optional (they
// are build tools, not shipped). The dependency graph is resolved the way Node
// finds modules (nearest node_modules first). The output is deterministic: no
// timestamp, and a serial number derived from the lockfile's own hash, so the
// same lockfile always gives the same file (a diff means the dependencies moved).
//
// What it is not: it lists what the lockfile pins (what `npm ci` installs), not
// the vendored copies in src/renderer/vendor (scripts/vendor-manifest.js covers
// those) and not Electron's own bundled Chromium.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// "node_modules/@a/b/node_modules/c" -> "c"; "node_modules/@a/b" -> "@a/b"
function nameOf(key) {
  const i = key.lastIndexOf('node_modules/');
  return i < 0 ? '' : key.slice(i + 'node_modules/'.length);
}
const purl = (name, version) => 'pkg:npm/' + (name.startsWith('@') ? '%40' + name.slice(1) : name) + '@' + encodeURIComponent(version);

function integrityToHash(integrity) {
  const m = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(String(integrity || ''));
  return m ? [{ alg: 'SHA-512', content: Buffer.from(m[1], 'base64').toString('hex') }] : [];
}

// The lockfile key that `name` resolves to from the package at `fromKey`.
function resolveDep(packages, fromKey, name) {
  let base = fromKey;
  for (;;) {
    const candidate = (base ? base + '/' : '') + 'node_modules/' + name;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const i = base.lastIndexOf('/node_modules/');
    base = i < 0 ? '' : base.slice(0, i);
  }
}

function buildSbom(lock, { lockText = JSON.stringify(lock) } = {}) {
  if (!lock || !lock.packages || typeof lock.packages !== 'object') throw new Error('package-lock.json has no "packages" (lockfileVersion 2 or 3 is needed)');
  const packages = lock.packages;
  const rootPkg = packages[''] || {};
  const hex = crypto.createHash('sha256').update(lockText).digest('hex');
  const serial = `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  const ref = (key) => purl(nameOf(key), packages[key].version) + (key.split('node_modules/').length > 2 ? '?path=' + encodeURIComponent(key) : '');
  const keys = Object.keys(packages).filter(k => k && nameOf(k) && !packages[k].link);
  keys.sort();
  const components = keys.map(key => {
    const p = packages[key];
    const name = nameOf(key);
    const c = { type: 'library', 'bom-ref': ref(key), name, version: p.version || '0.0.0', purl: purl(name, p.version || '0.0.0') };
    if (name.startsWith('@')) { c.group = name.split('/')[0]; c.name = name.split('/')[1]; }
    const hashes = integrityToHash(p.integrity);
    if (hashes.length) c.hashes = hashes;
    if (typeof p.license === 'string' && p.license) c.licenses = [{ expression: p.license }];
    c.scope = p.dev ? 'optional' : 'required';
    const props = [];
    if (p.dev) props.push({ name: 'cdx:npm:package:development', value: 'true' });
    if (p.optional) props.push({ name: 'cdx:npm:package:optional', value: 'true' });
    if (p.hasInstallScript) props.push({ name: 'cdx:npm:package:has-install-script', value: 'true' });
    if (p.resolved && !/^https:\/\/registry\.npmjs\.org\//.test(p.resolved)) props.push({ name: 'cdx:npm:package:resolved', value: String(p.resolved) });
    if (props.length) c.properties = props;
    return c;
  });
  const rootRef = purl(rootPkg.name || 'vex', rootPkg.version || '0.0.0');
  const deps = [];
  const edges = (key, p) => {
    const names = Object.keys({ ...(p.dependencies || {}), ...(p.optionalDependencies || {}) });
    return [...new Set(names.map(n => resolveDep(packages, key, n)).filter(Boolean).map(ref))].sort();
  };
  deps.push({ ref: rootRef, dependsOn: [...new Set(Object.keys({ ...(rootPkg.dependencies || {}), ...(rootPkg.devDependencies || {}), ...(rootPkg.optionalDependencies || {}) }).map(n => resolveDep(packages, '', n)).filter(Boolean).map(ref))].sort() });
  for (const key of keys) deps.push({ ref: ref(key), dependsOn: edges(key, packages[key]) });
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: serial,
    version: 1,
    metadata: {
      component: { type: 'application', 'bom-ref': rootRef, name: rootPkg.name || 'vex', version: rootPkg.version || '0.0.0', purl: rootRef },
      tools: { components: [{ type: 'application', name: 'vex scripts/gen-sbom.js' }] },
    },
    components,
    dependencies: deps,
  };
}

// Shape problems a consumer would trip over; [] when fine.
function validate(bom) {
  const problems = [];
  if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.5') problems.push('not a CycloneDX 1.5 document');
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(bom.serialNumber)) problems.push('bad serialNumber');
  const refs = new Set(bom.components.map(c => c['bom-ref']));
  if (refs.size !== bom.components.length) problems.push('duplicate bom-ref');
  for (const c of bom.components) if (!c.name || !c.version || !c.purl) problems.push('incomplete component ' + JSON.stringify(c.name));
  const known = new Set([...refs, bom.metadata.component['bom-ref']]);
  for (const d of bom.dependencies) {
    if (!known.has(d.ref)) problems.push('dependency of unknown ' + d.ref);
    for (const t of d.dependsOn) if (!known.has(t)) problems.push('depends on unknown ' + t);
  }
  return problems;
}

function main(argv = process.argv.slice(2)) {
  const lockFile = path.join(root, 'package-lock.json');
  const text = fs.readFileSync(lockFile, 'utf8');
  const bom = buildSbom(JSON.parse(text), { lockText: text.replace(/\r\n/g, '\n') });
  const problems = validate(bom);
  if (problems.length) throw new Error('the SBOM is not valid: ' + problems.slice(0, 5).join('; '));
  const outAt = argv.indexOf('--out');
  if (argv.includes('--check')) { console.log(`gen-sbom: ${bom.components.length} components, ${bom.dependencies.length} dependency entries, valid`); return; }
  const json = JSON.stringify(bom, null, 2) + '\n';
  if (outAt >= 0) {
    if (!argv[outAt + 1]) throw new Error('--out needs a file name');
    fs.mkdirSync(path.dirname(path.resolve(argv[outAt + 1])), { recursive: true });
    fs.writeFileSync(argv[outAt + 1], json);
    console.log(`gen-sbom: wrote ${bom.components.length} components to ${argv[outAt + 1]}`);
  } else process.stdout.write(json);
}

if (require.main === module) {
  try { main(); } catch (err) { console.error('gen-sbom: ' + ((err && err.message) || err)); process.exit(1); }
}

module.exports = { buildSbom, validate, resolveDep, nameOf, purl };
