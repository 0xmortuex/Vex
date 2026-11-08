// @vitest-environment node
//
// Supply-chain hygiene: CI actions pinned to commits, the vendored-files hash
// manifest, and the CycloneDX SBOM made from package-lock.json.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const vm = require('../../scripts/vendor-manifest.js');
const sbom = require('../../scripts/gen-sbom.js');
const root = path.join(__dirname, '..', '..');

describe('CI workflow', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'verify.yml'), 'utf8');
  const uses = workflow.split(/\r?\n/).filter(l => /^\s*-?\s*uses:/.test(l));
  it('has actions to pin', () => { expect(uses.length).toBeGreaterThan(0); });
  it.each(uses.map(l => [l.trim()]))('%s is pinned to a full commit SHA with a version comment', (line) => {
    expect(line).toMatch(/uses:\s+[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+# v\d+(?:\.\d+){0,2}\s*$/);
  });
  it('checks the fuses, the vendored files and the SBOM of the packaged build', () => {
    expect(workflow).toMatch(/verify-fuses\.js scratchpad\/ci-package\/win-unpacked/);
    expect(workflow).toMatch(/vendor-manifest\.js --check --asar scratchpad\/ci-package/);
    expect(workflow).toMatch(/gen-sbom\.js --check/);
  });
  it('builds the CI package with fuses (VEX_FUSES) and checks them with the same variable', () => {
    const lines = workflow.split(/\r?\n/);
    const stepAt = (needle) => { const i = lines.findIndex(l => l.includes(needle)); expect(i).toBeGreaterThan(-1); return lines.slice(i, i + 5).join('\n'); };
    expect(stepAt('npm run pack -- --config.directories.output=scratchpad/ci-package')).toMatch(/VEX_FUSES: '1'/);
    expect(stepAt('node scripts/verify-fuses.js scratchpad/ci-package/win-unpacked')).toMatch(/VEX_FUSES: '1'/);
  });
  it('does not use npm ci --ignore-scripts until that is proven (owner decision, RELEASING.md)', () => {
    expect(workflow).toMatch(/- run: npm ci\s*$/m);
    expect(workflow).not.toMatch(/--ignore-scripts/);
  });
});

describe('vendor manifest', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vendor-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), body); };

  it('records every file and finds a changed, a missing and an extra file', () => {
    put('a.js', 'one'); put('runtime/b.mjs', 'two'); put('runtime/c.wasm', Buffer.from([0, 1, 2]));
    const recorded = vm.hashTree(tmp);
    expect(Object.keys(recorded)).toEqual(['a.js', 'runtime/b.mjs', 'runtime/c.wasm']);
    expect(vm.compare(recorded, vm.hashTree(tmp))).toEqual([]);
    put('a.js', 'ONE'); fs.rmSync(path.join(tmp, 'runtime/b.mjs')); put('runtime/evil.js', 'x');
    expect(vm.compare(recorded, vm.hashTree(tmp)).sort()).toEqual(['changed: a.js', 'missing: runtime/b.mjs', 'not in the record: runtime/evil.js']);
  });
  it('is not fooled by a different line ending in a text file, but is by a changed binary', () => {
    put('t.js', 'line1\nline2\n'); put('b.wasm', Buffer.from('a\r\nb'));
    const recorded = vm.hashTree(tmp);
    put('t.js', 'line1\r\nline2\r\n');
    expect(vm.compare(recorded, vm.hashTree(tmp))).toEqual([]);
    put('b.wasm', Buffer.from('a\nb'));
    expect(vm.compare(recorded, vm.hashTree(tmp))).toEqual(['changed: b.wasm']);
  });
  it('the committed record matches the committed vendored files (and the built runtime when it exists)', () => {
    const m = vm.readManifest();
    const dir = path.join(root, 'src', 'renderer', 'vendor');
    const actual = vm.hashTree(dir);
    const built = fs.existsSync(path.join(dir, 'runtime'));
    const keep = (rel) => built || !rel.startsWith('runtime/');
    const recorded = Object.fromEntries(Object.entries(m.files).filter(([rel]) => keep(rel)));
    expect(vm.compare(recorded, Object.fromEntries(Object.entries(actual).filter(([rel]) => keep(rel))))).toEqual([]);
    expect(Object.keys(m.files).some(f => f.startsWith('runtime/'))).toBe(true);
  });
  it('the release boot check runs it on the built app.asar', () => {
    const src = fs.readFileSync(path.join(root, 'scripts', 'verify-packaged-boot.js'), 'utf8');
    expect(src).toMatch(/vendor-manifest\.js'\), '--check', '--asar'/);
  });
  it('refuses to record a tree without the built runtime, and a record it cannot read', () => {
    put('jsQR.js', 'x');
    expect(() => vm.write({ dir: tmp, manifestFile: path.join(tmp, 'm.json') })).toThrow(/not built/);
    expect(() => vm.readManifest(path.join(tmp, 'absent.json'))).toThrow(/cannot read/);
    put('bad.json', '{"v":2}');
    expect(() => vm.readManifest(path.join(tmp, 'bad.json'))).toThrow(/not a vendor manifest/);
  });
});

describe('SBOM', () => {
  const lock = {
    packages: {
      '': { name: 'demo', version: '1.0.0', dependencies: { a: '^1', '@s/b': '^2' }, devDependencies: { d: '^1' } },
      'node_modules/a': { version: '1.2.3', integrity: 'sha512-' + Buffer.alloc(64, 1).toString('base64'), license: 'MIT', dependencies: { c: '^1', '@s/b': '^2' } },
      'node_modules/a/node_modules/c': { version: '1.0.0', license: 'ISC' },
      'node_modules/c': { version: '2.0.0' },
      'node_modules/@s/b': { version: '2.0.1', hasInstallScript: true },
      'node_modules/d': { version: '1.0.0', dev: true },
      'node_modules/linked': { link: true, resolved: 'x' },
    },
  };
  it('describes each package with purl, hash, license and scope', () => {
    const bom = sbom.buildSbom(lock);
    expect(sbom.validate(bom)).toEqual([]);
    const byName = Object.fromEntries(bom.components.map(c => [(c.group ? c.group + '/' : '') + c.name + '@' + c.version, c]));
    expect(byName['a@1.2.3']).toMatchObject({ purl: 'pkg:npm/a@1.2.3', licenses: [{ expression: 'MIT' }], scope: 'required' });
    expect(byName['a@1.2.3'].hashes[0]).toMatchObject({ alg: 'SHA-512', content: '01'.repeat(64) });
    expect(byName['@s/b@2.0.1'].purl).toBe('pkg:npm/%40s/b@2.0.1');
    expect(byName['@s/b@2.0.1'].properties).toContainEqual({ name: 'cdx:npm:package:has-install-script', value: 'true' });
    expect(byName['d@1.0.0'].scope).toBe('optional');
    expect(Object.keys(byName)).not.toContain('linked@undefined');
  });
  it('resolves a dependency to the nearest node_modules, as Node does', () => {
    const bom = sbom.buildSbom(lock);
    const a = bom.dependencies.find(d => d.ref === 'pkg:npm/a@1.2.3');
    expect(a.dependsOn).toContain('pkg:npm/c@1.0.0?path=node_modules%2Fa%2Fnode_modules%2Fc');
    expect(a.dependsOn).not.toContain('pkg:npm/c@2.0.0');
    expect(sbom.resolveDep(lock.packages, '', 'c')).toBe('node_modules/c');
    expect(sbom.resolveDep(lock.packages, 'node_modules/a', 'c')).toBe('node_modules/a/node_modules/c');
    expect(sbom.resolveDep(lock.packages, 'node_modules/a', 'nothing')).toBeNull();
  });
  it('is deterministic, and refuses a lockfile it cannot read', () => {
    expect(JSON.stringify(sbom.buildSbom(lock))).toBe(JSON.stringify(sbom.buildSbom(lock)));
    expect(() => sbom.buildSbom({})).toThrow(/no "packages"/);
  });
  it('describes this repository\'s real lockfile without a dangling reference', () => {
    const text = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    const bom = sbom.buildSbom(JSON.parse(text), { lockText: text.replace(/\r\n/g, '\n') });
    expect(sbom.validate(bom)).toEqual([]);
    expect(bom.components.length).toBeGreaterThan(100);
    expect(bom.components.find(c => c.name === 'electron-builder')).toBeTruthy();
  });
});
