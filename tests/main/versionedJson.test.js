// @vitest-environment node
//
// J2: the unversioned stores are read through unwrap(), so a later release can write { v, data } without the
// older shape or a downgrade misreading it. Nothing writes the envelope today (no on-disk format change).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const { isEnvelope, unwrap, versionOf, wrap } = require('../../src/main/versioned-json.js');
const { createHidGrants } = require('../../src/main/hid-grants.js');
const { loadSiteRules } = require('../../src/main/site-rules-store.js');
const SiteRules = require('../../src/main/site-rules.js');
const { createPermissionHygiene } = require('../../src/main/permission-hygiene.js');
const { loadSidebarConfig } = require('../../src/sidebar-config.js');

describe('the envelope helper', () => {
  it('reads both shapes', () => {
    expect(unwrap({ 'https://a.example::camera': 'allow' })).toEqual({ 'https://a.example::camera': 'allow' });
    expect(unwrap({ v: 2, data: { 'https://a.example::camera': 'allow' } })).toEqual({ 'https://a.example::camera': 'allow' });
    expect(unwrap([1, 2])).toEqual([1, 2]);
    expect(unwrap({ v: 3, data: [1, 2] })).toEqual([1, 2]);
    expect(unwrap(null)).toBe(null);
    expect(versionOf({ v: 3, data: [] })).toBe(3);
    expect(versionOf([])).toBe(0);
  });
  it('only an object that is exactly { v: whole number, data } is an envelope', () => {
    expect(isEnvelope({ v: 1, data: {} })).toBe(true);
    expect(isEnvelope({ v: 1, data: {}, extra: 1 })).toBe(false);   // a store that merely has a "data" field
    expect(isEnvelope({ v: '1', data: {} })).toBe(false);
    expect(isEnvelope({ v: 0, data: {} })).toBe(false);
    expect(isEnvelope({ v: 1.5, data: {} })).toBe(false);
    expect(isEnvelope({ data: {} })).toBe(false);
    expect(isEnvelope([])).toBe(false);
    expect(isEnvelope('x')).toBe(false);
  });
  it('wrap makes the envelope and refuses a bad version', () => {
    expect(wrap([1], 2)).toEqual({ v: 2, data: [1] });
    expect(() => wrap([1], 0)).toThrow(/whole number/);
  });
});

describe('the readers accept the bare shape and the envelope', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vj-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const put = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));

  it('hid-grants.json', () => {
    const grants = { 'persist:main::https://a.example': [{ vendorId: 1, productId: 2 }] };
    for (const value of [grants, { v: 2, data: grants }]) {
      put('hid-grants.json', value);
      expect(createHidGrants({ userDataPath: dir }).isGranted('persist:main', 'https://a.example', 1, 2)).toBe(true);
    }
  });

  it('site-rules.json', () => {
    const rules = { 'a.example': { cookies: 'off' } };
    const file = path.join(dir, 'site-rules.json');
    put('site-rules.json', rules);
    const bare = loadSiteRules({ file, clean: SiteRules.clean });
    put('site-rules.json', { v: 2, data: rules });
    const wrapped = loadSiteRules({ file, clean: SiteRules.clean });
    expect(bare.outcome).toBe('ok');
    expect(wrapped.outcome).toBe('ok');
    expect(wrapped.rules).toEqual(bare.rules);
  });

  it('permission-hygiene.json', () => {
    const saved = { config: { enabled: true, expiryDays: 14 }, pins: {} };
    put('permission-hygiene.json', saved);
    const a = createPermissionHygiene({ file: path.join(dir, 'permission-hygiene.json') });
    put('permission-hygiene.json', { v: 2, data: saved });
    const b = createPermissionHygiene({ file: path.join(dir, 'permission-hygiene.json') });
    expect(a.getConfig()).toMatchObject({ enabled: true, expiryDays: 14 });
    expect(b.getConfig()).toEqual(a.getConfig());
  });

  it('sidebar-config.json', () => {
    put('sidebar-config.json', { aiNewsUrl: 'https://news.example/' });
    const bare = loadSidebarConfig(dir);
    put('sidebar-config.json', { v: 2, data: { aiNewsUrl: 'https://news.example/' } });
    expect(loadSidebarConfig(dir)).toEqual(bare);
    expect(bare.aiNewsUrl).toBe('https://news.example/');
  });
});

describe('the other readers use the helper (permissions, recall, privacy, downloaded files)', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  it('each parse of those files goes through unwrap', () => {
    expect(read('src/main/permissions.js')).toMatch(/unwrap\(JSON\.parse\(fs\.readFileSync\(permissionsFile/);
    expect(read('src/main/downloads.js')).toMatch(/unwrap\(JSON\.parse\(fs\.readFileSync\(_knownFile\(\)/);
    expect(read('src/main.js')).toMatch(/unwrap\(JSON\.parse\(fs\.readFileSync\(PRIVACY_FILE\(\)/);
    expect(read('src/main.js')).toMatch(/unwrap\(JSON\.parse\(fsx\.readFileSync\(RECALL_FILE\(\)/);
  });
});
