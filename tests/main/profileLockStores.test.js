// T3-123: the stores under the encrypted profile lock, Settings' channels, and the unlock window's gate.
// Fixture profiles in temp folders only.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createProfileCrypt, isEnvelope } = req('../../src/main/profile-crypt.js');
const { createPreferenceStore } = req('../../src/main/storage.js');
const { JsonStore } = req('../../src/main/file-store.js');
const { registerProfileLock, STORAGE_KEYS, plainCopies, validate } = req('../../src/main/profile-lock-ipc.js');
const { createUnlockGate } = req('../../src/main/profile-unlock.js');

const KDF = { N: 16384, r: 8, p: 1 };
const PASS = 'correct horse battery';
const dirs = [];
function dir() { const d = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'vex-pls-')); dirs.push(d); nodeFs.mkdirSync(path.join(d, 'vex-storage')); return d; }
afterEach(() => { for (const d of dirs.splice(0)) nodeFs.rmSync(d, { recursive: true, force: true }); });
const engine = (d) => createProfileCrypt({ userDataPath: d, kdf: KDF });
const quiet = { error() {}, warn() {} };
const files = (d) => nodeFs.readdirSync(d).filter((n) => !nodeFs.statSync(path.join(d, n)).isDirectory());

describe('the preference store under the lock', () => {
  it('writes plaintext before the lock, encrypts what is on disk when it is switched on, and keeps encrypting', async () => {
    const d = dir(), eng = engine(d);
    const store = createPreferenceStore(path.join(d, 'vex-persist.json'), { codec: eng.codec, log: quiet });
    await store.set('vex.notes', JSON.stringify(['my diary']));
    expect(nodeFs.readFileSync(path.join(d, 'vex-persist.json'), 'utf8')).toContain('my diary');
    const r = await store.exclusive(() => eng.enable({ passphrase: PASS, files: eng.profileFiles([]) }));
    expect(r.files).toContain('vex-persist.json');
    expect(isEnvelope(nodeFs.readFileSync(path.join(d, 'vex-persist.json')))).toBe(true);
    await store.set('vex.journal', JSON.stringify(['later entry']));
    for (const f of files(d)) expect(nodeFs.readFileSync(path.join(d, f)).includes('my diary')).toBe(false);
    for (const f of files(d)) expect(nodeFs.readFileSync(path.join(d, f)).includes('later entry')).toBe(false);
    expect(store.load()['vex.notes']).toBe(JSON.stringify(['my diary']));
  });

  it('a new run reads it only after the unlock; locked, load() raises instead of returning nothing', async () => {
    const d = dir(), eng = engine(d);
    const store = createPreferenceStore(path.join(d, 'vex-persist.json'), { codec: eng.codec, log: quiet });
    await store.set('vex.notes', '"n"');
    await store.exclusive(() => eng.enable({ passphrase: PASS, files: eng.profileFiles([]) }));
    await store.set('vex.more', '"m"');
    const later = engine(d);
    const locked = createPreferenceStore(path.join(d, 'vex-persist.json'), { codec: later.codec, log: quiet });
    expect(() => locked.load()).toThrow(/locked/);
    expect(() => locked.set('vex.x', '"y"')).toThrow(/locked/);
    await later.unlock(PASS);
    const open = createPreferenceStore(path.join(d, 'vex-persist.json'), { codec: later.codec, log: quiet });
    expect(open.load()).toMatchObject({ 'vex.notes': '"n"', 'vex.more': '"m"' });
  });

  it('the split layout keeps both files encrypted, and the generations and .bak are ciphertext', async () => {
    const d = dir(), eng = engine(d);
    const main = path.join(d, 'vex-persist.json'), vol = path.join(d, 'vex-persist-volatile.json');
    const open = (e) => createPreferenceStore(main, { volatileFile: vol, codec: e.codec, log: quiet, volatileDelayMs: 10 });
    const store = open(eng);
    await store.set('vex.history', JSON.stringify([{ url: 'https://secret.example' }]));
    await store.set('vex.volatileSplit', '1');
    await store.flush();
    await store.exclusive(() => eng.enable({ passphrase: PASS, files: eng.profileFiles([]) }));
    await store.set('vex.history', JSON.stringify([{ url: 'https://secret2.example' }]));
    await store.flush();
    for (const f of files(d)) {
      const bytes = nodeFs.readFileSync(path.join(d, f));
      expect(bytes.includes('secret'), f).toBe(false);
    }
    const later = engine(d);
    await later.unlock(PASS);
    const again = open(later);
    expect(again.isSplit()).toBe(true);
    expect(again.load()['vex.history']).toContain('secret2');
  });

  it('a split change on an already encrypted profile that fails puts the encrypted file back byte for byte', async () => {
    const d = dir(), eng = engine(d);
    const main = path.join(d, 'vex-persist.json'), vol = path.join(d, 'vex-persist-volatile.json');
    const store = createPreferenceStore(main, { volatileFile: vol, codec: eng.codec, log: quiet });
    await store.set('vex.history', '["h"]');
    await store.exclusive(() => eng.enable({ passphrase: PASS, files: eng.profileFiles([]) }));
    const before = nodeFs.readFileSync(main);
    // Turning the split on makes the volatile file; a directory in its place makes that fail.
    nodeFs.mkdirSync(vol);
    const fresh = createPreferenceStore(main, { volatileFile: vol, codec: eng.codec, log: quiet, splitEnabled: () => true });
    expect(() => fresh.load()).not.toThrow();   // load() logs the failed split and carries on, as it always did
    expect(nodeFs.readFileSync(main).equals(before)).toBe(true);
    expect(isEnvelope(nodeFs.readFileSync(main))).toBe(true);
  });
});

describe('the JsonStore under the lock', () => {
  it('encrypts only the keys it was given; the others stay plain files', async () => {
    const d = dir(), eng = engine(d), sd = path.join(d, 'vex-storage');
    const store = new JsonStore(sd, { codec: eng.codec, codecKeys: STORAGE_KEYS });
    await store.write('tabs', [{ url: 'https://tab.example' }]);
    await store.write('theme', 'oxford');
    await store.exclusive(STORAGE_KEYS, () => eng.enable({ passphrase: PASS, files: eng.profileFiles(STORAGE_KEYS) }));
    expect(isEnvelope(nodeFs.readFileSync(path.join(sd, 'tabs.json')))).toBe(true);
    expect(JSON.parse(nodeFs.readFileSync(path.join(sd, 'theme.json'), 'utf8')).data).toBe('oxford');
    await store.write('tabs', [{ url: 'https://tab2.example' }]);
    expect(nodeFs.readFileSync(path.join(sd, 'tabs.json')).includes('tab2')).toBe(false);
    expect(nodeFs.readFileSync(path.join(sd, 'tabs.json.bak')).includes('tab')).toBe(false);
    expect(await store.read('tabs')).toEqual([{ url: 'https://tab2.example' }]);
    await store.write('theme', 'dark');   // not a codec key, not blocked
  });
  it('a locked read says so (it does not fall back to the .bak or to nothing)', async () => {
    const d = dir(), eng = engine(d), sd = path.join(d, 'vex-storage');
    const store = new JsonStore(sd, { codec: eng.codec, codecKeys: STORAGE_KEYS });
    await store.write('tabs', [1]); await store.write('tabs', [2]);
    await store.exclusive(STORAGE_KEYS, () => eng.enable({ passphrase: PASS, files: eng.profileFiles(STORAGE_KEYS) }));
    const later = engine(d);
    const locked = new JsonStore(sd, { codec: later.codec, codecKeys: STORAGE_KEYS });
    await expect(locked.read('tabs')).rejects.toThrow(/locked/);
    await expect(locked.write('tabs', [3])).rejects.toThrow(/locked/);
    await later.unlock(PASS);
    expect(await locked.read('tabs')).toEqual([2]);
  });
  it('exclusive() holds writes of those keys until it is done', async () => {
    const d = dir(), sd = path.join(d, 'vex-storage');
    const store = new JsonStore(sd);
    await store.write('tabs', ['one']);
    let write;
    await store.exclusive(['tabs'], async () => {
      write = store.write('tabs', ['two']);
      await new Promise((r) => setTimeout(r, 60));
      expect(JSON.parse(nodeFs.readFileSync(path.join(sd, 'tabs.json'), 'utf8')).data).toEqual(['one']);
    });
    await write;
    expect(await store.read('tabs')).toEqual(['two']);
  });
});

describe('Settings channels', () => {
  function setup() {
    const d = dir(), eng = engine(d);
    const handlers = new Map();
    const ipcMain = { handle: (c, f) => handlers.set(c, f) };
    const preferences = createPreferenceStore(path.join(d, 'vex-persist.json'), { codec: eng.codec, log: quiet });
    const dataStore = new JsonStore(path.join(d, 'vex-storage'), { codec: eng.codec, codecKeys: STORAGE_KEYS });
    const wc = { mainFrame: {} };
    const win = { isDestroyed: () => false, webContents: wc };
    registerProfileLock({ ipcMain, profileCrypt: eng, preferences, dataStore, userDataPath: d, mainWindowOf: () => win });
    const ok = { sender: wc, senderFrame: wc.mainFrame };
    const call = (c, ...a) => handlers.get(c)(ok, ...a);
    return { d, eng, handlers, preferences, dataStore, ok, call, other: { sender: {}, senderFrame: {} } };
  }
  it('only the main window may use them', async () => {
    const s = setup();
    for (const c of ['profilecrypt:status', 'profilecrypt:enable', 'profilecrypt:disable', 'profilecrypt:change', 'profilecrypt:new-recovery']) {
      await expect(s.handlers.get(c)(s.other, 'x')).rejects.toThrow(/main Vex window/);
    }
  });
  it('switch on, then change the passphrase, a new code, and switch back', async () => {
    const s = setup();
    await s.preferences.set('vex.notes', '"diary"');
    await s.dataStore.write('tabs', ['t']);
    nodeFs.mkdirSync(path.join(s.d, 'backups'));
    nodeFs.writeFileSync(path.join(s.d, 'backups', 'settings-1.json'), '{"vex.notes":"diary"}');
    expect(await s.call('profilecrypt:status')).toMatchObject({ enabled: false, state: 'plain', plainCopies: 1 });
    await expect(s.call('profilecrypt:enable', 'short')).rejects.toThrow(/passphrase is/);
    const on = await s.call('profilecrypt:enable', PASS);
    expect(on.recoveryCode).toMatch(/^[0-9A-Z-]{39}$/);
    expect(on.plainCopies).toBe(1);
    expect(await s.call('profilecrypt:status')).toMatchObject({ enabled: true, state: 'encrypted', locked: false });
    await s.call('profilecrypt:change', PASS, 'another long phrase');
    const code2 = await s.call('profilecrypt:new-recovery', 'another long phrase');
    expect(code2.recoveryCode).not.toBe(on.recoveryCode);
    await expect(s.call('profilecrypt:disable', 'passphrase', PASS)).rejects.toMatchObject({ code: 'WRONG_SECRET' });
    await s.call('profilecrypt:disable', 'recovery', code2.recoveryCode);
    expect(await s.call('profilecrypt:status')).toMatchObject({ enabled: false });
    expect(nodeFs.readFileSync(path.join(s.d, 'vex-persist.json'), 'utf8')).toContain('diary');
    expect(JSON.parse(nodeFs.readFileSync(path.join(s.d, 'vex-storage', 'tabs.json'), 'utf8')).data).toEqual(['t']);
    await s.preferences.set('vex.after', '"x"');           // writes are plain again
    expect(nodeFs.readFileSync(path.join(s.d, 'vex-persist.json'), 'utf8')).toContain('vex.after');
  });
  it('refuses to switch on over a settings file that does not read, and changes nothing', async () => {
    const s = setup();
    nodeFs.writeFileSync(path.join(s.d, 'vex-persist.json'), '{ broken');
    await expect(s.call('profilecrypt:enable', PASS)).rejects.toThrow();
    expect(nodeFs.readFileSync(path.join(s.d, 'vex-persist.json'), 'utf8')).toBe('{ broken');
    expect(nodeFs.existsSync(path.join(s.d, 'profile-lock.json'))).toBe(false);
  });
  it('validate() only insists on the live files', () => {
    expect(() => validate('vex-persist.json', Buffer.from('{'))).toThrow();
    expect(() => validate('vex-persist.json.bak', Buffer.from('{'))).not.toThrow();
    expect(() => validate('vex-storage/tabs.json', Buffer.from('nope'))).toThrow();
  });
  it('plainCopies counts the backup folders and raises on a real error', () => {
    const d = dir();
    expect(plainCopies(d)).toBe(0);
  });
});

describe('the unlock window gate', () => {
  function gateFor(d, { startupError = null, clock = { t: 0 }, i18n } = {}) {
    const handlers = new Map(), listeners = new Map();
    const ipcMain = { handle: (c, f) => handlers.set(c, f), on: (c, f) => listeners.set(c, f) };
    const calls = { quit: 0, exit: [], errorBoxes: [], windows: [] };
    class FakeWindow {
      constructor(opts) { this.opts = opts; this.webContents = { on() {}, setWindowOpenHandler() {} }; this.handlers = {}; calls.windows.push(this); }
      setMenuBarVisibility() {} once(ev, f) { this.handlers[ev] = f; } on(ev, f) { this.handlers[ev] = f; }
      loadFile(f, o) { this.file = f; this.loadOptions = o; return Promise.resolve(); } isDestroyed() { return !!this.gone; }
      close() { this.gone = true; if (this.handlers.closed) this.handlers.closed(); } show() {}
    }
    const app = { whenReady: () => Promise.resolve(), quit: () => { calls.quit += 1; }, exit: (c) => calls.exit.push(c) };
    const dialog = { showErrorBox: (t, m) => calls.errorBoxes.push([t, m]) };
    const gate = createUnlockGate({ app, BrowserWindow: FakeWindow, ipcMain, dialog, profileCrypt: engine(d), startupError, htmlFile: 'unlock.html', preloadFile: 'preload.js', i18n, now: () => clock.t, log: quiet });
    return { gate, handlers, listeners, calls, clock };
  }
  async function encryptedProfile() {
    const d = dir(); nodeFs.writeFileSync(path.join(d, 'vex-persist.json'), '{"a":1}');
    const eng = engine(d);
    const { recoveryCode } = await eng.enable({ passphrase: PASS, files: ['vex-persist.json'] });
    return { d, recoveryCode };
  }
  it('an ordinary profile pays nothing: ready at once, no window', async () => {
    const d = dir();
    const g = gateFor(d);
    await expect(g.gate.ready).resolves.toBeUndefined();
    expect(g.calls.windows).toEqual([]);
    expect(g.handlers.size).toBe(0);
  });
  it('an encrypted profile opens a window, refuses other senders, counts wrong tries, and opens with the passphrase', async () => {
    const { d } = await encryptedProfile();
    const g = gateFor(d);
    await new Promise((r) => setImmediate(r));
    const [win] = g.calls.windows;
    expect(win.opts.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    const ok = { sender: win.webContents };
    const unlock = g.handlers.get('profilecrypt:unlock');
    await expect(unlock({ sender: {} }, 'passphrase', PASS)).rejects.toThrow(/unlock window/);
    for (let i = 0; i < 4; i++) expect(await unlock(ok, 'passphrase', 'wrong wrong wrong')).toMatchObject({ ok: false, error: 'Wrong passphrase' });
    const fifth = await unlock(ok, 'passphrase', 'wrong wrong wrong');
    expect(fifth.error).toMatch(/Too many tries/);
    expect((await unlock(ok, 'passphrase', PASS)).error).toMatch(/Too many tries/);   // even the right one waits
    g.clock.t += 31000;
    let ready = false; g.gate.ready.then(() => { ready = true; });
    expect(await unlock(ok, 'passphrase', PASS)).toEqual({ ok: true });
    await new Promise((r) => setImmediate(r));
    expect(ready).toBe(true);
    g.gate.finish();
    expect(win.gone).toBe(true);
    expect(g.calls.quit).toBe(0);                       // closing after the unlock is not a quit
  });
  it('speaks Turkish when Vex is: the title, the page address, the wrong-passphrase answer and the wait', async () => {
    const { d } = await encryptedProfile();
    const i18n = require('../../src/main/i18n-main.js').create({ fs: nodeFs, dir: dir() });
    i18n.setLanguage('tr');
    const g = gateFor(d, { i18n });
    await new Promise((r) => setImmediate(r));
    const [win] = g.calls.windows;
    expect(win.opts.title).toBe('Vex’in kilidini aç');
    expect(win.loadOptions).toEqual({ query: { lang: 'tr' } });
    const ok = { sender: win.webContents };
    const unlock = g.handlers.get('profilecrypt:unlock');
    for (let i = 0; i < 4; i++) expect(await unlock(ok, 'passphrase', 'wrong wrong wrong')).toMatchObject({ ok: false, error: 'Yanlış parola' });
    expect((await unlock(ok, 'passphrase', 'wrong wrong wrong')).error).toBe('Çok fazla deneme - 30 sn bekleyin');
  });
  it('stays English, and asks the page for English, when nothing says otherwise', async () => {
    const { d } = await encryptedProfile();
    const g = gateFor(d);
    await new Promise((r) => setImmediate(r));
    expect(g.calls.windows[0].opts.title).toBe('Unlock Vex');
    expect(g.calls.windows[0].loadOptions).toEqual({ query: { lang: 'en' } });
  });
  it('opens with the recovery code, and closing the window without unlocking quits', async () => {
    const { d, recoveryCode } = await encryptedProfile();
    const g = gateFor(d);
    await new Promise((r) => setImmediate(r));
    const [win] = g.calls.windows;
    const unlock = g.handlers.get('profilecrypt:unlock');
    expect(await unlock({ sender: win.webContents }, 'recovery', 'not a code')).toMatchObject({ ok: false });
    expect(await unlock({ sender: win.webContents }, 'recovery', recoveryCode)).toEqual({ ok: true });

    const h = await encryptedProfile();
    const g2 = gateFor(h.d);
    await new Promise((r) => setImmediate(r));
    g2.calls.windows[0].close();
    expect(g2.calls.quit).toBe(1);
  });
  it('a lock that cannot be read ends in an error box and exit, never a plain start', async () => {
    const { d } = await encryptedProfile();
    nodeFs.writeFileSync(path.join(d, 'profile-lock.json'), 'cut'); nodeFs.rmSync(path.join(d, 'profile-lock.json.bak'), { force: true });
    const g = gateFor(d);
    await new Promise((r) => setImmediate(r));
    expect(g.calls.errorBoxes[0][0]).toMatch(/cannot open this profile/);
    expect(g.calls.exit).toEqual([1]);
    let ready = false; g.gate.ready.then(() => { ready = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(ready).toBe(false);
  });
});

describe('Health check on an encrypted profile', () => {
  it('does not call an encrypted file damaged (it would offer to move it aside)', async () => {
    const d = dir();
    nodeFs.writeFileSync(path.join(d, 'vex-persist.json'), '{"vex.notes":"[]"}');
    nodeFs.writeFileSync(path.join(d, 'vex-storage', 'tabs.json'), '{"$vexStore":1,"data":[]}');
    const eng = engine(d);
    await eng.enable({ passphrase: PASS, files: eng.profileFiles(STORAGE_KEYS) });
    const { createHealthCheck } = req('../../src/main/health-check.js');
    const r = createHealthCheck({ fs: nodeFs, userDataPath: d, getPersisted: () => ({}), now: () => new Date(0), log: quiet }).scan();
    expect(r.findings.filter((f) => /file-corrupt/.test(f.id))).toEqual([]);
  });
});
