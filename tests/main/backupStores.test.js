// @vitest-environment node
//
// The four files only the main process keeps, in the backup (src/main/backup-stores.js), and
// "Test this backup": a restore rehearsal in a temp folder that never touches the live profile.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createBackupStores, drillBackup, cleanDecisions, cleanDisabled, cleanReminderItems } = require('../../src/main/backup-stores.js');
const { createPermissionService } = require('../../src/main/permissions.js');
const SiteRules = require('../../src/main/site-rules.js');
const { VexBackup } = require('../../src/renderer/js/backup.js');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-bstores-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const drillDirs = () => fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('vex-drill-'));

describe('the cleaners', () => {
  it('keeps only allow/deny decisions with an origin::permission key, and drops ones that already ran out', () => {
    const now = 1000;
    const { clean, dropped } = cleanDecisions({
      'https://a.test::camera': 'allow', 'https://b.test::geolocation': 'deny',
      'junk': 'allow', 'https://c.test::midi': 'maybe', 'https://d.test::camera': 'allow',
      __until__: { 'https://a.test::camera': 5000, 'https://d.test::camera': 500, 'https://nope.test::x': 9999 },
    }, now);
    expect(clean).toEqual({ 'https://a.test::camera': 'allow', 'https://b.test::geolocation': 'deny', __until__: { 'https://a.test::camera': 5000 } });
    expect(dropped).toBe(4);
  });
  it('accepts only plain folder names that are installed', () => {
    const { clean, dropped } = cleanDisabled(['ok', '../evil', 'a/b', '', 42, 'gone', 'ok'], new Set(['ok']));
    expect(clean).toEqual(['ok']);
    expect(dropped).toBe(5);
  });
  it('leaves out fired one-off reminders and review reminders', () => {
    const out = cleanReminderItems([
      { id: 'a', message: 'x', at: 1 }, { id: 'b', message: 'y', firedAt: 5 }, { id: 'c', message: 'z', firedAt: 5, repeat: 'daily' },
      { id: 'd', message: 'r', kind: 'review' }, { message: 'no id' }, null,
    ]);
    expect(out.map(r => r.id)).toEqual(['a', 'c']);
  });
});

function fakes() {
  let rules = { 'keep.test': { js: 'off' } };
  const reminders = [{ id: 'r1', message: 'live one', at: 10 }];
  let disabled = new Set(['old-ext']);
  let stores = { main: { 'https://live.test::camera': 'deny' }, containers: {} };
  return {
    state: () => ({ rules, reminders, disabled, stores }),
    deps: {
      SiteRules,
      siteRules: { get: () => rules, set: (r) => { rules = SiteRules.clean(r); } },
      permissions: {
        combined: () => ({ ...stores.main }),
        mainAndContainers: () => JSON.parse(JSON.stringify(stores)),
        merge: async (clean) => { const { __until__, ...rest } = clean; stores = { ...stores, main: { ...stores.main, ...rest } }; return 0; },
        restoreStores: async (before) => { stores = JSON.parse(JSON.stringify(before)); },
      },
      reminders: {
        list: async () => reminders.map(r => ({ ...r })),
        importList: async (items) => { let added = 0; for (const i of items) if (!reminders.some(r => r.id === i.id)) { reminders.push(i); added++; } return { added, updated: 0 }; },
        delete: async (id) => { reminders.splice(reminders.findIndex(r => r.id === id), 1); },
      },
      extensions: { readDisabled: () => disabled, writeDisabled: (l) => { disabled = new Set(l); }, installed: () => new Set(['old-ext', 'new-ext']) },
    },
  };
}

describe('collect, apply and undo', () => {
  it('collects the four stores', async () => {
    const f = fakes();
    const main = await createBackupStores(f.deps).collect();
    expect(Object.keys(main).sort()).toEqual(['extensions', 'permissions', 'reminders', 'site-rules']);
    expect(main['site-rules'].rules).toEqual({ 'keep.test': { js: 'off' } });
    expect(main.permissions.decisions).toEqual({ 'https://live.test::camera': 'deny' });
    expect(main.reminders.items.map(r => r.id)).toEqual(['r1']);
    expect(main.extensions.disabled).toEqual(['old-ext']);
  });

  it('restores through the cleaners, merges over what is there, and undo puts everything back', async () => {
    const f = fakes();
    const s = createBackupStores(f.deps);
    const incoming = {
      'site-rules': { rules: { 'new.test': { cookies: 'off', evil: 'x' }, 'Bad Host!': { js: 'off' } } },
      permissions: { decisions: { 'https://new.test::midi': 'allow', 'bad': 'allow' } },
      reminders: { items: [{ id: 'r2', message: 'from backup', at: 99 }] },
      extensions: { disabled: ['new-ext', 'not-installed'] },
    };
    const r = await s.apply(incoming);
    expect(r.written).toBeGreaterThan(0);
    const st = f.state();
    expect(st.rules).toEqual({ 'keep.test': { js: 'off' }, 'new.test': { cookies: 'off' } });   // cleaned: 'evil' dropped, bad host dropped, live rule kept
    expect(st.stores.main).toEqual({ 'https://live.test::camera': 'deny', 'https://new.test::midi': 'allow' });
    expect(st.reminders.map(x => x.id)).toEqual(['r1', 'r2']);
    expect([...st.disabled].sort()).toEqual(['new-ext', 'old-ext']);
    expect(r.notes.join(' ')).toMatch(/not installed here/);

    await s.undo();
    const back = f.state();
    expect(back.rules).toEqual({ 'keep.test': { js: 'off' } });
    expect(back.stores.main).toEqual({ 'https://live.test::camera': 'deny' });
    expect(back.reminders.map(x => x.id)).toEqual(['r1']);
    expect([...back.disabled]).toEqual(['old-ext']);
    expect(() => s.undo()).rejects.toThrow(/Nothing has been restored/);
  });

  it('a store that fails is named, the others still go back, and undo still works', async () => {
    const f = fakes();
    f.deps.reminders.importList = async () => { throw new Error('reminders are not running'); };
    const s = createBackupStores(f.deps);
    await expect(s.apply({ 'site-rules': { rules: { 'new.test': { js: 'off' } } }, reminders: { items: [{ id: 'x', message: 'm' }] } })).rejects.toThrow(/reminders: reminders are not running/);
    expect(f.state().rules['new.test']).toEqual({ js: 'off' });
    await s.undo();
    expect(f.state().rules).toEqual({ 'keep.test': { js: 'off' } });
  });
});

describe('the real permission service takes restored decisions into the right store', () => {
  it('puts container keys in their container and counts the ones it cannot place', async () => {
    const handlers = new Map();
    const perms = createPermissionService({
      userDataPath: tmp, secureSessions: { owner: () => null, partitionOf: () => 'persist:main' },
      ipcMain: { handle: (c, fn) => handlers.set(c, fn), on: (c, fn) => handlers.set(c, fn) },
    });
    const skipped = await perms.mergeIncomingDecisions({
      'https://a.test::camera': 'allow',
      'https://b.test (in the work container)::geolocation': 'deny',
      'https://c.test (through Tor)::camera': 'deny',
      'https://d.test (somewhere odd)::camera': 'deny',
    });
    await perms.flushPermissions();
    expect(skipped).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'permissions.json'), 'utf8'))).toEqual({ 'https://a.test::camera': 'allow' });
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'permissions-containers.json'), 'utf8'))).toEqual({
      'persist:container-work': { 'https://b.test::geolocation': 'deny' },
      'persist:route-tor': { 'https://c.test::camera': 'deny' },
    });
    // The Settings list sees them as it always did.
    expect(perms.loadPermissionDecisions()['https://b.test (in the work container)::geolocation']).toBe('deny');
    // and a snapshot put back exactly restores the earlier state
    const before = { main: { 'https://z.test::camera': 'allow' }, containers: {} };
    await perms.replaceStores(before);
    await perms.flushPermissions();
    expect(perms.storesSnapshot()).toEqual(before);
  });
});

describe('Test this backup (the rehearsal)', () => {
  const sealed = (extra = {}) => VexBackup.seal({
    v: 2, at: '2026-11-01T10:00:00.000Z', app: '2.60.0',
    items: { 'vex.notes': '[1]', 'vex.theme': 'x', 'vex.lockPin': 'SECRET-HASH' },
    stores: { settings: { a: 1, b: 2 } },
    main: { 'site-rules': { rules: { 'a.test': { js: 'off' }, 'Bad Host!': { js: 'off' } } }, permissions: { decisions: { 'https://a.test::camera': 'allow' } }, reminders: { items: [{ id: 'r', message: 'm' }] }, extensions: { disabled: ['e'] } },
    ...extra,
  });

  it('reports counts per store against the live counts, and removes its temp folder', () => {
    const live = path.join(tmp, 'live');
    fs.mkdirSync(live);
    fs.writeFileSync(path.join(live, 'site-rules.json'), '{"keep.test":{"js":"off"}}');
    const before = fs.readFileSync(path.join(live, 'site-rules.json'), 'utf8');
    const dirsBefore = drillDirs().length;
    const r = drillBackup({ text: JSON.stringify(sealed()), live: { items: 5, stores: { settings: 1 }, main: { 'site-rules': 4, permissions: 0, reminders: 1, extensions: 3 } }, VexBackup, SiteRules });
    expect(r.ok).toBe(true);
    expect(r.integrity).toBe('verified');
    const row = Object.fromEntries(r.rows.map(x => [x.name, x]));
    expect(row.items).toMatchObject({ backup: 2, live: 5, diff: -3 });             // the secret-shaped key is not counted
    expect(row.settings).toMatchObject({ backup: 2, live: 1, diff: 1 });
    expect(row['site-rules']).toMatchObject({ backup: 1, live: 4, diff: -3 });      // the invalid host is not counted
    expect(row.permissions).toMatchObject({ backup: 1, live: 0, diff: 1 });
    expect(row.reminders).toMatchObject({ backup: 1, live: 1, diff: 0 });
    expect(row.extensions).toMatchObject({ backup: 1, live: 3, diff: -2 });
    expect(r.notes.join(' ')).toMatch(/left out as invalid/);
    expect(drillDirs().length).toBe(dirsBefore);
    expect(fs.readFileSync(path.join(live, 'site-rules.json'), 'utf8')).toBe(before);
  });

  it('refuses a damaged backup and says an old one has no checksum', () => {
    const bad = JSON.parse(JSON.stringify(sealed()));
    bad.items['vex.notes'] = '[1,2,3]';
    const r = drillBackup({ text: JSON.stringify(bad), VexBackup, SiteRules });
    expect(r).toMatchObject({ ok: false, integrity: 'damaged' });
    expect(r.error).toMatch(/damaged/);
    const old = drillBackup({ text: JSON.stringify({ v: 1, items: { 'vex.theme': 'x' }, stores: {} }), VexBackup, SiteRules });
    expect(old).toMatchObject({ ok: true, integrity: 'unverified', version: 1 });
    expect(old.rows.map(x => x.name)).toEqual(['items']);
    expect(drillBackup({ text: 'not json', VexBackup, SiteRules }).ok).toBe(false);
    expect(drillBackup({ text: '{"v":9}', VexBackup, SiteRules }).ok).toBe(false);
  });

  it('removes the temp folder even when the rehearsal fails half way (fault injection)', () => {
    const dirsBefore = drillDirs().length;
    let writes = 0;
    const flaky = { ...fs, writeFileSync: (...a) => { if (++writes === 3) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return fs.writeFileSync(...a); } };
    const r = drillBackup({ text: JSON.stringify(sealed()), VexBackup, SiteRules, fs: flaky });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rehearsal failed.*disk full/);
    expect(drillDirs().length).toBe(dirsBefore);
  });

  it('never writes outside its own temp folder', () => {
    const seen = new Set();
    const spy = { ...fs, writeFileSync: (f, ...a) => { seen.add(f); return fs.writeFileSync(f, ...a); }, mkdirSync: (f, ...a) => { seen.add(f); return fs.mkdirSync(f, ...a); } };
    drillBackup({ text: JSON.stringify(sealed()), VexBackup, SiteRules, fs: spy });
    for (const f of seen) expect(path.resolve(f).startsWith(path.join(os.tmpdir(), 'vex-drill-'))).toBe(true);
  });
});
