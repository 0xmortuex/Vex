// @vitest-environment node
//
// "Many of your logins look gone" (src/main/mass-signout.js): compares the count of lasting sign-ins between starts,
// fires only on a drop of more than half from at least 6, and cannot fire on a fresh profile or after a deliberate clear.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createMassSignout } = require('../../src/main/mass-signout.js');
const { countPersistent } = require('../../src/main/signed-in.js');

let dir, file, clock, count, dropped, log;
const make = (over = {}) => createMassSignout({ file, now: () => clock, countSignIns: async () => count, newestBackup: () => ({ name: 'auto-daily-x.json', at: 5 }), onDrop: (i) => dropped.push(i), log, ...over });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-mass-'));
  file = path.join(dir, 'signin-baseline.json');
  clock = 1000; count = 0; dropped = []; log = vi.fn();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('when it must not fire', () => {
  it('on a fresh profile: no file, whatever the count', async () => {
    count = 0;
    expect(await make().check()).toMatchObject({ fired: false, why: 'fresh' });
    expect(dropped).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ count: 0, at: 1000 });
  });
  it('when the baseline is under 6, even if everything is gone', async () => {
    count = 5; await make().check();
    count = 0;
    expect((await make().check()).fired).toBe(false);
    expect(dropped).toEqual([]);
  });
  it('for a drop of half or less (10 to 5 is exactly half) but for 10 to 4', async () => {
    count = 10; await make().check();
    count = 5;
    expect((await make().check()).fired).toBe(false);
    count = 10; await make().check();
    count = 6;
    expect((await make().check()).fired).toBe(false);
    count = 10; await make().check();
    count = 4;
    expect((await make().check()).fired).toBe(true);
  });
  it('right after the owner cleared data on purpose, even though the count is now zero', async () => {
    count = 30; await make().check();
    const m = make();
    m.deliberate('clear-all');
    expect(m.read()).toEqual({ count: null, at: 1000 });
    count = 0;
    expect(await make().check()).toMatchObject({ fired: false, why: 'reset' });
    expect(dropped).toEqual([]);
    expect(make().read().count).toBe(0);                // the new normal
  });
  it('does not repeat itself: the next start with the same low count is quiet', async () => {
    count = 20; await make().check();
    count = 2;
    expect((await make().check()).fired).toBe(true);
    expect((await make().check()).fired).toBe(false);
    expect(dropped).toHaveLength(1);
  });
});

describe('when it fires', () => {
  it('reports before, now and the newest valid backup, once', async () => {
    count = 12; await make().check();
    clock = 5000; count = 3;
    const r = await make().check();
    expect(r).toEqual({ fired: true, before: 12, now: 3 });
    expect(dropped).toEqual([{ before: 12, now: 3, since: 1000, backup: { name: 'auto-daily-x.json', at: 5 } }]);
  });
});

describe('what is stored', () => {
  it('one number and one time, never a list of sites', async () => {
    count = 9; await make().check();
    const text = fs.readFileSync(file, 'utf8');
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['at', 'count']);
    expect(text.length).toBeLessThan(60);
    expect(fs.readdirSync(dir)).toEqual(['signin-baseline.json']);        // no temp file left
  });
  it('a baseline that cannot be read is an error, not a fresh start that hides a drop', async () => {
    fs.writeFileSync(file, '{broken');
    await expect(make().check()).rejects.toThrow(/cannot be read/);
    fs.writeFileSync(file, JSON.stringify({ count: 'many', at: 1 }));
    await expect(make().check()).rejects.toThrow(/not in the form/);
    expect(dropped).toEqual([]);
  });
  it('a count that is not a number is an error', async () => {
    count = NaN;
    await expect(make().check()).rejects.toThrow(/not a number/);
  });
  it('a write that fails leaves the old baseline', async () => {
    count = 10; await make().check();
    count = 9;
    const flaky = { ...fs, renameSync: () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); } };
    await expect(make({ fs: flaky }).check()).rejects.toThrow(/EBUSY/);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).count).toBe(10);
    expect(fs.readdirSync(dir)).toEqual(['signin-baseline.json']);
  });
});

describe('in-session refresh', () => {
  it('follows ordinary changes, but a collapse does not become the new normal', async () => {
    count = 10; await make().check();
    const m = make();
    count = 12; await m.refresh();
    expect(m.read().count).toBe(12);
    count = 2; expect(await m.refresh()).toEqual({ kept: true });
    expect(m.read().count).toBe(12);
    // so the next start still reports it
    expect((await make().check()).fired).toBe(true);
  });
  it('waits ten minutes after a deliberate clear so a half-cleared count is not recorded', async () => {
    count = 30; await make().check();
    const m = make();
    m.deliberate('clear-all');
    count = 14; expect(await m.refresh()).toMatchObject({ kept: true, why: 'recent clear' });
    expect(m.read().count).toBe(null);
    clock += 11 * 60 * 1000; count = 0;
    await m.refresh();
    expect(m.read().count).toBe(0);
  });
});

describe('counting (signed-in.js)', () => {
  const now = Date.UTC(2026, 10, 7);
  const c = (domain, name, extra = {}) => ({ domain, name, session: false, expirationDate: now / 1000 + 86400, ...extra });
  it('counts each registrable domain once, only for lasting, unexpired sign-in cookies', () => {
    const by = {
      'persist:main': [c('.github.com', 'user_session'), c('api.github.com', 'logged_in'), c('.example.co.uk', 'sessionid'), c('.a.test', 'sid', { session: true }),
        c('.b.test', 'sessionid', { expirationDate: now / 1000 - 5 }), c('.c.test', '_ga'), c('.d.test', 'csrf_token')],
      'persist:container-work': [c('.github.com', 'auth_token'), c('www.example.co.uk', 'jwt')],
    };
    expect(countPersistent(by, now)).toBe(2);
    expect(countPersistent({}, now)).toBe(0);
    expect(countPersistent(null, now)).toBe(0);
  });
});

describe('the hooks in main.js (every deliberate clearing path)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  it('Clear browsing data and the privacy clean-up reach it through noteAction', () => {
    expect(src).toMatch(/action === 'clear-all' \|\| action === 'privacy-cleanup'\) _massSignoutDeliberate\(action\)/);
    expect(src).toMatch(/ipcMain\.handle\('browsing:clear-data'[\s\S]{0,200}_protect\.signout\.noteAction\('clear-all'\)/);
  });
  it('a forget-this-site sweep, the quit sweep and the app-lock session wipe forget the baseline too', () => {
    expect(src).toMatch(/forgot\.cleared\) _massSignoutDeliberate\('forget-site'\)/);
    expect(src).toMatch(/_massSignoutDeliberate\('forget-site-quit'\);\r?\n\s*_siteForget\.onQuit\(\)/);
    expect(src).toMatch(/clearSessions: async \(\) => \{\r?\n\s*_massSignoutDeliberate\('app-lock-reset'\)/);
  });
});
