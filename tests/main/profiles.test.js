// Profiles (src/main/profiles.js): each profile is a whole userData folder of
// its own. These tests hold the parts that would lose or mix up someone's data
// if they were wrong — the default profile's folder never moves, a profile is
// chosen before anything reads userData, a running profile is never deleted,
// and two profiles' reminder tasks never share a name.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const req = createRequire(import.meta.url);
const P = req('../../src/main/profiles.js');
const { taskName, registerScript, unregisterScript, unregisterScopeScript } = req('../../src/main/os-schedule.js');
const { createNotifier } = req('../../src/main/notify.js');
const { validate } = req('../../src/main/ipc-schemas.js');

let tmp, defaultDir;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-profiles-'));
  defaultDir = path.join(tmp, 'Roaming', 'Vex');
  fs.mkdirSync(defaultDir, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

let ids;
const store = (extra = {}) => {
  ids = ['p-aaaaaaa1', 'p-bbbbbbb2', 'p-ccccccc3'];
  return P.createProfileStore({ fs, defaultDir, now: () => 1000, randomId: () => ids.shift(), ...extra });
};

describe('which profile a launch asks for', () => {
  it('reads --profile=<id>, and the profile a toast button carries', () => {
    expect(P.profileArg(['vex.exe'])).toBe(null);
    expect(P.profileArg(['vex.exe', '--profile=p-12345678'])).toBe('p-12345678');
    expect(P.profileArg(['vex.exe', 'vex://snooze/r1?profile=p-12345678'])).toBe('p-12345678');
    expect(P.profileArg(['vex.exe', 'vex://open/r1'])).toBe(null);
    // A web link that happens to say profile= is not a Vex profile.
    expect(P.profileArg(['vex.exe', 'https://example.com/?profile=p-12345678'])).toBe(null);
  });
  it('keeps extra profiles beside the default folder, never inside it', () => {
    expect(P.rootFor('C:\\Users\\u\\AppData\\Roaming\\Vex')).toBe(path.join('C:\\Users\\u\\AppData\\Roaming', 'Vex Profiles'));
  });
});

describe('the profile list', () => {
  it('has only the default profile, in the folder Vex always used, until one is added', () => {
    const s = store();
    expect(s.list()).toEqual([{ id: 'default', name: 'Default', color: '#6366f1', icon: 'user', created: 0, isDefault: true, dir: defaultDir }]);
    expect(fs.existsSync(s.registryFile)).toBe(false);
  });

  it('adds a profile with its own folder in Vex Profiles', () => {
    const s = store();
    const p = s.create({ name: '  Work ', color: '#0EA5E9', icon: 'briefcase' });
    expect(p).toMatchObject({ id: 'p-aaaaaaa1', name: 'Work', color: '#0ea5e9', icon: 'briefcase', created: 1000, isDefault: false });
    expect(p.dir).toBe(path.join(tmp, 'Roaming', 'Vex Profiles', 'p-aaaaaaa1'));
    expect(fs.statSync(p.dir).isDirectory()).toBe(true);
    expect(s.list().map(x => x.id)).toEqual(['default', 'p-aaaaaaa1']);
  });

  it('refuses a profile without a name, with a bad colour or icon, and too long a name', () => {
    const s = store();
    expect(() => s.create({ name: '   ' })).toThrow(/needs a name/);
    expect(() => s.create({ name: 'x', color: 'red' })).toThrow(/colour/);
    expect(() => s.create({ name: 'x', icon: '<svg>' })).toThrow(/icon/);
    expect(() => s.create({ name: 'x'.repeat(41) })).toThrow(/at most 40/);
    expect(s.list()).toHaveLength(1);
  });

  it('renames and recolours a profile, the default one included, without moving its folder', () => {
    const s = store();
    const p = s.create({ name: 'Work' });
    s.update(p.id, { name: 'Office', color: '#ef4444' });
    s.update('default', { name: 'Home', icon: 'home' });
    const [d, o] = s.list();
    expect(d).toMatchObject({ id: 'default', name: 'Home', icon: 'home', dir: defaultDir });
    expect(o).toMatchObject({ name: 'Office', color: '#ef4444', dir: p.dir });
  });

  it('says so when profiles.json is damaged, instead of acting as if there were no profiles', () => {
    const s = store();
    fs.mkdirSync(path.dirname(s.registryFile), { recursive: true });
    fs.writeFileSync(s.registryFile, '{ not json');
    expect(() => s.list()).toThrow(/damaged/);
  });
});

describe('deleting a profile', () => {
  it('removes its whole folder and its entry', () => {
    const s = store();
    const p = s.create({ name: 'Work' });
    fs.writeFileSync(path.join(p.dir, 'vex-persist.json'), '{}');
    s.remove(p.id, { currentId: 'default' });
    expect(fs.existsSync(p.dir)).toBe(false);
    expect(s.list().map(x => x.id)).toEqual(['default']);
  });

  it('never deletes the default profile, the one asking, or one that is open', () => {
    const s = store();
    const p = s.create({ name: 'Work' });
    expect(() => s.remove('default', { currentId: p.id })).toThrow(/default profile cannot be deleted/);
    expect(() => s.remove(p.id, { currentId: p.id })).toThrow(/cannot delete itself/);
    // An open profile: Chromium's lockfile there cannot be opened for writing.
    fs.writeFileSync(path.join(p.dir, 'lockfile'), '');
    const busyFs = { ...fs, openSync: (f, flags) => { if (/lockfile$/.test(f)) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return fs.openSync(f, flags); } };
    const busy = P.createProfileStore({ fs: busyFs, defaultDir });
    expect(busy.isRunning(p.id)).toBe(true);
    expect(() => busy.remove(p.id, { currentId: 'default' })).toThrow(/is open/);
    expect(fs.existsSync(p.dir)).toBe(true);
  });

  it('reads a lockfile left by a Vex that has gone as not running', () => {
    const s = store();
    const p = s.create({ name: 'Work' });
    expect(s.isRunning(p.id)).toBe(false);
    fs.writeFileSync(path.join(p.dir, 'lockfile'), '');
    expect(s.isRunning(p.id)).toBe(false);
  });
});

describe('choosing the profile at launch', () => {
  const fakeApp = () => {
    const paths = { userData: defaultDir };
    return { paths, getPath: (k) => paths[k], setPath: (k, v) => { paths[k] = v; } };
  };
  it('leaves userData alone for the default profile', () => {
    const app = fakeApp();
    const r = P.selectProfile({ app, argv: ['vex.exe'], fs });
    expect(r).toMatchObject({ id: 'default', dir: defaultDir });
    expect(app.paths.userData).toBe(defaultDir);
    expect(P.selectProfile({ app, argv: ['vex.exe', '--profile=default'], fs }).id).toBe('default');
  });
  it('points userData at a known profile', () => {
    const p = store().create({ name: 'Work' });
    const app = fakeApp();
    const r = P.selectProfile({ app, argv: ['vex.exe', '--profile=' + p.id], fs });
    expect(r.id).toBe(p.id);
    expect(app.paths.userData).toBe(p.dir);
  });
  it('refuses a profile that does not exist, or an id that is not one', () => {
    const app = fakeApp();
    expect(() => P.selectProfile({ app, argv: ['vex.exe', '--profile=p-99999999'], fs })).toThrow(/no longer exists/);
    expect(() => P.selectProfile({ app, argv: ['vex.exe', '--profile=..\\..\\Windows'], fs })).toThrow(/not a Vex profile/);
    expect(app.paths.userData).toBe(defaultDir);
  });
});

describe('starting a profile', () => {
  it('repeats --user-data-dir, and gives the development binary its app folder', () => {
    expect(P.launchArgs({ id: 'p-12345678', packaged: true, appPath: 'x', argv: ['Vex.exe'] })).toEqual(['--profile=p-12345678']);
    expect(P.launchArgs({ id: 'p-12345678', packaged: false, appPath: 'C:\\app', argv: ['e.exe', '.', '--user-data-dir=C:\\T\\Vex', '--remote-debugging-port=1'], extra: ['--vex-close-for-update'] }))
      .toEqual(['C:\\app', '--user-data-dir=C:\\T\\Vex', '--profile=p-12345678', '--vex-close-for-update']);
  });
  it('gives each extra profile its own taskbar identity, and the default none', () => {
    expect(P.appDetails({ id: 'default', name: 'Default', execPath: 'Vex.exe', packaged: true, argv: [] })).toBe(null);
    expect(P.appDetails({ id: 'p-12345678', name: 'Work', execPath: 'C:\\Program Files\\Vex\\Vex.exe', packaged: true, argv: [] })).toEqual({
      appId: 'com.vex.browser.profile.p-12345678', appIconPath: 'C:\\Program Files\\Vex\\Vex.exe', appIconIndex: 0,
      relaunchCommand: '"C:\\Program Files\\Vex\\Vex.exe" --profile=p-12345678', relaunchDisplayName: 'Vex (Work)',
    });
  });
  it('makes a desktop shortcut named after the profile that starts it', () => {
    const s = P.shortcutSpec({ id: 'p-12345678', name: 'Work: "A/B"', execPath: 'C:\\V\\Vex.exe', packaged: true, argv: [], desktopDir: 'C:\\D' });
    expect(s.file).toBe(path.join('C:\\D', 'Vex (Work AB).lnk'));
    expect(s.options).toMatchObject({ target: 'C:\\V\\Vex.exe', args: '--profile=p-12345678', appUserModelId: 'com.vex.browser.profile.p-12345678' });
  });
});

describe('an update with several profiles open', () => {
  it('writes down the profiles to reopen, and the default profile reads them once', () => {
    const s = store();
    const a = s.create({ name: 'A' });
    const b = s.create({ name: 'B' });
    s.noteReopen([a.id, b.id, 'default', a.id], '2.35.2');
    expect(s.takeReopen()).toEqual([a.id, b.id]);
    expect(s.takeReopen()).toEqual([]);
  });
  it('ignores a list from an update that never happened, and profiles deleted since', () => {
    let t = 1000;
    const s = P.createProfileStore({ fs, defaultDir, now: () => t, randomId: (() => { const q = ['p-aaaaaaa1', 'p-bbbbbbb2']; return () => q.shift(); })() });
    const a = s.create({ name: 'A' });
    s.noteReopen([a.id, 'p-77777777'], '1');
    expect(s.takeReopen()).toEqual([a.id]);
    s.noteReopen([a.id], '1');
    t += P.REOPEN_MAX_AGE_MS + 1;
    expect(s.takeReopen()).toEqual([]);
  });
});

describe('reminder tasks per profile (main/os-schedule.js)', () => {
  const at = new Date(2026, 8, 13, 14, 46);
  const packaged = { execPath: 'C:\\V\\Vex.exe', appPath: 'x', packaged: true };
  it('keeps the default profile\'s task names, and names the others apart', () => {
    expect(taskName('r1')).toBe('Vex Reminder r1');
    expect(taskName('r1', 'p-12345678')).toBe('Vex Reminder p-12345678 r1');
    expect(() => taskName('r1', "p-1'; x")).toThrow(/not safe/);
    const script = registerScript({ ...packaged, id: 'r1', at, scope: 'p-12345678', extraArgs: ['--profile=p-12345678'] });
    expect(script).toContain("-TaskName 'Vex Reminder p-12345678 r1'");
    expect(script).toContain("-Argument '--profile=p-12345678 --reminder=r1'");
    expect(unregisterScript('r1', 'p-12345678')).toContain("'Vex Reminder p-12345678 r1'");
  });
  it('removes every task of a deleted profile and nothing else', () => {
    const s = unregisterScopeScript('p-12345678');
    expect(s).toContain(".StartsWith('Vex Reminder p-12345678 ')");
    expect(() => unregisterScopeScript('default')).toThrow(/not safe/);
  });
});

describe('a toast from an extra profile (main/notify.js)', () => {
  class FakeNotification { static isSupported() { return true; } on() {} show() {} }
  it('carries the profile on its buttons, and the default profile\'s do not', () => {
    const work = createNotifier({ Notification: FakeNotification, profile: 'p-12345678' }).toastXml({ title: 't', body: 'b', tag: 'r1' });
    expect(work).toContain('arguments="vex://snooze/r1?profile=p-12345678"');
    expect(work).toContain('launch="vex://open/r1?profile=p-12345678"');
    const def = createNotifier({ Notification: FakeNotification }).toastXml({ title: 't', body: 'b', tag: 'r1' });
    expect(def).toContain('arguments="vex://snooze/r1"');
    expect(P.profileArg(['Vex.exe', 'vex://snooze/r1?profile=p-12345678'])).toBe('p-12345678');
  });
});

describe('the profile IPC contracts (main/ipc-schemas.js)', () => {
  it('accepts profile ids and looks, and refuses paths and extra fields', () => {
    expect(() => validate('profiles:list', [])).not.toThrow();
    expect(() => validate('profiles:create', [{ name: 'Work', color: '#0ea5e9', icon: 'briefcase' }])).not.toThrow();
    expect(() => validate('profiles:update', ['default', { name: 'Home' }])).not.toThrow();
    expect(() => validate('profiles:open', ['p-12345678'])).not.toThrow();
    expect(() => validate('profiles:delete', ['..\\Vex'])).toThrow();
    expect(() => validate('profiles:create', [{ name: 'x', dir: 'C:\\' }])).toThrow();
    expect(() => validate('profiles:create', [{ name: 'x', color: 'url(x)' }])).toThrow();
  });
});

describe('main.js picks the profile before anything reads userData', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');
  it('selects the profile above the first userData read and the single-instance lock', () => {
    const select = src.indexOf("require('./main/profiles').selectProfile(");
    expect(select).toBeGreaterThan(0);
    expect(select).toBeLessThan(src.indexOf("app.getPath('userData')"));
    expect(select).toBeLessThan(src.indexOf('app.requestSingleInstanceLock()'));
    expect(select).toBeLessThan(src.indexOf('const userDataPath = '));
  });
});
